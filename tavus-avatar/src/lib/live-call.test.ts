/**
 * Server-side fixes from the live call 1ee5181b (follow-up 6): two-phase turns, so a beat only
 * counts once the customer actually heard it.
 */
import { describe, it, expect } from "vitest";
import {
  processClientTurn,
  commitTurn,
  getOrCreateCallState,
  resetCallState,
  renderBeatText,
  formatSpeechText,
  splitIntoSentences,
  BEATS,
} from "./beat-controller";

function fresh(beat: number) {
  const sid = `live_${Math.random().toString(36).slice(2)}`;
  resetCallState(sid);
  const st = getOrCreateCallState(sid);
  st.step0_completed = true;
  st.current_beat = beat;
  st.delivered_beats = Array.from({ length: beat }, (_, i) => i + 1);
  st.last_spoken_text = BEATS.find((b) => b.id === beat)?.text ?? "";
  return sid;
}
const beatBody = (id: number, sid: string) => formatSpeechText(renderBeatText(BEATS.find((b) => b.id === id)!, getOrCreateCallState(sid).dealConfig));

describe("R2: a beat only counts when it was delivered", () => {
  it("(c) a dropped (stale) reply is rolled back and resumed by the next 'yeah', not skipped", async () => {
    const sid = fresh(2);
    // Customer answers the test-drive question; the server moves to Beat 3 (walkaround)...
    const first = await processClientTurn(sid, "yeah I drove it", 1);
    expect(first.beatId).toBe(3);
    // ...but the client dropped that reply as stale, so the customer never heard Beat 3
    expect(commitTurn(sid, 1, false, 0)).toEqual({ rolledBack: true });
    expect(getOrCreateCallState(sid).current_beat).toBe(2);

    // The next bare "yeah" resumes Beat 3; it is not taken as an answer to Beat 3's question
    const next = await processClientTurn(sid, "yeah", 2);
    expect(next.intent).toBe("resume_interrupted");
    expect(next.beatId).toBe(3);
    expect(next.textToSpeak).toContain(beatBody(3, sid).slice(0, 40));
    expect(getOrCreateCallState(sid).interrupted).toBeUndefined();
  });

  it("a cut line resumes from the sentence where Max was cut", async () => {
    const sid = fresh(5);
    const reply = await processClientTurn(sid, "yes", 1); // Beat 6: several sentences
    const sentences = splitIntoSentences(reply.textToSpeak);
    expect(sentences.length).toBeGreaterThan(2);
    commitTurn(sid, 1, false, 0.5);
    const resumed = await processClientTurn(sid, "okay", 2);
    const cutAt = Math.floor(0.5 * sentences.length);
    expect(resumed.textToSpeak.startsWith(sentences[cutAt])).toBe(true);
    expect(resumed.textToSpeak).not.toContain(sentences[0]);
  });

  it("after a rollback, a real answer is processed against the question the customer did hear", async () => {
    const sid = fresh(2);
    await processClientTurn(sid, "yeah I drove it", 1);
    commitTurn(sid, 1, false, 0.1);
    const d = await processClientTurn(sid, "no I didn't drive it", 2);
    expect(d.intent).not.toBe("resume_interrupted");
    expect(d.beatId).toBe(4); // Beat 2 "didn't drive" path skips the walkaround question
  });

  it("a delivered reply is kept; a late or unknown commit changes nothing", async () => {
    const sid = fresh(2);
    await processClientTurn(sid, "yeah I drove it", 1);
    expect(commitTurn(sid, 1, true, 0.95)).toEqual({ rolledBack: false });
    expect(getOrCreateCallState(sid).current_beat).toBe(3);
    expect(commitTurn(sid, 1, false, 0).rolledBack).toBe(false); // already committed
    await processClientTurn(sid, "yes he did", 2);
    expect(commitTurn(sid, 1, false, 0)).toMatchObject({ rolledBack: false, reason: "not_the_latest_turn" });
    expect(getOrCreateCallState(sid).current_beat).toBe(4);
  });
});
