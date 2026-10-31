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
  getBeatCheckInQuestion,
  renderBeatText,
  formatSpeechText,
  BEATS,
  type ControllerDecision,
} from "./beat-controller";
import {
  HANDOFF_LINE,
  CLARIFY_LINE,
  CLOSING_LINE,
  UNKNOWN_QUESTION_LINE,
  COMPLIMENT_LINE,
  LANGUAGE_LINE,
  REPEATED_NO_LINE,
} from "./max-lines";

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

  // ---- Follow-up 2: unrelated turns must not fall through to the unknown-question line

  it("A: a vehicle correction is handled as a discrepancy and holds the beat", async () => {
    const [cx] = await play(9, "It's a CX-30, not a CX-5");
    expect(cx.intent).toBe("vehicle_discrepancy");
    expect(cx.beatId).toBe(9);
    expect(cx.stopped).toBe(false);
    expect(cx.textToSpeak).toContain("CX-30");
    expect(cx.textToSpeak).not.toContain(UNKNOWN_QUESTION_LINE);
    expect(cx.state.dealConfig.vehicle_model).toBe("CX-30");

    for (const say of ["that's not my car", "wrong car"]) {
      const [d] = await play(12, say);
      expect(d.intent, say).toBe("vehicle_discrepancy");
      expect(d.beatId, say).toBe(12);
    }
  });

  it("A: a compliment at any beat gets COMPLIMENT_LINE plus the current check-in, never ends the call", async () => {
    for (const beat of [1, 9, 10, 22, 23, 24, 25]) {
      for (const say of ["beautiful car", "love it", "nice ride"]) {
        const [d] = await play(beat, say);
        const checkIn = getBeatCheckInQuestion(BEATS.find((b) => b.id === beat)!);
        expect(d.intent, `B${beat} ${say}`).toBe("compliment");
        expect(d.textToSpeak, `B${beat} ${say}`).toBe(`${COMPLIMENT_LINE} ${checkIn}`);
        expect(d.beatId, `B${beat} ${say}`).toBe(beat);
        expect(d.stopped, `B${beat} ${say}`).toBe(false);
        expect(showsEscalation(d), `B${beat} ${say}`).toBe(false);
      }
    }
  });

  it("A: 'why do you keep asking me that' repeats only the current check-in", async () => {
    for (const say of ["why do you keep asking me that", "why are you asking"]) {
      const [d] = await play(10, say);
      expect(d.textToSpeak, say).toBe("Are you with me?");
      expect(d.beatId, say).toBe(10);
    }
  });

  it("A: another language gets LANGUAGE_LINE and holds the beat", async () => {
    for (const say of ["Puedo hablar en español?", "habla español?", "Can we do this in Spanish?"]) {
      const [d] = await play(9, say);
      expect(d.textToSpeak, say).toBe(LANGUAGE_LINE);
      expect(d.beatId, say).toBe(9);
      expect(d.stopped, say).toBe(false);
    }
  });

  it("B: the unknown-question line never implies coverage", async () => {
    const [d] = await play(8, "what about hail?");
    expect(d.textToSpeak).toContain(UNKNOWN_QUESTION_LINE);
    expect(d.textToSpeak).toContain(CLARIFY_LINE);
    expect(d.textToSpeak.toLowerCase()).not.toContain("covered");
  });

  it("C: two Nos in a row move on with REPEATED_NO_LINE, never a handoff", async () => {
    const [first, second] = await play(9, "no", "no");
    expect(first.stopped).toBe(false);
    expect(second.stopped).toBe(false);
    expect(second.textToSpeak.startsWith(REPEATED_NO_LINE)).toBe(true);
    expect(second.textToSpeak).not.toContain(HANDOFF_LINE);
    expect(second.beatId).toBe(10);
    expect([first, second].some(showsEscalation)).toBe(false);
  });

  it("C: two Nos to the Beat 1 recording disclosure withhold consent and end the session", async () => {
    const [, second, after] = await play(1, "no", "no", "okay go on");
    expect(second.stopped).toBe(true);
    expect(second.textToSpeak).not.toContain(HANDOFF_LINE);
    expect(showsEscalation(second)).toBe(false);
    expect(after.textToSpeak).toBe(CLOSING_LINE);
  });
});
