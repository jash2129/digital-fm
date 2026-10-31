/**
 * Follow-up 8: failures found by 5 simulated weird-customer calls (offline, rule-based).
 */
import { describe, it, expect } from "vitest";
import { processControllerTurn, getOrCreateCallState, resetCallState, repromptText, BEATS } from "./beat-controller";
import { DEFAULT_DEAL_CONFIG } from "./deal-config";
import { STEP_0_CHECKIN_LINE, STEP_0_SORRY_LINE, NO_PRESSURE_LINE, UNKNOWN_QUESTION_LINE } from "./max-lines";

const GLAD = "so glad to hear that";

function newCall() {
  const sid = `f8_${Math.random().toString(36).slice(2)}`;
  resetCallState(sid);
  getOrCreateCallState(sid);
  return sid;
}
const say = (sid: string, text: string) => processControllerTurn(sid, text, DEFAULT_DEAL_CONFIG);

// Mid-script at `beat`, as if Max had just delivered it
function atBeat(beat: number) {
  const sid = newCall();
  const st = getOrCreateCallState(sid);
  st.step0_completed = true;
  st.current_beat = beat;
  st.delivered_beats = Array.from({ length: beat }, (_, i) => i + 1);
  st.last_spoken_text = BEATS.find((b) => b.id === beat)?.text ?? "";
  return sid;
}

// Past the tech check: Max has just asked "How has your experience been with our team so far?"
async function atCheckIn() {
  const sid = newCall();
  const opener = await say(sid, "Yeah.");
  expect(opener.textToSpeak).toContain(STEP_0_CHECKIN_LINE);
  return sid;
}

describe("1: Step 0 only says 'glad to hear that' to a good answer", () => {
  it("a hostile answer gets the sorry line, then Beat 1", async () => {
    const sid = await atCheckIn();
    const t = await say(sid, "I don't trust any of this, you people always upsell.");
    expect(t.textToSpeak).not.toContain(GLAD);
    expect(t.textToSpeak.startsWith(STEP_0_SORRY_LINE)).toBe(true);
    expect(t.beatId).toBe(1);
    expect(t.textToSpeak).toContain("recorded audio and video");
  });

  it("a 3rd wrong-vehicle correction stays on the pending question, never advances", async () => {
    const sid = await atCheckIn();
    await say(sid, "I'm buying an Audi, not a Mazda");
    await say(sid, "I said Audi, not Mazda");
    const third = await say(sid, "Are you listening? Audi!");
    expect(third.textToSpeak).not.toContain(GLAD);
    expect(third.beatId).toBe(0);
    expect(third.textToSpeak).toBe(STEP_0_CHECKIN_LINE);
  });

  it("'Are you listening?' with no vehicle in it is hostile, not good", async () => {
    const sid = await atCheckIn();
    const t = await say(sid, "Are you listening?");
    expect(t.textToSpeak).not.toContain(GLAD);
    expect(t.textToSpeak.startsWith(STEP_0_SORRY_LINE)).toBe(true);
  });

  it("'Hmm.' re-asks the question once, and a second one is not called good", async () => {
    const sid = await atCheckIn();
    const first = await say(sid, "Hmm.");
    expect(first.textToSpeak).toBe(STEP_0_CHECKIN_LINE);
    expect(first.beatId).toBe(0);
    const second = await say(sid, "Hmm.");
    expect(second.textToSpeak).not.toContain(GLAD);
    expect(second.beatId).toBe(1);
  });

  it.each(["good", "great", "it was fine", "it was okay", "not bad", "no complaints"])("'%s' is a good answer", async (answer) => {
    const sid = await atCheckIn();
    const t = await say(sid, answer);
    expect(t.textToSpeak).toContain(GLAD);
    expect(t.beatId).toBe(1);
  });

  it.each(["terrible", "it was bad", "not great honestly"])("'%s' gets the sorry line", async (answer) => {
    const sid = await atCheckIn();
    const t = await say(sid, answer);
    expect(t.textToSpeak.startsWith(STEP_0_SORRY_LINE)).toBe(true);
  });
});

describe("2: a no-pressure reply to 'I'm not paying for anything extra'", () => {
  it.each([1, 4, 9])("at Beat %i: reassures, then re-asks the pending question", async (beat) => {
    for (const line of ["I'm not paying for anything extra.", "you always upsell", "don't pressure me"]) {
      const sid = atBeat(beat);
      const t = await say(sid, line);
      expect(t.textToSpeak.startsWith(NO_PRESSURE_LINE)).toBe(true);
      expect(t.textToSpeak).not.toContain(UNKNOWN_QUESTION_LINE);
      expect(t.beatId).toBe(beat);
      const pending = repromptText(sid, "resume");
      expect(pending).toMatch(/\?$/);
      expect(t.textToSpeak.endsWith(pending)).toBe(true);
    }
  });

  it("at the price (Beat 22) 'not paying' stays with the negotiation", async () => {
    const t = await say(atBeat(22), "I'm not paying for anything extra.");
    expect(t.textToSpeak).not.toContain(NO_PRESSURE_LINE);
  });
});

describe("3: small talk about the weather is not the warranty climate fact", () => {
  it("'What's the weather like today?' gets the unknown-question line", async () => {
    const t = await say(atBeat(2), "What's the weather like today?");
    expect(t.textToSpeak).toContain(UNKNOWN_QUESTION_LINE);
    expect(t.textToSpeak).not.toContain("110 degrees");
  });

  it("a climate question about the car still gets the fact", async () => {
    const t = await say(atBeat(9), "Does the Texas heat really damage the car?");
    expect(t.textToSpeak).toContain("110 degrees");
  });
});
