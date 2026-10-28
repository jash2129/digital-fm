import { describe, it, expect } from "vitest";
import { processControllerTurn, getOrCreateCallState } from "./beat-controller";
import { DEFAULT_DEAL_CONFIG } from "./deal-config";

describe("Client Scenarios Human Experience Validation", () => {
  it("Call 1: 'The Skeptical Dealer Principal' (Sales objection, walkaround 'No', warranty 'No', $2 push)", async () => {
    const sessionId = "client-call-1-" + Date.now();
    getOrCreateCallState(sessionId);

    // Turn 1: Tech Check
    const t1 = await processControllerTurn(sessionId, "Yeah, I'm here.", DEFAULT_DEAL_CONFIG);
    expect(t1.textToSpeak).toContain("Max");
    expect(t1.textToSpeak).not.toContain("colleague");

    // Turn 2: Sales Objection 1
    const t2 = await processControllerTurn(sessionId, "Is this a sales call or what?", DEFAULT_DEAL_CONFIG);
    expect(t2.textToSpeak).toContain("This isn't a sales call");
    expect(t2.textToSpeak).not.toContain("Awesome, so glad to hear that!");

    // Turn 3: Sales Objection 2 (STT 'sales score' insistence)
    const t3 = await processControllerTurn(sessionId, "Let me make you clear, is this a sales score or not? Just let me know.", DEFAULT_DEAL_CONFIG);
    expect(t3.textToSpeak).toContain("This isn't a sales call");
    expect(t3.textToSpeak).not.toContain("Awesome, so glad to hear that!");

    // Turn 4: Agreement to proceed into disclosure
    const t4 = await processControllerTurn(sessionId, "Okay, let's proceed.", DEFAULT_DEAL_CONFIG);
    expect(t4.textToSpeak).toContain("recorded audio and video");

    // Turn 5: Disclosure accepted -> Beat 2
    const t5 = await processControllerTurn(sessionId, "Yes, that's fine.", DEFAULT_DEAL_CONFIG);
    expect(t5.textToSpeak).toContain("chance to drive the vehicle");

    // Turn 6: Vehicle Discrepancy Curveball
    const t6 = await processControllerTurn(sessionId, "Wait a minute, I was not buying the Mazda, I was buying the Mercedes Maybach.", DEFAULT_DEAL_CONFIG);
    expect(t6.textToSpeak).toContain("Maybach");
    expect(t6.beatId).toBe(2);

    // Turn 7: Customer confirms driving the vehicle
    const t7 = await processControllerTurn(sessionId, "Yeah, I did drive it.", DEFAULT_DEAL_CONFIG);
    expect(t7.textToSpeak).toContain("walkaround");

    // Turn 8: CRITICAL FIX TEST: Customer says NO to Walkaround
    const t8 = await processControllerTurn(sessionId, "No, he didn't show me anything.", DEFAULT_DEAL_CONFIG);
    expect(t8.textToSpeak).not.toContain("When you came back from the test drive, the sales person did the walkaround");
    expect(t8.beatId).toBe(4);
    expect(t8.textToSpeak).toContain("What's your understanding of the warranty that comes with the vehicle?");

    // Turn 9: CRITICAL FIX TEST: Customer says NO to Warranty explanation
    const t9 = await processControllerTurn(sessionId, "No, he didn't tell me anything about the warranty.", DEFAULT_DEAL_CONFIG);
    expect(t9.textToSpeak).not.toContain("bring in my colleague");
    expect(t9.textToSpeak).toContain("Allow me to go over it really quick to make sure that you understand everything");
    expect(t9.textToSpeak).toContain("Mazda is like any other manufacturer");
    expect(t9.beatId).toBe(6);

    // Turn 10: Check-in
    const t10 = await processControllerTurn(sessionId, "Okay, makes sense.", DEFAULT_DEAL_CONFIG);
    expect(t10.beatId).toBeGreaterThan(6);

    // Turn 11: Presence check curveball ('Are you there?')
    const t11 = await processControllerTurn(sessionId, "Are you there?", DEFAULT_DEAL_CONFIG);
    expect(t11.textToSpeak).toContain("I'm right here with you!");
    expect(t11.textToSpeak).not.toContain("When you came back from the test drive");

    // Fast-forward to Beat 22 (The Offer) to test critical price negotiation & floor defense
    const state1 = getOrCreateCallState(sessionId);
    state1.current_beat = 22;

    // Turn 12: Offer pushback & lowball request below floor ($2/day)
    const t12 = await processControllerTurn(sessionId, "Four dollars a day is too much. Can you do two dollars a day?", DEFAULT_DEAL_CONFIG);
    expect(t12.textToSpeak).toContain("Three dollars a day is our absolute hard floor");
    expect(t12.textToSpeak).not.toContain("colleague");
    expect(t12.toolCalls.some(t => t.name === "show_payment_breakdown")).toBe(true);

    // Turn 13: Customer accepts at $3.00 floor
    const t13 = await processControllerTurn(sessionId, "Alright, three dollars a day sounds fair. Let's lock it in.", DEFAULT_DEAL_CONFIG);
    expect(t13.textToSpeak).not.toContain("colleague");
  });

  it("Call 2: 'The Tough F&I Director' (APR questions, trade-in, cancellation, full ladder)", async () => {
    const sessionId = "client-call-2-" + Date.now();
    getOrCreateCallState(sessionId);

    // Turn 1: Tech Check
    const t1 = await processControllerTurn(sessionId, "Yes, I can hear you.", DEFAULT_DEAL_CONFIG);
    expect(t1.textToSpeak.length).toBeGreaterThan(0);

    // Turn 2: Call Purpose Inquiry
    const t2 = await processControllerTurn(sessionId, "What is this call actually for?", DEFAULT_DEAL_CONFIG);
    expect(t2.textToSpeak).toContain("paperwork");

    // Turn 3: Disclosure
    const t3 = await processControllerTurn(sessionId, "Yeah, sounds good to me.", DEFAULT_DEAL_CONFIG);
    expect(t3.textToSpeak).toContain("recorded audio and video");

    // Turn 4: Customer acknowledges recording -> moves to Beat 2
    const t4 = await processControllerTurn(sessionId, "Understood.", DEFAULT_DEAL_CONFIG);
    expect(t4.beatId).toBe(2);

    // Turn 5: OFF-SCRIPT TEST: Financial APR & Interest Rate Question
    // Max answers authoritatively about financing agreement and smoothly transitions to Beat 3
    const t5 = await processControllerTurn(sessionId, "What is my interest rate and monthly payment going to be?", DEFAULT_DEAL_CONFIG);
    expect(t5.textToSpeak).not.toContain("make a note of that for my colleague");
    expect(t5.textToSpeak).not.toContain("colleague");
    expect(t5.textToSpeak).toContain("purchase terms are locked in");

    // Turn 6: Customer confirms walkaround (answers Beat 3) -> moves to Beat 4
    const t6 = await processControllerTurn(sessionId, "Yes, he showed me around the vehicle.", DEFAULT_DEAL_CONFIG);
    expect(t6.beatId).toBe(4);

    // Turn 7: Customer heard about factory warranty
    const t7 = await processControllerTurn(sessionId, "He mentioned something about 10 years and 100,000 miles.", DEFAULT_DEAL_CONFIG);
    expect(t7.textToSpeak).toContain("more information about the warranty");

    // Turn 8: Warranty agreement check-in
    const t8 = await processControllerTurn(sessionId, "Yes, that's fine.", DEFAULT_DEAL_CONFIG);
    expect(t8.beatId).toBeGreaterThanOrEqual(6);

    // Turn 9: OFF-SCRIPT TEST: Trade-in appraisal value
    const t9 = await processControllerTurn(sessionId, "What about my trade in value? Did they give me enough?", DEFAULT_DEAL_CONFIG);
    expect(t9.textToSpeak).not.toContain("make a note for my colleague");
    expect(t9.textToSpeak).not.toContain("colleague");

    // Fast-forward to Beat 22 (The Offer) to test the 4-stage negotiation ladder & human escalation defense
    const state2 = getOrCreateCallState(sessionId);
    state2.current_beat = 22;

    // Turn 10: Ladder Stage 1: Pushback on $4.00/day
    const t10 = await processControllerTurn(sessionId, "Four dollars is too high for warranty. Can you do better?", DEFAULT_DEAL_CONFIG);
    expect(t10.textToSpeak).toContain("three dollars and fifty cents");
    expect(t10.toolCalls.some(t => t.name === "show_payment_breakdown")).toBe(true);

    // Turn 11: Ladder Stage 2: Pushback on $3.50/day
    const t11 = await processControllerTurn(sessionId, "Three fifty is still more than I budgeted for.", DEFAULT_DEAL_CONFIG);
    expect(t11.textToSpeak).toContain("three dollars and twenty-five cents");
    expect(t11.toolCalls.some(t => t.name === "show_payment_breakdown")).toBe(true);

    // Turn 12: Ladder Stage 3: Pushback on $3.25/day
    const t12 = await processControllerTurn(sessionId, "Give me your absolute best deal or I'll pass.", DEFAULT_DEAL_CONFIG);
    expect(t12.textToSpeak).toContain("three dollars a day");
    expect(t12.textToSpeak).not.toContain("colleague");
    expect(t12.toolCalls.some(t => t.name === "show_payment_breakdown")).toBe(true);

    // Turn 13: Human Escalation Request Test: 'Let me talk to a real person'
    const t13 = await processControllerTurn(sessionId, "I want to speak with a human manager right now.", DEFAULT_DEAL_CONFIG);
    expect(t13.textToSpeak).toContain("I have full authority to handle your paperwork");
    expect(t13.textToSpeak).not.toContain("bring in my colleague");

    // Turn 14: Final Agreement at $3.00/day
    const t14 = await processControllerTurn(sessionId, "Okay, you convinced me. Let's do the three dollars a day.", DEFAULT_DEAL_CONFIG);
    expect(t14.textToSpeak).not.toContain("colleague");
  });
});
