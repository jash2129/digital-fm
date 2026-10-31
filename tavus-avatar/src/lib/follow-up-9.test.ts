/**
 * Follow-up 9: failures from 5 more simulated calls (rambler, haggler, confused, changes-mind,
 * already-covered), offline, rule-based.
 */
import { describe, it, expect } from "vitest";
import { processControllerTurn, getOrCreateCallState, resetCallState, BEATS } from "./beat-controller";
import { DEFAULT_DEAL_CONFIG } from "./deal-config";
import { STEP_0_CHECKIN_LINE, VEHICLE_NOTED_LINE } from "./max-lines";

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
