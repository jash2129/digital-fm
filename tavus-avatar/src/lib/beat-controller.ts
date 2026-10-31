import beatsData from "./beats.json" with { type: "json" };
import { DEFAULT_DEAL_CONFIG, type DealConfig } from "./deal-config";
import {
  LEAD_IN_NO,
  GARBLED_LINE,
  DEFER_LINE,
  OUT_OF_SCRIPT_LINE,
  HANDOFF_LINE,
  AI_DISCLOSURE_LINE,
  STEP_0_GREETING,
  STEP_0_RAPPORT_LINE,
  STEP_0_TRANSITION_LINE,
  BEAT_TRANSITION_BRIDGES,
  PAUSE_LINE,
  LISTENING_LINE,
  SLOW_DOWN_LINE,
  COMPLIMENT_LINE,
  IDENTITY_LINE,
  EQ_DEESCALATION_LINE,
  EQ_REASSURANCE_LINE,
  EQ_EXCITEMENT_LINE,
  EQ_HUMOR_BRIDGES,
  INSURANCE_LINE,
  SPOUSE_LINE,
  CANCELLATION_LINE,
  VEHICLE_DISCREPANCY_LINE,
  MANUFACTURER_VS_DEALER_LINE,
  SALES_CALL_LINE,
  CALL_PURPOSE_LINE,
  FLOOR_PRICE_LINE,
  SCRIPT_COMPLETE_LINE,
  REPEATED_NO_LINE,
  UNKNOWN_QUESTION_LINE,
  CLOSING_LINE,
  LANGUAGE_LINE,
  VERIFY_REASK_LINE,
  VERIFY_DEFER_LINE,
  CHOSEN_COVERAGE_CONFIRM_LINE,
  KEEP_COVERAGES_REASK_LINE,
  STILL_WITH_ME_LINE,
  PRESENCE_LINE,
  CLARIFY_LINE,
  ANSWER_CHECK_LINE,
  TIRE_EXCLUSION_LINE,
  MAINTENANCE_EXCLUSION_LINE,
  DROP_COVERAGE_LINE,
  UNIT_PRICE_LINE,
  TOTAL_PRICE_LINE,
  THINK_ABOUT_IT_LINE,
  NOT_FUNNY_LINE,
  TECH_ISSUE_LINE,
  MARKUP_OBJECTION_LINE,
} from "./max-lines";
import { answerFromKnowledgeBase, looksLikeQuestion } from "./grounded-answer";

export interface Beat {
  id: number;
  type: "wait" | "continue";
  text: string;
  check_in: string | null;
  expects?: "consent" | "yes_no" | "open" | "statement";
}

export const BEATS: Beat[] = beatsData as Beat[];

export interface CallState {
  current_beat: number;
  delivered_beats: number[];
  last_spoken_text: string;
  no_count_in_a_row: number;
  negotiated_price_so_far: number | null;
  concession_stage?: number;
  step0_turns: number;
  step0_completed: boolean;
  dealConfig: DealConfig;
  is_stopped: boolean;
  price_defer_count?: number;
  /** consecutive questions the knowledge base could not answer */
  ungrounded_count?: number;
  /** customer already said yes to a finalize question, so Beat 24 must not ask again */
  finalize_confirmed?: boolean;
  /** coverages the customer named at Beat 23 ("which two do you see the most value in?") */
  chosen_coverages?: string[];
  /** coverages the customer asked to drop at Beat 23 (logged only; never repriced) */
  excluded_coverages?: string[];
  /** the last question Max asked, so interjections can re-ask what is actually pending */
  last_question?: string;
  /**
   * Max's last reply was not heard (cut early or dropped as stale): the state was rolled back to
   * before that turn. A bare "yes" resumes this text instead of answering a question nobody heard.
   */
  interrupted?: { remaining: string; after: CallState; toolCalls: ControllerDecision["toolCalls"] };
  /** consecutive Beat 25 replies that were not a name and address */
  verify_misses?: number;
  /** Beat 25 closed without the details: never claim the paperwork was finalized */
  verification_deferred?: boolean;
  last_check_in_tag?: string;
  is_impatient_flow?: boolean;
  sentence_index?: number;
  total_sentences?: number;
}

export function splitIntoSentences(text: string): string[] {
  const clean = text.replace(/[""]/g, '"').trim();
  const raw = clean.match(/[^.!?]+[.!?]+(\s+|$)|[^.!?]+$/g) || [clean];
  return raw.map((s) => s.trim()).filter((s) => s.length > 0);
}

export function getBeatCheckInQuestion(beat: Beat): string {
  if (beat.check_in) {
    const ci = beat.check_in.trim();
    const capitalized = ci.charAt(0).toUpperCase() + ci.slice(1);
    return capitalized.endsWith("?") ? capitalized : `${capitalized}?`;
  }
  switch (beat.id) {
    case 1:
      return "Is that okay with you?";
    case 2:
      return "Did you get a chance to take it for a test drive?";
    case 3:
      return "Did the salesperson do the walkaround with you?";
    case 4:
      return "Did the salesperson go over the warranty with you?";
    case 22:
      return "Does that work for you?";
    default:
      return "Does that make sense?";
  }
}

export const BEAT_RECAPS: Record<number, string> = {
  6: "As a quick recap, your Mazda comes with the five-year sixty thousand mile base warranty and ten-year one hundred thousand mile powertrain coverage.",
  7: "Just to recap, the factory warranty covers factory defects only.",
  8: "As a quick recap, wear and tear from climate, roads, and driving causes ninety-five percent of breakdowns.",
  9: "As a recap, potholes and road hazards cause severe wear on tires, rims, and sensors.",
  10: "As a recap, wear and tear causes ninety-five percent of all mechanical breakdowns.",
  11: "To recap, diagnosis is always the mandatory first step before manufacturer warranty steps in.",
  12: "To recap, the manufacturer only covers factory defects, while wear and tear is out-of-pocket.",
  13: "To recap, major parts like an engine or transmission can cost seven to eight thousand dollars.",
  14: "To recap, dashboard sensors and electronics can cost thousands of dollars to replace.",
  15: "To recap, service labor can add ten to fifteen hours of expense to any major repair.",
  16: "As a quick recap, the wrap gives you ten years and one hundred thousand miles of bumper-to-bumper protection with zero deductible.",
  17: "As a quick recap, the tire and wheel package covers your tires and wheels for five full years with zero out-of-pocket costs.",
  18: "To recap, the five-year maintenance package covers your synthetic oil changes, filters, and tire rotations.",
  19: "To recap, with full protection, fuel is your only ongoing out-of-pocket expense.",
  20: "To recap, you get ten-year one hundred thousand mile bumper-to-bumper coverage with zero deductible.",
  21: "To recap, you get the five-year tire and wheel protection and five-year maintenance package.",
  22: "That full vehicle protection package is just four dollars a day.",
};

export type ClassifierIntent =
  | "agree"
  | "no"
  | "question_in_script"
  | "question_out_of_script"
  | "price_ask"
  | "negotiate_price"
  | "garbled"
  | "avatar_echo"
  | "repeat_request"
  | "restart_request"
  | "human_request"
  | "hang_up"
  | "ai_question"
  | "tech_check_ack"
  | "pause_request"
  | "overwhelmed"
  | "compliment"
  | "identity_question"
  | "greeting_check"
  | "customer_frustrated"
  | "customer_anxious"
  | "spouse_objection"
  | "insurance_question"
  | "cancellation_question"
  | "vehicle_discrepancy"
  | "manufacturer_vs_dealer"
  | "sales_question"
  | "call_purpose"
  | "language_request"
  | "why_asking"
  | "number_clarification"
  | "classifier_timeout"
  | "provided_details"
  | "resume_interrupted"
  | "other";

export interface ClassificationResult {
  intent: ClassifierIntent;
  topic_beat_ids: number[];
  /** the remote LLM classifier was called (rules alone could not classify) */
  usedLLM?: boolean;
  /** the remote classifier hit LLM_CLASSIFIER_TIMEOUT_MS */
  timedOut?: boolean;
}

/** Per-turn latency breakdown, logged by the client and shown in the Inspector. */
export interface TurnMetrics {
  classifierMs: number;
  /** any remote LLM call this turn: the classifier or a knowledge-base rewrite */
  usedLLM: boolean;
  classifierTimedOut: boolean;
}

export interface ControllerDecision {
  textToSpeak: string;
  beatId: number;
  beatType: "wait" | "continue" | "stop";
  toolCalls: Array<{ name: string; args: Record<string, any> }>;
  state: CallState;
  intent: ClassifierIntent | "step0" | "greeting";
  isScriptComplete?: boolean;
  metrics?: TurnMetrics & { controllerMs: number; intent: string; beatBefore: number; beatAfter: number };
}

// In-memory session state store for controller turns persisted across Next.js dev reloads
const globalForBeatController = globalThis as unknown as {
  activeStates?: Map<string, CallState>;
};
export const activeStates =
  globalForBeatController.activeStates ?? new Map<string, CallState>();
if (process.env.NODE_ENV !== "production") {
  globalForBeatController.activeStates = activeStates;
}

// -----------------------------------------------------------------------------
// TWO-PHASE TURNS (live calls): a turn's state change only counts once the client confirms Max's
// reply was delivered. Until then the pre-turn state is kept so it can be rolled back.
// -----------------------------------------------------------------------------
interface PendingCommit {
  turnId: number;
  before: CallState;
  after: CallState;
  text: string;
  toolCalls: ControllerDecision["toolCalls"];
}
const globalForCommits = globalThis as unknown as { pendingCommits?: Map<string, PendingCommit> };
const pendingCommits = globalForCommits.pendingCommits ?? new Map<string, PendingCommit>();
if (process.env.NODE_ENV !== "production") globalForCommits.pendingCommits = pendingCommits;

// Max must have said this much of a reply for it to count as heard
export const DELIVERED_FRACTION = 0.8;

const cloneState = (s: CallState): CallState => JSON.parse(JSON.stringify(s));
function replaceState(target: CallState, source: CallState): void {
  for (const k of Object.keys(target)) delete (target as unknown as Record<string, unknown>)[k];
  Object.assign(target, cloneState(source));
}

/**
 * A live customer turn. Like processControllerTurn, but (1) remembers the pre-turn state under
 * turnId until commitTurn() confirms delivery, and (2) if the previous reply was not heard, a bare
 * confirmation resumes it from the sentence where Max was cut.
 */
export async function processClientTurn(
  sessionId: string,
  customerTranscript: string,
  turnId: number,
  dealConfig = DEFAULT_DEAL_CONFIG
): Promise<ControllerDecision> {
  const state = getOrCreateCallState(sessionId, dealConfig);
  // A new turn implies the previous reply was not rolled back in time: keep it
  pendingCommits.delete(sessionId);

  const pending = state.interrupted;
  if (pending) {
    state.interrupted = undefined;
    const reply = customerTranscript.toLowerCase().replace(/[^a-z0-9 ]/g, " ").trim();
    if (isBareAck(reply)) {
      // "yeah" after an unheard line: say the rest of it, never treat it as an answer to it
      const t0 = Date.now();
      const beatBefore = state.current_beat;
      const rolledBackState = cloneState(state);
      replaceState(state, pending.after);
      state.last_spoken_text = pending.remaining;
      const beat = BEATS.find((b) => b.id === state.current_beat);
      const decision: ControllerDecision = {
        textToSpeak: pending.remaining,
        beatId: state.current_beat,
        beatType: beat?.type ?? "wait",
        toolCalls: pending.toolCalls,
        state,
        intent: "resume_interrupted",
        isScriptComplete: state.is_stopped,
      };
      decision.metrics = {
        classifierMs: 0,
        usedLLM: false,
        classifierTimedOut: false,
        controllerMs: Date.now() - t0,
        intent: decision.intent,
        beatBefore,
        beatAfter: decision.beatId,
      };
      pendingCommits.set(sessionId, { turnId, before: rolledBackState, after: cloneState(state), text: pending.remaining, toolCalls: pending.toolCalls });
      return decision;
    }
    // Anything else is answered against the rolled-back state (the question they did hear)
  }

  const before = cloneState(state);
  const decision = await processControllerTurn(sessionId, customerTranscript, dealConfig);
  pendingCommits.set(sessionId, { turnId, before, after: cloneState(state), text: decision.textToSpeak, toolCalls: decision.toolCalls });
  return decision;
}

/**
 * The client reports whether the reply for turnId was heard. Not delivered (dropped as stale, or
 * cut before DELIVERED_FRACTION): roll back to the pre-turn state and remember where to resume.
 */
export function commitTurn(
  sessionId: string,
  turnId: number,
  delivered: boolean,
  spokenFraction = 0
): { rolledBack: boolean; reason?: string } {
  const pending = pendingCommits.get(sessionId);
  if (!pending || pending.turnId !== turnId) return { rolledBack: false, reason: "not_the_latest_turn" };
  pendingCommits.delete(sessionId);
  // The client decides delivery (finished naturally, or cut after DELIVERED_FRACTION of the line)
  if (delivered) return { rolledBack: false };
  const state = activeStates.get(sessionId);
  if (!state) return { rolledBack: false, reason: "no_session" };

  const sentences = splitIntoSentences(pending.text);
  // Resume at the sentence that was cut (sentences fully heard are not repeated)
  const cutAt = Math.min(Math.max(0, sentences.length - 1), Math.floor(spokenFraction * sentences.length));
  const remaining = sentences.slice(cutAt).join(" ") || pending.text;
  replaceState(state, pending.before);
  state.interrupted = { remaining, after: pending.after, toolCalls: pending.toolCalls };
  console.warn("[beat-controller] TURN_ROLLED_BACK", JSON.stringify({ sessionId, turnId, spokenFraction, beat: state.current_beat }));
  return { rolledBack: true };
}

/**
 * Something for Max to say when the line has gone quiet, without a customer turn:
 *  - "resume": the dead-man switch (no audio 4 s after the customer spoke). Resumes an unheard
 *    reply if one was rolled back, else re-asks the pending question.
 *  - "still_with_me": first 7 s customer silence at a wait beat.
 *  - "clarify": later silences.
 * Never advances the script except to re-apply a reply the customer is about to hear.
 */
export function repromptText(sessionId: string, kind: "resume" | "still_with_me" | "clarify"): string {
  const state = getOrCreateCallState(sessionId);
  if (!state.step0_completed) return STEP_0_GREETING;
  if (kind === "resume" && state.interrupted) {
    const { remaining, after } = state.interrupted;
    replaceState(state, after);
    state.last_spoken_text = remaining;
    return remaining;
  }
  const text = kind === "clarify" ? CLARIFY_LINE : kind === "still_with_me" ? `${STILL_WITH_ME_LINE} ${pendingQuestion(state)}` : pendingQuestion(state);
  state.last_spoken_text = text;
  return text;
}

export function getOrCreateCallState(sessionId: string, dealConfig = DEFAULT_DEAL_CONFIG): CallState {
  if (!activeStates.has(sessionId)) {
    activeStates.set(sessionId, {
      current_beat: 0,
      delivered_beats: [],
      last_spoken_text: STEP_0_GREETING,
      no_count_in_a_row: 0,
      negotiated_price_so_far: null,
      concession_stage: 1,
      step0_turns: 0,
      step0_completed: false,
      dealConfig: { ...dealConfig },
      is_stopped: false,
      price_defer_count: 0,
      last_check_in_tag: "",
      is_impatient_flow: false,
    });
  }
  return activeStates.get(sessionId)!;
}

export function resetCallState(sessionId: string): void {
  activeStates.delete(sessionId);
}

// Render raw beat text with placeholders replaced by deal variables
export function renderBeatText(beat: Beat, dealConfig: DealConfig, state?: CallState): string {
  let rendered = beat.text;
  if (beat.id === 24) {
    const yearMakeModel = `${dealConfig.vehicle_year} ${dealConfig.vehicle_make} ${dealConfig.vehicle_model}`.trim();
    const chosen = state?.chosen_coverages ?? [];
    if (chosen.length > 0 && chosen.length < COVERAGES.length) {
      // Customer named only some coverages: repeat back their choice, never claim "full", same price
      rendered = CHOSEN_COVERAGE_CONFIRM_LINE.replace("{{coverages}}", chosen.join(" and the "))
        .replace("{{price}}", dealConfig.per_day_price)
        .replace("{{vehicle}}", yearMakeModel);
    } else {
      rendered = `"Great, so to confirm, we're moving forward with full vehicle protection for ${dealConfig.per_day_price} a day on your ${yearMakeModel}."`;
    }
  } else {
    rendered = rendered.replace(/\{\{vehicle_year\}\}/g, dealConfig.vehicle_year);
    rendered = rendered.replace(/\{\{vehicle_make\}\}/g, dealConfig.vehicle_make);
    rendered = rendered.replace(/\{\{vehicle_model\}\}/g, dealConfig.vehicle_model);
    rendered = rendered.replace(/\{\{per_day_price\}\}/g, dealConfig.per_day_price);
  }
  return rendered;
}

