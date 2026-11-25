/**
 * "Who are you" on every beat (2026-11-25): for each beat 0-25 and each phrasing, the reply says who
 * Max is (or that he is an AI) and the question never moves the call on. Repeated with the question
 * landing on each greeting turn, including the turn the disclosure is due.
 */
import { describe, it, expect } from "vitest";
import { processControllerTurn, resetCallState, getOrCreateCallState, BEATS } from "./beat-controller";
import { retrieve } from "./grounded-answer";
import { DEFAULT_DEAL_CONFIG } from "./deal-config";

const PHRASINGS = ["who are you", "who is this", "are you a real person", "are you AI", "is this a bot", "What's your name?", "and you are?"];
const ANSWERED = /I'm Max|I'm an AI|finance (?:manager|assistant)/i;
const say = (sid: string, t: string) => processControllerTurn(sid, t, DEFAULT_DEAL_CONFIG);

function atBeat(beat: number) {
  const sid = `wl_${Math.random().toString(36).slice(2)}`;
  resetCallState(sid);
  const st = getOrCreateCallState(sid, DEFAULT_DEAL_CONFIG);
  st.step0_completed = true;
  st.current_beat = beat;
  st.delivered_beats = Array.from({ length: beat }, (_, i) => i + 1);
  st.last_spoken_text = BEATS.find((b) => b.id === beat)?.text ?? "";
  return sid;
}

describe("'who are you' is answered on every beat", () => {
  for (let beat = 1; beat <= 25; beat++) {
    it(`Beat ${beat}`, async () => {
      for (const q of PHRASINGS) {
        const d = await say(atBeat(beat), q);
        expect(d.textToSpeak, `B${beat} "${q}"`).toMatch(ANSWERED);
        expect(d.beatId, `B${beat} "${q}" moved the call on`).toBe(beat);
        expect(d.state.is_stopped, `B${beat} "${q}" ended the call`).toBeFalsy();
      }
    });
  }

  it("in the greeting, with the question on each turn (incl. the disclosure turn), 200 calls, 0 skipped", async () => {
    const leads = [[], ["Yes, I can hear and see you"], ["Yes, I can hear and see you", "It's been great"]];
    let calls = 0;
    let skipped = 0;
    for (let i = 0; i < 200; i++) {
      const lead = leads[i % leads.length];
      const q = PHRASINGS[i % PHRASINGS.length];
      const sid = `wg_${i}_${Math.random().toString(36).slice(2)}`;
      resetCallState(sid);
      getOrCreateCallState(sid, DEFAULT_DEAL_CONFIG);
      for (const l of lead) await say(sid, l);
      const d = await say(sid, q);
      calls++;
      if (!ANSWERED.test(d.textToSpeak)) skipped++;
      // At the disclosure turn the disclosure is never dropped for the answer
      if (lead.length === 1 && d.beatId === 1) expect(d.textToSpeak, q).toMatch(/recorded audio and video/);
    }
    expect(calls).toBe(200);
    expect(skipped).toBe(0);
  });
});

describe("GAP stays unspoken until TXM approves it", () => {
  it("the proposed answer is not used while its status is needs_txm", async () => {
    expect(retrieve("what is gap").map((f) => f.id)).not.toContain("gap");
    const d = await say(atBeat(9), "What is GAP?");
    expect(d.textToSpeak).not.toMatch(/insurance pays if the car is totaled/);
  });
});
