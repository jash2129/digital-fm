/**
 * Fix round after the first automated test batch (2026-11-09): Max said the same line whenever he
 * did not understand (the disclosure 21 times, the $3 floor 4 times), and read knowledge-base notes
 * aloud ("The customer is asked which two coverages…").
 */
import { describe, it, expect } from "vitest";
import { processControllerTurn, processClientTurn, commitTurn, getOrCreateCallState, resetCallState, BEATS, asksForPrice, polishSpeech } from "./beat-controller";
import { DEFAULT_DEAL_CONFIG } from "./deal-config";
import {
  REPHRASE_LINE,
  MOVE_ON_LINE,
  CONSENT_SHORT_LINE,
  PRICE_DECISION_LINE,
  FLOOR_DECISION_LINE,
  DECLINE_LINE,
  UNKNOWN_QUESTION_LINE,
  PRICE_LATER_LINE,
  PRICE_SOON_LINE,
} from "./max-lines";
import { retrieve } from "./grounded-answer";
import { scoreCall } from "./call-scorecard";

const say = (sid: string, text: string) => processControllerTurn(sid, text, DEFAULT_DEAL_CONFIG);
function atBeat(beat: number, stage?: number) {
  const sid = `fr_${Math.random().toString(36).slice(2)}`;
  resetCallState(sid);
  const st = getOrCreateCallState(sid);
  st.step0_completed = true;
  st.current_beat = beat;
  st.delivered_beats = Array.from({ length: beat }, (_, i) => i + 1);
  st.last_spoken_text = BEATS.find((b) => b.id === beat)?.text ?? "";
  if (stage) st.concession_stage = stage;
  return sid;
}

describe("misses in a row escalate instead of repeating", () => {
  it("a statement beat: normal reply, then a shorter rephrase, then Max moves on", async () => {
    const sid = atBeat(7);
    const first = await say(sid, "blorp");
    expect(first.intent).toBe("garbled");
    const second = await say(sid, "flarp");
    expect(second.textToSpeak.startsWith(REPHRASE_LINE)).toBe(true);
    expect(second.beatId).toBe(7);
    const third = await say(sid, "zzz");
    expect(third.textToSpeak.startsWith(MOVE_ON_LINE)).toBe(true);
    expect(third.beatId).toBe(8);
    expect(third.intent).toBe("move_on");
  });

  it("the counter resets once the call moves on", async () => {
    const sid = atBeat(7);
    await say(sid, "blorp");
    await say(sid, "yes");
    const after = await say(sid, "blorp");
    expect(after.textToSpeak.startsWith(REPHRASE_LINE)).toBe(false);
  });

  it("confused at the recording disclosure: never the full disclosure on repeat, never moves on without consent", async () => {
    const sid = atBeat(1);
    const replies: string[] = [];
    for (let i = 0; i < 6; i++) {
      const t = await say(sid, "what does that mean?");
      replies.push(t.textToSpeak);
      expect(t.beatId).toBe(1);
    }
    expect(replies.slice(1)).toContain(CONSENT_SHORT_LINE);
    expect(replies.filter((r) => r.includes("recorded audio and video")).length).toBeLessThanOrEqual(1);
  });

  it("at the price, misses never become a yes: a plain decision question instead", async () => {
    const sid = atBeat(23, 2);
    for (let i = 0; i < 4; i++) {
      const t = await say(sid, "blorp");
      expect(t.beatId).toBe(23);
      // the plain decision question, varied with a short acknowledgement once it repeats
      if (i >= 1) expect(t.textToSpeak).toContain(PRICE_DECISION_LINE);
    }
  });

  it("two different questions in a row both get their answer, not a rephrase", async () => {
    const sid = atBeat(4);
    const a = await say(sid, "Why should I buy yours?");
    const b = await say(sid, "Is this mandatory?");
    // TXM answered both on 2026-11-22
    expect(a.textToSpeak).toContain("whole dealership behind you");
    expect(b.textToSpeak).toContain("not mandatory");
    expect(b.textToSpeak.startsWith(REPHRASE_LINE)).toBe(false);
  });

  it("a live call (two-phase turns) stays in step when Max moves on", async () => {
    const sid = atBeat(9);
    await processClientTurn(sid, "blorp", 1);
    commitTurn(sid, 1, true, 1);
    await processClientTurn(sid, "flarp", 2);
    commitTurn(sid, 2, true, 1);
    const moved = await processClientTurn(sid, "zzz", 3);
    expect(moved.beatId).toBe(10);
    expect(commitTurn(sid, 3, true, 1)).toEqual({ rolledBack: false });
    expect(getOrCreateCallState(sid).current_beat).toBe(10);
  });
});

