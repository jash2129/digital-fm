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

// Step 0 Greeting line spoken before Beat 1
// Status: APPROVED
export const STEP_0_GREETING = "Can you hear and see me alright?";
