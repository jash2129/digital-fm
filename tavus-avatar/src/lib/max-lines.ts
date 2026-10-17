// =============================================================================
// MAX FIXED LINES CONFIGURATION
// All fixed lines live in this single config file for TXM review and tuning.
// Approved lines as of Part 3 sign-off.
// =============================================================================

// Spoken before repeating the current beat after customer says "no"
// Status: APPROVED
export const LEAD_IN_NO = "Allow me to go over it really quick to make sure that you understand everything.";

// Spoken when customer input cannot be transcribed or is inaudible
// Status: APPROVED
export const GARBLED_LINE = "Sorry, I didn't catch that.";

// Spoken when customer asks price before Beat 22
// Status: APPROVED
export const DEFER_LINE = "I'm going to cover that in just a moment.";

// Spoken when customer asks an out-of-script question before resuming next beat
// Status: APPROVED
export const OUT_OF_SCRIPT_LINE = "I'll make a note of that for my colleague to cover right after we finish your paperwork.";

// Spoken when customer asks for a human, after 2 consecutive 'No's, or after Beat 22 completes
// Status: APPROVED
export const HANDOFF_LINE = "Let me bring in my colleague to go over the rest with you.";

// Spoken when customer asks if Max is an AI / real person
// Status: APPROVED
export const AI_DISCLOSURE_LINE = "I'm an AI finance assistant.";

// Step 0 Tech Check line spoken when call connects
// Status: APPROVED
export const STEP_0_GREETING = "Can you hear and see me alright?";

// Stage 0 Rapport & Formal Greeting line (CONTEXT_RULES.md Stage 0 & Step 1)
// Status: APPROVED
export const STEP_0_RAPPORT_LINE = "Awesome, great to connect with you! First of all, congratulations on your {{vehicle_year}} {{vehicle_make}} {{vehicle_model}}, and thank you for buying with us today! I'm Max, your finance manager, and I'll be handling your paperwork today. How has your experience been with our team so far?";

// Stage 0 Transition into Legal Disclosure
// Status: APPROVED
export const STEP_0_TRANSITION_LINE = "Glad to hear that! Now before I start, I just want to let you know this transaction is recorded audio and video, also I'm required by the law to go over everything with you before you sign any paperwork to make sure you understand first okay.";

// Natural Conversational Affirmative Transition Bridges
// Gives Max active-listening charisma rather than sounding like an automated script runner
// Status: APPROVED
export const BEAT_TRANSITION_BRIDGES: Record<number, string> = {
  3: "Awesome!",
  4: "Great.",
  5: "Gotcha.",
  6: "Right on.",
  7: "Right!",
  8: "Exactly.",
  11: "Now,",
  13: "And look,",
  16: "So,",
};

// Spoken when customer asks to pause, hold on, or take a moment
export const PAUSE_LINE = "Take all the time you need, I'm right here whenever you're ready.";

// Spoken when customer feels rushed or asks Max to slow down
export const SLOW_DOWN_LINE = "I completely understand, it is a lot of information. Let's take it one step at a time.";

// Spoken when customer compliments the vehicle
export const COMPLIMENT_LINE = "It really is a fantastic car, you're going to love driving it!";

// Spoken when customer asks who Max is or for his identity/name
export const IDENTITY_LINE = "I'm Max, your digital finance manager today.";