// Polish speech text with natural sentence boundaries, prosody pauses, and clean phonetic cadence
export function formatSpeechText(text: string): string {
  // Convert adjacent quotes into clean sentence boundaries with breathing room
  let clean = text.replace(/([.?!])\s*"\s*"([A-Za-z])/g, "$1 $2");
  clean = clean.replace(/([^.?!])\s*"\s*"([A-Za-z])/g, "$1. $2");
  clean = clean.replace(/^["'\s]+|["'\s]+$/g, "");
  clean = clean.replace(/"\s*"/g, ". ");

  // Spacing around punctuation
  clean = clean.replace(/\s+,\s*/g, ", ");
  clean = clean.replace(/\s+\.\s*/g, ". ");
  clean = clean.replace(/\s+/g, " ");

  // Prosody & Phonetic Polish:
  // Convert all-caps shouting words into natural executive speech
  clean = clean.replace(/\bWARE AND TEAR\b/g, "wear and tear");
  clean = clean.replace(/\bCLIMATE, ROAD CONDITION AND DRIVING HABIT specially here in texas\b/g, "climate, road conditions, and driving habits... especially here in Texas.");
  clean = clean.replace(/\bCLIMATE:\s*/g, "Climate... ");
  clean = clean.replace(/\bROAD CONDITION\b/g, "Road conditions");
  clean = clean.replace(/\bDRIVING HABITS\b/g, "Driving habits");
  clean = clean.replace(/\bDRIVING HABIT\b/g, "driving habits");

  // Fix awkward script typos so HeyGen TTS speaks fluent, confident English
  clean = clean.replace(/\bfutures and builts and whistles\b/gi, "features, bells, and whistles");
  clean = clean.replace(/\busuilaly\b/gi, "usually");
  clean = clean.replace(/\bware an tear\b/gi, "wear and tear");
  clean = clean.replace(/\bmis design or mis built or mis installed\b/gi, "misdesigned, misbuilt, or misinstalled");
  clean = clean.replace(/\bsecond of is\b/gi, "second warranty is");

  // Spoken Numbers & Pronunciation Formatting (STRICT TTS RULE from wordtoword.md)
  clean = clean.replace(/\b95\s*%/g, "ninety-five percent");
  clean = clean.replace(/\b110\s*degrees?\b/gi, "one hundred ten degrees");
  clean = clean.replace(/\b110\b/g, "one hundred ten");
  clean = clean.replace(/\b3\s*years\b/gi, "three years");
  clean = clean.replace(/\b4\s*years\b/gi, "four years");
  clean = clean.replace(/\b5-years?\b|\b5\s*years?\b/gi, "five years");
  clean = clean.replace(/\b7\s*years\b/gi, "seven years");
  clean = clean.replace(/\b10-years?\b|\b10\s*years?\b/gi, "ten years");
  clean = clean.replace(/\b36,000\b/g, "thirty-six thousand");
  clean = clean.replace(/\b60,000\b/g, "sixty thousand");
  clean = clean.replace(/\b100\s*percent\b/gi, "one hundred percent");
  clean = clean.replace(/\b100,000\b/g, "one hundred thousand");
  clean = clean.replace(/\b100\b/g, "one hundred");
  clean = clean.replace(/\b2\s*different\s*warrant(?:y|ies)\b/gi, "two different warranties");
  clean = clean.replace(/\b3\s*reasons?\b/gi, "three reasons");
  clean = clean.replace(/\b2\s*sets\b/gi, "two sets");
  clean = clean.replace(/\b8\s*tiers\b/gi, "eight tires");
  clean = clean.replace(/\b8\s*of\s*those\b/gi, "eight of those");
  clean = clean.replace(/\b10\s*hours\s*(and\s*15\s*hours)?\b/gi, "ten hours and fifteen hours");
  clean = clean.replace(/\b15\s*hours\b/gi, "fifteen hours");
  clean = clean.replace(/\b4\s*thousand\b/gi, "four thousand");
  clean = clean.replace(/\b7\s*thousand\b/gi, "seven thousand");
  clean = clean.replace(/\b6\s*thousand\b/gi, "six thousand");
  clean = clean.replace(/\b29\s*dollar\b/gi, "twenty-nine dollars");
  clean = clean.replace(/\b8\s*dollars\b/gi, "eight dollars");
  clean = clean.replace(/\b4\s*dollars\b/gi, "four dollars");
  clean = clean.replace(/\$4\.00|\$4\b/gi, "four dollars");
  clean = clean.replace(/\$3\.50\b/gi, "three dollars and fifty cents");
  clean = clean.replace(/\$3\.25\b/gi, "three dollars and twenty-five cents");
  clean = clean.replace(/\$3\.00|\$3\b/gi, "three dollars");
  clean = clean.replace(/\bhundred thirty dollar per hour up to hundred sixty dollar per hour\b/gi, "one hundred thirty to one hundred sixty dollars per hour");
  clean = clean.replace(/\bpage number 4\b/gi, "page number four");

  return clean.trim();
}

// Formats full utterance for a beat: beat text + check-in line with natural conversational pause
export function getFullBeatUtterance(beat: Beat, dealConfig: DealConfig, state?: CallState): string {
  const rendered = renderBeatText(beat, dealConfig, state);
  const cleanBody = formatSpeechText(rendered);
  if (beat.check_in) {
    // If customer is in an impatient flow, suppress interrogation tags
    if (state?.is_impatient_flow) {
      return cleanBody;
    }
    const cleanCheckIn = formatSpeechText(beat.check_in);
    // Suppress repeating the exact same tag consecutively
    if (state?.last_check_in_tag && state.last_check_in_tag.toLowerCase() === cleanCheckIn.toLowerCase()) {
      return cleanBody;
    }
    if (state) {
      state.last_check_in_tag = cleanCheckIn;
    }
    // Ellipsis introduces a human 250ms conversational pause before the check-in question
    return `${cleanBody}... ${cleanCheckIn}`;
  }
  return cleanBody;
}

// Map beat numbers to their UI canvas tools
export function getBeatToolCalls(beatId: number): Array<{ name: string; args: Record<string, any> }> {
  switch (beatId) {
    case 6:
      return [{ name: "show_content", args: { item: "warranty_terms" } }];
    case 11:
      return [{ name: "show_content", args: { item: "cost_breakdown" } }];
    case 16:
      return [
        { name: "draw_grid_outline", args: {} },
        { name: "show_pricing", args: { product: "vsc" } },
      ];
    case 17:
      return [{ name: "show_pricing", args: { product: "tire_wheel" } }];
    case 18:
      return [{ name: "show_pricing", args: { product: "maintenance" } }];
    case 20:
      return [{ name: "show_pricing", args: { product: "gap" } }];
    case 22:
    case 23:
      return [{ name: "show_payment_breakdown", args: { daily_rate: 4 } }];
    case 24:
      return [{ name: "show_content", args: { item: "deal_summary" } }];
    default:
      return [];
  }
}

// Hook called when script reaches end of all beats
export function onScriptComplete(state: CallState): void {
  console.log(`[beat-controller] onScriptComplete() reached for session. Handoff line spoken.`);
  state.is_stopped = true;
}

/**
 * Detects whether an incoming customer transcript is actually an acoustic echo
 * of Max's voice leaking through laptop speakers into the microphone.
 */
export function isAvatarScriptEcho(transcript: string): boolean {
  const norm = transcript.toLowerCase().replace(/[^a-z0-9 ]/g, " ").trim();
  if (!norm) return false;

  // Never treat customer questions or natural conversation as acoustic echo
  const conversationalLeadIns = [
    "what", "why", "how", "who", "when", "where", "is", "can", "could",
    "would", "does", "do", "did", "tell", "explain", "fine", "honestly",
    "stop", "wait", "hold", "look", "listen", "repair", "actually", "cost", "price"
  ];
  if (conversationalLeadIns.some((cp) => norm.startsWith(cp) || norm.includes(` ${cp} `))) {
    return false;
  }

  const echoPhrases = [
    "great to connect with you",
    "congratulations on your",
    "thank you for buying with us today",
    "handling your paperwork today",
    "how has your experience been with our team",
    "transaction is recorded audio and video",
    "required by the law to go over everything",
    "before you sign any paperwork",
    "make sure you understand first okay",
    "agreed to buy a new",
    "chance to drive the vehicle that you are buying",
    "walkaround and showed you all the features",
    "bells and whistles in the car",
    "what s your understanding of the warranty",
    "whats your understanding of the warranty",
    "warranty that comes with the vehicle",
    "more information about the warranty i need to go over",
    "base limited warranty",
    "power train which is referring to the engine",
    "defect only stated in the manual book",
    "misdesign misbuilt or misinstalled",
    "climate road condition and driving habit",
    "climate can go over 110",
    "driving habits the way i drive the way you drive",
    "diagnose the vehicle to find out what is the problem",
    "reserve the right to determine if the break down",
    "engine by itself can cost up to seven thousand",
    "luck of the draw could cost anywhere",
    "sorry i didn t catch",
    "sorry i didn't catch",
    "allow me to go over it really quick to make sure",
    "those purchase terms are locked in on your primary",
    "i have full authority to handle your paperwork",
    "everything on your paperwork is all set and finalized",
    "three dollars a day is our absolute hard floor",
    "i'm an ai finance assistant",
    "take all the time you need i'm right here",
    "i'm max your digital finance manager today",
    "true blanket cover warranty around the vehicle"
  ];

  return echoPhrases.some((phrase) => norm.includes(phrase));
}

// Beat 23 asks "Which two of those do you see the most value in?" about the three coverages Max
// presented. These map what the customer names to how Max repeats it back at Beat 24.
const COVERAGES: Array<{ label: string; words: RegExp }> = [
  { label: "bumper-to-bumper warranty", words: /\b(bumper|warranty|engine|transmission|mechanical|electronics?)\b/ },
  { label: "tire and wheel", words: /\b(tires?|wheels?|rims?)\b/ },
  { label: "maintenance", words: /\b(maintenance|oil|filters?|rotations?)\b/ },
];
const NAMES_ALL_COVERAGES = /\b(everything|all of (them|it)|all three|the whole (thing|package))\b/;
export function namedCoverages(norm: string): string[] {
  return COVERAGES.filter((c) => c.words.test(norm)).map((c) => c.label);
}
// "drop the tires and keep the rest", "I don't need the maintenance": a removal, not a choice
const EXCLUSION = /\b(drop|dropping|without|don t need|dont need|do not need|skip|remove|exclude|except|not the|no tires?|keep the rest|everything but)\b/;

// The last question in an utterance ("" if it asks nothing)
function lastQuestionOf(text: string): string {
  const parts = text.match(/[^.!?]+[.!?]*/g) ?? [];
  return (parts.filter((p) => p.includes("?")).at(-1) ?? "").trim();
}

// What Max is actually waiting on. At Beat 23 that is the coverage question (or the keep re-ask),
// not the beat's default "Does that sound fair?" check-in.
function pendingQuestion(state: CallState): string {
  const last = state.last_question || lastQuestionOf(state.last_spoken_text);
  if (state.current_beat === 23) {
    if (/would you like to keep/i.test(last)) return KEEP_COVERAGES_REASK_LINE;
    if (/which two|most important to you/i.test(last)) return "Which two of those do you see the most value in?";
  }
  return getBeatCheckInQuestion(BEATS.find((b) => b.id === state.current_beat)!);
}

// "yes" / "ok" / "sure" (with fillers) does not answer "which two?"
const BARE_ACK = new Set("yes yeah yep yup ya ok okay sure alright fine right uh um mhm mm hm oh well so".split(" "));
function isBareAck(norm: string): boolean {
  const words = norm.split(/\s+/).filter(Boolean);
  return words.length > 0 && words.every((w) => BARE_ACK.has(w));
}

// Beat 25 asks for full legal name, spelling and mailing address. A real answer has digits (street
// number, zip) or at least 4 content words; "yes", "sure" or "I just said yes. yes" is not one.
const VERIFY_FILLER = new Set(
  "yes yeah yep yup ok okay sure alright fine uh um hmm oh well so i just said already told you it its that is the a right correct good great sounds".split(" ")
);
export function isVerificationAnswer(transcript: string): boolean {
  if (/\d/.test(transcript)) return true;
  const words = transcript.toLowerCase().replace(/[^a-z ]/g, " ").split(/\s+/).filter(Boolean);
  return words.filter((w) => !VERIFY_FILLER.has(w)).length >= 4;
}

// Daily rate Max is offering at each concession stage: $4.00 -> $3.50 -> $3.25 -> $3.00 hard floor
const CONCESSION_LADDER: Record<number, number> = { 1: 4.0, 2: 3.5, 3: 3.25, 4: 3.0 };

// Daily price the customer names in a counter-offer ("how about three fifty", "$3.25"), or null
export function parseNamedDailyPrice(transcript: string): number | null {
  const t = transcript.toLowerCase().replace(/-/g, " ");
  const digits = t.match(/\$?\b(\d+(?:\.\d{1,2})?)\b/);
  if (digits) {
    const n = Number(digits[1]);
    if (n > 0 && n < 10) return n;
  }
  if (/\bthree (dollars? )?(and )?twenty five\b/.test(t)) return 3.25;
  if (/\bthree (dollars? )?(and )?fifty\b|\bthree and a half\b/.test(t)) return 3.5;
  if (/\bthree (dollars?|bucks)\b/.test(t)) return 3.0;
  if (/\bfour (dollars?|bucks)\b/.test(t)) return 4.0;
  return null;
}

// "Say that again" / "what does that mean": a request to hear the current beat again, not a new
// question. Takes the normalized transcript (lower-case, punctuation replaced by spaces).
function isReExplainRequest(norm: string): boolean {
  return (
    norm.includes("repeat that") ||
    norm.includes("say that again") ||
    norm.includes("say again") ||
    norm.includes("what did you say") ||
    norm.includes("one more time") ||
    norm.includes("come again") ||
    norm.includes("what does that mean") ||
    norm.includes("what does this mean") ||
    norm.includes("what do you mean") ||
    norm.includes("explain that") ||
    norm.includes("explain this") ||
    norm.includes("don t understand") ||
    norm.includes("dont understand") ||
    norm.includes("do not understand")
  );
}

// Checking a number Max just said: "you mean seven thousand?", "so that's ten hours?",
// "did you say seventy hundred?". Takes the normalized transcript.
// Only an amount counts: digits, "hundred"/"thousand", or a number word next to a money or
// mileage word. A bare "four" ("covers all four?") is not a number being checked.
const NUMBER_WORD = /\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|fourty|fifty|sixty|seventy|eighty|ninety)\b/;
function mentionsAmount(norm: string): boolean {
  return (
    /\d/.test(norm) ||
    /\b(hundred|thousand|grand)\b/.test(norm) ||
    (NUMBER_WORD.test(norm) && /\b(dollars?|bucks|cents|miles?|percent)\b/.test(norm))
  );
}
function isNumberClarification(norm: string): boolean {
  return /\b(you mean|so that s|so thats|did you say)\b/.test(norm) && mentionsAmount(norm);
}

// Customer praising the vehicle ("beautiful car", "love it", "nice ride"). Takes the normalized transcript.
function isVehicleCompliment(norm: string): boolean {
  return (
    /\b(beautiful|gorgeous)\b/.test(norm) ||
    norm.includes("looks great") ||
    norm.includes("sweet car") ||
    norm.includes("awesome car") ||
    norm.includes("love this car") ||
    norm.includes("love the car") ||
    norm.includes("love it") ||
    norm.includes("beautiful car") ||
    norm.includes("great car") ||
    norm.includes("nice car") ||
    norm.includes("nice ride") ||
    norm.includes("sweet ride") ||
    norm.includes("drove like a dream") ||
    norm.includes("love the color") ||
    norm.includes("gorgeous car") ||
    norm.includes("amazing car") ||
    norm.includes("amazing vehicle") ||
    norm.includes("dream car")
  );
}

// Customer speaking, or asking to speak, a language other than English. Takes the normalized
// transcript, where accented letters have become spaces ("español" -> "espa ol").
function isOtherLanguage(norm: string): boolean {
  return (
    /\b(habla|hablar|hablas|puedo|espa ol|espanol|por favor|no entiendo|parlez|fran ais)\b/.test(norm) ||
    /\b(in|speak|talk|use) (spanish|french|vietnamese|chinese|mandarin|hindi|korean|portuguese|arabic|another language|a different language)\b/.test(norm)
  );
}

// Deterministic rule-based classification fallback (also used for unit/simulation tests)
export function classifyCustomerInputRuleBased(
  transcript: string,
  currentBeatId: number
): ClassificationResult {
  const norm = transcript.toLowerCase().replace(/[^a-z0-9 ]/g, " ").trim();
  const words = norm.split(/\s+/).filter(Boolean);

  if (words.length === 0) {
    return { intent: "garbled", topic_beat_ids: [] };
  }

  // 0. Avatar Script Echo Protection: Never treat Max's own script echoed from laptop speakers as user progression
  if (isAvatarScriptEcho(transcript)) {
    return { intent: "avatar_echo", topic_beat_ids: [] };
  }

  // 0.5. Recording objection at Beat 1
  if (
    currentBeatId === 1 &&
    (norm.includes("don t want to be recorded") ||
      norm.includes("dont want to be recorded") ||
      norm.includes("do not want to be recorded") ||
      norm.includes("not recorded") ||
      norm.includes("not want to be recorded") ||
      norm.includes("stop recording") ||
      norm.includes("stop the recording") ||
      norm.includes("don't want to be recorded") ||
      norm.includes("dont record") ||
      norm.includes("do not record") ||
      norm.includes("consent to recording") ||
      norm.includes("consent to be recorded"))
  ) {
    return { intent: "human_request", topic_beat_ids: [] };
  }

  // 0.6. Customer hanging up / ending call
  if (
    norm.includes("hang up") ||
    norm.includes("hanging up") ||
    norm.includes("gonna hang up") ||
    norm.includes("going to hang up")
  ) {
    return { intent: "hang_up", topic_beat_ids: [] };
  }

  // 0.7. Another language: the script is English-only
  if (isOtherLanguage(norm)) {
    return { intent: "language_request", topic_beat_ids: [] };
  }

  // 1. AI Question (check before human request so questions like "are you an AI avatar or a real person?" are handled as AI disclosure)
  if (
    norm.includes("are you an ai") ||
    norm.includes("are you a robot") ||
    norm.includes("are you real") ||
    norm.includes("are you a real person") ||
    norm.includes("real person or") ||
    norm.includes("or a real person") ||
    norm.includes("are you an avatar") ||
    norm.includes("is this ai") ||
    norm.includes("is this a real person") ||
    norm.includes("am i talking to an ai") ||
    norm.includes("am i talking to a real person") ||
    norm.includes("ai avatar")
  ) {
    return { intent: "ai_question", topic_beat_ids: [] };
  }

  // 1.2. Human request (explicit request to speak with / transfer to a human)
  if (
    norm.includes("speak to a human") ||
    norm.includes("talk to a human") ||
    norm.includes("speak with a human") ||
    norm.includes("talk with a human") ||
    norm.includes("talk to a person") ||
    norm.includes("speak to a person") ||
    norm.includes("talk to a real person") ||
    norm.includes("speak to a real person") ||
    norm.includes("get me a real person") ||
    norm.includes("give me a real person") ||
    norm.includes("connect me to a human") ||
    norm.includes("connect me with a human") ||
    norm.includes("human manager") ||
    norm.includes("speak to someone else") ||
    norm.includes("talk to someone else") ||
    norm.includes("transfer me") ||
    norm.includes("get me a manager") ||
    norm.includes("speak to your manager")
  ) {
    return { intent: "human_request", topic_beat_ids: [] };
  }

  // 1.3. Vehicle Mismatch / Car Discrepancy (e.g. "buying a Maybach", "I was buying Maybach", "that's not my car", "confirm which car", "how can you ask me that")
  // MUST be checked before generic negation 'no' or generic greetings!
  const isVehicleDiscrepancy =
    norm.includes("maybach") ||
    norm.includes("mercedes") ||
    norm.includes("bmw") ||
    norm.includes("audi") ||
    norm.includes("porsche") ||
    norm.includes("lexus") ||
    norm.includes("buying a ") ||
    norm.includes("was buying") ||
    norm.includes("am buying") ||
    norm.includes("bought a ") ||
    norm.includes("not buying a mazda") ||
    norm.includes("not a mazda") ||
    norm.includes("not my car") ||
    norm.includes("wrong car") ||
    norm.includes("wrong vehicle") ||
    norm.includes("different car") ||
    norm.includes("different vehicle") ||
    norm.includes("which car") ||
    norm.includes("confirm which car") ||
    norm.includes("what car") ||
    norm.includes("which vehicle") ||
    norm.includes("how can you ask me that") ||
    // "It's a CX-30, not a CX-5" (hyphens are spaces here)
    /\b(it s|its|it is|i m buying|i bought|getting|got) (a |the )?(mazda )?cx \d+/.test(norm) ||
    /\bnot (a |the )?(mazda )?cx \d+/.test(norm);

  if (isVehicleDiscrepancy) {
    return { intent: "vehicle_discrepancy", topic_beat_ids: [] };
  }

  // 1.4. Manufacturer Warranty vs Dealership Vehicle Protection (e.g. "is this provided by the manufacturer", "should I buy the new one")
  const isManufacturerVsDealer =
    norm.includes("provided by the manufacturer") ||
    norm.includes("provided by manufacturer") ||
    norm.includes("by the manufacturer") ||
    norm.includes("from the manufacturer") ||
    norm.includes("does this provided") ||
    norm.includes("is this provided") ||
    norm.includes("comes from the manufacturer") ||
    norm.includes("should i buy the new one") ||
    norm.includes("should i buy a new one") ||
    norm.includes("buy the new one") ||
    norm.includes("buy a new one") ||
    norm.includes("buy the new warranty") ||
    norm.includes("buy a new warranty") ||
    norm.includes("new warranty or") ||
    norm.includes("is this from mazda") ||
    norm.includes("is this third party") ||
    norm.includes("who provides this") ||
    norm.includes("who provides the warranty");

  if (isManufacturerVsDealer) {
    return { intent: "manufacturer_vs_dealer", topic_beat_ids: [] };
  }

  // 1.5. Identity questions (e.g. "who's this", "who are you", "what's your name", "who am i talking to", "yeah who's this")
  if (
    norm.includes("who is this") ||
    norm.includes("whos this") ||
    norm.includes("who s this") ||
    norm.includes("who is speaking") ||
    norm.includes("who are you") ||
    norm.includes("who am i talking") ||
    norm.includes("who am i speaking") ||
    norm.includes("what is your name") ||
    norm.includes("whats your name") ||
    norm.includes("what s your name") ||
    norm.includes("who is that") ||
    norm.includes("who s that") ||
    norm.includes("who that") ||
    norm.includes("who this") ||
    norm === "who"
  ) {
    return { intent: "identity_question", topic_beat_ids: [] };
  }

  // 1.6. Sales call inquiry (e.g. "is this a sales call", "are you selling me something", "trying to sell")
  if (
    norm.includes("sales call") ||
    norm.includes("sell me") ||
    norm.includes("trying to sell") ||
    norm.includes("selling something") ||
    norm.includes("selling me")
  ) {
    return { intent: "sales_question", topic_beat_ids: [] };
  }

  // 1.7. Call purpose inquiry (e.g. "what is this about", "why are we doing this", "what is this call for")
  if (
    norm.includes("what is this about") ||
    norm.includes("whats this about") ||
    norm.includes("why are we doing this") ||
    norm.includes("what is this for") ||
    norm.includes("whats this for") ||
    norm.includes("what are we doing") ||
    norm.includes("why am i here")
  ) {
    return { intent: "call_purpose", topic_beat_ids: [] };
  }

  // 1.8. Mid-call presence checks / greetings (e.g. "hey", "hello", "hi", "hey max", "are you there", "why aren't you responding")
  if (
    norm === "hey" ||
    norm === "hi" ||
    norm === "hello" ||
    norm === "hey max" ||
    norm === "hello max" ||
    norm === "hi max" ||
    norm.includes("are you there") ||
    norm.includes("you there") ||
    norm.includes("why aren t you responding") ||
    norm.includes("why arent you responding") ||
    norm.includes("why aren t you answering") ||
    norm.includes("why arent you answering") ||
    norm.includes("not responding") ||
    norm.includes("not answering") ||
    norm.includes("are you listening") ||
    norm.includes("can you hear me") ||
    norm.includes("anybody there") ||
    norm.includes("anyone there") ||
    norm.includes("are you still there") ||
    // Live call 1ee5181b: the customer waiting on a question they never heard
    norm.includes("say something") ||
    /\bwhat (was|s|is) the question\b/.test(norm) ||
    /\bwhy (aren t|arent|are not) you (asking|speaking|talking|saying)\b/.test(norm)
  ) {
    return { intent: "greeting_check", topic_beat_ids: [] };
  }

  // 3. Restart request
  if (
    norm.includes("start over") ||
    norm.includes("from the beginning") ||
    norm.includes("restart")
  ) {
    return { intent: "restart_request", topic_beat_ids: [] };
  }

  // 3.4. Checking a number Max said ("you mean seven thousand?"): answer it from the knowledge base,
  // never re-recite the beat. Before the offer only; from Beat 22 on, numbers are negotiation (5.5).
  if (currentBeatId < 22 && isNumberClarification(norm)) {
    return { intent: "number_clarification", topic_beat_ids: [] };
  }

  // 3.5. "Why do you keep asking me that": re-ask only the current check-in
  if (
    norm.includes("why do you keep asking") ||
    norm.includes("why are you asking") ||
    norm.includes("why do you ask") ||
    norm.includes("you already asked") ||
    norm.includes("why you keep asking")
  ) {
    return { intent: "why_asking", topic_beat_ids: [] };
  }

  // 4. Repeat request, including asking Max to re-explain what he just said
  if (isReExplainRequest(norm)) {
    return { intent: "repeat_request", topic_beat_ids: [] };
  }

  // 5. Price ask / Bottom line price inquiry
  if (
    norm.includes("how much") ||
    norm.includes("what is the price") ||
    norm.includes("whats the price") ||
    norm.includes("what s the price") ||
    norm.includes("what does it cost") ||
    norm.includes("what does this cost") ||
    norm.includes("what does that cost") ||
    norm.includes("how much is this") ||
    norm.includes("what is the monthly") ||
    norm.includes("bottom line price") ||
    norm.includes("bottom line") ||
    norm.includes("exact cost") ||
    norm.includes("what is this wrap protection going to cost") ||
    norm.includes("going to cost me") ||
    norm.includes("what will it cost") ||
    norm.includes("tell me the price") ||
    norm.includes("pay as i go") ||
    norm.includes("pay as you go")
  ) {
    return { intent: "price_ask", topic_beat_ids: [] };
  }

  // 5.1. Casual price asks before the offer ("what's this gonna cost me", "and the price?").
  // From Beat 22 on, cost talk is negotiation and is handled in 5.5.
  if (
    currentBeatId < 22 &&
    (norm.includes("gonna cost") ||
      norm.includes("going to cost") ||
      norm.includes("and the price") ||
      norm.includes("about the price") ||
      norm.includes("what about price") ||
      norm.includes("what s the cost") ||
      norm.includes("whats the cost") ||
      norm.includes("what is the cost") ||
      norm === "price" ||
      norm.endsWith(" the price"))
  ) {
    return { intent: "price_ask", topic_beat_ids: [] };
  }

  // 5.5. Contextual Progression & Negotiation at Beats 22-25 (Evaluate BEFORE generic topic keywords!)
  if (currentBeatId >= 22) {
    const isCloseConfirmation =
      norm.includes("works") ||
      norm.includes("let s do it") ||
      norm.includes("lets do it") ||
      norm.includes("let's do it") ||
      norm.includes("take it") ||
      norm.includes("i'll take it") ||
      norm.includes("ill take it") ||
      norm.includes("sounds good") ||
      norm.includes("sounds great") ||
      norm.includes("that works") ||
      norm.includes("works for me") ||
      norm.includes("confirm") ||
      norm.includes("forward") ||
      norm.includes("finish the paperwork") ||
      norm.includes("finalize") ||
      norm.includes("we have a deal") ||
      norm.includes("it's a deal") ||
      norm.includes("its a deal") ||
      norm.includes("it s a deal") ||
      norm === "deal" ||
      (norm.includes("deal") && !norm.includes("no deal") && !norm.includes("best deal") && !norm.includes("better deal"));

    if (isCloseConfirmation) {
      return { intent: "agree", topic_beat_ids: [] };
    }

    const isCounterOfferOrFloorPush =
      norm.includes("three dollar") ||
      norm.includes("three dollars") ||
      norm.includes("3 dollar") ||
      norm.includes("3.00") ||
      norm.includes("three fifty") ||
      norm.includes("3.50") ||
      norm.includes("three twenty five") ||
      norm.includes("3.25") ||
      norm.includes("two dollar") ||
      norm.includes("two dollars") ||
      norm.includes("two fifty") ||
      norm.includes("2.50") ||
      norm.includes("2.00") ||
      norm.includes("cheaper") ||
      norm.includes("can you do") ||
      norm.includes("better on the price") ||
      norm.includes("too expensive") ||
      norm.includes("too much") ||
      norm.includes("too high") ||
      norm.includes("still high") ||
      norm.includes("is high") ||
      norm.includes("higher than") ||
      norm.includes("more than") ||
      norm.includes("budget") ||
      norm.includes("afford") ||
      norm.includes("lower the price") ||
      norm.includes("lower") ||
      norm.includes("discount") ||
      norm.includes("best deal") ||
      norm.includes("best price") ||
      norm.includes("best you can") ||
      norm.includes("do better") ||
      norm.includes("dollar fifty") ||
      norm.includes("1.50") ||
      norm.includes("no deal") ||
      norm.includes("come down") ||
      norm.includes("20 dollars a month") ||
      norm.includes("twenty dollars") ||
      norm.includes("20 a month");

    if (isCounterOfferOrFloorPush) {
      return { intent: "negotiate_price", topic_beat_ids: [] };
    }

    // A compliment with no yes in it is not an answer to the offer or confirmation
    if (isVehicleCompliment(norm) && !/\b(yes|yeah|yep)\b/.test(norm)) {
      return { intent: "compliment", topic_beat_ids: [] };
    }

    if (currentBeatId === 22) {
      if (
        norm.includes("sounds good") ||
        norm.includes("sounds great") ||
        norm.includes("great protection") ||
        norm.includes("reasonable") ||
        norm.includes("four dollars") ||
        norm.includes("agree") ||
        norm.includes("yes") ||
        norm.includes("focus on") ||
        norm.includes("options")
      ) {
        return { intent: "agree", topic_beat_ids: [] };
      }
    }

    if (currentBeatId === 23) {
      if (
        norm.includes("value") ||
        norm.includes("warranty") ||
        norm.includes("tire") ||
        norm.includes("maintenance") ||
        norm.includes("four dollars") ||
        norm.includes("three dollars and fifty") ||
        norm.includes("three twenty-five") ||
        norm.includes("fair") ||
        norm.includes("agree") ||
        norm.includes("yes") ||
        norm.includes("sounds good") ||
        norm.includes("works for me") ||
        norm.includes("both") ||
        namedCoverages(norm).length > 0 ||
        NAMES_ALL_COVERAGES.test(norm)
      ) {
        return { intent: "agree", topic_beat_ids: [] };
      }
    }

    if (currentBeatId === 24) {
      if (
        norm.includes("confirm") ||
        norm.includes("forward") ||
        norm.includes("yes") ||
        norm.includes("ready") ||
        norm.includes("sounds good") ||
        norm.includes("finalize") ||
        norm.includes("absolutely")
      ) {
        return { intent: "agree", topic_beat_ids: [] };
      }
    }

    if (currentBeatId === 25) {
      return { intent: "agree", topic_beat_ids: [] };
    }
  }

  // 5.75. Customer answers Beat 1 (Legal Disclosure & Agreement to proceed)
  if (currentBeatId === 1) {
    const isExplicitNegation =
      norm === "no" || norm === "nope" || norm.startsWith("no ") || norm.includes("don't agree") || norm.includes("dont agree");
    const isCompliment =
      norm.includes("love") ||
      norm.includes("beautiful") ||
      norm.includes("dream") ||
      norm.includes("gorgeous") ||
      norm.includes("amazing");
    const isStep0RapportTail =
      norm.includes("was good") ||
      norm.includes("it was good") ||
      norm.includes("been good") ||
      norm.includes("good so far") ||
      norm.includes("great experience") ||
      norm.includes("treated us well") ||
      norm.includes("treated me well") ||
      norm === "good" ||
      norm === "great" ||
      norm === "fine thanks";

    if (isStep0RapportTail) {
      return { intent: "repeat_request", topic_beat_ids: [] };
    }

    if (!isExplicitNegation && !isVehicleDiscrepancy && !isManufacturerVsDealer && !isCompliment) {
      if (
        norm === "ok" ||
        norm === "okay" ||
        norm === "yes" ||
        norm === "yeah" ||
        norm === "yep" ||
        norm === "sure" ||
        norm === "fine" ||
        norm.startsWith("fine ") ||
        norm === "alright" ||
        norm === "understood" ||
        norm === "i understand" ||
        norm === "sounds good" ||
        norm === "go ahead" ||
        norm === "proceed" ||
        norm === "makes sense" ||
        norm.startsWith("yes ") ||
        norm.startsWith("yeah ") ||
        norm.startsWith("okay ") ||
        norm.startsWith("ok ") ||
        norm.startsWith("sounds good") ||
        norm.includes("understand") ||
        norm.includes("understanding") ||
        norm.includes("i agree") ||
        norm.includes("fine with me") ||
        norm.includes("ready to proceed")
      ) {
        return { intent: "agree", topic_beat_ids: [] };
      }
    }
  }

  // 5.76. Customer answers Beat 2 (Test Drive Qualifying Question)
  if (currentBeatId === 2) {
    const isExplicitNoDrive =
      norm === "no" ||
      norm === "nope" ||
      norm.startsWith("no ") ||
      norm.includes("didn t drive") ||
      norm.includes("didnt drive") ||
      norm.includes("did not drive") ||
      norm.includes("haven t driven") ||
      norm.includes("havent driven") ||
      norm.includes("haven t") ||
      norm.includes("havent") ||
      norm.includes("didn t get a chance") ||
      norm.includes("didnt get a chance") ||
      norm.includes("did not get a chance") ||
      norm.includes("not yet") ||
      norm.includes("never drove") ||
      norm.includes("didn t get to") ||
      norm.includes("didnt get to") ||
      norm.includes("did not get to") ||
      norm.includes("didn t") ||
      norm.includes("didnt") ||
      norm.includes("never got to drive");

    if (isExplicitNoDrive) {
      return { intent: "no", topic_beat_ids: [] };
    }

    const hasProgressionWord =
      norm.includes("did that") ||
      norm.includes("drove") ||
      norm.includes("drive");

    const isExplicitYesDrive =
      norm === "yes" ||
      norm === "yeah" ||
      norm === "yep" ||
      norm === "i did" ||
      norm === "we did" ||
      norm === "yes i did" ||
      norm === "yeah i did" ||
      norm === "sure did" ||
      norm === "absolutely" ||
      norm === "definitely" ||
      norm.startsWith("yes ") ||
      norm.startsWith("yeah ") ||
      norm.includes("drove it") ||
      norm.includes("test drive") ||
      norm.includes("test drove") ||
      norm.includes("took it out") ||
      norm.includes("for a spin") ||
      norm.includes("drove the car") ||
      norm.includes("drove the vehicle") ||
      hasProgressionWord;

    if (isExplicitYesDrive) {
      return { intent: "agree", topic_beat_ids: [] };
    }
  }

  // 5.77. Customer answers Beat 3 (Walkaround Qualifying Question)
  if (currentBeatId === 3) {
    const isExplicitNoWalkaround =
      norm === "no" ||
      norm === "nope" ||
      norm.startsWith("no ") ||
      norm.includes("didn t") ||
      norm.includes("didnt") ||
      norm.includes("did not") ||
      norm.includes("never") ||
      norm.includes("rushed") ||
      norm.includes("not really");

    if (isExplicitNoWalkaround) {
      return { intent: "no", topic_beat_ids: [] };
    }

    const isExplicitYesWalkaround =
      norm === "yes" ||
      norm === "yeah" ||
      norm === "yep" ||
      norm === "he did" ||
      norm === "they did" ||
      norm === "we did" ||
      norm === "yes he did" ||
      norm === "yeah he did" ||
      norm === "sure did" ||
      norm.startsWith("yes ") ||
      norm.startsWith("yeah ") ||
      norm.includes("showed me") ||
      norm.includes("walkaround") ||
      norm.includes("walk around") ||
      norm.includes("went over");

    if (isExplicitYesWalkaround) {
      return { intent: "agree", topic_beat_ids: [] };
    }
  }

  // 5.8. Customer answers Beat 4 (Warranty Understanding inquiry - open)
  if (currentBeatId === 4) {
    const isExplicitNoWarranty =
      norm.startsWith("no") ||
      norm.includes("didn t") ||
      norm.includes("didn't") ||
      norm.includes("did not") ||
      norm.includes("never") ||
      norm.includes("nothing") ||
      norm.includes("not really") ||
      norm.includes("no one told") ||
      norm.includes("didnt");

    if (isExplicitNoWarranty) {
      return { intent: "no", topic_beat_ids: [] };
    }

    // Filler sounds like "uh", "hmm", "well" do NOT answer open question
    const fillers = new Set(["uh", "um", "hmm", "hm", "well", "ah", "er", "uh huh", "mhm"]);
    if (fillers.has(norm) || words.every(w => fillers.has(w))) {
      return { intent: "other", topic_beat_ids: [] };
    }

    // Any real sentence answers (at least 2 words or a meaningful explanation)
    if (words.length >= 2 || norm.includes("warranty") || norm.includes("cover") || norm.includes("everything")) {
      return { intent: "agree", topic_beat_ids: [] };
    }
  }

  // 6. In-script question matching
  if (
    norm.includes("what does it cover") ||
    norm.includes("what is covered") ||
    norm.includes("tell me about the warranty")
  ) {
    return { intent: "question_in_script", topic_beat_ids: [6] };
  }
  if (
    norm.includes("wear and tear") ||
    norm.includes("what causes breakdowns")
  ) {
    return { intent: "question_in_script", topic_beat_ids: [8, 9, 10] };
  }
  if (
    norm.includes("how much are parts") ||
    norm.includes("repair costs") ||
    norm.includes("cost of repair") ||
    norm.includes("repair actually cost") ||
    norm.includes("what does a repair cost") ||
    norm.includes("what does repair cost") ||
    (norm.includes("repair") && norm.includes("cost")) ||
    (norm.includes("parts") && norm.includes("cost"))
  ) {
    return { intent: "question_in_script", topic_beat_ids: [13, 14, 15] };
  }
  const isTireExclusionOrCustom =
    norm.includes("own tire") ||
    norm.includes("my own tires") ||
    norm.includes("don t need tire") ||
    norm.includes("dont need tire") ||
    norm.includes("drop the tire") ||
    norm.includes("without the tire") ||
    norm.includes("remove the tire");

  const isOilExclusionOrCustom =
    norm.includes("own oil") ||
    norm.includes("my own oil") ||
    norm.includes("do my own") ||
    norm.includes("don t need maintenance") ||
    norm.includes("dont need maintenance");

  if (!isTireExclusionOrCustom && (norm.includes("tire") || norm.includes("wheel"))) {
    return { intent: "question_in_script", topic_beat_ids: [17] };
  }
  if (!isOilExclusionOrCustom && (norm.includes("oil change") || norm.includes("maintenance"))) {
    return { intent: "question_in_script", topic_beat_ids: [18] };
  }

  // 7. Out-of-script question
  if (
    norm.includes("interest rate") ||
    norm.includes("apr") ||
    norm.includes("trade in") ||
    norm.includes("dealer fee") ||
    norm.includes("down payment")
  ) {
    return { intent: "question_out_of_script", topic_beat_ids: [] };
  }

  // 7.1. Spouse / Wife decision-maker objection
  if (
    norm.includes("my wife") ||
    norm.includes("ask my wife") ||
    norm.includes("wife handles") ||
    norm.includes("wife makes") ||
    norm.includes("check with my wife") ||
    norm.includes("my husband")
  ) {
    return { intent: "spouse_objection", topic_beat_ids: [] };
  }

  // 7.2. Auto Insurance vs Mechanical Protection question
  if (
    norm.includes("car insurance") ||
    norm.includes("auto insurance") ||
    (norm.includes("insurance") && norm.includes("cover"))
  ) {
    return { intent: "insurance_question", topic_beat_ids: [] };
  }

  // 7.3. Cancellation / Transferability question
  if (
    norm.includes("cancel") ||
    norm.includes("refund") ||
    norm.includes("money back") ||
    (norm.includes("sell the car") && norm.includes("what happen"))
  ) {
    return { intent: "cancellation_question", topic_beat_ids: [] };
  }

  // 8. Explicit No
  if (
    norm === "no" ||
    norm === "nope" ||
    norm === "not really" ||
    norm.startsWith("no ") ||
    norm.endsWith(" no") ||
    norm.includes(" no ") ||
    norm.includes("still no") ||
    norm.includes("no thanks")
  ) {
    return { intent: "no", topic_beat_ids: [] };
  }

  // 8.5. Tech check & video/audio connection confirmation (e.g. "I can see you", "Yeah I can see you", "Loud and clear")
  // MUST NOT advance sales script beats (e.g. Qualifying questions)
  const isTechCheckPhrase =
    norm.includes("see you") ||
    norm.includes("hear you") ||
    norm.includes("hear and see") ||
    norm.includes("see and hear") ||
    norm.includes("loud and clear") ||
    norm.includes("can see") ||
    norm.includes("can hear") ||
    norm.includes("i see you") ||
    norm.includes("i hear you");

  if (isTechCheckPhrase) {
    return { intent: "tech_check_ack", topic_beat_ids: [] };
  }

  // 8.6. Pause / Hold / Interjection request (e.g. "wait a second", "hold on", "give me a moment", "let me tell you", "let me finish")
  // Do NOT advance beat or treat as cold negation/abandonment
  if (
    norm.includes("hold on") ||
    norm.includes("wait a sec") ||
    norm.includes("wait a minute") ||
    norm.includes("wait a moment") ||
    norm.includes("one second") ||
    norm.includes("one sec") ||
    norm.includes("give me a second") ||
    norm.includes("give me a sec") ||
    norm.includes("give me a minute") ||
    norm.includes("give me a moment") ||
    norm.includes("let me think") ||
    norm.includes("hang on") ||
    norm.includes("hold up") ||
    norm.includes("let me tell you") ||
    norm.includes("let me speak") ||
    norm.includes("let me finish") ||
    norm.includes("let me complete") ||
    norm.includes("listen to me") ||
    norm.includes("listen first") ||
    norm.includes("hear me out")
  ) {
    return { intent: "pause_request", topic_beat_ids: [] };
  }

  // 8.65. Beat 4 Qualifying Question ("What's your understanding of the warranty...")
  // When customer explains what the salesperson told them, advance to Beat 5
  if (currentBeatId === 4) {
    if (
      norm.includes("explained") ||
      norm.includes("told me") ||
      norm.includes("said that") ||
      norm.includes("went over") ||
      norm.includes("mentioned") ||
      norm.includes("basic") ||
      norm.includes("factory warranty") ||
      norm.includes("manufacturer") ||
      norm.includes("some of") ||
      norm.includes("not much") ||
      norm.includes("a little") ||
      norm.includes("showed me")
    ) {
      return { intent: "agree", topic_beat_ids: [] };
    }
  }

  // 8.66. Beat 22 Offer Pitch -> Advance to Beat 23 (Negotiation/Value)
  if (currentBeatId === 22) {
    if (
      norm.includes("sounds good") ||
      norm.includes("sounds great") ||
      norm.includes("great protection") ||
      norm.includes("let's do it") ||
      norm.includes("lets do it") ||
      norm.includes("four dollars") ||
      norm.includes("agree") ||
      norm.includes("yes") ||
      norm.includes("deal") ||
      norm.includes("focus on") ||
      norm.includes("options")
    ) {
      return { intent: "agree", topic_beat_ids: [] };
    }
  }

  // 8.67. Beat 23 Negotiation Value -> Advance to Beat 24 (Verbal Close)
  if (currentBeatId === 23) {
    if (
      norm.includes("value") ||
      norm.includes("warranty") ||
      norm.includes("tire") ||
      norm.includes("maintenance") ||
      norm.includes("four dollars") ||
      norm.includes("fair") ||
      norm.includes("agree") ||
      norm.includes("yes") ||
      norm.includes("sounds good") ||
      norm.includes("both")
    ) {
      return { intent: "agree", topic_beat_ids: [] };
    }
  }

  // 8.68. Beat 24 Verbal Close Confirmation -> Advance to Beat 25 (Verification)
  if (currentBeatId === 24) {
    if (
      norm.includes("confirm") ||
      norm.includes("forward") ||
      norm.includes("yes") ||
      norm.includes("ready") ||
      norm.includes("let's do it") ||
      norm.includes("lets do it") ||
      norm.includes("sounds good") ||
      norm.includes("finalize") ||
      norm.includes("absolutely")
    ) {
      return { intent: "agree", topic_beat_ids: [] };
    }
  }

  // 8.69. Beat 25 Post-Close Verification -> Terminal completion
  if (currentBeatId === 25) {
    if (
      norm.includes("name is") ||
      norm.includes("address") ||
      norm.includes("alex") ||
      norm.includes("terrace") ||
      norm.includes("street") ||
      norm.includes("confirm") ||
      norm.includes("correct") ||
      norm.includes("spelling") ||
      norm.includes("yes")
    ) {
      return { intent: "agree", topic_beat_ids: [] };
    }
  }

  // 8.7. Overwhelmed / Pace adjustment request (e.g. "slow down", "too fast", "moving too fast", "lot of information")
  if (
    norm.includes("slow down") ||
    norm.includes("too fast") ||
    norm.includes("moving too fast") ||
    norm.includes("lot of info") ||
    norm.includes("lot of information") ||
    norm.includes("overwhelmed")
  ) {
    return { intent: "overwhelmed", topic_beat_ids: [] };
  }

  // 8.8. Vehicle compliment, excitement, or humor appreciation (e.g. "I love this car", "beautiful vehicle", "haha that's funny")
  if (
    isVehicleCompliment(norm) ||
    norm.includes("so excited") ||
    norm.includes("can't wait to drive") ||
    norm.includes("cant wait to drive") ||
    norm.includes("pumped") ||
    norm.includes("stoked") ||
    norm.includes("so happy") ||
    norm.includes("thrilled") ||
    norm.includes("haha") ||
    norm.includes("lol") ||
    (!norm.includes("not funny") && !norm.includes("isnt funny") && !norm.includes("isn t funny") && norm.includes("funny")) ||
    norm.includes("hilarious")
  ) {
    return { intent: "compliment", topic_beat_ids: [] };
  }

  // 8.82. Customer Frustration / Impatience / Rush / Markup complaints
  if (
    norm.includes("hurry up") ||
    norm.includes("been waiting") ||
    norm.includes("waiting so long") ||
    norm.includes("taking forever") ||
    norm.includes("waste my time") ||
    norm.includes("wasting my time") ||
    norm.includes("don't waste my time") ||
    norm.includes("dont waste my time") ||
    norm.includes("hate paperwork") ||
    norm.includes("let's get this over") ||
    norm.includes("lets get this over") ||
    norm.includes("tired of waiting") ||
    norm.includes("been here 3 hours") ||
    norm.includes("been here for hours") ||
    norm.includes("annoyed") ||
    norm.includes("frustrated") ||
    norm.includes("too slow") ||
    norm.includes("wrap it up") ||
    norm.includes("get on with it") ||
    norm.includes("get to the point") ||
    norm.includes("markup") ||
    norm.includes("ridiculous") ||
    norm.includes("rip off") ||
    norm.includes("ripoff") ||
    norm.includes("overpriced")
  ) {
    return { intent: "customer_frustrated", topic_beat_ids: [] };
  }

  // 8.83. Customer Anxiety / Fear / Doubt / Buyer's Remorse
  if (
    norm.includes("scared") ||
    norm.includes("nervous") ||
    norm.includes("anxious") ||
    norm.includes("doubt") ||
    norm.includes("worried") ||
    norm.includes("first time buying") ||
    norm.includes("first car") ||
    norm.includes("hesitant") ||
    norm.includes("afraid") ||
    norm.includes("buyer's remorse") ||
    norm.includes("buyers remorse") ||
    norm.includes("afraid of getting ripped") ||
    norm.includes("scared of hidden fees") ||
    norm.includes("hidden cost") ||
    norm.includes("feel pressured") ||
    norm.includes("feeling pressured") ||
    norm.includes("is this a scam") ||
    norm.includes("what if i make a mistake")
  ) {
    return { intent: "customer_anxious", topic_beat_ids: [] };
  }

  // 8.84. Beat 2 / Beat 3 bare progression check (yes_no beats)
  // Evaluated after all objections, pause requests, questions, anxiety, and frustration
  if (currentBeatId === 2 || currentBeatId === 3) {
    const hasProgressionAction =
      norm.includes("go ahead") ||
      norm.includes("go on") ||
      norm.includes("continue") ||
      norm.includes("carry on") ||
      norm.includes("sounds good") ||
      norm.includes("did that") ||
      norm.includes("drove") ||
      norm.includes("drive");

    const isBareAffirmative =
      !hasProgressionAction &&
      (norm === "ok" ||
        norm === "okay" ||
        norm === "alright" ||
        norm === "all right" ||
        norm === "sure" ||
        norm === "fine" ||
        norm === "gotcha" ||
        norm === "cool" ||
        norm === "uh huh" ||
        norm === "mhm" ||
        norm.startsWith("ok ") ||
        norm.startsWith("okay ") ||
        norm.startsWith("alright "));

    if (isBareAffirmative) {
      return { intent: "repeat_request", topic_beat_ids: [] };
    }
  }

  // 9. Comprehensive Natural Affirmation / Progression
  // Handles compound colloquial variations ("yeah, yeah, okay, go on", "ok sure sounds good", "carry on", etc.)
  if (isAffirmativeOrProgression(norm)) {
    return { intent: "agree", topic_beat_ids: [] };
  }

  return { intent: "other", topic_beat_ids: [] };
}

/**
 * Robust affirmative & conversational progression evaluator.
 * Eliminates confusion with preset answers by recognizing any combination of natural affirmations.
 */
export function isAffirmativeOrProgression(norm: string): boolean {
  const words = norm.toLowerCase().replace(/[^a-z0-9 ]/g, " ").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return false;

  // Never treat avatar script echo as customer affirmative
  if (isAvatarScriptEcho(norm)) return false;

  // Never treat tech check as sales affirmative
  const techCheckPhrases = ["see you", "hear you", "can see", "can hear", "loud and clear"];
  if (techCheckPhrases.some((tcp) => norm.includes(tcp))) return false;

  // Explicit negations are NOT affirmations
  const negationWords = new Set(["no", "not", "dont", "nope", "never", "stop", "wait", "hold"]);
  if (words.some((w) => negationWords.has(w))) return false;

  // Explicit questions asking for information or rates are NOT simple progression
  const nonAffirmativeWords = new Set(["what", "why", "how", "who", "where", "when", "which", "rate", "apr", "cost", "price", "payment", "trade"]);
  if (words.some((w) => nonAffirmativeWords.has(w))) return false;

  // Bare filler words are NOT affirmations
  const bareFillers = new Set(["uh", "um", "hmm", "hm", "whatever", "maybe"]);
  if (bareFillers.has(norm) || (words.length === 1 && bareFillers.has(words[0]))) return false;
  // Trailing hesitation
  if (norm.endsWith(" uh") || norm.endsWith(" um") || norm.endsWith(" hmm")) return false;

  // Backchannel sounds ("mm-hm", "uh-huh", "mhm"). A bare "hm"/"hmm" is doubt and stays excluded above.
  if (/^(m+ ?h+m+|uh ?huh)$/.test(words.join(" "))) return true;

  // Leading reactions and fillers don't change the answer: "wow, okay" and "uh, okay, continue"
  // are judged on what follows them. A reaction on its own ("wow") is not an answer.
  const leadIns = new Set(["uh", "um", "oh", "ah", "wow", "well", "so", "geez", "jeez", "man", "dang", "damn"]);
  let start = 0;
  while (start < words.length - 1 && leadIns.has(words[start])) start++;
  const core = words.slice(start);
  const coreNorm = core.join(" ");

  // If the sentence starts with an affirmative anchor and has no questions/negations:
  const affirmativeAnchors = ["yes", "yeah", "yep", "yup", "yea", "sure", "ok", "okay", "alright", "right", "sounds good", "go on", "go ahead"];
  if (affirmativeAnchors.some((a) => coreNorm === a || coreNorm.startsWith(`${a} `))) {
    return true;
  }

  // Full vocabulary of affirmative & progression tokens
  const affirmativeVocabulary = new Set([
    "yes", "yeah", "yep", "yup", "yea", "sure", "ok", "okay", "k",
    "right", "alright", "all", "good", "sounds", "great", "fine", "cool",
    "continue", "go", "on", "ahead", "proceed", "carry", "moving", "forward",
    "makes", "sense", "understood", "understand", "with", "you",
    "he", "she", "they", "we", "i", "did", "have", "got", "it", "that", "done", "already",
    "drove", "test", "car", "vehicle",
    "definitely", "absolutely", "please", "ready", "set", "perfect", "true", "to", "me",
    "mhm", "mmhmm"
  ]);

  if (core.every((w) => affirmativeVocabulary.has(w))) {
    return true;
  }

  // Common multi-word progression phrases
  const commonPhrases = [
    "go on", "go ahead", "carry on", "sounds good", "makes sense",
    "i understand", "i understood", "with you", "let's do it", "lets do it",
    "all right", "all set", "take your time", "i drove it", "we drove it"
  ];
  if (commonPhrases.some((p) => norm.includes(p))) {
    return true;
  }

  return false;
}

// Longest the remote classifier may take before the turn falls back to hold + CLARIFY_LINE
export const LLM_CLASSIFIER_TIMEOUT_MS = 800;

// LLM Classifier using fast model with temperature: 0
export async function classifyWithLLM(
  customerTranscript: string,
  state: CallState
): Promise<ClassificationResult> {
  // Ultra-Fast Fast-Path: Deterministically classify common affirmations, objections, and standard requests in <1ms without remote LLM roundtrip lag
  const fastRuleResult = classifyCustomerInputRuleBased(customerTranscript, state.current_beat);
  if (fastRuleResult.intent !== "other") {
    return fastRuleResult;
  }

  const apiKey = process.env.XAI_API_KEY?.trim() || process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    return fastRuleResult;
  }

  const isXai = Boolean(process.env.XAI_API_KEY);
  const endpoint = isXai ? "https://api.x.ai/v1/chat/completions" : "https://api.openai.com/v1/chat/completions";
  const model = process.env.GROK_MODEL?.trim() || (isXai ? "grok-4.20-0309-non-reasoning" : "gpt-4o-mini");

  const systemPrompt = `You are a strict, ultra-fast intent classification engine for a car dealership finance manager call.
Output ONLY valid JSON with keys "intent" and "topic_beat_ids".
The LLM never writes sales dialogue. Only classify.

Intents:
- "agree": Customer affirms, agrees, says yes/yeah/ok/sure/makes sense/go on/sounds good, or answers affirmatively.
- "no": Customer says no or disagrees ("no", "not really").
- "question_in_script": Customer asks a question answered by vehicle warranty/protection script topics (coverage, wear and tear, repair costs, tires, oil changes).
- "question_out_of_script": Customer asks a question outside warranty/protection (e.g. APR, loan interest rate, trade-in, dealer doc fee).
- "price_ask": Customer asks what it costs, the price, or daily/monthly payment.
- "garbled": Inaudible, empty, or unintelligible words.
- "repeat_request": Customer asks Max to repeat or re-explain what he just said ("say that again", "what did you say?", "what does that mean?", "what do you mean?", "can you explain that?", "I don't understand", "i don't get it").
- "restart_request": Customer asks to restart from the very beginning.
- "human_request": Customer asks for a human manager or real person.
- "ai_question": Customer asks if Max is an AI / robot / real person.
- "pause_request": Customer asks to hold on, pause, or take a moment.
- "overwhelmed": Customer asks Max to slow down or expresses information overload.
- "compliment": Customer compliments the vehicle, features, or experience.
- "customer_frustrated": Customer expresses impatience, anger, or complaints about wait times or paperwork.
- "customer_anxious": Customer expresses fear, anxiety, hesitation, or doubt about making a mistake or hidden costs.
- "identity_question": Customer asks who Max is, what his name is, or who they are speaking with.
- "vehicle_discrepancy": Customer states they are buying a different car (e.g. Maybach, BMW) or that the Mazda CX-5 is the wrong vehicle.
- "manufacturer_vs_dealer": Customer asks whether this protection is from the manufacturer or dealer, or whether they should buy a new warranty from the manufacturer.
- "language_request": Customer speaks, or asks to continue in, a language other than English ("puedo hablar en español?").
- "why_asking": Customer asks why Max keeps asking the same question ("why do you keep asking me that?").
- "other": Off-topic greeting or comment.

Topic Beat IDs:
If question_in_script:
- warranty overview: [6]
- wear and tear: [8, 9, 10]
- parts and repair labor costs: [13, 14, 15]
- bumper to bumper VSC coverage: [16]
- tires and wheels: [17]
- scheduled maintenance: [18]
Otherwise: []`;

  const userMessage = JSON.stringify({
    current_beat: state.current_beat,
    last_spoken_text: state.last_spoken_text,
    customer_transcript: customerTranscript,
  });

  // Hard cap: dead air hurts more than a re-ask, so a slow classifier falls back to hold + clarify
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LLM_CLASSIFIER_TIMEOUT_MS);
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMessage },
        ],
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      return { ...fastRuleResult, usedLLM: true };
    }

    const data = await res.json();
    const raw = data.choices?.[0]?.message?.content || "{}";
    const cleaned = raw.replace(/```json/gi, "").replace(/```/g, "").trim();
    const parsed = JSON.parse(cleaned);

    return {
      intent: parsed.intent || "other",
      topic_beat_ids: Array.isArray(parsed.topic_beat_ids) ? parsed.topic_beat_ids : [],
      usedLLM: true,
    };
  } catch (err) {
    if (controller.signal.aborted) {
      console.warn(`[beat-controller] LLM classifier exceeded ${LLM_CLASSIFIER_TIMEOUT_MS}ms, holding with the clarify line`);
      return { intent: "classifier_timeout", topic_beat_ids: [], usedLLM: true, timedOut: true };
    }
    console.warn("[beat-controller] LLM classification error, falling back to rule-based:", err);
    return { ...fastRuleResult, usedLLM: true };
  } finally {
    clearTimeout(timer);
  }
}

