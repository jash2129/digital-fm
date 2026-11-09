/**
 * Fixes from the first real test calls (call log sheet, 2026-11-08): moments that went wrong, replayed.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { processControllerTurn, repromptText, getOrCreateCallState, resetCallState, BEATS, classifyCustomerInputRuleBased } from "./beat-controller";
import { DEFAULT_DEAL_CONFIG } from "./deal-config";
import { GARBLED_LINE, STEP_0_CHECKIN_LINE, STEP_0_GREETING, STILL_WITH_ME_LINE } from "./max-lines";
import { SILENCE_PROMPT_MS } from "./turn-taking";
import { sendCallLog } from "./call-log-webhook";
import type { HeygenCallLog } from "./heygen-logger";

const say = (sid: string, text: string) => processControllerTurn(sid, text, DEFAULT_DEAL_CONFIG);
function atBeat(beat: number) {
  const sid = `tcf_${Math.random().toString(36).slice(2)}`;
  resetCallState(sid);
  const st = getOrCreateCallState(sid);
  st.step0_completed = true;
  st.current_beat = beat;
  st.delivered_beats = Array.from({ length: beat }, (_, i) => i + 1);
  st.last_spoken_text = BEATS.find((b) => b.id === beat)?.text ?? "";
  return sid;
}

describe("silence before Beat 1 re-asks the last question, not the tech check (0a970976, 07cdf16e)", () => {
  it("after the opener: 'Are you still with me? How has your experience been…'", async () => {
    const sid = `tcf_${Math.random()}`;
    resetCallState(sid);
    await say(sid, "Hi. How are you today?");
    expect(repromptText(sid, "still_with_me")).toBe(`${STILL_WITH_ME_LINE} ${STEP_0_CHECKIN_LINE}`);
    expect(repromptText(sid, "clarify")).toBe(STEP_0_CHECKIN_LINE);
  });

  it("before anything was said, it is still the tech check", () => {
    const sid = `tcf_${Math.random()}`;
    resetCallState(sid);
    expect(repromptText(sid, "resume")).toBe(STEP_0_GREETING);
  });

  it("waits 12 s, not 7, before asking 'Are you still with me?'", () => {
    expect(SILENCE_PROMPT_MS).toBe(12000);
  });
});

describe("one-word fragments are not answers (7cfcc156, ccbf6324, 888ec8fb)", () => {
  it.each([
    [23, "up"],
    [2, "There"],
    [4, "years"],
    [7, "Are"],
    [9, "Can"],
  ] as const)("Beat %i: '%s' is not understood: Max says so and asks his question again", async (beat, said) => {
    const t = await say(atBeat(beat), said);
    expect(t.intent).toBe("garbled");
    expect(t.beatId).toBe(beat);
    expect(t.textToSpeak.startsWith(`${GARBLED_LINE} `)).toBe(true);
    expect(t.textToSpeak).toMatch(/\?$/);
  });

  it("'up' at the coverage question never confirms the package", async () => {
    const t = await say(atBeat(23), "up");
    expect(t.textToSpeak).not.toMatch(/moving forward|finalize/i);
  });

  it.each(["yes", "proceed", "okay", "right", "understand", "continue"])("a real one-word answer still counts: '%s'", (said) => {
    expect(classifyCustomerInputRuleBased(said, 9).intent).not.toBe("garbled");
  });

  it("Step 0: 'There' re-asks the check-in once instead of 'Thanks for sharing that'", async () => {
    const sid = `tcf_${Math.random()}`;
    resetCallState(sid);
    await say(sid, "Yeah");
    const t = await say(sid, "There");
    expect(t.textToSpeak).toBe(STEP_0_CHECKIN_LINE);
    expect(t.beatId).toBe(0);
    // Only once: a second fragment moves on rather than looping
    expect((await say(sid, "There")).beatId).toBe(1);
  });
});

describe("a plain 'no' to the price moves down the approved ladder (888ec8fb)", () => {
  it("'no' to $4 offers $3.50, a second 'no' offers $3.25, never below the floor", async () => {
    const sid = atBeat(22);
    const first = await say(sid, "no");
    expect(first.intent).toBe("negotiate_price");
    expect(first.textToSpeak).toContain("three dollars and fifty cents");
    const second = await say(sid, "no thanks");
    expect(second.textToSpeak).toContain("three dollars and twenty-five cents");
  });

  it("'no' before the price is still an ordinary no", () => {
    expect(classifyCustomerInputRuleBased("no", 9).intent).not.toBe("negotiate_price");
  });
});

describe("a call is sent to the sheet once, even from two servers (duplicate rows)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("another server already sent it: this one does not send again", async () => {
    vi.stubEnv("CALL_LOG_WEBHOOK_URL", "https://hook.example/make");
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://fake.upstash.io");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "t");
    const posted: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: { body: string }) => {
        if (url.startsWith("https://fake.upstash.io")) {
          // max:sent:<id> already exists (SET NX answers null); logs are not stored
          const out = (JSON.parse(init.body) as string[][]).map(() => ({ result: null }));
          return { ok: true, json: async () => out };
        }
        posted.push(url);
        return { ok: true, status: 200, json: async () => ({}) };
      })
    );
    const log = { sessionId: `dup_${Math.random()}`, startTime: "2026-11-08T09:02:08.858Z", transcript: [] } as unknown as HeygenCallLog;
    expect(await sendCallLog(log.sessionId, "https://digital-fm.vercel.app", { log })).toEqual({ sent: false, reason: "already sent" });
    expect(posted).toHaveLength(0);
  });
});
