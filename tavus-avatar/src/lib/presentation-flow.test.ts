/**
 * Phase 2 (2026-11-24): Max presents smoothly. In TXM's last 10 test calls about 40% of Max's lines
 * were check-ins and whole paragraphs came back 4-6 times. TXM: "don't ask if I understand, just
 * continue with the presentation", "assume and keep going", "don't snooze".
 */
import { describe, it, expect } from "vitest";
import {
  processControllerTurn,
  resetCallState,
  getOrCreateCallState,
  getFullBeatUtterance,
  isCarryOn,
  isPresentationBeat,
  stripCheckIns,
  beatRecap,
  BEATS,
  BEAT_RECAPS,
} from "./beat-controller";
import { CLARIFY_LINE, LEAD_IN_NO } from "./max-lines";
import { CONTINUE_PAUSE_MS } from "./turn-taking";
import { DEFAULT_DEAL_CONFIG } from "./deal-config";

const say = (sid: string, t: string) => processControllerTurn(sid, t, DEFAULT_DEAL_CONFIG);
function atBeat(beat: number) {
  const sid = `flow_${Math.random().toString(36).slice(2)}`;
  resetCallState(sid);
  const st = getOrCreateCallState(sid, DEFAULT_DEAL_CONFIG);
  st.step0_completed = true;
  st.current_beat = beat;
  st.delivered_beats = Array.from({ length: beat }, (_, i) => i + 1);
  st.last_spoken_text = BEATS.find((b) => b.id === beat)?.text ?? "";
  return sid;
}
const CHECK_INS = /\b(right\?|you understand\?|are you with me\?|does that make sense\?|does that help clarify things\?)$/i;

describe("no check-ins during the explanation (Beats 6-21)", () => {
  it("no beat from 6 to 21 ends with its check-in", () => {
    const st = getOrCreateCallState(atBeat(5), DEFAULT_DEAL_CONFIG);
    for (const b of BEATS.filter((x) => isPresentationBeat(x.id))) {
      const said = getFullBeatUtterance(b, st.dealConfig, st);
      expect(said, `Beat ${b.id}`).not.toMatch(CHECK_INS);
      expect(said, `Beat ${b.id}`).not.toContain(CLARIFY_LINE);
    }
  });

  it("a question beat outside the explanation keeps its check-in (Beat 5: 'Is that okay?')", () => {
    for (const id of [5]) expect(getFullBeatUtterance(BEATS.find((b) => b.id === id)!, DEFAULT_DEAL_CONFIG), `Beat ${id}`).toContain("?");
  });

  it("a whole explanation said with 'okay' flows from Beat 6 to the price with no check-in and no repeat", async () => {
    const sid = atBeat(5);
    const lines: string[] = [];
    let d = await say(sid, "yes");
    for (let i = 0; i < 30 && d.beatId < 22; i++) {
      lines.push(d.textToSpeak);
      expect(d.beatType, `Beat ${d.beatId}`).toBe("continue");
      d = await say(sid, "proceed");
    }
    expect(d.beatId).toBe(22);
    for (const l of lines) expect(l).not.toMatch(CHECK_INS);
    expect(new Set(lines).size).toBe(lines.length);
  });

  it("strips the check-ins Max used to add, and keeps real questions", () => {
    expect(stripCheckIns(`I don't have that detail. ${CLARIFY_LINE}`)).toBe("I don't have that detail.");
    expect(stripCheckIns("…it covers factory defects only... You understand?")).toBe("…it covers factory defects only.");
    expect(stripCheckIns("Which part would you like me to explain?")).toBe("Which part would you like me to explain?");
  });
});

describe("answers and unclear turns mid-explanation", () => {
  it("an unclear remark carries on instead of 'continue, or go over that again?'", async () => {
    const d = await say(atBeat(9), "my neighbor bought one of these last spring and liked it");
    expect(d.textToSpeak).not.toContain(CLARIFY_LINE);
    expect(d.textToSpeak).not.toMatch(/\?$/);
    expect(d.beatId === 10 || d.beatType === "continue").toBe(true);
  });

  it("an unanswerable question: the honest line, then on after the pause", async () => {
    const d = await say(atBeat(8), "what about hail?");
    expect(d.textToSpeak).not.toContain(CLARIFY_LINE);
    expect(d.beatType).toBe("continue");
    expect(d.beatId).toBe(8);
  });

  it("a lone word (a cut-off question) never jumps ahead", async () => {
    for (const w of ["Are", "Can", "so..."]) expect((await say(atBeat(7), w)).beatId, w).toBe(7);
  });
});

describe("a paragraph is said in full only once", () => {
  it("'no' and 'I'm confused' get the one-line recap, never LEAD_IN_NO plus the whole paragraph", async () => {
    for (const t of ["no", "I'm confused"]) {
      const d = await say(atBeat(12), t);
      expect(d.textToSpeak, t).toBe(BEAT_RECAPS[12]);
      expect(d.textToSpeak, t).not.toContain(LEAD_IN_NO);
      expect(d.beatType, t).toBe("continue");
    }
  });

  it("outside the explanation 'no' still goes over the beat again", async () => {
    const d = await say(atBeat(4), "no");
    expect(d.textToSpeak).not.toBe(BEAT_RECAPS[4] ?? "-");
  });
});

describe("carry-on phrases", () => {
  it("recognised", () => {
    for (const t of ["keep going", "Okay, keep going please", "proceed", "next", "skip", "skip that", "move on", "Stop repeating yourself", "you already said that", "got it", "what's next"]) {
      expect(isCarryOn(t), t).toBe(true);
    }
    for (const t of ["no", "what does that mean", "I don't want to move on", "keep going with what?", "next year I might"]) expect(isCarryOn(t), t).toBe(false);
  });

  it("move to the next part at once", async () => {
    for (const t of ["keep going", "stop repeating yourself", "skip"]) {
      const d = await say(atBeat(8), t);
      expect(d.beatId, t).toBe(9);
    }
  });

  it("outside the explanation they answer nothing: 'next' at the test drive question is not a yes", async () => {
    const d = await say(atBeat(2), "next");
    expect(d.beatId).toBe(2);
  });
});

describe("the warranty recap names the car on the deal (TXM's brand table)", () => {
  it("Mazda's own figures, not Hyundai's", () => {
    const st = getOrCreateCallState(atBeat(6), DEFAULT_DEAL_CONFIG);
    const r = beatRecap(6, st);
    expect(r).toContain(st.dealConfig.vehicle_make);
    expect(r).toMatch(/base warranty/);
  });

  it("an unknown make gets the neutral recap, with no figures", () => {
    const st = getOrCreateCallState(atBeat(6), DEFAULT_DEAL_CONFIG);
    st.dealConfig = { ...st.dealConfig, vehicle_make: "Zzyzx" };
    expect(beatRecap(6, st)).toBe(BEAT_RECAPS[6]);
    expect(BEAT_RECAPS[6]).not.toMatch(/thousand|years/);
  });
});

it("the pause between parts is 1.5 s (was 3.5 s)", () => {
  expect(CONTINUE_PAUSE_MS).toBe(1500);
});