// Step 0 Dynamic Rapport Generator (CONTEXT_RULES.md Stage 0 & Step 1)
export async function generateStep0Turn(
  customerTranscript: string,
  step0Turns: number,
  dealConfig = DEFAULT_DEAL_CONFIG
): Promise<{ text: string; moveToBeat1: boolean }> {
  const norm = customerTranscript.toLowerCase().replace(/[^a-z0-9 ]/g, " ").trim();
  const isTechAck =
    norm.includes("see you") ||
    norm.includes("hear you") ||
    norm.includes("loud and clear") ||
    norm.includes("can see") ||
    norm.includes("can hear") ||
    norm === "yes" ||
    norm === "yeah" ||
    norm === "yep" ||
    norm === "sure" ||
    norm === "i can" ||
    norm === "alright" ||
    norm === "all right" ||
    norm === "fine";

  // Prevent avatar echo from advancing Step 0 into Beat 1
  if (isAvatarScriptEcho(customerTranscript)) {
    console.warn(`[beat-controller] Step 0 detected avatar script echo: "${customerTranscript}". Staying on Step 0.`);
    let rapportText = STEP_0_RAPPORT_LINE;
    rapportText = rapportText.replace(/\{\{vehicle_year\}\}/g, dealConfig.vehicle_year);
    rapportText = rapportText.replace(/\{\{vehicle_make\}\}/g, dealConfig.vehicle_make);
    rapportText = rapportText.replace(/\{\{vehicle_model\}\}/g, dealConfig.vehicle_model);
    return {
      text: formatSpeechText(rapportText),
      moveToBeat1: false,
    };
  }

  // Check tech issues first
  const isTechIssue =
    norm.includes("cant see") ||
    norm.includes("can t see") ||
    norm.includes("cannot see") ||
    norm.includes("can not see") ||
    norm.includes("cant hear") ||
    norm.includes("can t hear") ||
    norm.includes("cannot hear") ||
    norm.includes("screen is black") ||
    norm.includes("no video") ||
    norm.includes("no audio");

  if (isTechIssue) {
    return {
      text: TECH_ISSUE_LINE,
      moveToBeat1: false,
    };
  }

  const isSalesAsk =
    (norm.includes("sales") &&
      (norm.includes("call") ||
        norm.includes("score") ||
        norm.includes("pitch") ||
        norm.includes("or not") ||
        norm.includes("is this") ||
        norm.includes("are you"))) ||
    norm.includes("sales call") ||
    norm.includes("sales pitch") ||
    norm.includes("sell me") ||
    norm.includes("selling me") ||
    norm.includes("trying to sell") ||
    norm.includes("selling something") ||
    norm.includes("selling");

  if (isSalesAsk) {
    return {
      text: SALES_CALL_LINE,
      moveToBeat1: false,
    };
  }

  // Turn 1: customer confirmed audio/video ("i can see you", "yes", etc.)
  // Build rapport & deliver formal greeting asking how their experience was
  if (step0Turns <= 1) {
    let rapportText = STEP_0_RAPPORT_LINE;
    rapportText = rapportText.replace(/\{\{vehicle_year\}\}/g, dealConfig.vehicle_year);
    rapportText = rapportText.replace(/\{\{vehicle_make\}\}/g, dealConfig.vehicle_make);
    rapportText = rapportText.replace(/\{\{vehicle_model\}\}/g, dealConfig.vehicle_model);
    return {
      text: formatSpeechText(rapportText),
      moveToBeat1: false,
    };
  }

  // Turn 2+: Check if customer is asking a question or interrupting BEFORE giving a rapport answer
  const isIdentityAsk =
    norm.includes("who are you") ||
    norm.includes("who is this") ||
    norm.includes("whos this") ||
    norm.includes("who am i") ||
    norm.includes("whats your name") ||
    norm.includes("what is your name") ||
    norm.includes("who you") ||
    norm === "who";

  const isWaitingOrRushed =
    norm.includes("wait") ||
    norm.includes("hour") ||
    norm.includes("hurry") ||
    norm.includes("waste") ||
    norm.includes("rush") ||
    norm.includes("appointment");

  if (isIdentityAsk) {
    if (isWaitingOrRushed) {
      return {
        text: "I'm Max, your digital finance manager today. I completely apologize for the long wait—that is way too long, so I'm going to make this fast, crisp, and direct so you can get on the road. Did you get a chance to test drive your new vehicle today?",
        moveToBeat1: false,
      };
    }
    return {
      text: "I'm Max, your digital finance manager today! I handle all your paperwork, title details, and warranty options before you drive off in your new car. How was your test drive out there today?",
      moveToBeat1: false,
    };
  }

  if (isSalesAsk) {
    if (isWaitingOrRushed) {
      return {
        text: "I completely respect your time! This is strictly your required paperwork and warranty review before you sign—zero sales pressure. Did our sales team treat you well today?",
        moveToBeat1: false,
      };
    }
    return {
      text: "Not at all! This isn't a sales call—my job is simply to review your paperwork and factory warranty before you sign anything. Did our sales team treat you well today?",
      moveToBeat1: false,
    };
  }

  const isCallPurposeAsk =
    norm.includes("what is this about") ||
    norm.includes("whats this about") ||
    norm.includes("why are we doing this") ||
    norm.includes("what is this for") ||
    norm.includes("whats this for") ||
    norm.includes("why am i here") ||
    norm.includes("what are we doing") ||
    norm.includes("what is this call") ||
    (norm.includes("call") && norm.includes("for"));

  if (isCallPurposeAsk) {
    return {
      text: "Every buyer meets with finance before delivery to verify paperwork, registration details, and review factory warranty coverage. Did you get a good feel for the car on your test drive?",
      moveToBeat1: false,
    };
  }

  const isAiAsk =
    norm.includes("are you real") ||
    norm.includes("are you ai") ||
    norm.includes("are you a robot") ||
    norm.includes("is this ai") ||
    norm.includes("real person");

  if (isAiAsk) {
    return {
      text: "I'm an AI digital finance manager, built to make your paperwork fast, clear, and transparent! How was your test drive out there today?",
      moveToBeat1: false,
    };
  }

  const isPauseAsk =
    norm.includes("let me tell you") ||
    norm.includes("listen to me") ||
    norm.includes("wait a second") ||
    norm.includes("wait a minute") ||
    norm.includes("hold on") ||
    norm === "wait" ||
    norm === "stop";

  if (isPauseAsk) {
    return {
      text: "I'm listening, please go ahead.",
      moveToBeat1: false,
    };
  }

  // Turn 2+: Customer answered the rapport question ("it was great", "good", "fine", or complained about wait) -> smooth transition into Beat 1 Legal Disclosure
  const isNegative =
    norm.includes("wait") ||
    norm.includes("hour") ||
    norm.includes("forever") ||
    norm.includes("terrible") ||
    norm.includes("bad") ||
    norm.includes("horrible") ||
    norm.includes("frustrat") ||
    norm.includes("annoy") ||
    norm.includes("waste") ||
    norm.includes("hurry") ||
    norm.includes("rush") ||
    norm.includes("get this over") ||
    norm.includes("been here") ||
    norm.includes("sitting here") ||
    norm.includes("long time") ||
    norm.includes("point") ||
    norm.includes("get to the point") ||
    norm.includes("cut to the chase") ||
    norm.includes("make it brief") ||
    norm.includes("appointment") ||
    norm.includes("move on");

  const isAnxious =
    norm.includes("scared") ||
    norm.includes("nervous") ||
    norm.includes("anxious") ||
    norm.includes("doubt") ||
    norm.includes("worried") ||
    norm.includes("first time") ||
    norm.includes("hesitant");

  const isExcited =
    norm.includes("amazing") ||
    norm.includes("awesome") ||
    norm.includes("so excited") ||
    norm.includes("love it") ||
    norm.includes("love the car") ||
    norm.includes("best experience") ||
    norm.includes("thrilled") ||
    norm.includes("pumped");

  let transitionLine = STEP_0_TRANSITION_LINE;
  if (isNegative) {
    transitionLine = STEP_0_TRANSITION_LINE.replace(
      "Glad to hear that!",
      "Understood, I value your time and will keep this crisp, direct, and straight to the point."
    );
  } else if (isAnxious) {
    transitionLine = STEP_0_TRANSITION_LINE.replace(
      "Glad to hear that!",
      "I completely understand—buying a car is a big decision, so we'll take it one step at a time with zero pressure."
    );
  } else if (isExcited) {
    transitionLine = STEP_0_TRANSITION_LINE.replace(
      "Glad to hear that!",
      "I love that excitement! That new car is an absolute blast to drive!"
    );
  } else {
    transitionLine = STEP_0_TRANSITION_LINE.replace(
      "Glad to hear that!",
      "Awesome, so glad to hear that! Our team works really hard to take care of our customers."
    );
  }

  return {
    text: formatSpeechText(transitionLine),
    moveToBeat1: true,
  };
}

