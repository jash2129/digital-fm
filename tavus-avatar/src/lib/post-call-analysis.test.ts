import { describe, it, expect, vi, afterEach } from "vitest";
import { complianceChecks, parseJudgeReply, combineAnalysis, judgeCall } from "./post-call-analysis";
import { getOrCreateCallState, resetCallState } from "./beat-controller";
import type { HeygenCallLog } from "./heygen-logger";

const log = (maxSaid: string[]) =>
  ({
    sessionId: "pca",
    startTime: "2026-11-04T10:00:00.000Z",
    transcript: maxSaid.flatMap((text) => [
      { role: "assistant", text },
      { role: "user", text: "okay" },
    ]),
    timingLogs: [],
    bargeIns: [],
    turnLogs: [],
  }) as unknown as HeygenCallLog;

function stateAt(beat: number) {
  const sid = `pca_${beat}_${Math.random()}`;
  resetCallState(sid);
  const st = getOrCreateCallState(sid);
  st.current_beat = beat;
  st.delivered_beats = Array.from({ length: beat }, (_, i) => i + 1);
  return st;
}

describe("compliance checks", () => {
  it("all pass on a compliant call that reached the price", () => {
    const out = complianceChecks(
      log(["this transaction is recorded audio and video", "everything for only four dollars a day", "the best I can do is three dollars a day"]),
      stateAt(24)
    );
    expect(out).toBe("Disclosure given: PASS | Price never under $3/day: PASS | No human handoff promised: PASS");
  });

  it("flags a price under the floor, a handoff promise, and a skipped disclosure", () => {
    const out = complianceChecks(log(["I can do two dollars a day", "let me get a manager... a member of our team will call you"]), stateAt(23));
    expect(out).toContain("Disclosure given: FAIL");
    expect(out).toContain("Price never under $3/day: FAIL");
    expect(out).toContain("No human handoff promised: FAIL");
  });

  it("says 'not reached' when the call ended before it mattered", () => {
    expect(complianceChecks(log(["Can you hear and see me alright?"]), stateAt(0))).toBe(
      "Disclosure given: not reached | Price never under $3/day: not reached | No human handoff promised: PASS"
    );
  });
});

describe("the AI review's reply", () => {
  it("reads the JSON even with text around it, and trims the lists", () => {
    const r = parseJudgeReply(
      'Here you go:\n{"score": 4, "summary": "Short call.", "sentiment": "Frustrated: kept getting cut off", "wentWrong": ["a","b","c","d","e","f"], "wentWell": ["x","y","z","w"], "fixes": ["1","2","3","4"]}'
    );
    expect(r).toEqual({
      score: 4,
      summary: "Short call.",
      sentiment: "Frustrated: kept getting cut off",
      wentWrong: ["a", "b", "c", "d", "e"],
      wentWell: ["x", "y", "z"],
      fixes: ["1", "2", "3"],
    });
  });

  it("rejects replies that are not usable", () => {
    expect(parseJudgeReply("no json here")).toBeNull();
    expect(parseJudgeReply('{"score": 42}')).toBeNull();
    expect(parseJudgeReply("{broken")).toBeNull();
  });
});

describe("combined analysis", () => {
  it("without the AI review, the row still gets the verdict, timing problems and compliance", () => {
    const a = combineAnalysis(log(["Can you hear and see me alright?"]), undefined, null);
    expect(a.aiScore).toBe("");
    expect(a.callSummary).toBe("(AI review unavailable for this call)");
    expect(a.aiVerdict).toMatch(/^(Poor|Needs Improvement|Good|Excellent): /);
    expect(a.complianceCheck).toContain("Disclosure given:");
  });

  it("with the AI review, its problems come first and every list is bulleted", () => {
    const a = combineAnalysis(log(["hi"]), undefined, {
      score: 7,
      summary: "S",
      sentiment: "Neutral",
      wentWrong: ["Cut the customer off"],
      wentWell: ["Clear disclosure"],
      fixes: ["Wait longer"],
    });
    expect(a.aiScore).toBe(7);
    expect(a.problemsFound.split("\n")[0]).toBe("• Cut the customer off");
    expect(a.wentWell).toBe("• Clear disclosure");
    expect(a.suggestedFixes).toBe("• Wait longer");
  });
});

describe("calling the reviewer", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("returns null without an API key, and on a failed request", async () => {
    vi.stubEnv("XAI_API_KEY", "");
    vi.stubEnv("OPENAI_API_KEY", "");
    expect(await judgeCall("Max: hi", "facts")).toBeNull();

    vi.stubEnv("OPENAI_API_KEY", "k");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
    expect(await judgeCall("Max: hi", "facts")).toBeNull();
  });

  it("parses a good reply", async () => {
    vi.stubEnv("XAI_API_KEY", "");
    vi.stubEnv("OPENAI_API_KEY", "k");
    const reply = { score: 6, summary: "s", sentiment: "Neutral", wentWrong: [], wentWell: [], fixes: [] };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(reply) } }] }) })
    );
    expect((await judgeCall("Max: hi", "facts"))?.score).toBe(6);
  });
});

describe("a log the turn-taking analyzer cannot read", () => {
  it("still produces a row instead of failing the whole send", () => {
    const odd = { ...log(["hi"]), timingLogs: [{ stageMs: { total: 3000 } }] } as unknown as HeygenCallLog;
    const a = combineAnalysis(odd, undefined, null);
    expect(a.aiVerdict).toBe("Unknown: turn-taking analysis unavailable for this call");
    expect(a.complianceCheck).toContain("Disclosure given:");
  });
});
