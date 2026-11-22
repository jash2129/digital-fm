/**
 * AI speech, Option C (MAX_SPEECH=ai): the script decides what Max covers, the AI words it, and the
 * checker falls back to the approved line on anything new, dropped or risky. The AI is mocked.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { shouldSpeakWithAI, checkGenerated, echoesCustomer, speakWithAI, factsFor, numberTokens, type SpeechTurn } from "./ai-speech";
import { processControllerTurn, getOrCreateCallState, resetCallState, lastSaid, BEATS } from "./beat-controller";
import { DEFAULT_DEAL_CONFIG } from "./deal-config";
import { MOVE_ON_LINE, UNKNOWN_QUESTION_LINE } from "./max-lines";

const ENV = { ...process.env };
let fetchMock: ReturnType<typeof vi.fn>;

/** The AI's reply, built from the request (default: a short reaction plus the approved line) */
function aiSays(make: (approved: string) => string) {
  fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    const user = JSON.parse(body.messages[1].content);
    const content = make(user.APPROVED_REPLY ?? "");
    return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
  });
  vi.stubGlobal("fetch", fetchMock);
}
const speechCalls = () => fetchMock.mock.calls.filter(([, init]) => String((init as RequestInit).body).includes("APPROVED_REPLY"));

beforeEach(() => {
  delete process.env.MAX_UNDERSTANDING;
  process.env.MAX_SPEECH = "ai";
  process.env.XAI_API_KEY = "test-key";
  aiSays((a) => `Oh, that's good to hear. ${a}`);
});
afterEach(() => {
  process.env = { ...ENV };
  vi.unstubAllGlobals();
});

const say = (sid: string, text: string) => processControllerTurn(sid, text, DEFAULT_DEAL_CONFIG);
function atBeat(beat: number, stage?: number) {
  const sid = `sp_${Math.random().toString(36).slice(2)}`;
  resetCallState(sid);
  const st = getOrCreateCallState(sid);
  st.step0_completed = true;
  st.current_beat = beat;
  st.delivered_beats = Array.from({ length: beat }, (_, i) => i + 1);
  st.last_spoken_text = BEATS.find((b) => b.id === beat)?.text ?? "";
  if (stage) st.concession_stage = stage;
  return sid;
}

const turn = (p: Partial<SpeechTurn>): SpeechTurn => ({ intent: "agree", beatBefore: 7, beatAfter: 8, beatType: "wait", draft: "Some line. Right?", ...p });

describe("when the AI words the reply", () => {
  it("only with the switch on", () => {
    delete process.env.MAX_SPEECH;
    expect(shouldSpeakWithAI(turn({}))).toBe(false);
    process.env.MAX_SPEECH = "ai";
    expect(shouldSpeakWithAI(turn({}))).toBe(true);
  });

  it("never at Step 0, the recording disclosure, the price or the close", () => {
    for (const [b, a] of [[0, 0], [0, 1], [1, 1], [1, 2], [21, 22], [22, 23], [23, 23], [23, 24], [24, 25], [25, 25]]) {
      expect(shouldSpeakWithAI(turn({ beatBefore: b, beatAfter: a })), `${b} -> ${a}`).toBe(false);
    }
  });

  it("never for the fixed answers: AI question, human, hang-up, move-on, vehicle, price", () => {
    for (const intent of ["ai_question", "human_request", "hang_up", "move_on", "vehicle_discrepancy", "negotiate_price", "resume_interrupted"] as const) {
      expect(shouldSpeakWithAI(turn({ intent })), intent).toBe(false);
    }
    expect(shouldSpeakWithAI(turn({ isScriptComplete: true }))).toBe(false);
    expect(shouldSpeakWithAI(turn({ beatType: "stop" }))).toBe(false);
  });
});