describe("closing at the $3 floor", () => {
  it("pushback after the floor gets a choice; a second no keeps the factory warranty and moves to the paperwork", async () => {
    const sid = atBeat(23, 4);
    const choice = await say(sid, "that's still too much");
    expect(choice.textToSpeak).toBe(FLOOR_DECISION_LINE);
    const decline = await say(sid, "no, just the factory warranty");
    expect(decline.textToSpeak.startsWith(DECLINE_LINE)).toBe(true);
    expect(decline.beatId).toBe(25);
    expect(getOrCreateCallState(sid).package_declined).toBe(true);
  });

  it("a yes after the choice goes ahead at three dollars", async () => {
    const sid = atBeat(23, 4);
    await say(sid, "too much");
    const yes = await say(sid, "okay let's do it");
    expect(yes.beatId).toBe(24);
    expect(yes.textToSpeak).toContain("three dollars");
  });

  it("a long refusal at the price never becomes a confirmed sale (batch 2026-11-14)", async () => {
    const sid = atBeat(23, 3);
    const turns = [];
    for (const line of [
      "No. I don't trust this. I'm not paying for any of it. Just the factory numbers with nothing added.",
      "No that's not what I said. I don't want the protection. Stop trying to add it.",
      "No. Stop adding it. I don't want the protection. Just the factory warranty only.",
    ]) {
      const t = await say(sid, line);
      turns.push({ customer: line, max: t.textToSpeak, beat: t.beatId });
      expect(t.textToSpeak, line).not.toMatch(/moving forward with/i);
    }
    expect(turns[0].max).toContain("three dollars a day");
    expect(turns[1].max).toBe(FLOOR_DECISION_LINE);
    expect(turns[2].max.startsWith(DECLINE_LINE)).toBe(true);
    expect(getOrCreateCallState(sid).package_declined).toBe(true);
    expect(scoreCall(turns).checks.find((c) => c.id === "no_confirm_after_refusal")?.pass).toBe(true);
  });

  it("naming the price while refusing it is not an acceptance (batch 2026-11-14 #23)", async () => {
    const sid = atBeat(23, 4);
    getOrCreateCallState(sid).floor_decision_asked = true;
    const t = await say(sid, "Keep just the factory warranty. I'm not paying three dollars a day for anything extra.");
    expect(t.textToSpeak).not.toMatch(/moving forward with/i);
    expect(t.textToSpeak.startsWith(DECLINE_LINE)).toBe(true);
  });

  it("'No… just do the paperwork' at the price is a refusal, not a yes (batch 2026-11-14 #39)", async () => {
    const t = await say(atBeat(23, 2), "No. I'm not paying for any of it. Just do the paperwork with the basic deal only.");
    expect(t.textToSpeak).not.toMatch(/moving forward with/i);
    expect(t.textToSpeak).toContain("three dollars and twenty-five cents");
  });

  it("real acceptances at the price still go through", async () => {
    for (const line of ["Three dollars works, let's do it.", "Yes, no problem, let's go ahead."]) {
      const t = await say(atBeat(23, 4), line);
      expect(t.beatId, line).toBe(24);
    }
  });

  it("the scorecard flags a confirmation right after a refusal", () => {
    const bad = scoreCall([
      { customer: "No, I don't want the protection", max: "Great, so to confirm, we're moving forward with full vehicle protection for three dollars a day.", beat: 24 },
    ]);
    expect(bad.checks.find((c) => c.id === "no_confirm_after_refusal")?.pass).toBe(false);
    const ok = scoreCall([
      { customer: "Three fifty a day sounds great, this feels like a no brainer.", max: "Great, so to confirm, we're moving forward with full vehicle protection for three dollars and fifty cents a day.", beat: 24 },
    ]);
    expect(ok.checks.find((c) => c.id === "no_confirm_after_refusal")?.pass).toBe(true);
  });

  it("the floor line is never said four times: a haggling run passes the loop check", async () => {
    const sid = atBeat(22);
    const turns = [];
    for (const line of ["too much", "too much", "too much", "too much", "still too much", "no"]) {
      const t = await say(sid, line);
      turns.push({ customer: line, max: t.textToSpeak, beat: t.beatId });
    }
    expect(scoreCall(turns).checks.find((c) => c.id === "no_loop")?.pass).toBe(true);
  });
});

