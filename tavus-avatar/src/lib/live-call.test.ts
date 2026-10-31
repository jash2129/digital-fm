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
  repromptText,
  classifyCustomerInputRuleBased,
  BEATS,
} from "./beat-controller";
import { STILL_WITH_ME_LINE, CLARIFY_LINE, PRESENCE_LINE } from "./max-lines";

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

describe("W (server): reprompts and presence checks", () => {
  it("the dead-man 'resume' re-delivers a rolled-back reply in full", async () => {
    const sid = fresh(2);
    const reply = await processClientTurn(sid, "yeah I drove it", 1);
    commitTurn(sid, 1, false, 0);
    expect(repromptText(sid, "resume")).toBe(splitIntoSentences(reply.textToSpeak).join(" "));
    expect(getOrCreateCallState(sid).current_beat).toBe(3);
    expect(getOrCreateCallState(sid).interrupted).toBeUndefined();
  });

  it("without an unheard reply, 'resume' re-asks the pending question and does not advance", () => {
    const sid = fresh(4);
    expect(repromptText(sid, "resume")).toMatch(/warranty/i);
    expect(getOrCreateCallState(sid).current_beat).toBe(4);
  });

  it("silence prompts: still-with-me plus the pending question, then the clarify line", () => {
    const sid = fresh(2);
    expect(repromptText(sid, "still_with_me")).toBe(`${STILL_WITH_ME_LINE} Did you get a chance to take it for a test drive?`);
    expect(repromptText(sid, "clarify")).toBe(CLARIFY_LINE);
  });

  it("the live call's unanswered lines are presence checks that re-ask the pending question", async () => {
    for (const say of ["say something", "what was the question", "what's the question", "why aren't you asking questions"]) {
      expect(classifyCustomerInputRuleBased(say, 4).intent, say).toBe("greeting_check");
      const sid = fresh(4);
      const d = await processClientTurn(sid, say, 1);
      expect(d.textToSpeak.startsWith(PRESENCE_LINE), say).toBe(true);
      expect(d.textToSpeak, say).not.toContain("please go ahead");
      expect(d.beatId, say).toBe(4);
    }
  });
});

describe("S: greetings re-ask the pending question", () => {
  it("B2 'Are you there?' re-asks the Beat 2 question; then 'yeah' answers it", async () => {
    const sid = fresh(2);
    const hello = await processClientTurn(sid, "Are you there?", 1);
    expect(hello.textToSpeak.endsWith("Did you get a chance to take it for a test drive?")).toBe(true);
    expect(hello.textToSpeak).not.toContain("please go ahead");
    expect(hello.beatId).toBe(2);
    const yeah = await processClientTurn(sid, "yeah", 2);
    expect(yeah.beatId).toBe(3);
  });

  it("'Hello' and 'can you hear me' at other beats re-ask that beat's pending question", async () => {
    for (const [beat, say] of [[10, "Hello."], [7, "can you hear me"]] as const) {
      const sid = fresh(beat);
      const d = await processClientTurn(sid, say, 1);
      expect(d.textToSpeak.trim().endsWith("?"), `${beat} ${say}`).toBe(true);
      expect(d.beatId, `${beat} ${say}`).toBe(beat);
    }
  });

  it("a question asked at an earlier beat is never re-asked as if it were pending", async () => {
    const sid = fresh(5);
    await processClientTurn(sid, "yes", 1); // Beat 6, asks "right?"
    const st = getOrCreateCallState(sid);
    st.current_beat = 9; // a continue beat with no question of its own
    const d = await processClientTurn(sid, "are you there", 2);
    expect(d.textToSpeak).not.toContain("right?");
  });
});

