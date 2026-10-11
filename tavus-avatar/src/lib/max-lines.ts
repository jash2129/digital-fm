// =============================================================================
// MAX FIXED LINES CONFIGURATION
// All fixed lines live in this single config file so TXM can approve or change them in one place.
// Every line below is marked "pending TXM approval".
// =============================================================================

// Spoken before repeating the current beat after customer says "no"
// pending TXM approval
export const LEAD_IN_NO = "Allow me to go over it really quick to make sure that you understand everything.";

// Spoken when customer input cannot be transcribed or is inaudible
// pending TXM approval
export const GARBLED_LINE = "Sorry, I didn't catch that.";

// Spoken when customer asks price before Beat 22
// pending TXM approval
export const DEFER_LINE = "I'm going to cover that in just a moment.";

// Spoken when customer asks an out-of-script question
// Until TXM provides an official line, use DEFER_LINE
// pending TXM approval
export const OUT_OF_SCRIPT_LINE = DEFER_LINE;

// Spoken when customer asks for a human, after 2 consecutive 'No's, or after Beat 22 completes
// pending TXM approval
export const HANDOFF_LINE = "Let me bring in my colleague to go over the rest with you.";

// Spoken when customer asks if Max is an AI / real person
// pending TXM approval
export const AI_DISCLOSURE_LINE = "I'm an AI finance assistant.";

// Step 0 Greeting line spoken before Beat 1
// pending TXM approval
export const STEP_0_GREETING = "Can you hear and see me alright?";
