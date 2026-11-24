/**
 * Phase 6 (2026-11-24): Max learns from TXM's coaching and from all calls, with no approval.
 *  - coaching about timing ("don't cut me off", "don't snooze") changes the timing in every call
 *  - in a call, a customer Max cut off gets a longer wait for the rest of that call
 *  - the nightly report reads new calls, finds problems, and makes Max wait longer when customers
 *    keep getting cut off
 */
import { describe, it, expect, beforeEach } from "vitest";
import { settingsFromNote, adjustSetting, currentSettings, resetSettingsForTest, SETTING_BOUNDS } from "./learned-settings";
import { buildReport, applySignals } from "./learning-report";
import { adaptedWaitMs, isCutOff, IN_CALL_EXTRA_MAX_MS } from "./turn-taking";
import { processControllerTurn, resetCallState, getOrCreateCallState, BEATS } from "./beat-controller";
import { resetRephrasings } from "./learned-phrasing";
import { COACH_APPLIED_LINE, UNKNOWN_QUESTION_LINE } from "./max-lines";
import { DEFAULT_DEAL_CONFIG } from "./deal-config";
import type { StoredCallLog } from "./call-log-store";

beforeEach(() => {
  resetSettingsForTest();
  resetRephrasings();
});

describe("timing from coaching", () => {
  it("TXM's words map to the right knob", () => {
    expect(settingsFromNote("you keep cutting me off, let me finish")).toEqual([{ key: "endOfTurnExtraMs", delta: 300, reason: expect.any(String) }]);
    expect(settingsFromNote("don't snooze, keep it moving")).toEqual([{ key: "continuePauseMs", delta: -300, reason: expect.any(String) }]);
    expect(settingsFromNote("give the customer a moment between parts")).toEqual([{ key: "continuePauseMs", delta: 500, reason: expect.any(String) }]);
    expect(settingsFromNote("say defect instead of misinstalled")).toEqual([]);
  });

  it("stays inside its bounds", async () => {
    for (let i = 0; i < 10; i++) await adjustSetting("endOfTurnExtraMs", 300, "coaching", "t");
    expect(currentSettings().endOfTurnExtraMs).toBe(SETTING_BOUNDS.endOfTurnExtraMs.max);
    expect(await adjustSetting("endOfTurnExtraMs", 300, "coaching", "t")).toBeNull();
    for (let i = 0; i < 10; i++) await adjustSetting("continuePauseMs", -300, "coaching", "t");
    expect(currentSettings().continuePauseMs).toBe(SETTING_BOUNDS.continuePauseMs.min);
  });

  it("in a call: 'coach mode, you're cutting me off' changes the timing at once and Max confirms", async () => {
    const sid = `sl_${Math.random().toString(36).slice(2)}`;
    resetCallState(sid);
    const st = getOrCreateCallState(sid, DEFAULT_DEAL_CONFIG);
    st.step0_completed = true;
    st.current_beat = 9;
    st.delivered_beats = Array.from({ length: 9 }, (_, i) => i + 1);
    st.last_spoken_text = BEATS.find((b) => b.id === 9)!.text;
    await processControllerTurn(sid, "coach mode, you're cutting me off, let me finish", DEFAULT_DEAL_CONFIG);
    const done = await processControllerTurn(sid, "done", DEFAULT_DEAL_CONFIG);
    expect(done.textToSpeak.startsWith(COACH_APPLIED_LINE)).toBe(true);
    expect(currentSettings().endOfTurnExtraMs).toBe(300);
    expect(st.trainer_feedback![0].settingsChanged).toEqual(["endOfTurnExtraMs 0 -> 300"]);
  });
});

describe("in-call adaptation", () => {
  it("a real sentence early in Max's line is a cut-off; a late 'okay' is not", () => {
    expect(isCutOff(800, 6)).toBe(true);
    expect(isCutOff(800, 1)).toBe(false);
    expect(isCutOff(9000, 6)).toBe(false);
  });

  it("the wait grows with what was learned, within limits", () => {
    expect(adaptedWaitMs(900, 0, 0)).toBe(900);
    expect(adaptedWaitMs(900, 300, 250)).toBe(1450);
    expect(adaptedWaitMs(900, 5000, 5000)).toBe(900 + 1000 + IN_CALL_EXTRA_MAX_MS);
  });
});

function call(id: string, opts: { cutOffs?: number; lastBeat?: number; unknown?: string; repeatsAt?: number } = {}): StoredCallLog {
  const last = opts.lastBeat ?? 25;
  return {
    sessionId: id,
    engine: "heygen-grok",
    avatarId: "a",
    avatarName: "Max",
    startTime: "2026-11-24T10:00:00Z",
    endTime: null,
    durationSeconds: 300,
    status: "completed",
    transcript: [],
    turnLogs: [
      { ts: "", rawTranscript: "yes", avatarSpeaking: false, intent: "agree", beatBefore: 1, beatAfter: 2, reason: "" },
      { ts: "", rawTranscript: "what?", avatarSpeaking: false, intent: opts.repeatsAt ? "repeat_request" : "agree", beatBefore: opts.repeatsAt ?? 2, beatAfter: 3, reason: "" },
      { ts: "", rawTranscript: "ok", avatarSpeaking: false, intent: "agree", beatBefore: 3, beatAfter: last, reason: "" },
    ],
    timingLogs: opts.unknown
      ? [{ turnId: 1, userInput: opts.unknown, avatarText: `${UNKNOWN_QUESTION_LINE}`, controller: { beatBefore: 9 } as never, timestamps: {} as never, gaps: { total_latency_ms: 1800 } as never }]
      : [],
    bargeIns: Array.from({ length: opts.cutOffs ?? 0 }, () => ({ timestamp: 0, spokenText: "wait I was still talking", avatarTextWhenInterrupted: "", honored: true, words: 5, msIntoLine: 900 })),
  } as StoredCallLog;
}

describe("the nightly report", () => {
  it("finds unanswered questions, confusing beats and where calls stop", () => {
    const r = buildReport([
      call("a", { unknown: "can I cancel later?", repeatsAt: 12, lastBeat: 14 }),
      call("b", { unknown: "Can I cancel later", repeatsAt: 12, lastBeat: 14 }),
      call("c"),
    ]);
    expect(r.totals.calls).toBe(3);
    expect(r.totals.completed).toBe(1);
    expect(r.unanswered[0]).toMatchObject({ count: 2, beat: 9 });
    expect(r.byBeat[12].repeats).toBe(2);
    expect(r.byBeat[14].endedHere).toBe(2);
    expect(r.findings.join(" ")).toMatch(/could not answer/);
    expect(r.findings.join(" ")).toMatch(/Beat 12/);
  });

  it("customers cut off in most calls -> Max waits 200 ms longer, on his own", async () => {
    const r = buildReport([call("a", { cutOffs: 2 }), call("b", { cutOffs: 1 }), call("c", { cutOffs: 1 })]);
    const actions = await applySignals(r);
    expect(actions).toHaveLength(1);
    expect(currentSettings().endOfTurnExtraMs).toBe(200);
    expect(currentSettings().history.at(-1)).toMatchObject({ source: "signals" });
  });

  it("no change from one call, or when nobody was cut off", async () => {
    expect(await applySignals(buildReport([call("a", { cutOffs: 5 })]))).toHaveLength(0);
    expect(await applySignals(buildReport([call("a"), call("b"), call("c")]))).toHaveLength(0);
    expect(currentSettings().endOfTurnExtraMs).toBe(0);
  });
});