/**
 * Dynamic off-script responder with strict negative constraints.
 * Generates a concise, polite 1-sentence answer for general/dealership questions.
 *
 * Strict Negative Constraints:
 * 1. NO PRICING OR RATE PROMISES: NEVER state, quote, estimate, or promise interest rates (APR),
 *    monthly payments, loan term/duration, down payment, trade-in value, taxes, or discounts.
 * 2. If the user asks about financing terms, interest rates, monthly payment, down payment, or trade-in value,
 *    MUST defer to human colleague using OUT_OF_SCRIPT_LINE.
 * 3. Max length: 1 single sentence, max 20 words.
 * 4. Zero filler words ("Sure", "Awesome", "Great question", "Got it", "Of course").
 * 5. If response violates constraints (e.g. mentions $, %, rate, apr, payment), immediately fallback to OUT_OF_SCRIPT_LINE.
 */
export async function generateConstrainedOffScriptResponse(
  customerTranscript: string,
  state: CallState
): Promise<string> {
  const norm = customerTranscript.toLowerCase();

  // Hard safety filter: If asking about financial/rates/trade-in/payments, immediately use OUT_OF_SCRIPT_LINE
  const financialKeywords = [
    "rate",
    "apr",
    "interest",
    "monthly payment",
    "payment",
    "down payment",
    "trade in",
    "trade-in",
    "credit score",
    "loan term",
    "discount",
    "rebate",
    "invoice",
    "msrp",
  ];

  if (financialKeywords.some((kw) => norm.includes(kw))) {
    return OUT_OF_SCRIPT_LINE;
  }

  const apiKey = process.env.XAI_API_KEY?.trim() || process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    return "";
  }

  const isXai = Boolean(process.env.XAI_API_KEY);
  const endpoint = isXai ? "https://api.x.ai/v1/chat/completions" : "https://api.openai.com/v1/chat/completions";
  const model = process.env.GROK_MODEL?.trim() || (isXai ? "grok-4.20-0309-non-reasoning" : "gpt-4o-mini");

  const systemPrompt = `You are Max, an authoritative, polite Digital Finance Manager at a car dealership.
The customer asked an off-script question during their finance paperwork review.
Respond with EXACTLY ONE short, authoritative sentence (max 20 words) answering or acknowledging their question directly.

STRICT CONSTRAINTS:
- You have full authority to handle the deal. NEVER refer to a "colleague", "coworker", or "taking a note".
- NEVER tell the customer to "finish your question", "finish your sentence", or "could you please finish". If their statement is a fragment or incomplete, simply acknowledge politely ("Understood, please go ahead") or answer directly.
- NEVER quote, promise, or discuss specific interest rates (APR), monthly payments, loan terms, down payments, discounts, or trade-in values.
- NEVER make mechanical warranty guarantees beyond the manufacturer paperwork.
- NO filler words (do NOT start with "Sure", "Awesome", "Great question", "Got it", "Certainly", "Of course").
- Keep it natural, confident, direct, and under 20 words.
- Output ONLY the exact sentence to speak, no quotes, no markdown.`;

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.1,
        max_tokens: 60,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `Customer asked: "${customerTranscript}"` },
        ],
      }),
    });

    if (!res.ok) {
      return "";
    }

    const data = await res.json();
    let reply = (data.choices?.[0]?.message?.content || "").trim();
    reply = formatSpeechText(reply);

    // Safety checks against rate/price promises or scolding in output
    const replyNorm = reply.toLowerCase();
    if (
      replyNorm.includes("finish your question") ||
      replyNorm.includes("complete your question") ||
      replyNorm.includes("finish your sentence") ||
      replyNorm.includes("could you please finish")
    ) {
      return "I understand, please go ahead.";
    }

    if (
      !reply ||
      replyNorm.includes("$") ||
      replyNorm.includes("%") ||
      replyNorm.includes("percent") ||
      replyNorm.includes(" apr") ||
      replyNorm.includes("interest rate") ||
      replyNorm.includes("per month") ||
      replyNorm.includes("a month")
    ) {
      return OUT_OF_SCRIPT_LINE;
    }

    return reply;
  } catch (err) {
    console.warn("[beat-controller] Dynamic off-script generation error, falling back to empty:", err);
    return "";
  }
}

