/**
 * Phase 4 (2026-11-25): conversation gaps from TXM's test calls.
 *  - a lone word mid-explanation ("Are") is held silently and joined to the customer's next words
 *  - "I don't want the maintenance" (TXM #21) is acknowledged with the approved lines
 *  - after the call closes, the closing line is said once, then silence
 */
import { describe, it, expect } from "vitest";
import { processControllerTurn, resetCallState, getOrCreateCallState, coverageExclusion, BEATS, FRAGMENT_JOIN_MS } from "./beat-controller";
import { MAINTENANCE_EXCLUSION_LINE, DROP_MAINTENANCE_LINE, TIRE_EXCLUSION_LINE, CLOSING_LINE } from "./max-lines";
import { DEFAULT_DEAL_CONFIG } from "./deal-config";

const say = (sid: string, t: string) => processControllerTurn(sid, t, DEFAULT_DEAL_CONFIG);
function atBeat(beat: number) {
  const sid = `p4_${Math.random().toString(36).slice(2)}`;
  resetCallState(sid);
  const st = getOrCreateCallState(sid, DEFAULT_DEAL_CONFIG);
  st.step0_completed = true;
  st.current_beat = beat;
  st.delivered_beats = Array.from({ length: beat }, (_, i) => i + 1);
  st.last_spoken_text = BEATS.find((b) => b.id === beat)?.text ?? "";
  return { sid, st };
}

describe("a lone word mid-explanation", () => {
  it("is held silently and joined to the next words: 'Are' + 'you saying it's a defect?'", async () => {
    const { sid, st } = atBeat(10);
    const held = await say(sid, "Are");
    expect(held.textToSpeak).toBe("");
    expect(st.pending_fragment?.text).toBe("Are");
    const next = await say(sid, "you saying it's a defect?");
    expect(next.intent).toBe("script_fact");
    expect(next.textToSpeak).toContain("defects only");
    expect(st.pending_fragment).toBeUndefined();
  });

  it("an old held word is not joined", async () => {
    const { sid, st } = atBeat(10);
    await say(sid, "Are");
    st.pending_fragment!.at = Date.now() - FRAGMENT_JOIN_MS - 1;
    const next = await say(sid, "keep going");
    expect(next.beatId).toBe(11);
  });

  it("the call screen's 'proceed' after the hold carries on", async () => {
    const { sid } = atBeat(10);
    await say(sid, "So");
    expect((await say(sid, "proceed")).beatId).toBe(11);
  });

  it("'Hello?' is never held silently (the customer thinks Max is gone)", async () => {
    const { sid } = atBeat(10);
    expect((await say(sid, "Hello?")).textToSpeak).not.toBe("");
  });
});

describe("'I don't want the maintenance' (TXM #21)", () => {
  it("during the explanation: the approved exclusion line, then on", async () => {
    for (const [beat, t] of [[18, "I don't want the maintenance"], [12, "I don't need the maintenance package"], [18, "I do my own oil changes"]] as const) {
      const d = await say(atBeat(beat).sid, t);
      expect(d.textToSpeak, t).toBe(MAINTENANCE_EXCLUSION_LINE);
      expect(d.beatType, t).toBe("continue");
    }
  });

  it("at the price: the adjust line and the price question, no price change", async () => {
    const { sid, st } = atBeat(22);
    const d = await say(sid, "I don't want the maintenance");
    expect(d.textToSpeak.startsWith(DROP_MAINTENANCE_LINE)).toBe(true);
    expect(d.textToSpeak).toMatch(/\?$/);
    expect(st.concession_stage ?? 1).toBe(1);
  });

  it("tires too, and nothing for a question about coverage", () => {
    const { st } = atBeat(17);
    expect(coverageExclusion("I don't need the tires", st)).toBe(TIRE_EXCLUSION_LINE);
    expect(coverageExclusion("does the maintenance cover brakes?", st)).toBeNull();
  });
});

describe("the end of the call", () => {
  it("the closing line once, then silence", async () => {
    const { sid } = atBeat(9);
    const stop = await say(sid, "I'm going to hang up");
    expect(stop.state.is_stopped).toBe(true);
    const texts = [];
    for (const t of ["thank you", "bye", "take care", "okay"]) texts.push((await say(sid, t)).textToSpeak);
    expect(texts.filter((t) => t === CLOSING_LINE).length).toBeLessThanOrEqual(1);
    expect(texts.slice(1).every((t) => t === "")).toBe(true);
  });
});
