/**
 * Multi-turn regressions: bugs that only show up when a customer keeps talking after Max's
 * first reply. Each test drives the real controller (processControllerTurn) through several
 * turns on one session, offline (rule-based classifier, no LLM keys needed).
 *
 * Human escalation was removed by the client: Max must never stop the call or offer a handoff
 * because of a question.
 */
import { describe, it, expect } from "vitest";
import {
  processControllerTurn,
  getOrCreateCallState,
  resetCallState,
  renderBeatText,
  formatSpeechText,
  BEATS,
  type ControllerDecision,
} from "./beat-controller";
import { HANDOFF_LINE, CLARIFY_LINE, CLOSING_LINE, UNKNOWN_QUESTION_LINE } from "./max-lines";

function fresh(beat: number) {
  const sid = `multi_${Math.random().toString(36).slice(2)}`;
  resetCallState(sid);
  const st = getOrCreateCallState(sid);
  st.step0_completed = true;
  st.current_beat = beat;
  st.delivered_beats = Array.from({ length: beat }, (_, i) => i + 1);
  st.last_spoken_text = BEATS.find((b) => b.id === beat)?.text ?? "";
  return sid;
}

// d.state is the live session object, so snapshot what each turn left behind
type Turn = ControllerDecision & { price: string; stopped: boolean };

async function play(beat: number, ...lines: string[]): Promise<Turn[]> {
  const sid = fresh(beat);
  const out: Turn[] = [];
  for (const line of lines) {
    const d = await processControllerTurn(sid, line);
    out.push({ ...d, price: d.state.dealConfig.per_day_price, stopped: d.state.is_stopped });
  }
  return out;
}

const showsEscalation = (d: ControllerDecision) =>
  d.toolCalls.some((t) => t.name === "show_content" && t.args.item === "escalate");

describe("multi-turn regressions", () => {
  it("Fix 1: asking for a human holds the beat, then the call continues", async () => {
    const [ask, next] = await play(9, "I want to talk to a human", "okay, go on");
    expect(ask.textToSpeak).toBe(HANDOFF_LINE);
    expect(ask.beatId).toBe(9);
    expect(ask.stopped).toBe(false);
    expect(showsEscalation(ask)).toBe(false);

    expect(next.beatId).toBe(10);
    expect(next.stopped).toBe(false);
    expect(next.textToSpeak).not.toContain(HANDOFF_LINE);
  });

  it("Fix 2: two unanswerable questions in a row never stop the call", async () => {
    const turns = await play(9, "is it transferable?", "does it cover my battery?", "okay continue");
    for (const d of turns) {
      expect(d.stopped).toBe(false);
      expect(showsEscalation(d)).toBe(false);
      expect(d.textToSpeak.toLowerCase()).not.toContain("member of our team");
    }
    expect(turns[1].textToSpeak).toContain(CLARIFY_LINE);
    expect(turns[2].beatId).toBe(10);
  });

  it("Fix 2: the unknown-question line promises no team member", () => {
    expect(UNKNOWN_QUESTION_LINE.toLowerCase()).not.toMatch(/team|bring in|someone/);
  });

  it("Fix 3: naming the price Max just offered accepts it instead of dropping again", async () => {
    const [offer, accept] = await play(22, "that's too much", "how about three fifty");
    expect(offer.price).toBe("three dollars and fifty cents");

    expect(accept.beatId).toBe(24);
    expect(accept.price).toBe("three dollars and fifty cents");
    expect(accept.textToSpeak.toLowerCase()).toContain("three dollars and fifty cents");
    expect(accept.textToSpeak.toLowerCase()).not.toContain("twenty-five");
  });

  it("Fix 3: asking for less than the current offer still drops one tier, never below $3", async () => {
    const [, lower, floor, again] = await play(22, "that's too much", "how about three twenty five", "still too much", "lower");
    expect(lower.price).toBe("three dollars and twenty-five cents");
    expect(floor.price).toBe("three dollars");
    expect(again.price).toBe("three dollars");
  });

  it("Fix 4: 'what does that mean' repeats the current beat and its check-in", async () => {
    const beat10 = BEATS.find((b) => b.id === 10)!;
    const body = formatSpeechText(renderBeatText(beat10, getOrCreateCallState("probe").dealConfig));
    for (const say of ["wait, what does that mean", "what do you mean", "can you explain that", "I don't understand", "say that again"]) {
      const [d] = await play(10, say);
      expect(d.intent, say).toBe("repeat_request");
      expect(d.beatId, say).toBe(10);
      expect(d.textToSpeak, say).toContain(body);
      expect(d.textToSpeak, say).toContain(formatSpeechText(beat10.check_in!));
    }
  });

  it("Fix 5: after a recording objection the call stays closed", async () => {
    const [stop, after, again] = await play(1, "I don't want to be recorded", "okay fine, continue", "hello?");
    expect(stop.stopped).toBe(true);
    for (const d of [after, again]) {
      expect(d.textToSpeak).toBe(CLOSING_LINE);
      expect(d.textToSpeak).not.toContain(HANDOFF_LINE);
      expect(d.stopped).toBe(true);
    }
  });

  it("Fix 5: after a hang-up the call stays closed", async () => {
    const [stop, after] = await play(9, "I'm going to hang up", "wait, sorry, keep going");
    expect(stop.stopped).toBe(true);
    expect(after.textToSpeak).toBe(CLOSING_LINE);
  });

  it("Fix 6: no bridge word in front of a beat that already opens with a connective", async () => {
    for (const from of [10, 12, 15]) {
      const [d] = await play(from, "yes");
      expect(d.beatId).toBe(from + 1);
      expect(d.textToSpeak).not.toMatch(/^(Now|And look|So),\s+"?(And|Now|But|That'?s|So|Also)\b/i);
    }
  });

  it("B12 'so who pays then?' answers, then 'yes' reaches B13", async () => {
    const [ask, next] = await play(12, "so who pays then?", "yes");
    expect(ask.beatId).toBe(12);
    expect(ask.stopped).toBe(false);
    expect(next.beatId).toBe(13);
  });
});