describe("price asks wrapped in a yes (simulated batch 2026-11-21)", () => {
  it("'Yes … what's the price?' twice: the second goes straight to the price, never a second 'in a moment'", async () => {
    const sid = atBeat(7);
    const first = await say(sid, "Yes I understand. Can we please move on to the protection package and its daily price?");
    expect(first.intent).toBe("price_ask");
    const second = await say(sid, "Yeah I get it. What's the daily price on the protection package?");
    expect(second.beatId).toBe(22);
    expect(second.textToSpeak).toContain("four dollars a day");
    expect(second.textToSpeak).not.toContain("in just a moment");
  });

  it("a plain yes that mentions repairs costing money is still a yes", async () => {
    const t = await say(atBeat(13), "Yes, repairs cost a fortune these days");
    expect(t.intent).not.toBe("price_ask");
    expect(asksForPrice("how much longer is this going to take")).toBe(false);
    expect(asksForPrice("Let's talk price on the protection package")).toBe(true);
  });

  it("price worries before the price: the two 'later' lines take turns, never the same twice in a row", async () => {
    const sid = atBeat(9);
    const replies: string[] = [];
    for (const line of ["That's too much", "I can't afford that", "can you do better"]) replies.push((await say(sid, line)).textToSpeak);
    expect(replies[0].startsWith(PRICE_LATER_LINE)).toBe(true);
    expect(replies[1].startsWith(PRICE_SOON_LINE)).toBe(true);
    expect(replies[2].startsWith(PRICE_SOON_LINE)).toBe(false);
    expect(getOrCreateCallState(sid).current_beat).toBe(9);
  });
});

describe("speech polish: capitals, punctuation and spelling, never the wording (2026-11-22)", () => {
  it("fixes what reached the voice in the simulated calls", () => {
    expect(polishSpeech("the warranty i need to go over.... Is that okay?")).toBe("The warranty I need to go over... Is that okay?");
    expect(polishSpeech("ten years hundred thousand mile BUMBER TO BUMBER WARRANTY THAT COVERS ALL the parts")).toBe(
      "Ten years hundred thousand mile bumper to bumper warranty that covers all the parts"
    );
    expect(polishSpeech("im sure you heard that. it costs less then half a cup, especially here in texas.. Climate")).toBe(
      "I'm sure you heard that. It costs less than half a cup, especially here in Texas. Climate"
    );
  });
  it("leaves acronyms, ellipsis pauses, prices and correct text alone", () => {
    for (const ok of ["GAP covers the loan.", "Climate... especially in summer.", "It's four dollars a day.", FLOOR_DECISION_LINE, DECLINE_LINE]) {
      expect(polishSpeech(ok)).toBe(ok);
    }
  });
  it("is stable: polishing twice changes nothing", () => {
    for (const b of BEATS) {
      const once = polishSpeech(b.text);
      expect(polishSpeech(once), `beat ${b.id}`).toBe(once);
    }
  });
});

describe("knowledge-base notes are never read aloud", () => {
  it("'which two coverages' no longer finds the note about the call", () => {
    const facts = retrieve("which two do you see the most value in");
    expect(facts.map((f) => f.answer).join(" ")).not.toMatch(/the customer is asked|the assistant/i);
  });
});

describe("polish round after batch 3 (8 of 40 calls still looping)", () => {
  it("a long friendly story while Max is explaining carries the call on", async () => {
    const sid = atBeat(9);
    const t = await say(sid, "oh that reminds me, my old car had the worst potholes on my commute every single morning");
    expect(t.beatId).toBe(10);
  });

  it("short remarks and pushback are not treated as a story", async () => {
    for (const line of ["You sound like a machine.", "I do my own oil changes in my garage every few months anyway"]) {
      const t = await say(atBeat(9), line);
      expect(t.beatId, line).toBe(9);
    }
  });

  it("a short question said three times in a row is varied", async () => {
    const sid = atBeat(5);
    const replies: string[] = [];
    for (let i = 0; i < 3; i++) replies.push((await say(sid, "blorp")).textToSpeak);
    expect(new Set(replies).size).toBe(3);
  });

  it("moving on at a yes/no question does not assume a yes", async () => {
    const sid = atBeat(2);
    await say(sid, "blorp");
    await say(sid, "flarp");
    const moved = await say(sid, "zzz");
    expect(moved.textToSpeak.startsWith(MOVE_ON_LINE)).toBe(true);
    expect(moved.textToSpeak).not.toMatch(/Awesome|when you came back from the test drive/i);
  });
});
