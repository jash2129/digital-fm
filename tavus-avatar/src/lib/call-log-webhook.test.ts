import { describe, it, expect, vi, afterEach } from "vitest";
import { buildCallLogPayload, sendCallLog, MAX_RECORDING_BYTES } from "./call-log-webhook";
import { getOrCreateCallState, resetCallState } from "./beat-controller";
import type { HeygenCallLog } from "./heygen-logger";
import { UNKNOWN_QUESTION_LINE } from "./max-lines";

const LOG = {
  sessionId: "d4711cfb-1c84-45eb-b0ce-7d042d5dfce6",
  engine: "heygen-grok",
  avatarId: "liveavatar",
  avatarName: "Max",
  startTime: "2026-11-03T09:46:34.900Z",
  endTime: "2026-11-03T09:47:58.917Z",
  durationSeconds: 84,
  status: "completed",
  finalDailyRate: 4,
  transcript: [
    { role: "assistant", text: "Can you hear and see me alright?", timestamp: "" },
    { role: "user", text: "yes", timestamp: "" },
    { role: "assistant", text: `${UNKNOWN_QUESTION_LINE} Would you like me to continue?`, timestamp: "" },
    { role: "user", text: "can we start over", timestamp: "" },
  ],
  timingLogs: [{ stageMs: { total: 3000 } }, { stageMs: { total: 6600 } }, { gaps: { total_latency_ms: 2400 } }],
  bargeIns: [{}, {}],
  turnLogs: [
    { event: "transcript_dropped", reason: "echo_fragment" },
    { event: "transcript_dropped", reason: "avatar_echo" },
    { event: "transcript_dropped", reason: "stale" },
  ],
} as unknown as HeygenCallLog;

const opts = { secret: "s3cret", origin: "https://max.example", environment: "local" };

describe("call log sheet payload", () => {
  it("fills every automatic column from the saved log", () => {
    const p = buildCallLogPayload(LOG, opts);
    expect(p).toMatchObject({
      secret: "s3cret",
      callId: LOG.sessionId,
      startTime: LOG.startTime,
      durationSec: 84,
      environment: "local",
      customerTurns: 2,
      avgReplyMs: 4000,
      slowestReplyMs: 6600,
      interruptions: 2,
      echoDrops: 2,
      unknownReplies: 1,
      inspectorUrl: `https://max.example/inspector?session=${LOG.sessionId}`,
      recordingBase64: "",
      recordingMimeType: "audio/webm",
    });
    expect(p.transcriptText.split("\n")[0]).toBe("Max: Can you hear and see me alright?");
    expect(p.transcriptText).toContain("Customer: can we start over");
    expect(JSON.parse(p.logJson).sessionId).toBe(LOG.sessionId);
  });

  it("reports the furthest beat and how the call ended from the live call state", () => {
    const sid = "calllog_state";
    resetCallState(sid);
    const st = getOrCreateCallState(sid);
    st.current_beat = 9;
    st.delivered_beats = [1, 2, 3, 4, 5, 6, 7, 8, 9];
    const p = buildCallLogPayload(LOG, { ...opts, state: st });
    expect(p.furthestBeat).toBe(9);
    expect(p.endedHow).toBe("customer ended the call");
    // No price was offered before Beat 22, so none is reported
    expect(p.finalPrice).toBe("");

    st.current_beat = 25;
    st.is_stopped = true;
    const done = buildCallLogPayload({ ...LOG, finalDailyRate: 3.25 } as HeygenCallLog, { ...opts, state: st });
    expect(done.endedHow).toBe("script complete");
    expect(done.finalPrice).toBe(3.25);
  });

  it("attaches the recording, unless it is too big for the webhook", () => {
    const small = buildCallLogPayload(LOG, { ...opts, recording: Buffer.from("audio") });
    expect(Buffer.from(small.recordingBase64, "base64").toString()).toBe("audio");
    const big = buildCallLogPayload(LOG, { ...opts, recording: Buffer.alloc(MAX_RECORDING_BYTES + 1) });
    expect(big.recordingBase64).toBe("");
  });
});

describe("sending", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("does nothing without a webhook URL (tests and local runs never post)", async () => {
    vi.stubEnv("CALL_LOG_WEBHOOK_URL", "");
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    expect(await sendCallLog("anything", "http://x")).toEqual({ sent: false, reason: "CALL_LOG_WEBHOOK_URL not set" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
