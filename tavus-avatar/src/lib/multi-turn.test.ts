/**
 * Multi-turn regressions: bugs that only show up when a customer keeps talking after Max's
 * first reply. Each test drives the real controller (processControllerTurn) through several
 * turns on one session, offline (rule-based classifier, no LLM keys needed).
 *
 * Human escalation was removed by the client: Max must never stop the call or offer a handoff
 * because of a question.
 */
import { describe, it, expect, vi } from "vitest";
import {
  processControllerTurn,
  getOrCreateCallState,
  resetCallState,
  getBeatCheckInQuestion,
  classifyCustomerInputRuleBased,
  classifyWithLLM,
  LLM_CLASSIFIER_TIMEOUT_MS,
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
  SCRIPT_COMPLETE_LINE,
  VERIFY_REASK_LINE,
  VERIFY_DEFER_LINE,
  COMPLIMENT_LINE as COMPLIMENT,
} from "./max-lines";
import { answerFromKnowledgeBase, REMOTE_TIMEOUT_MS, FACT_PICKER_TIMEOUT_MS } from "./grounded-answer";

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
    // Follow-up 7 B: acknowledge once, never argue or echo a make; later lines say "your new vehicle"
    expect(cx.textToSpeak).toContain("Thanks for catching that");
    expect(cx.textToSpeak).not.toContain(UNKNOWN_QUESTION_LINE);
    expect(cx.state.vehicle_disputed).toBe(true);

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
        // At Beat 23 the pending question is "which two" (follow-up 5 N), not the default check-in
        const checkIn = beat === 23 ? "Which two of those do you see the most value in?" : getBeatCheckInQuestion(BEATS.find((b) => b.id === beat)!);
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

  // ---- Latency: everyday replies must hit the instant rules, not the remote LLM classifier
  // (Inspector flagged 3.0s of dead air on "wow, okay" in a simulated call)

  it("acknowledgements with fillers or backchannel sounds are classified instantly as agree", () => {
    for (const [beat, say] of [[9, "mm-hm"], [14, "wow, okay"], [15, "uh, okay, continue"], [9, "uh huh"], [11, "oh okay"], [14, "geez, okay"]] as const) {
      expect(classifyCustomerInputRuleBased(say, beat).intent, say).toBe("agree");
    }
  });

  it("doubt and bare reactions still never count as agreement", () => {
    for (const say of ["hmm", "hm", "uh", "wow"]) {
      expect(classifyCustomerInputRuleBased(say, 7).intent, say).not.toBe("agree");
    }
  });

  it("casual price asks before the offer get the price path instantly", () => {
    for (const [beat, say] of [[16, "yeah I'm with you. what's this gonna cost me though"], [18, "okay. and the price?"]] as const) {
      expect(classifyCustomerInputRuleBased(say, beat).intent, say).toBe("price_ask");
    }
    // From Beat 22 on, cost talk is negotiation
    expect(classifyCustomerInputRuleBased("that's gonna cost me too much", 22).intent).toBe("negotiate_price");
  });

  // ---- Follow-up 3 (from the Inspector replay of sim-ladder_negotiator_buyer)

  it("A: checking a number Max said gets a grounded answer, holds the beat, never re-recites it", async () => {
    const beat15 = BEATS.find((b) => b.id === 15)!;
    const body = formatSpeechText(renderBeatText(beat15, getOrCreateCallState("probe15").dealConfig));
    const [d] = await play(15, "wait, seventy hundred? you mean seven thousand?");
    expect(d.intent).toBe("number_clarification");
    expect(d.textToSpeak.toLowerCase()).toContain("seven thousand");
    expect(d.beatId).toBe(15);
    expect(d.stopped).toBe(false);
    expect(d.textToSpeak).not.toContain("I don't have that detail");
    expect(d.textToSpeak).not.toContain(body);
    expect(d.textToSpeak).toContain(getBeatCheckInQuestion(beat15));
  });

  it("A: 'what do you mean' without a number is still a repeat request", () => {
    expect(classifyCustomerInputRuleBased("what do you mean", 10).intent).toBe("repeat_request");
  });

  it("B: a yes to the finalize question is not asked again, it goes straight to verification", async () => {
    const turns = await play(22, "that's too much", "still too much", "still too much", "yes");
    expect(turns[2].textToSpeak).toMatch(/ready to finalize/i);
    const last = turns[3];
    expect(last.beatId).toBe(25);
    expect(last.textToSpeak.trim()).not.toMatch(/Are you ready to finalize\??$/);
    expect(last.textToSpeak).toContain("three dollars a day");
    expect(last.textToSpeak.toLowerCase()).toContain("verify");
    expect(last.stopped).toBe(false);
  });

  it("C: every turn reports a latency breakdown", async () => {
    const [d] = await play(9, "yes");
    expect(d.metrics).toMatchObject({ usedLLM: false, classifierTimedOut: false, intent: "agree", beatBefore: 9, beatAfter: 10 });
    expect(d.metrics!.controllerMs).toBeGreaterThanOrEqual(d.metrics!.classifierMs);
  });

  it("B: a yes to the priced 'does that sound fair?' also skips the second finalize ask", async () => {
    const turns = await play(22, "that's too much", "still too much", "yes");
    expect(turns[1].textToSpeak).toMatch(/twenty-five cents a day\. Does that sound fair\?$/);
    expect(turns[2].beatId).toBe(25);
    expect(turns[2].textToSpeak).toContain("three dollars and twenty-five cents a day");
  });

  it("B: Beat 23's own coverage 'sound fair?' names no price, so Beat 24 still asks to finalize", async () => {
    // A bare "yes" no longer answers Beat 23 (follow-up 4 B), so name a coverage
    const [d] = await play(23, "the tires and maintenance");
    expect(d.beatId).toBe(24);
    expect(d.textToSpeak.trim()).toMatch(/Are you ready to finalize\?$/);
  });

  it("C: a remote classifier slower than the cap holds the beat with the clarify line", async () => {
    const saved = { xai: process.env.XAI_API_KEY, openai: process.env.OPENAI_API_KEY };
    process.env.XAI_API_KEY = "test-key";
    // A classifier that never answers, but honors the abort signal
    vi.stubGlobal("fetch", (_url: string, init: { signal: AbortSignal }) =>
      new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(new Error("aborted"))))
    );
    try {
      const sid = fresh(9);
      const line = "my neighbor bought one of these last spring and liked it";
      expect(classifyCustomerInputRuleBased(line, 9).intent).toBe("other");
      // Fake timers: the cap is asserted exactly, independent of machine load
      vi.useFakeTimers();
      const pending = classifyWithLLM(line, getOrCreateCallState(sid));
      await vi.advanceTimersByTimeAsync(LLM_CLASSIFIER_TIMEOUT_MS + 10);
      const c = await pending;
      expect(c).toMatchObject({ intent: "classifier_timeout", timedOut: true, usedLLM: true });

      const turn = processControllerTurn(sid, line);
      await vi.advanceTimersByTimeAsync(LLM_CLASSIFIER_TIMEOUT_MS + 10);
      const d = await turn;
      expect(d.textToSpeak).toBe(CLARIFY_LINE);
      expect(d.beatId).toBe(9);
      expect(d.metrics).toMatchObject({ usedLLM: true, classifierTimedOut: true });
    } finally {
      vi.unstubAllGlobals();
      vi.useRealTimers();
      process.env.XAI_API_KEY = saved.xai ?? "";
      if (saved.xai === undefined) delete process.env.XAI_API_KEY;
      if (saved.openai !== undefined) process.env.OPENAI_API_KEY = saved.openai;
    }
  });

  // ---- Follow-up 4b: Beat 25 must actually collect the name and address

  it("H: a bare yes at Beat 25 is not a name and address, so Max re-asks", async () => {
    for (const say of ["yes", "I just said yes. yes", "okay sure"]) {
      const [d] = await play(25, say);
      expect(d.textToSpeak, say).toBe(VERIFY_REASK_LINE);
      expect(d.beatId, say).toBe(25);
      expect(d.stopped, say).toBe(false);
    }
  });

  it("H: a real name and address finishes with SCRIPT_COMPLETE_LINE", async () => {
    const [d] = await play(25, "sure, it's daniel reyes, r e y e s, 4410 maple ridge drive, plano texas");
    expect(d.textToSpeak).toBe(SCRIPT_COMPLETE_LINE);
    expect(d.stopped).toBe(true);
  });

  it("H: two non-answers close via the paperwork, never claiming anything was finalized", async () => {
    const [first, second, after] = await play(25, "yes", "yeah", "hello?");
    expect(first.textToSpeak).toBe(VERIFY_REASK_LINE);
    expect(second.textToSpeak).toBe(VERIFY_DEFER_LINE);
    expect(second.stopped).toBe(true);
    for (const d of [second, after]) expect(d.textToSpeak.toLowerCase()).not.toContain("finalized");
    expect(after.textToSpeak).toBe(CLOSING_LINE);
  });

  it("H: a re-ask then a real answer still completes", async () => {
    const [, d] = await play(25, "yes", "my name is maria lopez and I live on elm street in dallas");
    expect(d.textToSpeak).toBe(SCRIPT_COMPLETE_LINE);
  });

  // ---- Follow-up 4

  it("A: 'wow this car is beautiful' is a compliment at any beat, never the unknown line", async () => {
    for (const beat of [23, 10, 2]) {
      const [d] = await play(beat, "wow this car is beautiful");
      expect(d.beatId, `B${beat}`).toBe(beat);
      expect(d.textToSpeak, `B${beat}`).toContain(COMPLIMENT);
      expect(d.textToSpeak, `B${beat}`).not.toContain("I don't have that detail");
    }
  });

  it("B: a bare yes does not answer 'which two', so Max re-asks", async () => {
    const [d] = await play(23, "yes");
    expect(d.beatId).toBe(23);
    expect(d.textToSpeak).toBe("Which two of those do you see the most value in?");
  });

  it("B: named coverages are repeated back at Beat 24 without claiming full protection or changing the price", async () => {
    const [d] = await play(23, "the tires and maintenance");
    const t = d.textToSpeak.toLowerCase();
    expect(d.beatId).toBe(24);
    expect(t).toContain("tire");
    expect(t).toContain("maintenance");
    expect(t).not.toContain("full vehicle protection");
    expect(t).toContain("four dollars a day");
  });

  it("B: naming everything keeps the full-protection confirmation", async () => {
    const [d] = await play(23, "honestly all three");
    expect(d.beatId).toBe(24);
    expect(d.textToSpeak).toContain("full vehicle protection");
  });

  it("C: 'you mean the manufacturer pays?' is answered from breakdown_process", async () => {
    const [d] = await play(12, "you mean the manufacturer pays?");
    expect(d.beatId).toBe(12);
    expect(d.textToSpeak).not.toContain("I don't have that detail");
    expect(d.textToSpeak).toContain("the manufacturer pays");
  });

  it("D: a slow remote model falls back to the approved sentences within the cap", async () => {
    // Fake timers: the caps are asserted exactly, independent of machine load
    vi.useFakeTimers();
    const saved = process.env.XAI_API_KEY;
    process.env.XAI_API_KEY = "test-key";
    const settle = <T,>(p: Promise<T>) => {
      const s = { done: false, value: undefined as T | undefined };
      p.then((v) => Object.assign(s, { done: true, value: v }));
      return s;
    };
    try {
      // Picker hangs until aborted: keyword answer at the picker cap, no second remote call
      vi.stubGlobal("fetch", (_u: string, init: { signal: AbortSignal }) =>
        new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(new Error("aborted"))))
      );
      let r = settle(answerFromKnowledgeBase("who pays when it breaks down?"));
      await vi.advanceTimersByTimeAsync(FACT_PICKER_TIMEOUT_MS - 50);
      expect(r.done).toBe(false);
      await vi.advanceTimersByTimeAsync(100);
      expect(r.done).toBe(true);
      expect(r.value?.kind).toBe("answer");
      expect(r.value?.text).toContain("the manufacturer pays");

      // Picker answers NONE fast, then the rewrite hangs: approved sentences after one rewrite cap
      let calls = 0;
      vi.stubGlobal("fetch", (_u: string, init: { signal: AbortSignal }) => {
        calls++;
        if (calls === 1) return Promise.resolve(new Response(JSON.stringify({ choices: [{ message: { content: "NONE" } }] })));
        return new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(new Error("aborted"))));
      });
      r = settle(answerFromKnowledgeBase("who pays when it breaks down?"));
      await vi.advanceTimersByTimeAsync(REMOTE_TIMEOUT_MS - 50);
      expect(r.done).toBe(false);
      await vi.advanceTimersByTimeAsync(100);
      expect(r.done).toBe(true);
      expect(calls).toBe(2);
      expect(r.value?.text).toContain("the manufacturer pays");
    } finally {
      vi.unstubAllGlobals();
      vi.useRealTimers();
      if (saved === undefined) delete process.env.XAI_API_KEY;
      else process.env.XAI_API_KEY = saved;
    }
  });

  it("E: a bare number word is not a number clarification; amounts and digits are", () => {
    expect(classifyCustomerInputRuleBased("you mean the tire package covers all four?", 17).intent).not.toBe("number_clarification");
    for (const say of ["you mean seven thousand?", "did you say 350?", "so that's ten dollars?", "you mean seventy hundred?"]) {
      expect(classifyCustomerInputRuleBased(say, 15).intent, say).toBe("number_clarification");
    }
  });

  it("L: a real name and address is logged as provided_details", async () => {
    const [d] = await play(25, "sure, it's daniel reyes, r e y e s, 4410 maple ridge drive, plano texas");
    expect(d.intent).toBe("provided_details");
    expect(d.metrics?.intent).toBe("provided_details");
    expect(d.textToSpeak).toBe(SCRIPT_COMPLETE_LINE);
  });

  // ---- Follow-up 5

  it("M: dropping a coverage is an exclusion, not a choice: re-ask what to keep, hold Beat 23", async () => {
    for (const say of ["can I drop the tires and keep the rest", "I don't need the maintenance"]) {
      const [offer, d] = await play(22, "that's too much", say);
      expect(d.beatId, say).toBe(23);
      expect(d.textToSpeak.toLowerCase(), say).toContain("which coverages would you like to keep");
      expect(d.textToSpeak, say).not.toContain("you said matters most");
      expect(d.price, say).toBe(offer.price); // never repriced
      expect(d.state.excluded_coverages?.length, say).toBeGreaterThan(0);
    }
  });

  it("M: 'just the warranty and the tires' is still a selection", async () => {
    const [, d] = await play(22, "that's too much", "just the warranty and the tires");
    expect(d.beatId).toBe(24);
    expect(d.textToSpeak).toContain("you said matters most");
  });

  it("M: after the keep re-ask, naming what to keep is taken as the selection", async () => {
    const [, , d] = await play(22, "that's too much", "can I drop the tires and keep the rest", "the warranty and the maintenance");
    expect(d.beatId).toBe(24);
    expect(d.textToSpeak).toContain("bumper-to-bumper warranty and the maintenance");
  });

  it("N: a compliment at Beat 23 re-asks the coverage question, not 'does that sound fair'", async () => {
    const [, d] = await play(22, "that's too much", "wow nice car");
    expect(d.textToSpeak.trim().endsWith("Which two of those do you see the most value in?")).toBe(true);
    expect(d.beatId).toBe(23);
  });

  it("O: the fact picker waits up to FACT_PICKER_TIMEOUT_MS (1200 ms by default)", async () => {
    expect(FACT_PICKER_TIMEOUT_MS).toBe(1200);
    const saved = process.env.XAI_API_KEY;
    process.env.XAI_API_KEY = "test-key";
    // A picker that answers "driving_habits" after `delay` ms, unless aborted first
    const pickerAt = (delay: number) => (_u: string, init: { signal: AbortSignal }) =>
      new Promise((resolve, reject) => {
        const t = setTimeout(() => resolve(new Response(JSON.stringify({ choices: [{ message: { content: "driving_habits" } }] }))), delay);
        init.signal.addEventListener("abort", () => { clearTimeout(t); reject(new Error("aborted")); });
      });
    try {
      // No keyword matches this, so only the picker can answer it
      const q = "what if I drive like a maniac?";
      vi.stubGlobal("fetch", pickerAt(1000));
      const used = await answerFromKnowledgeBase(q);
      expect(used.kind).toBe("answer");
      expect(used.sources).toEqual(["driving_habits"]);

      vi.stubGlobal("fetch", pickerAt(1500));
      const t0 = Date.now();
      const fellBack = await answerFromKnowledgeBase(q);
      expect(Date.now() - t0).toBeLessThan(FACT_PICKER_TIMEOUT_MS + 400);
      expect(fellBack.kind).toBe("handoff"); // keywords have nothing for it
    } finally {
      vi.unstubAllGlobals();
      if (saved === undefined) delete process.env.XAI_API_KEY;
      else process.env.XAI_API_KEY = saved;
    }
  });

  it("O: the turn classifier cap is unchanged at 800 ms", () => {
    expect(LLM_CLASSIFIER_TIMEOUT_MS).toBe(800);
  });
});

