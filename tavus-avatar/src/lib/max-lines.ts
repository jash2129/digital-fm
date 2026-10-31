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

// Spoken when customer asks an out-of-script financial question before resuming next beat
// Status: APPROVED — Authoritative, zero colleague or note references
export const OUT_OF_SCRIPT_LINE = "Those purchase terms are locked in on your primary sales agreement — let's make sure your new vehicle is 100% protected before you sign.";

// Spoken when customer asks for a human or manager
// Status: PENDING TXM — stay in character, do not claim "full authority"
export const HANDOFF_LINE = "I'm Max, your finance manager, and I'll go through everything with you right here. What question can I answer?";

// Spoken when all beats and paperwork review are complete
export const SCRIPT_COMPLETE_LINE = "Everything on your paperwork is all set and finalized. Congratulations on your new vehicle, and enjoy the ride!";

// Beat 24 confirmation when the customer named only some coverages at Beat 23 ("which two do you
// see the most value in?"). Repeats back their choice without claiming full protection and without
// changing the price (price changes are TXM's rule). {{coverages}} {{price}} {{vehicle}}
// Status: PENDING TXM
export const CHOSEN_COVERAGE_CONFIRM_LINE = "Great, so to confirm, we're moving forward with your protection, including the {{coverages}} coverage you said matters most, for {{price}} a day on your {{vehicle}}.";

// Beat 23: the customer excluded a coverage ("drop the tires and keep the rest") instead of choosing.
// Never confirmed as a choice and never repriced; Max re-asks what to keep.
// Status: PENDING TXM
export const KEEP_COVERAGES_REASK_LINE = "Just to be sure I have it right, which coverages would you like to keep?";

// Silence watchdog: 7 s of customer silence after Max finishes a wait beat, spoken before the
// pending question. Status: PENDING TXM
export const STILL_WITH_ME_LINE = "Are you still with me?";

// Presence check ("are you there?", "say something"): spoken before re-asking the pending question.
// Status: PENDING TXM
export const PRESENCE_LINE = "I'm right here with you!";

// Step 0: the customer asks "can you hear me?" before answering the tech check. Spoken before
// STEP_0_GREETING. Status: PENDING TXM
export const TECH_CHECK_ACK_LINE = "Yes, I can hear you.";

// Customer says the vehicle on file is wrong ("I'm buying an Audi, not a Mazda"). First time.
// Never argue; from here on Max says "your new vehicle" instead of the make and model.
// Status: PENDING TXM
export const VEHICLE_NOTED_LINE = "Thanks for catching that, I'll make a note of your vehicle.";

// The customer repeats the vehicle correction. Said once, then the script continues.
// Status: PENDING TXM
export const VEHICLE_CONFIRM_LINE = "Understood, I've noted it, and I'll have the sales team confirm the vehicle details.";

// Beat 25 verification: re-asked when the reply is not a name and address (a bare yes, a filler).
// Status: PENDING TXM
export const VERIFY_REASK_LINE = "I just need your full legal name, spelling, and current mailing address to verify.";

// Beat 25 verification: second non-answer in a row. Closes without claiming anything was finalized.
// Status: PENDING TXM
export const VERIFY_DEFER_LINE = "No problem, you can confirm those details on your paperwork before you sign. Thank you.";

// Spoken when customer gives repeated consecutive No answers
export const REPEATED_NO_LINE = "I completely understand and respect your decision. Let's move forward to review and finalize your standard purchase paperwork.";

// Spoken when price floor ($3/day) is reached or breached
export const FLOOR_PRICE_LINE = "Three dollars a day is our absolute hard floor for full vehicle protection — at less than the cost of a cup of coffee, it's the strongest coverage we offer. Let's get you locked in.";

// Spoken when customer asks if Max is an AI / real person
// Status: APPROVED
export const AI_DISCLOSURE_LINE = "I'm an AI finance assistant.";

// Step 0 Tech Check line spoken when call connects
// Status: APPROVED
export const STEP_0_GREETING = "Can you hear and see me alright?";

// Stage 0 Rapport & Formal Greeting line (CONTEXT_RULES.md Stage 0 & Step 1)
// Status: APPROVED
export const STEP_0_RAPPORT_LINE = "Awesome, great to connect with you! First of all, congratulations on your {{vehicle_year}} {{vehicle_make}} {{vehicle_model}}, and thank you for buying with us today! I'm Max, your finance manager, and I'll be handling your paperwork today. How has your experience been with our team so far?";

