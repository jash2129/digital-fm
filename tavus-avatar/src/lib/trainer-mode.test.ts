import { describe, it, expect, beforeEach } from "vitest";
import {
  processControllerTurn,
  resetCallState,
  getOrCreateCallState,
  isCoachFeedback,
  categorizeTrainerFeedback,
} from "./beat-controller";
import { COACH_ACK_LINE } from "./max-lines";
import { DEFAULT_DEAL_CONFIG } from "./deal-config";

describe("In-Call Trainer / Coaching Mode", () => {
  beforeEach(() => {
    resetCallState();
  });

  it("classifies voice and tagged trainer coaching triggers correctly", () => {
    expect(isCoachFeedback("[COACH]: Say it more warmly")).toBe(true);
    expect(isCoachFeedback("[feedback]: Don't mention the dealer fees")).toBe(true);
    expect(isCoachFeedback("Coach mode: you should pause before naming the price")).toBe(true);
    expect(isCoachFeedback("Note for Max: speak slower here")).toBe(true);
    expect(isCoachFeedback("Feedback for Max: explain wear and tear in simpler words")).toBe(true);
    expect(isCoachFeedback("Don't say that, say your monthly payment is $450")).toBe(true);
    expect(isCoachFeedback("Instead of that say we cover your entire engine and transmission")).toBe(true);
    expect(isCoachFeedback("You should have said the inspection is free")).toBe(true);
    expect(isCoachFeedback("Change that line to keep it simple")).toBe(true);

    // Normal customer dialogue should NOT be classified as coach feedback
    expect(isCoachFeedback("Yes, I can hear you fine")).toBe(false);
    expect(isCoachFeedback("That's too much money")).toBe(false);
    expect(isCoachFeedback("What does that mean?")).toBe(false);
    expect(isCoachFeedback("Does it cover my battery?")).toBe(false);
    expect(isCoachFeedback("No thanks, I'll pass")).toBe(false);
  });

  it("categorizes feedback types appropriately", () => {
    expect(categorizeTrainerFeedback("Speak more warmly and naturally")).toBe("tone");
    expect(categorizeTrainerFeedback("Slow down and pause before giving the number")).toBe("pacing");
    expect(categorizeTrainerFeedback("The factory warranty does not cover brake pads")).toBe("policy_fact");
    expect(categorizeTrainerFeedback("Change that line to say hello instead")).toBe("phrasing");
    expect(categorizeTrainerFeedback("Great job on this section")).toBe("general");
  });

  it("holds beat, speaks COACH_ACK_LINE, and records feedback at mid-call beat", async () => {
    const sid = "trainer-test-b9";
    const state = getOrCreateCallState(sid, DEFAULT_DEAL_CONFIG);
    state.step0_completed = true;
    state.current_beat = 9;
    state.last_spoken_text = "Potholes and road hazards can ruin tires, wheels, and suspension components.";

    const d1 = await processControllerTurn(sid, "Coach mode: don't say that, say road hazards are everywhere in Texas");

    expect(d1.beatId).toBe(9);
    expect(d1.textToSpeak).toBe(COACH_ACK_LINE);
    expect(d1.intent).toBe("coach_feedback");

    // Check feedback storage in call state
    expect(state.trainer_feedback).toBeDefined();
    expect(state.trainer_feedback?.length).toBe(1);
    expect(state.trainer_feedback?.[0].beat).toBe(9);
    expect(state.trainer_feedback?.[0].last_spoken).toContain("Potholes");
    expect(state.trainer_feedback?.[0].feedback).toContain("Texas");
    expect(state.trainer_feedback?.[0].category).toBe("phrasing");
  });

  it("resumes normally on the next turn after coach feedback", async () => {
    const sid = "trainer-resume-test";
    const state = getOrCreateCallState(sid, DEFAULT_DEAL_CONFIG);
    state.step0_completed = true;
    state.current_beat = 9;
    state.last_spoken_text = "Potholes and road hazards can ruin tires, wheels, and suspension components.";

    // Turn 1: Coaching feedback
    const d1 = await processControllerTurn(sid, "Feedback for Max: be more conversational here");
    expect(d1.textToSpeak).toBe(COACH_ACK_LINE);
    expect(d1.beatId).toBe(9);

    // Turn 2: Customer resumes with "okay, continue"
    const d2 = await processControllerTurn(sid, "okay, continue");
    expect(d2.beatId).toBe(10);
    expect(d2.textToSpeak).not.toBe(COACH_ACK_LINE);
  });

  it("handles coaching feedback during Step 0 without corrupting greeting flow", async () => {
    const sid = "trainer-step0-test";
    const state = getOrCreateCallState(sid, DEFAULT_DEAL_CONFIG);

    // Turn 1: Step 0 coach feedback
    const d1 = await processControllerTurn(sid, "Note for Max: your greeting was too fast");
    expect(d1.beatId).toBe(0);
    expect(d1.textToSpeak).toBe(COACH_ACK_LINE);
    expect(d1.intent).toBe("coach_feedback");
    expect(state.step0_completed).toBe(false);

    // Turn 2: Resume step 0
    const d2 = await processControllerTurn(sid, "Yes, I can hear and see you fine");
    expect(d2.intent).toBe("step0");
  });

  it("does not trigger handleMisses move_on even after 3 coaching notes in a row", async () => {
    const sid = "trainer-no-miss-test";
    const state = getOrCreateCallState(sid, DEFAULT_DEAL_CONFIG);
    state.step0_completed = true;
    state.current_beat = 12;

    await processControllerTurn(sid, "Coach mode: first note");
    await processControllerTurn(sid, "Coach mode: second note");
    const d3 = await processControllerTurn(sid, "Coach mode: third note");

    // Beat should still be held at 12, never auto-advanced as a miss
    expect(d3.beatId).toBe(12);
    expect(d3.textToSpeak).toBe(COACH_ACK_LINE);
    expect(state.trainer_feedback?.length).toBe(3);
  });
});
