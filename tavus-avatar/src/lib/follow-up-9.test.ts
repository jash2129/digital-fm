/**
 * Follow-up 9: failures from 5 more simulated calls (rambler, haggler, confused, changes-mind,
 * already-covered), offline, rule-based.
 */
import { describe, it, expect } from "vitest";
import { processControllerTurn, getOrCreateCallState, resetCallState, BEATS } from "./beat-controller";
import { DEFAULT_DEAL_CONFIG } from "./deal-config";
import { STEP_0_CHECKIN_LINE, VEHICLE_NOTED_LINE, ROLE_EXPLAIN_LINE, WHICH_PART_LINE, UNKNOWN_QUESTION_LINE, PRICE_LATER_LINE, FLOOR_PRICE_LINE } from "./max-lines";

const GLAD = "so glad to hear that";

function newCall() {
  const sid = `f9_${Math.random().toString(36).slice(2)}`;
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

describe("1: a make named in a sentence about someone else is not a vehicle correction", () => {
  it.each([
    "my brother in law has a Toyota and he never bought any warranty",
    "my neighbor owns a BMW and it broke down twice",
    "he bought a Honda last year",
  ])("Beat 3: '%s'", async (line) => {
    const sid = atBeat(3);
    const t = await say(sid, line);
    expect(t.textToSpeak).not.toContain(VEHICLE_NOTED_LINE);
    expect(getOrCreateCallState(sid).vehicle_disputed).toBeFalsy();
  });

  it.each(["I'm buying an Audi, not a Mazda", "I bought a Toyota", "that's not my car", "Brother, I was agreed to buy, uh, Audi"])(
    "a first-person correction still counts: '%s'",
    async (line) => {
      const sid = atBeat(3);
      const t = await say(sid, line);
      expect(t.textToSpeak).toContain(VEHICLE_NOTED_LINE);
      expect(getOrCreateCallState(sid).vehicle_disputed).toBe(true);
    }
  );

  it("after a real correction, naming the make again is still the same correction", async () => {
    const sid = atBeat(3);
    await say(sid, "I'm buying an Audi, not a Mazda");
    const again = await say(sid, "Audi!");
    expect(again.intent).toBe("vehicle_discrepancy");
    expect(again.beatId).toBe(3);
  });
});

describe("2: a happy rambler is not treated as rushed", () => {
  const RUSHED = "I value your time";

  it.each([
    "Oh it was great, the salesman Dave was awesome... the drive over here took forever because of the traffic",
    "It was great, took a little time but Dave was helpful",
    "great, though the traffic was bad on the way in",
  ])("'%s' gets the glad line", async (line) => {
    const sid = await atCheckIn();
    const t = await say(sid, line);
    expect(t.textToSpeak).not.toContain(RUSHED);
    expect(t.textToSpeak).toContain(GLAD);
    expect(t.beatId).toBe(1);
  });

  it.each(["I'm in a hurry", "how long is this going to take?", "I don't have time for this", "get to the point"])(
    "explicit hurry about this call: '%s'",
    async (line) => {
      const sid = await atCheckIn();
      const t = await say(sid, line);
      expect(t.textToSpeak).toContain(RUSHED);
    }
  );

  it("a plain waiting complaint still gets the time line, not 'glad'", async () => {
    const sid = await atCheckIn();
    const t = await say(sid, "I've been sitting here for three hours");
    expect(t.textToSpeak).toContain(RUSHED);
    expect(t.textToSpeak).not.toContain(GLAD);
  });
});

describe("3: 'I didn't catch that' and 'I don't understand' get the right reply", () => {
  it("Step 0 'Sorry, what? I didn't catch that.' repeats the Step 0 question", async () => {
    const sid = await atCheckIn();
    const t = await say(sid, "Sorry, what? I didn't catch that.");
    expect(t.textToSpeak).toBe(STEP_0_CHECKIN_LINE);
    expect(t.beatId).toBe(0);
  });

  it("Beat 1 'I don't understand what you do' explains Max's role, then re-asks", async () => {
    const sid = atBeat(1);
    const t = await say(sid, "I don't understand what you do");
    expect(t.textToSpeak.startsWith(ROLE_EXPLAIN_LINE)).toBe(true);
    expect(t.textToSpeak).toMatch(/\?$/);
    expect(t.textToSpeak).not.toContain("recorded audio and video");
    expect(t.beatId).toBe(1);
  });

  it("'I still don't get it': the explanation once, then 'which part?'", async () => {
    const sid = atBeat(1);
    const first = await say(sid, "I still don't get it");
    expect(first.textToSpeak.startsWith(ROLE_EXPLAIN_LINE)).toBe(true);
    expect(first.textToSpeak).not.toContain(UNKNOWN_QUESTION_LINE);
    const second = await say(sid, "I still don't get it");
    expect(second.textToSpeak).toBe(WHICH_PART_LINE);
    expect(second.beatId).toBe(1);
  });

  it("the role explanation and 'I still don't get it' share the count", async () => {
    const sid = atBeat(1);
    await say(sid, "I don't understand what you do");
    const t = await say(sid, "I still don't get it");
    expect(t.textToSpeak).toBe(WHICH_PART_LINE);
  });
});

describe("4: price objections before the price is quoted", () => {
  it.each([4, 9, 19])("at Beat %i: no counter, a 'price in a moment' reply, then the pending question", async (beat) => {
    for (const line of ["That's too much", "I can't afford that", "can you do better", "I'll give you $2 a day"]) {
      const sid = atBeat(beat);
      const t = await say(sid, line);
      expect(t.textToSpeak.startsWith(PRICE_LATER_LINE), line).toBe(true);
      expect(t.textToSpeak).toMatch(/\?$/);
      expect(t.textToSpeak).not.toContain(UNKNOWN_QUESTION_LINE);
      expect(t.beatId).toBe(beat);
      expect(getOrCreateCallState(sid).concession_stage ?? 1).toBe(1);
    }
  });

  it("replay to the price beats: early haggling is deferred, haggling at the offer runs the ladder to the floor", async () => {
    const sid = newCall();
    for (const line of ["yes", "good", "okay", "yes I drove it", "yes he did", "I'm not sure"]) await say(sid, line);
    let d = await say(sid, "yes");
    for (let i = 0; i < 20 && d.beatId < 19; i++) d = await say(sid, "yes");
    expect(d.beatId).toBe(19);

    // Beat 19: before the price
    for (const line of ["That's too much", "I'll give you $2 a day"]) {
      const early = await say(sid, line);
      expect(early.textToSpeak.startsWith(PRICE_LATER_LINE)).toBe(true);
      expect(early.beatId).toBe(19);
    }
    expect(getOrCreateCallState(sid).concession_stage ?? 1).toBe(1);

    // Beats 20-22: the recap, then the offer at four dollars
    await say(sid, "yes");
    await say(sid, "yes");
    const offer = await say(sid, "yes");
    expect(offer.beatId).toBe(22);
    expect(offer.textToSpeak).toContain("four dollars a day");

    // Haggling at the offer: $3.50, then a $2 counter lands on the $3 floor, never below
    const first = await say(sid, "That's too much");
    expect(first.textToSpeak).toContain("three dollars and fifty cents");
    const lowball = await say(sid, "I'll give you $2 a day");
    expect(lowball.textToSpeak).toBe(FLOOR_PRICE_LINE);
    expect(lowball.toolCalls).toEqual([{ name: "show_payment_breakdown", args: { daily_rate: 3.0 } }]);
    expect(lowball.textToSpeak).not.toMatch(/two dollars|\$2\b/i);
  });
});