// Stage 0 opener, split so the check-in question lands within ~6 s (the full rapport line ran ~17 s
// and customers always talked over it). Spoken as: opener, pause, check-in.
// Status: PENDING TXM (split and shortened from STEP_0_RAPPORT_LINE)
export const STEP_0_OPENER_LINE = "Awesome, great to connect with you! First of all, congratulations on your new vehicle.";
// TXM's own check-in question from STEP_0_RAPPORT_LINE
export const STEP_0_CHECKIN_LINE = "How has your experience been with our team so far?";
// TXM's introduction from STEP_0_RAPPORT_LINE, now said once on the way into Beat 1
export const STEP_0_INTRO_LINE = "I'm Max, your finance manager, and I'll be handling your paperwork today.";

// Stage 0: the customer's answer to the check-in was negative or hostile ("I don't trust any of
// this", "terrible"). Replaces "Glad to hear that!" in the transition into Beat 1.
// Status: PENDING TXM
export const STEP_0_SORRY_LINE = "I'm sorry to hear that, I'll do my best to make the rest easy.";
// Stage 0: an answer that is neither clearly good nor bad (a second "hmm", an unrelated remark)
// Status: PENDING TXM
export const STEP_0_NEUTRAL_ACK_LINE = "Thanks for sharing that.";

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

// Spoken when customer makes an interjection to speak or explain ('let me tell you', 'listen to me')
export const LISTENING_LINE = "I'm listening, please go ahead.";

// Spoken when customer feels rushed or asks Max to slow down
export const SLOW_DOWN_LINE = "I completely understand, it is a lot of information. Let's take it one step at a time.";

// Spoken when customer compliments the vehicle
export const COMPLIMENT_LINE = "It really is a fantastic car, you're going to love driving it!";

// Spoken when customer asks who Max is or for his identity/name
export const IDENTITY_LINE = "I'm Max, your digital finance manager today.";

// =============================================================================
// HIGH-EQ EMOTIONAL ADAPTATION & CHARISMATIC HUMOR LINES
// Tailored for Hyundai and partner dealerships to build trust, make people laugh,
// and disarm anger, anxiety, or skepticism.
// =============================================================================

// Spoken when customer is angry, rushed, impatient, or complaining about dealership wait time
export const EQ_DEESCALATION_LINE = "I hear you 100 percent. You've had a long day at the dealership, so I promise to keep this crisp, direct, and completely transparent so we can get you into your new car as fast as possible.";

// Spoken when customer expresses anxiety, doubt, fear of hidden fees, or buyer's remorse
export const EQ_REASSURANCE_LINE = "Take a deep breath—buying a car is a huge milestone, and it's totally normal to feel a bit hesitant. I'm here as your advocate with zero pressure, so we'll walk through every dollar together until you feel one hundred percent confident.";

// Spoken when customer is excited, smiling, laughing, or thrilled about their new car
export const EQ_EXCITEMENT_LINE = "I love that energy! That new car is an absolute head-turner, and you're going to have a blast driving it off the lot today!";

// Observational humor bridges that create warmth, laughter, and likability
export const EQ_HUMOR_BRIDGES = {
  paperwork: "I know nobody wakes up on a Saturday dreaming about doing finance paperwork, so I promise to make this as painless and fun as possible!",
  texas_heat: "And you know how our Texas summers get—if you leave a soda can in the car, it turns into a science experiment! That brutal heat is just as tough on modern vehicle computers and sensors.",
  potholes: "Around here, dodging potholes feels like an arcade game! One bad bump on the access road, and your wheel is begging for mercy.",
  gas_warranty: "Believe me, if I could find a warranty that covered gas prices, I'd be the first in line to sign up for it myself!",
  coffee_comparison: "Nowadays you can't even get a medium latte at Starbucks without them asking for nine dollars and a tip! For less than half a cup of coffee, your whole vehicle is completely covered.",
};

// Spoken when customer asks if regular car insurance covers mechanical repairs
// Status: PENDING TXM
export const INSURANCE_LINE = "Insurance and this coverage are separate; the paperwork explains what each one covers.";

