import { describe, it, expect } from "vitest";
import { retrieve, answerFromKnowledgeBase, isSupported, looksLikeQuestion } from "./grounded-answer";
import { processControllerTurn, getOrCreateCallState, resetCallState } from "./beat-controller";
import { UNKNOWN_QUESTION_LINE } from "./max-lines";

const nokey = () => { delete process.env.XAI_API_KEY; delete process.env.OPENAI_API_KEY; };

describe("grounded answers", () => {
  it.each([
    ["What's a powertrain?", "engine and the transmission"],
    ["Where is that in the manual?", "glovebox"],
    ["What is the deductible?", "zero deductible"],
    ["So who pays then?", "owner pays"],
    ["How much is labor?", "$180"],
  ])("answers %s from the script", async (q, frag) => {
    nokey();
    const r = await answerFromKnowledgeBase(q);
    expect(r.kind).toBe("answer");
    expect(r.text.toLowerCase()).toContain(frag.toLowerCase());
  });

  it.each([
    "Can I cancel and get a refund?",
    "What about hail?",
    "Do you cover Uber driving?",
    "Will this void my lease?",
    "Who is the warranty company?",
    "Do I have to decide today?",
  ])("hands off %s (no approved answer)", async (q) => {
    nokey();
    const r = await answerFromKnowledgeBase(q);
    expect(r.kind).toBe("handoff");
    expect(r.text).toBe(UNKNOWN_QUESTION_LINE);
  });

  // TXM's answers, 2026-11-22: approved, matched only by their own keywords
  it.each([
    ["Is it transferable if I sell the car?", "isn't transferable"],
    ["Does it cover the battery?", "battery, brake pads and wipers aren't covered"],
    ["Can I use my own mechanic?", "you can use your own mechanic"],
    ["Is this mandatory?", "not mandatory"],
    ["How do I make a claim?", "calls in the claim for you"],
    ["What does zero deductible mean?", "you pay nothing at the time"],
  ])("answers %s from TXM's approved answer", async (q, frag) => {
    nokey();
    const r = await answerFromKnowledgeBase(q);
    expect(r.kind).toBe("answer");
    expect(r.text).toContain(frag);
  });

  it.each(["What's the weather like outside?", "That's not true at all.", "Is this whole call an automated bot?", "What's my interest rate on the loan?"])(
    "an answered TXM question never matches the unrelated remark %s",
    (q) => {
      expect(retrieve(q).map((f) => f.id).filter((id) => id.startsWith("txm:"))).toEqual([]);
    }
  );

  it("rejects drafts that add numbers or risky words not in the passages", () => {
    expect(isSupported("It is fully refundable.", ["Zero deductible."])).toBe(false);
    expect(isSupported("It covers 12 years.", ["Zero deductible."])).toBe(false);
    expect(isSupported("Zero deductible.", ["Zero deductible anywhere."])).toBe(true);
  });

  it("does not treat filler as a question", () => {
    expect(looksLikeQuestion("Hmm.")).toBe(false);
    expect(looksLikeQuestion("what about hail")).toBe(true);
  });

  it("controller holds the beat after an answer and never invents terms", async () => {
    nokey();
    const sid = "g1"; resetCallState(sid);
    const st = getOrCreateCallState(sid); st.step0_completed = true; st.current_beat = 7; st.delivered_beats = [1,2,3,4,5,6,7];
    const d = await processControllerTurn(sid, "Where is that in the manual?");
    expect(d.beatId).toBe(7);
    expect(d.textToSpeak.toLowerCase()).toContain("glovebox");
  });

  // Human escalation was removed by the client: a second unanswerable question keeps the call going.
  it("two unanswerable questions in a row never stop the call", async () => {
    nokey();
    const sid = "g2"; resetCallState(sid);
    const st = getOrCreateCallState(sid); st.step0_completed = true; st.current_beat = 9; st.delivered_beats = [1,2,3,4,5,6,7,8,9];
    const a = await processControllerTurn(sid, "Can I cancel and get a refund?");
    expect(a.state.is_stopped).toBe(false);
    expect(a.textToSpeak).toContain(UNKNOWN_QUESTION_LINE);
    const b = await processControllerTurn(sid, "What about hail damage?");
    expect(b.state.is_stopped).toBe(false);
    expect(b.beatId).toBe(9);
    expect(b.textToSpeak).toContain(UNKNOWN_QUESTION_LINE);
  });
});
