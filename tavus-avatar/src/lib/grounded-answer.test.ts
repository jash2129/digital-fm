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
    ["How much is labor?", "$130"],
  ])("answers %s from the script", async (q, frag) => {
    nokey();
    const r = await answerFromKnowledgeBase(q);
    expect(r.kind).toBe("answer");
    expect(r.text.toLowerCase()).toContain(frag.toLowerCase());
  });

  it.each([
    "Can I cancel and get a refund?",
    "Is it transferable?",
    "Does it cover the battery?",
    "What about hail?",
    "Can I use my own mechanic?",
    "Do you cover Uber driving?",
    "Will this void my lease?",
  ])("hands off %s (no approved answer)", async (q) => {
    nokey();
    const r = await answerFromKnowledgeBase(q);
    expect(r.kind).toBe("handoff");
    expect(r.text).toBe(UNKNOWN_QUESTION_LINE);
  });

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

  it("two unanswerable questions in a row hand off", async () => {
    nokey();
    const sid = "g2"; resetCallState(sid);
    const st = getOrCreateCallState(sid); st.step0_completed = true; st.current_beat = 9; st.delivered_beats = [1,2,3,4,5,6,7,8,9];
    const a = await processControllerTurn(sid, "Is it transferable if I sell the car?");
    expect(a.state.is_stopped).toBe(false);
    expect(a.textToSpeak).toContain(UNKNOWN_QUESTION_LINE);
    const b = await processControllerTurn(sid, "Does it cover the battery?");
    expect(b.state.is_stopped).toBe(true);
  });
});
