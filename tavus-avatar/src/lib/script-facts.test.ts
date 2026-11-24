/**
 * Phase 3 (2026-11-24): wrong facts and lines from TXM's coaching. Labor is $180-$200 an hour
 * (confirmed 2026-11-24); "premature wear and tear" (#12); no "I hear you" / "long day"; warranty,
 * defect and labor questions answered from Beats 6, 7 and 15.
 */
import { describe, it, expect } from "vitest";
import {
  processControllerTurn,
  resetCallState,
  getOrCreateCallState,
  getFullBeatUtterance,
  scriptFactAnswer,
  LABOR_ANSWER,
  DEFECT_ANSWER,
  BEAT_RECAPS,
  BEATS,
} from "./beat-controller";
import * as lines from "./max-lines";
import { DEFAULT_DEAL_CONFIG } from "./deal-config";

const say = (sid: string, t: string) => processControllerTurn(sid, t, DEFAULT_DEAL_CONFIG);
function atBeat(beat: number) {
  const sid = `facts_${Math.random().toString(36).slice(2)}`;
  resetCallState(sid);
  const st = getOrCreateCallState(sid, DEFAULT_DEAL_CONFIG);
  st.step0_completed = true;
  st.current_beat = beat;
  st.delivered_beats = Array.from({ length: beat }, (_, i) => i + 1);
  st.last_spoken_text = BEATS.find((b) => b.id === beat)?.text ?? "";
  return sid;
}
const beat = (id: number) => getFullBeatUtterance(BEATS.find((b) => b.id === id)!, DEFAULT_DEAL_CONFIG);

describe("what Max says in the beats", () => {
  it("Beat 15: labor is one hundred eighty to two hundred dollars an hour", () => {
    expect(beat(15)).toContain("one hundred eighty to two hundred dollars per hour");
    expect(beat(15)).not.toMatch(/thirty|sixty dollars per hour/);
    expect(beat(15)).not.toContain("hoursof");
    expect(BEAT_RECAPS[15]).toContain("one hundred eighty to two hundred dollars");
  });

  it("Beat 8: 'premature wear and tear' (TXM #12)", () => {
    expect(beat(8)).toContain("premature wear and tear on the vehicle");
    expect(beat(8)).not.toContain("a premature to");
  });

  it("no 'I hear you' or 'long day' in any of Max's lines", () => {
    for (const [name, v] of Object.entries(lines)) {
      if (typeof v === "string") expect(v, name).not.toMatch(/I hear you|long day/i);
    }
  });
});

describe("warranty, defect and labor questions during the explanation", () => {
  it("'explain the warranty' gets both warranties of the car on the deal, and 'defect only'", async () => {
    for (const q of ["Can you explain the warranty?", "explain the warranty again", "what is the factory warranty?"]) {
      const d = await say(atBeat(9), q);
      expect(d.intent, q).toBe("script_fact");
      expect(d.textToSpeak, q).toContain("Mazda comes with two factory warranties");
      expect(d.textToSpeak, q).toContain("defects only");
      expect(d.textToSpeak, q).not.toContain(lines.UNKNOWN_QUESTION_LINE);
      expect(d.beatId, q).toBe(9);
      expect(d.beatType, q).toBe("continue");
    }
  });

  it("'what does that cover?' right after the warranty beats", async () => {
    expect((await say(atBeat(7), "what does that cover?")).textToSpeak).toContain("two factory warranties");
  });

  it("defect questions get the Beat 7 answer", async () => {
    for (const q of ["what does defect only mean?", "so it's a defect?", "what do you mean by misinstalled?"]) {
      const d = await say(atBeat(10), q);
      expect(d.textToSpeak.startsWith(DEFECT_ANSWER), q).toBe(true);
    }
  });

  it("'how much is labor?' is answered, not taken as a price question", async () => {
    const d = await say(atBeat(16), "how much is labor?");
    expect(d.textToSpeak.startsWith(LABOR_ANSWER)).toBe(true);
    expect(d.beatId).toBe(16);
  });

  it("not used for the protection package, or outside the explanation", () => {
    const st = getOrCreateCallState(atBeat(17), DEFAULT_DEAL_CONFIG);
    expect(scriptFactAnswer("what is the bumper to bumper warranty?", st)).toBeNull();
    expect(scriptFactAnswer("explain the warranty", st)).toBeNull();
    st.current_beat = 4;
    expect(scriptFactAnswer("explain the warranty", st)).toBeNull();
    st.current_beat = 9;
    expect(scriptFactAnswer("does the warranty cover my battery?", st)).toBeNull();
  });
});