/**
 * Out-of-script turn: answer only from the approved knowledge base and hold the current beat.
 * Never advances the script and never stops the call (there is no human escalation).
 */
async function handleGroundedTurn(
  customerTranscript: string,
  state: CallState,
  currentBeat: Beat,
  metrics?: TurnMetrics,
  skipQuestionGate = false
): Promise<{ text: string; beatType: "wait" | "continue" | "stop"; toolCalls: Array<{ name: string; args: Record<string, any> }> }> {
  if (!skipQuestionGate && !looksLikeQuestion(customerTranscript)) {
    return { text: CLARIFY_LINE, beatType: "wait", toolCalls: [] };
  }
  const normQ = customerTranscript.toLowerCase();
  const financial = ["rate", "apr", "interest", "monthly payment", "payment", "down payment", "trade in", "trade-in", "credit score", "loan term", "discount", "rebate", "invoice", "msrp"];
  if (financial.some((kw) => normQ.includes(kw))) {
    return { text: `${OUT_OF_SCRIPT_LINE} ${CLARIFY_LINE}`, beatType: "wait", toolCalls: [] };
  }
  const result = await answerFromKnowledgeBase(customerTranscript);
  if (metrics && result.usedLLM) metrics.usedLLM = true;
  if (result.kind === "answer") {
    state.ungrounded_count = 0;
    const bridge = "Now, back to where we were.";
    if (state.sentence_index !== undefined && state.sentence_index > 0) {
      const fullUtterance = getFullBeatUtterance(currentBeat, state.dealConfig, state);
      const sentences = splitIntoSentences(fullUtterance);
      if (state.sentence_index < sentences.length) {
        const remaining = sentences.slice(state.sentence_index).join(" ");
        state.sentence_index = undefined;
        return { text: `${result.text} ${bridge} ${remaining}`, beatType: "wait", toolCalls: [] };
      }
    }
    const checkIn = getBeatCheckInQuestion(currentBeat);
    return { text: `${result.text} ${bridge} ${checkIn}`, beatType: "wait", toolCalls: [] };
  }
  state.ungrounded_count = (state.ungrounded_count || 0) + 1;
  console.warn(
    "[beat-controller] UNANSWERED_QUESTION",
    JSON.stringify({ beat: currentBeat.id, q: customerTranscript, in_a_row: state.ungrounded_count })
  );
  return { text: `${UNKNOWN_QUESTION_LINE} ${CLARIFY_LINE}`, beatType: "wait", toolCalls: [] };
}

