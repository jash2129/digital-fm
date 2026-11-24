/**
 * Coached rewordings are used at once, with no approval (2026-11-24): "instead of X say Y" in a
 * coaching session changes Max's words from his next line and in every later call.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { applyRephrasings, parseRephrase, lockedReason, findMaxWords, resetRephrasings, currentRephrasings } from "./learned-phrasing";
import { processControllerTurn, resetCallState, getOrCreateCallState, BEATS } from "./beat-controller";
import { COACH_APPLIED_LINE, COACH_DONE_LINE } from "./max-lines";
import { DEFAULT_DEAL_CONFIG } from "./deal-config";

const say = (sid: string, t: string) => processControllerTurn(sid, t, DEFAULT_DEAL_CONFIG);
function atBeat(beat: number) {
  const sid = `learn_${Math.random().toString(36).slice(2)}`;
  resetCallState(sid);
  const st = getOrCreateCallState(sid, DEFAULT_DEAL_CONFIG);
  st.step0_completed = true;
  st.current_beat = beat;
  st.delivered_beats = Array.from({ length: beat }, (_, i) => i + 1);
  st.last_spoken_text = BEATS.find((b) => b.id === beat)?.text ?? "";
  return { sid, st };
}

beforeEach(() => resetRephrasings());

describe("reading the rewording out of a coaching note", () => {
  it("the ways TXM phrases it", () => {
    expect(parseRephrase("instead of misinstalled, say it's a defect")).toEqual({ from: "misinstalled", to: "it's a defect" });
    expect(parseRephrase("Don't say no absolutely not, say and that's not fair to you.")).toEqual({ from: "no absolutely not", to: "and that's not fair to you" });
    expect(parseRephrase("say factory defect instead of mis built")).toEqual({ from: "mis built", to: "factory defect" });
    expect(parseRephrase("change 'thats a very good complementary warranty' to 'that's a good warranty'")).toEqual({ from: "thats a very good complementary warranty", to: "that's a good warranty" });
    expect(parseRephrase("rephrase right on as perfect")).toEqual({ from: "right on", to: "perfect" });
    expect(parseRephrase("don't say right on")).toEqual({ from: "right on", to: "" });
    expect(parseRephrase("speak more slowly here")).toBeNull();
  });

  it("finds Max's own spelling of the words", () => {
    expect(findMaxWords("misinstalled", "anything mis design or mis built or mis installed.")).toBe("mis installed");
    expect(findMaxWords("install", "mis installed")).toBeNull(); // whole words only
  });

  it("the price ladder and the recording disclosure cannot be reworded", () => {
    expect(lockedReason("four dollars a day", "two dollars a day")).toMatch(/price/);
    expect(lockedReason("this transaction is recorded", "this is a chat")).toMatch(/disclosure/);
    expect(lockedReason("right on", "perfect")).toBeNull();
  });
});

describe("applying it", () => {
  const rule = (from: string, to: string) => ({ id: "x", from, to, createdAt: 0, note: "" });

  it("replaces the words wherever Max says them, keeping a capital at the start", () => {
    const list = [rule("right on", "perfect")];
    expect(applyRephrasings("Right on. Mazda is like any other manufacturer.", list)).toBe("Perfect. Mazda is like any other manufacturer.");
    expect(applyRephrasings("that is right on, and", list)).toBe("that is perfect, and");
  });

  it("leaves words out when the note says only 'don't say'", () => {
    expect(applyRephrasings("Right on. Mazda is great.", [rule("Right on", "")])).toBe("Mazda is great.");
  });

  it("applying twice changes nothing", () => {
    const list = [rule("defect", "factory defect")];
    const once = applyRephrasings("it is a defect only", list);
    expect(once).toBe("it is a factory defect only");
    expect(applyRephrasings(once, list)).toBe(once);
  });
});

describe("in a call", () => {
  it("coached at Beat 7, used at once: Max confirms and says the new words from then on", async () => {
    const { sid, st } = atBeat(7);
    await say(sid, "Coach mode");
    await say(sid, "instead of mis installed, say installed wrong");
    const done = await say(sid, "done");
    expect(done.textToSpeak.startsWith(COACH_APPLIED_LINE)).toBe(true);
    expect(st.trainer_feedback![0].applied).toMatchObject({ from: "mis installed", to: "installed wrong" });
    expect(currentRephrasings()).toHaveLength(1);

    // A later call, back at Beat 6 -> 7
    const other = atBeat(6);
    const beat7 = await say(other.sid, "okay");
    expect(beat7.beatId).toBe(7);
    expect(beat7.textToSpeak).toContain("installed wrong");
    expect(beat7.textToSpeak).not.toMatch(/mis installed/i);
  });

  it("words Max never says are kept as a note, not applied", async () => {
    const { sid, st } = atBeat(9);
    await say(sid, "Coach mode, instead of banana say apple");
    const done = await say(sid, "done");
    expect(done.textToSpeak.startsWith(COACH_DONE_LINE)).toBe(true);
    expect(st.trainer_feedback![0].notApplied).toMatch(/never says/);
    expect(currentRephrasings()).toHaveLength(0);
  });

  it("a price cannot be coached away", async () => {
    const { sid, st } = atBeat(22);
    await say(sid, "coach mode don't say four dollars a day, say two dollars a day");
    await say(sid, "done");
    expect(st.trainer_feedback![0].notApplied).toMatch(/price/);
    expect(currentRephrasings()).toHaveLength(0);
  });
});