// Spoken when customer mentions spouse or wife decision-maker
// Status: PENDING TXM
export const SPOUSE_LINE = "I completely respect that! In fact, this package is designed specifically to protect the family budget from surprise multi-thousand dollar repair bills. What questions can I answer for her?";

// Spoken when customer asks about cancellation or selling the car early
// Status: PENDING TXM
export const CANCELLATION_LINE = "That's covered in your contract paperwork, and I'll go over the details with you before you sign.";

// Spoken when customer notes they are buying a different car or reports vehicle mismatch
export const VEHICLE_DISCREPANCY_LINE = "Oh, thank you for catching that! My system pulled up the Mazda CX-5 file, but let me immediately note that you're buying the {{vehicle_model}} so sales and titling update your paperwork right away. While they make that quick update, the protection coverage works the exact same way — did you get a chance to test drive the vehicle?";

// Spoken when customer asks whether warranty is provided by manufacturer or dealer
export const MANUFACTURER_VS_DEALER_LINE = "Great question. The factory warranty comes directly from the manufacturer, but it only covers manufacturer defects. The vehicle protection packages we're reviewing are our dealership's comprehensive coverage, which covers wear and tear, mechanical breakdowns, sensors, and electronic parts that the factory warranty excludes. Does that make sense?";

// Spoken when customer asks if this is a sales call or trying to sell them something
// Status: PENDING TXM
export const SALES_CALL_LINE = "I'm Max, your finance manager. My job is to go over your paperwork and the coverage options with you before you sign.";

// Spoken when customer asks what this call is for or why they are meeting with finance
export const CALL_PURPOSE_LINE = "Every buyer meets with finance before delivery to verify paperwork, registration details, and review factory warranty coverage. Did you get a good feel for the car on your test drive?";

// Spoken when a customer asks something the approved knowledge base cannot answer.
// Status: PENDING TXM APPROVAL. Replaces any invented answer; the question is logged.
// There is no human escalation, so this must never promise to bring anyone in, and it must never
// imply the thing asked about is covered.
export const UNKNOWN_QUESTION_LINE = "I don't have that detail in front of me and I don't want to guess, so the contract paperwork spells it out and I'll point you to it before you sign.";

// Spoken when the customer speaks or asks for a language other than English.
// Status: PENDING TXM
export const LANGUAGE_LINE = "I'm sorry, I can only continue in English.";

// Spoken on every turn after the call has stopped (recording objection or hang-up).
// Status: PENDING TXM / LEGAL — confirm wording for the recording-objection case.
export const CLOSING_LINE = "Thank you, take care.";

// Spoken when the customer's reply is a filler sound or unclear at a check-in.
// Status: PENDING TXM APPROVAL.
export const CLARIFY_LINE = "Would you like me to continue, or go over that again?";

// Spoken after an answer from the knowledge base, before returning to the script.
// Status: PENDING TXM APPROVAL.
export const ANSWER_CHECK_LINE = "Does that answer your question?";

// Contextual objection and exclusion stand-ins.
// Status: PENDING TXM APPROVAL.
export const TIRE_EXCLUSION_LINE = "You can certainly use your own tires, but the tire and wheel package protects your tires and wheels against road hazard damage with zero deductible.";
export const MAINTENANCE_EXCLUSION_LINE = "I understand you do your own maintenance! The package covers synthetic oil and filter changes so you have zero out-of-pocket expenses.";
export const DROP_COVERAGE_LINE = "If you'd like to drop the tire and wheel package, we can adjust the coverage options to fit what you need most.";
export const UNIT_PRICE_LINE = "That's four dollars a day, which works out to about one hundred and twenty dollars a month on your paperwork.";
export const TOTAL_PRICE_LINE = "The total for full vehicle protection is four dollars a day over your contract term.";
export const THINK_ABOUT_IT_LINE = "I completely understand taking time to think about it. Protecting your family budget from sudden repair bills is important. What part of the coverage can I clarify for you?";
export const NOT_FUNNY_LINE = "I understand. Let's focus on the protection options for your vehicle.";
export const TECH_ISSUE_LINE = "I'm sorry about that! Let me check the connection on my end. Can you see and hear me clearly now?";
export const MARKUP_OBJECTION_LINE = "I completely hear you—retail parts prices and dealership labor can feel outrageous. That's exactly why we don't want you paying out-of-pocket retail markup; our protection covers parts and certified labor with zero deductible. Does that make sense?";