// -----------------------------------------------------------------------------
// MAIN CONTROLLER DECISION FUNCTION
// Evaluates customer input against current call state and outputs exact text to speak
// -----------------------------------------------------------------------------
export async function processControllerTurn(
  sessionId: string,
  customerTranscript: string,
  dealConfig = DEFAULT_DEAL_CONFIG,
  mockClassification?: ClassificationResult
): Promise<ControllerDecision> {
  const t0 = Date.now();
  const beatBefore = getOrCreateCallState(sessionId, dealConfig).current_beat;
  const metrics: TurnMetrics = { classifierMs: 0, usedLLM: false, classifierTimedOut: false };
  const decision = await runControllerTurn(sessionId, customerTranscript, dealConfig, mockClassification, metrics);
  decision.metrics = {
    ...metrics,
    controllerMs: Date.now() - t0,
    intent: decision.intent,
    beatBefore,
    beatAfter: decision.beatId,
  };
  return decision;
}

async function runControllerTurn(
  sessionId: string,
  customerTranscript: string,
  dealConfig: DealConfig,
  mockClassification: ClassificationResult | undefined,
  metrics: TurnMetrics
): Promise<ControllerDecision> {
  const state = getOrCreateCallState(sessionId, dealConfig);

  // Once stopped (script complete, recording objection, hang-up), stay closed: one fixed line,
  // never the handoff line and never back into the script.
  if (state.is_stopped) {
    const terminalText = state.current_beat >= 25 && !state.verification_deferred ? SCRIPT_COMPLETE_LINE : CLOSING_LINE;
    return {
      textToSpeak: terminalText,
      beatId: state.current_beat,
      beatType: "stop",
      toolCalls: [],
      state,
      intent: "hang_up",
      isScriptComplete: true,
    };
  }

  // ===========================================================================
  // 3.6 Step 0 (Before Beat 1)
  // ===========================================================================
  if (!state.step0_completed) {
    state.step0_turns++;
    const step0Result = await generateStep0Turn(customerTranscript, state.step0_turns, state.dealConfig);

    if (step0Result.moveToBeat1) {
      state.step0_completed = true;
      state.current_beat = 1;
      const beat1 = BEATS.find((b) => b.id === 1)!;
      const utterance = step0Result.text || getFullBeatUtterance(beat1, state.dealConfig);
      state.last_spoken_text = utterance;
      state.delivered_beats.push(1);

      return {
        textToSpeak: utterance,
        beatId: 1,
        beatType: beat1.type,
        toolCalls: getBeatToolCalls(1),
        state,
        intent: "step0",
      };
    } else {
      state.last_spoken_text = step0Result.text;
      return {
        textToSpeak: step0Result.text,
        beatId: 0,
        beatType: "wait",
        toolCalls: [],
        state,
        intent: "step0",
      };
    }
  }

  // ===========================================================================
  // 3.4 & 3.5 Intent Classification & Matrix Handling
  // ===========================================================================
  const tClassify = Date.now();
  const classification = mockClassification || (await classifyWithLLM(customerTranscript, state));
  metrics.classifierMs = Date.now() - tClassify;
  if (classification.usedLLM) metrics.usedLLM = true;
  if (classification.timedOut) metrics.classifierTimedOut = true;
  const { intent, topic_beat_ids } = classification;
  // What the turn log records; differs from `intent` only where the reply's role is clearer
  let reportedIntent: ControllerDecision["intent"] = intent;

  console.log(`[beat-controller] Turn Intent: "${intent}", Current Beat: ${state.current_beat}`);

  let textToSpeak = "";
  let beatType: "wait" | "continue" | "stop" = "wait";
  let toolCalls: Array<{ name: string; args: Record<string, any> }> = [];

  switch (intent) {
    case "agree": {
      const currentBeatObj = BEATS.find((b) => b.id === state.current_beat);
      if (currentBeatObj) {
        const expects = currentBeatObj.expects || (currentBeatObj.check_in ? "statement" : "statement");
        const norm = customerTranscript.toLowerCase().replace(/[^a-z0-9 ]/g, " ").trim();
        // In yes_no beat (Beat 2, 3), a bare "ok" or "sure" without confirmation must NOT advance
        if (expects === "yes_no") {
          const isExplicitDriveOrWalkaround =
            Boolean(mockClassification) ||
            norm.includes("drove") ||
            norm.includes("drive") ||
            norm.includes("walkaround") ||
            norm.includes("showed") ||
            norm.includes("went over") ||
            norm.includes("did that") ||
            norm === "yes" ||
            norm === "yeah" ||
            norm === "yep" ||
            norm.startsWith("yes ") ||
            norm.startsWith("yeah ") ||
            norm.includes(" yes ") ||
            norm.includes(" yeah ") ||
            norm === "i did" ||
            norm === "we did" ||
            norm === "he did" ||
            norm === "they did" ||
            norm === "sure did";

          if (!isExplicitDriveOrWalkaround) {
            // Uncertain - hold beat and ask confirmation
            if (state.current_beat === 2) {
              textToSpeak = "Just to confirm, did you get a chance to take it for a test drive, or have you not driven it yet?";
            } else {
              textToSpeak = "Just to confirm, did the salesperson do the walkaround with you, or did they not get to that?";
            }
            beatType = "wait";
            break;
          }
        }
      }

      // Beat 25 (expects "open"): only a real name and address finishes the call
      if (currentBeatObj?.expects === "open" && state.current_beat === BEATS.length) {
        if (!isVerificationAnswer(customerTranscript)) {
          state.verify_misses = (state.verify_misses || 0) + 1;
          if (state.verify_misses >= 2) {
            // Two non-answers: defer to the paperwork and close, without saying anything was finalized
            state.verification_deferred = true;
            textToSpeak = VERIFY_DEFER_LINE;
            beatType = "stop";
            onScriptComplete(state);
          } else {
            textToSpeak = VERIFY_REASK_LINE;
            beatType = "wait";
          }
          break;
        }
        state.verify_misses = 0;
        reportedIntent = "provided_details";
      }

      // Beat 23 (expects "open"): "Which two of those do you see the most value in?". A bare yes is
      // not an answer, so re-ask; named coverages are remembered for Beat 24's confirmation.
      if (currentBeatObj?.expects === "open" && state.current_beat === 23 && /which two|most important to you|would you like to keep/i.test(state.last_spoken_text)) {
        const reply = customerTranscript.toLowerCase().replace(/[^a-z0-9 ]/g, " ").trim();
        if (isBareAck(reply)) {
          textToSpeak = "Which two of those do you see the most value in?";
          beatType = "wait";
          break;
        }
        // A removal is not a selection: never confirm it as chosen and never reprice; ask what to keep
        if (EXCLUSION.test(reply)) {
          state.excluded_coverages = namedCoverages(reply);
          textToSpeak = KEEP_COVERAGES_REASK_LINE;
          beatType = "wait";
          break;
        }
        state.chosen_coverages = NAMES_ALL_COVERAGES.test(reply) ? COVERAGES.map((c) => c.label) : namedCoverages(reply);
      }

      state.no_count_in_a_row = 0;
      state.ungrounded_count = 0;
      let nextBeatId = state.current_beat + 1;

      // If customer explicitly accepts the offer at Beat 22, jump directly to Beat 24 (confirmation), skipping negotiation (Beat 23)
      if (state.current_beat === 22) {
        const norm = customerTranscript.toLowerCase();
        if (norm.includes("works for me") || norm.includes("that works") || norm.includes("i'll take it") || norm.includes("ill take it") || norm.includes("deal")) {
          nextBeatId = 24;
        }
      }

      // The customer just said yes to a finalize question that named a price (the floor line, or
      // "I can bring that down to ... Does that sound fair?"). Speak Beat 24's confirmation without
      // asking "Are you ready to finalize?" a second time, and carry straight on into Beat 25's
      // verification. Beat 23's own "sound fair?" (about which coverages matter) names no price, so a
      // yes to it is not price acceptance and Beat 24 still asks.
      const lastAsk = state.last_spoken_text;
      const acceptedPricedFinalize =
        /(ready to finalize[^?]*\?|sound fair\?|get you locked in\.)\s*$/i.test(lastAsk) && /dollars/i.test(lastAsk);
      if (state.current_beat === 23 && acceptedPricedFinalize) {
        state.finalize_confirmed = true;
        const beat24 = BEATS.find((b) => b.id === 24)!;
        const beat25 = BEATS.find((b) => b.id === 25)!;
        state.delivered_beats.push(24, 25);
        state.current_beat = 25;
        const confirmation = formatSpeechText(renderBeatText(beat24, state.dealConfig, state));
        textToSpeak = `${confirmation} ${getFullBeatUtterance(beat25, state.dealConfig, state)}`;
        beatType = beat25.type;
        toolCalls = getBeatToolCalls(24);
        break;
      }

      // Check if finished all script beats
      if (nextBeatId > BEATS.length) {
        state.is_stopped = true;
        textToSpeak = SCRIPT_COMPLETE_LINE;
        beatType = "stop";
        toolCalls = [{ name: "show_content", args: { item: "deal_summary" } }];
        onScriptComplete(state);
        break;
      }

      // If customer is in an impatient flow, skip redundant recaps (Beats 20 & 21) and go directly to Beat 22
      if (state.is_impatient_flow && state.current_beat >= 18 && nextBeatId < 22) {
        nextBeatId = 22;
      }
      state.current_beat = nextBeatId;
      state.delivered_beats.push(nextBeatId);
      const nextBeat = BEATS.find((b) => b.id === nextBeatId)!;
      const baseUtterance = getFullBeatUtterance(nextBeat, state.dealConfig, state);
      // Skip the bridge when the beat already opens with a connective ("Now, And the first...")
      const opensWithConnective = /^\W*(and|now|but|that['’]?s|so|also)\b/i.test(baseUtterance);
      const bridge = opensWithConnective ? undefined : BEAT_TRANSITION_BRIDGES[nextBeatId];
      textToSpeak = bridge ? `${bridge} ${baseUtterance}` : baseUtterance;
      beatType = nextBeat.type;
      toolCalls = getBeatToolCalls(nextBeatId);
      break;
    }

    case "no": {

      // Beat 2: Did you get a chance to drive the vehicle?
      if (state.current_beat === 2) {
        const norm = customerTranscript.toLowerCase();
        const isNotDriven =
          norm.includes("didn't drive") ||
          norm.includes("did not drive") ||
          norm.includes("didnt drive") ||
          norm.includes("haven't driven") ||
          norm.includes("havent driven") ||
          norm.includes("didn't get a chance") ||
          norm.includes("didnt get a chance") ||
          norm.includes("did not get a chance") ||
          norm.includes("not yet") ||
          norm.includes("never drove") ||
          norm.includes("didn't") ||
          norm.includes("didnt") ||
          norm.includes("haven't") ||
          norm.includes("havent") ||
          (!mockClassification && (norm === "no" || norm === "nope" || norm.startsWith("no ")));

        if (isNotDriven) {
          state.no_count_in_a_row = 0;
          state.current_beat = 4;
          if (!state.delivered_beats.includes(2)) state.delivered_beats.push(2);
          if (!state.delivered_beats.includes(3)) state.delivered_beats.push(3); // Walkaround skipped since not driven
          state.delivered_beats.push(4);
          const beat4 = BEATS.find((b) => b.id === 4)!;
          const beat4Utterance = getFullBeatUtterance(beat4, state.dealConfig, state);
          textToSpeak = `No problem, thanks for letting me know. ${beat4Utterance}`;
          beatType = beat4.type;
          toolCalls = getBeatToolCalls(4);
          break;
        }
      }

      // Beat 3: Did salesperson do the walkaround?
      if (state.current_beat === 3) {
        state.no_count_in_a_row = 0;
        state.current_beat = 4;
        state.delivered_beats.push(4);
        const beat4 = BEATS.find((b) => b.id === 4)!;
        const beat4Utterance = getFullBeatUtterance(beat4, state.dealConfig);
        textToSpeak = `No problem, thanks for letting me know. ${beat4Utterance}`;
        beatType = beat4.type;
        toolCalls = getBeatToolCalls(4);
        break;
      }

      // Beat 4: Did salesperson go over the warranty?
      // TXM Branching logic on Q3:
      // If customer says No: "Allow me to go over it really quick to make sure that you understand everything. Also, if you have any questions, please do not hesitate to stop me and ask me."
      // Followed immediately by transitioning to the warranty presentation (Beat 6) and displaying warranty terms.
      if (state.current_beat === 4) {
        state.no_count_in_a_row = 0;
        state.current_beat = 6;
        if (!state.delivered_beats.includes(5)) state.delivered_beats.push(5);
        state.delivered_beats.push(6);
        const beat6 = BEATS.find((b) => b.id === 6)!;
        const beat6Utterance = getFullBeatUtterance(beat6, state.dealConfig);
        textToSpeak = `Allow me to go over it really quick to make sure that you understand everything. Also, if you have any questions, please do not hesitate to stop me and ask me. ${beat6Utterance}`;
        beatType = beat6.type;
        toolCalls = getBeatToolCalls(6);
        break;
      }

      // Beat 5: "There is actually more information... Is that okay?"
      if (state.current_beat === 5) {
        state.no_count_in_a_row = 0;
        state.current_beat = 6;
        state.delivered_beats.push(6);
        const beat6 = BEATS.find((b) => b.id === 6)!;
        const beat6Utterance = getFullBeatUtterance(beat6, state.dealConfig);
        textToSpeak = `I completely understand and I respect your time! By law, before you sign, I'm just required to go over what the manufacturer warranty does and doesn't cover so there are no surprises. Allow me to go over it really quick with you. ${beat6Utterance}`;
        beatType = beat6.type;
        toolCalls = getBeatToolCalls(6);
        break;
      }

      state.no_count_in_a_row++;
      if (state.no_count_in_a_row >= 2) {
        // Beat 1 is the recording disclosure: refusing it twice withholds consent, so the call ends
        // exactly like a recording objection. Moving on would continue a recorded call without consent.
        if (state.current_beat === 1) {
          textToSpeak = "I understand. I'll end this session now.";
          beatType = "stop";
          onScriptComplete(state);
          break;
        }
        // After 2 in a row, respect it and move on to the next beat (there is no human handoff)
        state.no_count_in_a_row = 0;
        const nextBeatId = state.current_beat + 1;
        if (nextBeatId > BEATS.length) {
          textToSpeak = `${REPEATED_NO_LINE} ${SCRIPT_COMPLETE_LINE}`;
          beatType = "stop";
          toolCalls = [{ name: "show_content", args: { item: "deal_summary" } }];
          onScriptComplete(state);
          break;
        }
        state.current_beat = nextBeatId;
        state.delivered_beats.push(nextBeatId);
        const nextBeat = BEATS.find((b) => b.id === nextBeatId)!;
        textToSpeak = `${REPEATED_NO_LINE} ${getFullBeatUtterance(nextBeat, state.dealConfig, state)}`;
        beatType = nextBeat.type;
        toolCalls = getBeatToolCalls(nextBeatId);
      } else {
        // Speak lead-in line LEAD_IN_NO, then the same beat once more plus its check-in
        const currentBeat = BEATS.find((b) => b.id === state.current_beat)!;
        const beatUtterance = getFullBeatUtterance(currentBeat, state.dealConfig);
        textToSpeak = `${LEAD_IN_NO} ${beatUtterance}`;
        beatType = currentBeat.type;
      }
      break;
    }

    case "question_in_script": {
      // Speak only the focused sentence(s) from the primary beat in topic_beat_ids.
      // If a beat was already delivered, speak only its concise recap, never repeat the full paragraph or multiple recaps.
      const ids = topic_beat_ids.length > 0 ? topic_beat_ids : [state.current_beat];
      // Pick the first undelivered beat if any, otherwise the primary matched beat
      const undeliveredId = ids.find((id) => !state.delivered_beats.includes(id));
      const targetId = undeliveredId || ids[0];

      let responseText = "";
      if (state.delivered_beats.includes(targetId)) {
        responseText = BEAT_RECAPS[targetId] || "As a quick reminder, that coverage is fully included in your protection package.";
      } else {
        const beatObj = BEATS.find((b) => b.id === targetId);
        if (beatObj) {
          responseText = formatSpeechText(renderBeatText(beatObj, state.dealConfig));
          state.delivered_beats.push(targetId);
        } else {
          responseText = BEAT_RECAPS[state.current_beat] || "As a quick reminder, that coverage is fully included in your package.";
        }
      }

      // Only append check-in if response doesn't already have one and customer is not in impatient flow
      if (!responseText.includes("?") && !state.is_impatient_flow) {
        responseText += ` Does that help clarify things?`;
      }

      textToSpeak = responseText;
      beatType = "wait";
      break;
    }

    case "question_out_of_script": {
      const g = await handleGroundedTurn(customerTranscript, state, BEATS.find((b) => b.id === state.current_beat)!, metrics);
      textToSpeak = g.text;
      beatType = g.beatType;
      toolCalls = g.toolCalls;
      break;
    }

    case "price_ask": {
      state.price_defer_count = (state.price_defer_count || 0) + 1;
      const norm = customerTranscript.toLowerCase();
      const isDemandingBottomLine =
        norm.includes("bottom line") ||
        norm.includes("exact cost") ||
        norm.includes("what is this wrap protection going to cost") ||
        norm.includes("tell me the price") ||
        norm.includes("what is the price") ||
        state.price_defer_count > 1;

      // If customer asks for price a second time OR explicitly demands bottom-line price,
      // DO NOT repeat DEFER_LINE! Skip educational beats and jump straight to the offer (Beat 22)!
      if (isDemandingBottomLine || state.current_beat >= 21) {
        state.current_beat = 22;
        state.delivered_beats.push(22);
        const beat22 = BEATS.find((b) => b.id === 22)!;
        const offerUtterance = getFullBeatUtterance(beat22, state.dealConfig, state);
        textToSpeak = `I hear you loud and clear—let's skip straight to your exact bottom line numbers. ${offerUtterance}`;
        beatType = "wait";
        toolCalls = getBeatToolCalls(22);
      } else {
        // First price ask before Beat 22: speak DEFER_LINE once, then advance
        const nextBeatId = state.current_beat + 1;
        state.current_beat = nextBeatId;
        state.delivered_beats.push(nextBeatId);
        const nextBeat = BEATS.find((b) => b.id === nextBeatId)!;
        const nextUtterance = getFullBeatUtterance(nextBeat, state.dealConfig, state);
        textToSpeak = `${DEFER_LINE} ${nextUtterance}`;
        beatType = nextBeat.type;
        toolCalls = getBeatToolCalls(nextBeatId);
      }
      break;
    }

    case "negotiate_price": {
      // Approved ladder: Stage 1 ($4.00) -> Stage 2 ($3.50) -> Stage 3 ($3.25) -> Stage 4 ($3.00 hard floor)
      // Any offer below $3.00 must trigger manager handoff!
      const norm = customerTranscript.toLowerCase();
      const numbersInText = norm.match(/\b\d+(\.\d+)?\b/g)?.map(Number) || [];
      const hasOfferBelowThree =
        numbersInText.some((n) => n > 0 && n < 3.0) ||
        norm.includes("two dollars") ||
        norm.includes("one dollar") ||
        norm.includes("two fifty") ||
        norm.includes("dollar fifty") ||
        norm.includes("1.50") ||
        norm.includes("2.50") ||
        norm.includes("2.00") ||
        norm.includes("20 dollars a month") ||
        norm.includes("twenty dollars") ||
        norm.includes("20 a month");

      if (hasOfferBelowThree) {
        state.concession_stage = 4;
        state.dealConfig.per_day_price = "three dollars";
        textToSpeak = FLOOR_PRICE_LINE;
        beatType = "wait";
        toolCalls = [{ name: "show_payment_breakdown", args: { daily_rate: 3.0 } }];
        break;
      }

      const currentStage = state.concession_stage || 1;

      // Customer names a price at or above what Max is currently offering ("how about three
      // fifty" right after Max offered $3.50): accept the current offer, never drop again.
      // Only a lower number or a push ("still too much", "lower") moves down the ladder.
      const currentOffer = CONCESSION_LADDER[currentStage] ?? 3.0;
      const namedPrice = parseNamedDailyPrice(customerTranscript);
      const isPushingLower =
        /too much|too high|too expensive|still|lower|cheaper|\bless\b|come down|do better|can t|cant|can't|\bno\b/.test(norm);
      if (namedPrice !== null && namedPrice >= currentOffer && !isPushingLower) {
        state.no_count_in_a_row = 0;
        state.current_beat = 24;
        state.delivered_beats.push(24);
        const beat24 = BEATS.find((b) => b.id === 24)!;
        textToSpeak = getFullBeatUtterance(beat24, state.dealConfig, state);
        beatType = beat24.type;
        toolCalls = getBeatToolCalls(24);
        break;
      }

      if (currentStage === 1) {
        state.concession_stage = 2;
        state.dealConfig.per_day_price = "three dollars and fifty cents";
        textToSpeak = "I understand. While four dollars is our standard rate, the best I can offer directly is three dollars and fifty cents a day. Which two coverages are most important to you?";
        beatType = "wait";
        toolCalls = [{ name: "show_payment_breakdown", args: { daily_rate: 3.5 } }];
        state.current_beat = 23;
      } else if (currentStage === 2) {
        state.concession_stage = 3;
        state.dealConfig.per_day_price = "three dollars and twenty-five cents";
        textToSpeak = "I want to make sure you get the right coverage. I can bring that down to three dollars and twenty-five cents a day. Does that sound fair?";
        beatType = "wait";
        toolCalls = [{ name: "show_payment_breakdown", args: { daily_rate: 3.25 } }];
        state.current_beat = 23;
      } else if (currentStage === 3) {
        state.concession_stage = 4;
        state.dealConfig.per_day_price = "three dollars";
        textToSpeak = "To make this work for you, three dollars a day is our absolute hard floor for full vehicle protection. Are you ready to finalize at three dollars a day?";
        beatType = "wait";
        toolCalls = [{ name: "show_payment_breakdown", args: { daily_rate: 3.0 } }];
        state.current_beat = 23;
      } else {
        // Floor breach / below $3 or pushing past stage 4
        state.concession_stage = 4;
        state.dealConfig.per_day_price = "three dollars";
        textToSpeak = FLOOR_PRICE_LINE;
        beatType = "wait";
        toolCalls = [{ name: "show_payment_breakdown", args: { daily_rate: 3.0 } }];
        state.current_beat = 23;
      }
      break;
    }

    case "garbled": {
      // Speak GARBLED_LINE once, listen again
      textToSpeak = GARBLED_LINE;
      beatType = "wait";
      break;
    }

    case "avatar_echo": {
      // Acoustic self-echo from laptop speakers: do NOT speak GARBLED_LINE (avoids echo loops).
      // Simply re-prompt the current beat or check-in without advancing state.current_beat.
      const currentBeat = BEATS.find((b) => b.id === state.current_beat);
      if (currentBeat) {
        const checkIn = currentBeat.check_in ? formatSpeechText(currentBeat.check_in) : "";
        if (checkIn && checkIn.split(/\s+/).length >= 3) {
          textToSpeak = checkIn;
        } else {
          textToSpeak = getFullBeatUtterance(currentBeat, state.dealConfig, state);
        }
        beatType = "wait";
      } else {
        textToSpeak = STEP_0_GREETING;
        beatType = "wait";
      }
      break;
    }

    case "repeat_request": {
      const norm = customerTranscript.toLowerCase();
      const isExplicitRepeat =
        isReExplainRequest(norm.replace(/[^a-z0-9 ]/g, " ")) ||
        norm.includes("repeat") ||
        norm.includes("again") ||
        norm.includes("what did you say") ||
        norm.includes("say that") ||
        norm.includes("say again") ||
        norm.includes("one more time") ||
        norm.includes("pardon") ||
        norm.includes("come again");

      if (state.current_beat === 2 && !isExplicitRepeat) {
        textToSpeak = "Just to confirm, did you get a chance to take it for a test drive, or have you not driven it yet?";
        beatType = "wait";
        break;
      }
      if (state.current_beat === 3 && !isExplicitRepeat) {
        textToSpeak = "Just to confirm, did the salesperson do the walkaround with you, or did they not get to that?";
        beatType = "wait";
        break;
      }
      const currentBeat = BEATS.find((b) => b.id === state.current_beat)!;
      textToSpeak = getFullBeatUtterance(currentBeat, state.dealConfig);
      beatType = currentBeat.type;
      break;
    }

    case "restart_request": {
      // Do not reset the pointer; offer to repeat only the last beat
      const currentBeat = BEATS.find((b) => b.id === state.current_beat)!;
      textToSpeak = getFullBeatUtterance(currentBeat, state.dealConfig);
      beatType = currentBeat.type;
      break;
    }

    case "human_request": {
      const norm = customerTranscript.toLowerCase();
      // Recording objection at Beat 1: the call cannot proceed without consent, so it ends.
      if (state.current_beat === 1 && (norm.includes("recorded") || norm.includes("recording"))) {
        textToSpeak = "I understand. I'll end this session now.";
        beatType = "stop";
        onScriptComplete(state);
        break;
      }
      // There is no human to hand off to: stay in character, hold the current beat, and let the
      // next turn continue the script normally.
      textToSpeak = HANDOFF_LINE;
      beatType = "wait";
      break;
    }

    case "hang_up": {
      state.is_stopped = true;
      textToSpeak = "I understand. I'll end this session now.";
      beatType = "stop";
      onScriptComplete(state);
      break;
    }

    case "pause_request": {
      // Customer asked to pause, hold on, or interjected to speak ("let me tell you", "listen")
      const norm = customerTranscript.toLowerCase();
      const isInterjection =
        norm.includes("let me tell you") ||
        norm.includes("let me speak") ||
        norm.includes("let me finish") ||
        norm.includes("let me complete") ||
        norm.includes("listen") ||
        norm.includes("hear me");
      textToSpeak = isInterjection ? LISTENING_LINE : PAUSE_LINE;
      // At Beat 23 keep the coverage question in front of the customer when they come back
      if (state.current_beat === 23) textToSpeak = `${textToSpeak} ${pendingQuestion(state)}`;
      beatType = "wait";
      toolCalls = [];
      break;
    }

    case "overwhelmed": {
      // Customer asked to slow down. Reassure and re-prompt current check-in without skipping
      const currentBeat = BEATS.find((b) => b.id === state.current_beat);
      const checkIn = currentBeat?.check_in ? formatSpeechText(currentBeat.check_in) : "";
      textToSpeak = checkIn ? `${SLOW_DOWN_LINE} ${checkIn}` : SLOW_DOWN_LINE;
      beatType = "wait";
      toolCalls = [];
      break;
    }

    case "compliment": {
      // Acknowledge vehicle compliments or laughter/humor, then re-ask the current beat's check-in.
      // Never advance (a compliment is not an answer, e.g. to the Beat 1 recording consent) and never end the call.
      const norm = customerTranscript.toLowerCase();
      const isLaughterOrHumor =
        norm.includes("haha") ||
        norm.includes("lol") ||
        (!norm.includes("not funny") && !norm.includes("isnt funny") && !norm.includes("isn t funny") && norm.includes("funny")) ||
        norm.includes("hilarious") ||
        norm.includes("crack me up");

      const leadIn = isLaughterOrHumor ? EQ_EXCITEMENT_LINE : COMPLIMENT_LINE;
      textToSpeak = `${leadIn} ${pendingQuestion(state)}`;
      beatType = "wait";
      break;
    }

    case "why_asking": {
      // "Why do you keep asking me that": re-ask only the current check-in, not the whole beat
      const currentBeat = BEATS.find((b) => b.id === state.current_beat)!;
      textToSpeak = getBeatCheckInQuestion(currentBeat);
      beatType = "wait";
      break;
    }

    case "language_request": {
      textToSpeak = LANGUAGE_LINE;
      beatType = "wait";
      break;
    }

    case "number_clarification": {
      // "You mean seven thousand?": answer from the knowledge base, hold the beat, re-ask its check-in.
      // Never re-recite the beat (that would repeat the number being questioned).
      const g = await handleGroundedTurn(customerTranscript, state, BEATS.find((b) => b.id === state.current_beat)!, metrics, true);
      textToSpeak = g.text;
      beatType = "wait";
      toolCalls = g.toolCalls;
      break;
    }

    case "classifier_timeout": {
      // The remote classifier was too slow: hold the beat rather than leave dead air or guess
      textToSpeak = CLARIFY_LINE;
      beatType = "wait";
      break;
    }

    case "customer_frustrated": {
      // De-escalate frustration, validate time respect, and advance when user requests speed
      state.no_count_in_a_row = (state.no_count_in_a_row || 0) + 1;
      const norm = customerTranscript.toLowerCase();

      // 1. Retail / Dealership markup objection
      if (norm.includes("markup") || norm.includes("ridiculous") || norm.includes("ripoff") || norm.includes("overpriced")) {
        textToSpeak = MARKUP_OBJECTION_LINE;
        beatType = "wait";
        toolCalls = [];
        break;
      }

      const wantsProgression =
        norm.includes("get to the point") ||
        norm.includes("point") ||
        norm.includes("move on") ||
        norm.includes("go ahead") ||
        norm.includes("cut to the chase") ||
        norm.includes("make it brief");

      if (wantsProgression && state.current_beat < BEATS.length) {
        state.is_impatient_flow = true;
        // If customer demands getting to the point during educational wear & tear (Beats 8-15),
        // skip the weather lecture and jump directly to protection options (Beat 16)!
        if (state.current_beat >= 6 && state.current_beat < 16) {
          state.current_beat = 16;
        } else {
          state.current_beat++;
        }
        state.delivered_beats.push(state.current_beat);
        const nextBeat = BEATS.find((b) => b.id === state.current_beat)!;
        const nextUtterance = getFullBeatUtterance(nextBeat, state.dealConfig, state);
        textToSpeak = `Understood, getting straight to it. ${nextUtterance}`;
        beatType = nextBeat.type;
        toolCalls = getBeatToolCalls(state.current_beat);
      } else {
        state.is_impatient_flow = true;
        textToSpeak = EQ_DEESCALATION_LINE;
        beatType = "wait";
        toolCalls = [];
      }
      break;
    }

    case "customer_anxious": {
      // Reassure anxiety and doubt, zero-pressure psychological safety, re-prompt current beat check-in
      const currentBeat = BEATS.find((b) => b.id === state.current_beat);
      const checkIn = currentBeat?.check_in ? formatSpeechText(currentBeat.check_in) : "";
      textToSpeak = checkIn ? `${EQ_REASSURANCE_LINE} ${checkIn}` : EQ_REASSURANCE_LINE;
      beatType = "wait";
      toolCalls = [];
      break;
    }

    case "identity_question": {
      // Customer asked who Max is. Answer clearly, and re-prompt current beat without advancing!
      const currentBeat = BEATS.find((b) => b.id === state.current_beat);
      if (currentBeat) {
        const checkInOrUtterance = currentBeat.check_in
          ? `${IDENTITY_LINE} ${formatSpeechText(currentBeat.check_in)}`
          : `${IDENTITY_LINE} ${getFullBeatUtterance(currentBeat, state.dealConfig)}`;
        textToSpeak = checkInOrUtterance;
        beatType = currentBeat.type;
        toolCalls = getBeatToolCalls(state.current_beat);
      } else {
        textToSpeak = IDENTITY_LINE;
        beatType = "wait";
      }
      break;
    }

    case "sales_question": {
      // Customer asked if this is a sales call. Reassure directly and re-prompt current beat without advancing!
      const currentBeat = BEATS.find((b) => b.id === state.current_beat);
      if (currentBeat) {
        const checkInOrUtterance = currentBeat.check_in
          ? `${SALES_CALL_LINE} ${formatSpeechText(currentBeat.check_in)}`
          : `${SALES_CALL_LINE} ${getFullBeatUtterance(currentBeat, state.dealConfig)}`;
        textToSpeak = checkInOrUtterance;
        beatType = currentBeat.type;
        toolCalls = getBeatToolCalls(state.current_beat);
      } else {
        textToSpeak = SALES_CALL_LINE;
        beatType = "wait";
      }
      break;
    }

    case "call_purpose": {
      // Customer asked why they are having this call. Answer clearly and re-prompt current beat without advancing!
      const currentBeat = BEATS.find((b) => b.id === state.current_beat);
      if (currentBeat) {
        const checkInOrUtterance = currentBeat.check_in
          ? `${CALL_PURPOSE_LINE} ${formatSpeechText(currentBeat.check_in)}`
          : `${CALL_PURPOSE_LINE} ${getFullBeatUtterance(currentBeat, state.dealConfig)}`;
        textToSpeak = checkInOrUtterance;
        beatType = currentBeat.type;
        toolCalls = getBeatToolCalls(state.current_beat);
      } else {
        textToSpeak = CALL_PURPOSE_LINE;
        beatType = "wait";
      }
      break;
    }

    case "greeting_check": {
      // Customer checked presence mid-call ("hey", "hello", "are you there").
      // Reassure presence and re-prompt current beat WITHOUT advancing the script!
      const currentBeat = BEATS.find((b) => b.id === state.current_beat);
      if (currentBeat) {
        // Answer, then re-ask the question Max is waiting on, so the next "yeah" answers that question
        textToSpeak = `${PRESENCE_LINE} ${pendingQuestion(state)}`;
        beatType = "wait";
        toolCalls = getBeatToolCalls(state.current_beat);
      } else {
        textToSpeak = "I'm right here with you! Can you hear and see me alright?";
        beatType = "wait";
      }
      break;
    }

    case "ai_question": {
      // Speak AI_DISCLOSURE_LINE, hold current beat, re-prompt check-in
      const currentBeat = BEATS.find((b) => b.id === state.current_beat);
      if (currentBeat) {
        textToSpeak = `${AI_DISCLOSURE_LINE} ${pendingQuestion(state)}`;
        beatType = "wait";
        toolCalls = [];
      } else {
        textToSpeak = `${AI_DISCLOSURE_LINE} Can you hear and see me alright?`;
        beatType = "wait";
        toolCalls = [];
      }
      break;
    }

    case "tech_check_ack": {
      // Customer confirmed tech check / video / audio status.
      // Do NOT advance script beats. Re-prompt current beat question politely.
      const currentBeat = BEATS.find((b) => b.id === state.current_beat);
      if (currentBeat) {
        const currentUtterance = getFullBeatUtterance(currentBeat, state.dealConfig);
        textToSpeak = `Great! ${currentUtterance}`;
        beatType = currentBeat.type;
      } else {
        textToSpeak = "Great, glad the audio and video are working well!";
        beatType = "wait";
      }
      break;
    }

    case "spouse_objection": {
      const currentBeat = BEATS.find((b) => b.id === state.current_beat);
      const checkIn = currentBeat?.check_in ? formatSpeechText(currentBeat.check_in) : "";
      textToSpeak = checkIn ? `${SPOUSE_LINE} ${checkIn}` : SPOUSE_LINE;
      beatType = "wait";
      break;
    }

    case "insurance_question": {
      const currentBeat = BEATS.find((b) => b.id === state.current_beat);
      const checkIn = currentBeat?.check_in ? formatSpeechText(currentBeat.check_in) : "";
      textToSpeak = checkIn ? `${INSURANCE_LINE} ${checkIn}` : INSURANCE_LINE;
      beatType = "wait";
      break;
    }

    case "cancellation_question": {
      const currentBeat = BEATS.find((b) => b.id === state.current_beat);
      const checkIn = currentBeat?.check_in ? formatSpeechText(currentBeat.check_in) : "";
      textToSpeak = checkIn ? `${CANCELLATION_LINE} ${checkIn}` : CANCELLATION_LINE;
      beatType = "wait";
      break;
    }

    case "vehicle_discrepancy": {
      // Customer stated they are buying a different vehicle or that the car model is incorrect
      const norm = customerTranscript.toLowerCase();
      let extractedModel = "";
      if (norm.includes("maybach")) extractedModel = "Maybach";
      else if (norm.includes("mercedes")) extractedModel = "Mercedes";
      else if (norm.includes("bmw")) extractedModel = "BMW";
      else if (norm.includes("audi")) extractedModel = "Audi";
      else if (norm.includes("porsche")) extractedModel = "Porsche";
      else if (norm.includes("lexus")) extractedModel = "Lexus";
      else if (norm.includes("ford")) extractedModel = "Ford";
      else if (norm.includes("toyota")) extractedModel = "Toyota";
      else if (norm.includes("honda")) extractedModel = "Honda";
      else if (norm.includes("kia")) extractedModel = "Kia";
      else if (norm.includes("hyundai")) extractedModel = "Hyundai";
      if (!extractedModel) {
        // "It's a CX-30, not a CX-5": take the CX model that is not the one on file
        const onFile = state.dealConfig.vehicle_model.toLowerCase();
        const named = [...norm.matchAll(/\bcx\s*-?\s*(\d+)/g)].map((m) => `CX-${m[1]}`);
        extractedModel = named.find((m) => m.toLowerCase() !== onFile) ?? "";
      }

      if (extractedModel) {
        state.dealConfig.vehicle_model = extractedModel;
        state.dealConfig.vehicle_make = extractedModel === "Maybach" ? "Mercedes-Maybach" : state.dealConfig.vehicle_make;
      }

      const vehicleName = extractedModel || "correct vehicle";
      const discrepancyLine = VEHICLE_DISCREPANCY_LINE.replace(/\{\{vehicle_model\}\}/g, vehicleName);
      if (state.current_beat === 2) {
        // The line ends by re-asking Beat 2's test-drive question
        textToSpeak = discrepancyLine;
      } else {
        // Any other beat: keep the acknowledgement, drop the test-drive question, re-ask where we are
        const ack = discrepancyLine.split(" — ")[0];
        textToSpeak = `${ack}. ${getBeatCheckInQuestion(BEATS.find((b) => b.id === state.current_beat)!)}`;
      }
      beatType = "wait";
      toolCalls = [];
      break;
    }

    case "manufacturer_vs_dealer": {
      // Customer asked whether warranty/coverage is from manufacturer or dealership, or if they should buy a new warranty
      textToSpeak = MANUFACTURER_VS_DEALER_LINE;
      beatType = "wait";
      toolCalls = [];
      break;
    }

    case "other":
    default: {
      const norm = customerTranscript.toLowerCase();
      if (state.current_beat === 22) {
        if (norm.includes("per day") || norm.includes("per month") || norm.includes("day or month")) {
          textToSpeak = UNIT_PRICE_LINE;
          beatType = "wait";
          toolCalls = [];
          break;
        }
        if (norm.includes("total") || norm.includes("what is the total") || norm.includes("whats the total") || norm.includes("what s the total")) {
          textToSpeak = TOTAL_PRICE_LINE;
          beatType = "wait";
          toolCalls = [];
          break;
        }
        if (norm.includes("think") || norm.includes("kids") || norm.includes("children")) {
          textToSpeak = THINK_ABOUT_IT_LINE;
          beatType = "wait";
          toolCalls = [];
          break;
        }
        if (norm.includes("drop") || norm.includes("drop the tires") || norm.includes("without tires")) {
          textToSpeak = DROP_COVERAGE_LINE;
          beatType = "wait";
          toolCalls = [];
          break;
        }
      }

      if (state.current_beat === 17) {
        if (norm.includes("own tire") || norm.includes("don t need tire") || norm.includes("dont need tire") || norm.includes("without tire")) {
          textToSpeak = TIRE_EXCLUSION_LINE;
          beatType = "wait";
          toolCalls = [];
          break;
        }
      }

      if (state.current_beat === 18) {
        if (norm.includes("own oil") || norm.includes("my own") || norm.includes("don t need maintenance") || norm.includes("dont need maintenance")) {
          textToSpeak = MAINTENANCE_EXCLUSION_LINE;
          beatType = "wait";
          toolCalls = [];
          break;
        }
      }

      if (state.current_beat === 19 && (norm.includes("not funny") || norm.includes("isnt funny") || norm.includes("isn t funny"))) {
        textToSpeak = NOT_FUNNY_LINE;
        beatType = "wait";
        toolCalls = [];
        break;
      }

      const g = await handleGroundedTurn(customerTranscript, state, BEATS.find((b) => b.id === state.current_beat)!, metrics);
      textToSpeak = g.text;
      beatType = g.beatType;
      toolCalls = g.toolCalls;
      break;
    }
  }

  state.last_spoken_text = textToSpeak;
  const askedNow = lastQuestionOf(textToSpeak);
  if (askedNow) state.last_question = askedNow;

  return {
    textToSpeak,
    beatId: state.current_beat,
    beatType,
    toolCalls,
    state,
    intent: reportedIntent,
    isScriptComplete: state.is_stopped,
  };
}