describe("the checker", () => {
  const draft = "The first warranty is five years sixty thousand mile base limited warranty. Right?";

  it("accepts the same content in natural words", () => {
    expect(checkGenerated("Oh, a long commute, I get it. So the first one is a five year, sixty thousand mile base limited warranty. Make sense?", draft).ok).toBe(true);
  });

  it("rejects a new number and a dropped number", () => {
    expect(checkGenerated("The first is a seven year, sixty thousand mile base limited warranty. Right?", draft).reason).toMatch(/new number "seven"/);
    expect(checkGenerated("The first is a five year base limited warranty. Right?", draft).reason).toMatch(/dropped number "sixty"/);
  });

  it("rejects a price, a promise, 'free', 'covers everything', refunds and insurance the draft does not say", () => {
    for (const bad of [
      "Five years, sixty thousand miles, and it only costs a little. Right?",
      "Five years, sixty thousand miles, guaranteed. Right?",
      "Five years, sixty thousand miles, and repairs are free. Right?",
      "Five years, sixty thousand miles, it covers everything. Right?",
      "Five years, sixty thousand miles, and you can cancel any time. Right?",
      "Five years, sixty thousand miles, like insurance. Right?",
      "Five years, sixty thousand miles, a few dollars. Right?",
    ]) {
      expect(checkGenerated(bad, draft).ok, bad).toBe(false);
    }
  });

  it("allows those words when the approved line already says them", () => {
    const d = "The package covers synthetic oil and filter changes so you have zero out-of-pocket expenses. Does that make sense?";
    expect(checkGenerated("Makes sense you'd ask. The package covers synthetic oil and filter changes, so zero out-of-pocket expenses for you. Does that make sense?", d).ok).toBe(true);
    expect(checkGenerated("Feel free to stop me. Five years, sixty thousand miles on the base limited warranty. Right?", draft).ok).toBe(true);
  });

  it("rejects claiming to be human, another make, talk of the script, a lost question, formatting and rambling", () => {
    expect(checkGenerated("I'm a real person, don't worry. Five years, sixty thousand miles base limited warranty. Right?", draft).ok).toBe(false);
    expect(checkGenerated("Just like a Toyota, five years sixty thousand miles base limited warranty. Right?", draft).reason).toMatch(/toyota/);
    expect(checkGenerated("My script says five years sixty thousand miles base limited warranty. Right?", draft).ok).toBe(false);
    expect(checkGenerated("Five years sixty thousand miles base limited warranty.", draft).reason).toBe("lost the question");
    expect(checkGenerated("**Five** years sixty thousand miles. Right?", draft).reason).toBe("formatting");
    expect(checkGenerated(`${"so ".repeat(60)}five years sixty thousand miles. Right?`, draft).reason).toMatch(/too long/);
  });

  it("keeps the coverage terms the draft names", () => {
    const d = "The tire and wheel package protects your tires and wheels against road hazard damage. Okay?";
    expect(checkGenerated("It protects against road hazard damage. Okay?", d).reason).toMatch(/dropped "tire"/);
  });

  it("rejects Max saying the customer's own question as his (simulated batch 2026-11-21)", () => {
    const d = "Awesome! When you came back from the test drive, the sales person did the walkaround and showed you all the features, bells, and whistles in the car.";
    const customer = "Yes I drove it, it was good. Can we move on to the numbers please?";
    expect(checkGenerated(`${d} Can we move on to the numbers please?`, d, "", customer).reason).toBe("repeats the customer's words");
    // A short echo ("it was good") is a normal reaction, not a repeat
    expect(checkGenerated(`Glad it was good! ${d}`, d, "", customer).ok).toBe(true);
    expect(echoesCustomer("Sure, can we move on to the numbers please?", customer)).toBe(true);
  });

  it("rejects a 'later' promise the approved line does not make", () => {
    expect(checkGenerated(`I'm going to cover that in just a moment. ${draft}`, draft).reason).toBe("adds a 'later' promise");
    const deferring = "I'm going to cover that in just a moment. Right?";
    expect(checkGenerated("Fair question, I'll cover that in just a moment. Right?", deferring).ok).toBe(true);
  });

  it("counts 'one' as a number only before a unit", () => {
    expect(numberTokens("the one thing I love")).toEqual([]);
    expect(numberTokens("one year, sixty thousand miles, 110 degrees")).toEqual(["one", "sixty", "thousand", "110"]);
  });
});

describe("falling back to the approved line", () => {
  const ctx = { customer: "okay", draft: "Five years sixty thousand mile base limited warranty. Right?", intent: "agree", recentTurns: [] };

  it("on an HTTP error, a rejected reply, or no key", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 503 })));
    expect(await speakWithAI(ctx)).toMatchObject({ text: ctx.draft, source: "script", reason: "http 503" });
    aiSays(() => "It's four dollars a day. Right?");
    expect((await speakWithAI(ctx)).source).toBe("script");
    delete process.env.XAI_API_KEY;
    expect(await speakWithAI(ctx)).toMatchObject({ text: ctx.draft, reason: "no AI key" });
  });

  it("when the AI is too slow", async () => {
    process.env.AI_SPEECH_TIMEOUT_MS = "50";
    vi.stubGlobal(
      "fetch",
      vi.fn((_u: string, init: RequestInit) => new Promise((_r, reject) => init.signal?.addEventListener("abort", () => reject(new Error("aborted")))))
    );
    const r = await speakWithAI(ctx);
    expect(r.source).toBe("script");
    expect(r.reason).toMatch(/timeout/);
  });

  it("the knowledge base is only sent when the customer asked something", () => {
    expect(factsFor(ctx)).toBe("");
    expect(factsFor({ ...ctx, customer: "do I need to come here for service?" })).toMatch(/service/i);
    expect(factsFor({ ...ctx, draft: UNKNOWN_QUESTION_LINE })).not.toBe("");
  });
});

describe("in a call", () => {
  it("Max says the AI's words, and the call state keeps the approved line", async () => {
    const sid = atBeat(7);
    const d = await say(sid, "okay that makes sense");
    expect(d.beatId).toBe(8);
    expect(d.metrics?.speech).toBe("ai");
    expect(d.textToSpeak.startsWith("Oh, that's good to hear.")).toBe(true);
    const st = getOrCreateCallState(sid);
    expect(st.last_spoken_text.startsWith("Oh")).toBe(false);
    expect(lastSaid(st)).toBe(d.textToSpeak);
    expect(st.recent_turns?.at(-1)?.max).toBe(d.textToSpeak);
  });

  it("a reply the checker rejects is said word for word", async () => {
    aiSays(() => "Honestly it covers everything, guaranteed. Right?");
    const sid = atBeat(7);
    const d = await say(sid, "okay that makes sense");
    expect(d.metrics?.speech).toBe("script");
    expect(d.metrics?.speechReason).toMatch(/rejected/);
    expect(d.textToSpeak).toBe(getOrCreateCallState(sid).last_spoken_text);
  });

  it("the price and the close never go to the AI", async () => {
    const sid = atBeat(23, 2);
    await say(sid, "No, that's too much for me.");
    await say(sid, "Okay, let's do it.");
    expect(speechCalls()).toHaveLength(0);
  });

  it("misses in a row still move the call on after three", async () => {
    const sid = atBeat(7);
    await say(sid, "blorp");
    const second = await say(sid, "flarp");
    expect(second.beatId).toBe(7);
    const third = await say(sid, "zzz");
    expect(third.beatId).toBe(8);
    expect(third.intent).toBe("move_on");
    expect(third.textToSpeak.startsWith(MOVE_ON_LINE)).toBe(true);
  });
});