describe("T: Step 0 reacts to what the customer says", () => {
  const step0 = () => {
    const sid = `s0_${Math.random().toString(36).slice(2)}`;
    resetCallState(sid);
    getOrCreateCallState(sid);
    return sid;
  };

  it("'Who's this?' first identifies Max, then continues with the Step 0 line", async () => {
    for (const say of ["Who's this?", "who is this", "who are you", "what is this"]) {
      const d = await processClientTurn(step0(), say, 1);
      expect(d.textToSpeak.startsWith("I'm Max, your digital finance manager today."), say).toBe(true);
      expect(d.textToSpeak, say).toContain("congratulations");
      expect(d.textToSpeak.match(/I'm Max/g)?.length, say).toBe(1); // not introduced twice
    }
  });

  it("'Can you hear me?' gets a short acknowledgment and the tech check again", async () => {
    const d = await processClientTurn(step0(), "can you hear me?", 1);
    expect(d.textToSpeak).toBe("Yes, I can hear you. Can you hear and see me alright?");
    expect(d.beatId).toBe(0);
  });

  it("'I can't see you' still gets the tech-issue line, never 'great to connect'", async () => {
    const d = await processClientTurn(step0(), "I can't see you", 1);
    expect(d.textToSpeak.toLowerCase()).not.toContain("great to connect");
    expect(d.textToSpeak.toLowerCase()).toContain("can you see and hear me");
  });
});

describe("Follow-up 7 A: a rollback never undoes the customer's progress", () => {
  const step0 = () => {
    const sid = `s0_${Math.random().toString(36).slice(2)}`;
    resetCallState(sid);
    getOrCreateCallState(sid);
    return sid;
  };
  const OPENER = "great to connect with you";

  it("opener cut at 30%, then 'Who are you?' gets the identity answer and step0_turns is 2", async () => {
    const sid = step0();
    const opener = await processClientTurn(sid, "Yeah.", 1);
    expect(opener.textToSpeak.toLowerCase()).toContain(OPENER);
    commitTurn(sid, 1, false, 0.3);
    expect(getOrCreateCallState(sid).step0_turns).toBe(1); // not rolled back

    const who = await processClientTurn(sid, "Who are you?", 2);
    expect(who.textToSpeak.startsWith("I'm Max")).toBe(true);
    expect(who.textToSpeak.toLowerCase()).not.toContain(OPENER);
    expect(getOrCreateCallState(sid).step0_turns).toBe(2);
  });

  it("four Step 0 turns, every reply cut: the full opener is never repeated and Beat 1 is reached by turn 3", async () => {
    const sid = step0();
    const says = ["Yeah.", "Who? Who are you?", "it was fine, thanks", "okay"];
    const replies: string[] = [];
    let reachedBeat1At = 0;
    for (let i = 0; i < says.length; i++) {
      const d = await processClientTurn(sid, says[i], i + 1);
      replies.push(d.textToSpeak);
      if (!reachedBeat1At && d.beatId >= 1) reachedBeat1At = i + 1;
      commitTurn(sid, i + 1, false, 0.3); // the customer talks over every line, as in the live call
    }
    const fullOpeners = replies.filter((r) => r.toLowerCase().includes(OPENER) && r.includes("How has your experience been"));
    expect(fullOpeners.length).toBeLessThanOrEqual(1);
    expect(reachedBeat1At).toBeGreaterThan(0);
    expect(reachedBeat1At).toBeLessThanOrEqual(3);
  });

  it("a cut Step 0 opener resumes with only its question", async () => {
    const sid = step0();
    await processClientTurn(sid, "Yeah.", 1);
    commitTurn(sid, 1, false, 0.4);
    const resumed = await processClientTurn(sid, "yeah", 2);
    expect(resumed.intent).toBe("resume_interrupted");
    expect(resumed.textToSpeak).toBe("How has your experience been with our team so far?");
  });

  it("a rollback keeps the negotiated price and only moves the beat pointer", async () => {
    const sid = fresh(22);
    await processClientTurn(sid, "that's too much", 1);
    expect(getOrCreateCallState(sid).dealConfig.per_day_price).toBe("three dollars and fifty cents");
    commitTurn(sid, 1, false, 0.2);
    const st = getOrCreateCallState(sid);
    expect(st.current_beat).toBe(22);
    expect(st.dealConfig.per_day_price).toBe("three dollars and fifty cents");
    expect(st.concession_stage).toBe(2);
  });

  it("a line is restarted from the top at most once", async () => {
    const sid = fresh(5);
    const first = await processClientTurn(sid, "yes", 1); // Beat 6
    commitTurn(sid, 1, false, 0); // cut in its first sentence
    const again = await processClientTurn(sid, "yeah", 2);
    expect(again.textToSpeak).toBe(splitIntoSentences(first.textToSpeak).join(" ")); // restart #1
    commitTurn(sid, 2, false, 0); // cut at the top again
    const third = await processClientTurn(sid, "okay", 3);
    expect(third.textToSpeak).not.toBe(again.textToSpeak);
    expect(third.textToSpeak.trim().endsWith("?")).toBe(true); // just its question
  });
});

describe("Follow-up 7 B: the customer says the vehicle is wrong", () => {
  const step0 = () => {
    const sid = `s0_${Math.random().toString(36).slice(2)}`;
    resetCallState(sid);
    getOrCreateCallState(sid);
    return sid;
  };
  const SAY = "I'm buying an Audi, not a Mazda";

  it("at Step 0: acknowledged, last question re-asked, and no 'Mazda' in any later line", async () => {
    const sid = step0();
    await processClientTurn(sid, "Yeah.", 1); // opener (asks about their experience)
    const fix = await processClientTurn(sid, SAY, 2);
    expect(fix.textToSpeak).toBe("Thanks for catching that, I'll make a note of your vehicle. How has your experience been with our team so far?");
    const later: string[] = [];
    for (const [i, say] of ["it was great", "okay", "yeah I drove it", "yes he did"].entries()) {
      later.push((await processClientTurn(sid, say, i + 3)).textToSpeak);
    }
    for (const t of later) expect(t).not.toMatch(/mazda|cx.?five|cx-5/i);
    expect(later.join(" ")).toContain("new vehicle");
  });

  it("at Beat 3: acknowledged, the walkaround question re-asked, later beats scrubbed", async () => {
    const sid = fresh(3);
    const fix = await processClientTurn(sid, SAY, 1);
    expect(fix.textToSpeak.startsWith("Thanks for catching that")).toBe(true);
    expect(fix.textToSpeak.endsWith("Did the salesperson do the walkaround with you?")).toBe(true);
    expect(fix.beatId).toBe(3);
    const st = getOrCreateCallState(sid);
    st.current_beat = 5; // the next reply is Beat 6, which opens "Mazda is like any other manufacturer"
    const beat6 = await processClientTurn(sid, "yes", 2);
    expect(beat6.beatId).toBe(6);
    expect(beat6.textToSpeak).not.toMatch(/mazda/i);
    expect(beat6.textToSpeak).toContain("Your manufacturer is like any other manufacturer");
  });

  it("repeating the correction gets a different reply each time, never the same twice", async () => {
    const sid = fresh(9);
    const a = await processClientTurn(sid, SAY, 1);
    const b = await processClientTurn(sid, "brother, I agreed to buy uh Audi, not the Mazda", 2);
    const c = await processClientTurn(sid, "I didn't buy a Mazda", 3);
    expect(b.textToSpeak.startsWith("Understood, I've noted it, and I'll have the sales team confirm the vehicle details.")).toBe(true);
    expect(new Set([a.textToSpeak, b.textToSpeak, c.textToSpeak]).size).toBe(3);
    for (const d of [a, b, c]) expect(d.beatId).toBe(9);
  });

  it("the live call's phrasings are all recognized", () => {
    for (const say of [
      "uh wait wait a minute i was uh agreed to buy uh audi",
      "Brother, what I'm saying is I was agreed to buy, uh, Audi, not the Mazda.",
      "what i'm saying is i am not going to buy mazda",
      "that's not my car",
      "wrong car",
    ]) {
      expect(classifyCustomerInputRuleBased(say, 5).intent, say).toBe("vehicle_discrepancy");
    }
    expect(classifyCustomerInputRuleBased("I love this Mazda", 5).intent).not.toBe("vehicle_discrepancy");
  });
});
