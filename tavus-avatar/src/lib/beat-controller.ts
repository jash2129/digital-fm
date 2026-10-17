import beatsData from "./beats.json";
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
  SLOW_DOWN_LINE,
  COMPLIMENT_LINE,
  IDENTITY_LINE,
} from "./max-lines";

export interface Beat {
  id: number;
  type: "wait" | "continue";
  text: string;
  check_in: string | null;
}

export const BEATS: Beat[] = beatsData as Beat[];

export interface CallState {
  current_beat: number;
  delivered_beats: number[];
  last_spoken_text: string;
  no_count_in_a_row: number;
  negotiated_price_so_far: number | null;
  step0_turns: number;
  step0_completed: boolean;
  dealConfig: DealConfig;
  is_stopped: boolean;
}

export type ClassifierIntent =
  | "agree"
  | "no"
  | "question_in_script"
  | "question_out_of_script"
  | "price_ask"
  | "garbled"
  | "avatar_echo"
  | "repeat_request"
  | "restart_request"
  | "human_request"
  | "ai_question"
  | "tech_check_ack"
  | "pause_request"
  | "overwhelmed"
  | "compliment"
  | "identity_question"
  | "other";

export interface ClassificationResult {
  intent: ClassifierIntent;
  topic_beat_ids: number[];
}

export interface ControllerDecision {
  textToSpeak: string;
  beatId: number;
  beatType: "wait" | "continue" | "stop";
  toolCalls: Array<{ name: string; args: Record<string, any> }>;
  state: CallState;
  intent: ClassifierIntent | "step0" | "greeting";
  isScriptComplete?: boolean;
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

export function getOrCreateCallState(sessionId: string, dealConfig = DEFAULT_DEAL_CONFIG): CallState {
  if (!activeStates.has(sessionId)) {
    activeStates.set(sessionId, {
      current_beat: 0,
      delivered_beats: [],
      last_spoken_text: STEP_0_GREETING,
      no_count_in_a_row: 0,
      negotiated_price_so_far: null,
      step0_turns: 0,
      step0_completed: false,
      dealConfig,
      is_stopped: false,
    });
  }
  return activeStates.get(sessionId)!;
}

export function resetCallState(sessionId: string): void {
  activeStates.delete(sessionId);
}

// Render raw beat text with placeholders replaced by deal variables
export function renderBeatText(beat: Beat, dealConfig: DealConfig): string {
  let rendered = beat.text;
  rendered = rendered.replace(/\{\{vehicle_year\}\}/g, dealConfig.vehicle_year);
  rendered = rendered.replace(/\{\{vehicle_make\}\}/g, dealConfig.vehicle_make);
  rendered = rendered.replace(/\{\{vehicle_model\}\}/g, dealConfig.vehicle_model);
  rendered = rendered.replace(/\{\{per_day_price\}\}/g, dealConfig.per_day_price);
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
  clean = clean.replace(/\b110 degree\b/gi, "110 degrees");
  clean = clean.replace(/\bsecond of is\b/gi, "second warranty is");

  return clean.trim();
}

// Formats full utterance for a beat: beat text + check-in line with natural conversational pause
export function getFullBeatUtterance(beat: Beat, dealConfig: DealConfig): string {
  const rendered = renderBeatText(beat, dealConfig);
  const cleanBody = formatSpeechText(rendered);
  if (beat.check_in) {
    const cleanCheckIn = formatSpeechText(beat.check_in);
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
      return [{ name: "show_payment_breakdown", args: { daily_rate: 4 } }];
    default:
      return [];
  }
}

// Hook called when script reaches end of Beat 22
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

  const echoPhrases = [
    "great to connect with you",
    "congratulations on your",
    "thank you for buying with us",
    "handling your paperwork",
    "how has your experience been",
    "recorded audio and video",
    "required by the law",
    "before you sign any paperwork",
    "make sure you understand first",
    "agreed to buy a new",
    "chance to drive the vehicle",
    "walkaround and showed you",
    "bells and whistles",
    "builts and whistles",
    "understanding of the warranty",
    "what s your understanding",
    "whats your understanding",
    "warranty that comes with the vehicle",
    "did the sales person go over",
    "more information about the warranty",
    "base limited warranty",
    "power train which is referring",
    "defect only stated in the manual",
    "page number 4",
    "mis design or mis built",
    "ware and tear",
    "wear and tear",
    "climate road condition",
    "climate can go over 110",
    "potholes everywhere",
    "driving habits the way i drive",
    "service place and the first thing",
    "diagnose the vehicle",
    "reserve the right to determine",
    "engine by itself can cost",
    "luck of the draw",
    "sorry i didn t catch",
    "sorry i didn't catch",
    "allow me to go over it really quick",
    "cover that in just a moment",
    "colleague to cover right after",
    "bring in my colleague",
    "make a note of that for my colleague",
    "i'm an ai finance assistant",
    "take all the time you need",
    "let's slow down a bit",
    "i'm max your digital finance manager"
  ];

  return echoPhrases.some((phrase) => norm.includes(phrase));
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

  // 1. Human request
  if (
    norm.includes("speak to a human") ||
    norm.includes("talk to a person") ||
    norm.includes("real person") ||
    norm.includes("human manager") ||
    norm.includes("speak to someone else") ||
    norm.includes("transfer me")
  ) {
    return { intent: "human_request", topic_beat_ids: [] };
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

  // 2. AI Question
  if (
    norm.includes("are you an ai") ||
    norm.includes("are you a robot") ||
    norm.includes("are you real") ||
    norm.includes("are you an avatar") ||
    norm.includes("is this ai")
  ) {
    return { intent: "ai_question", topic_beat_ids: [] };
  }

  // 3. Restart request
  if (
    norm.includes("start over") ||
    norm.includes("from the beginning") ||
    norm.includes("restart")
  ) {
    return { intent: "restart_request", topic_beat_ids: [] };
  }

  // 4. Repeat request
  if (
    norm.includes("repeat that") ||
    norm.includes("say that again") ||
    norm.includes("say again") ||
    norm.includes("what did you say") ||
    norm.includes("one more time") ||
    norm.includes("come again")
  ) {
    return { intent: "repeat_request", topic_beat_ids: [] };
  }

  // 5. Price ask (before beat 22)
  if (
    norm.includes("how much") ||
    norm.includes("what is the price") ||
    norm.includes("what does it cost") ||
    norm.includes("how much is this") ||
    norm.includes("what is the monthly")
  ) {
    return { intent: "price_ask", topic_beat_ids: [] };
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
    norm.includes("cost of repair")
  ) {
    return { intent: "question_in_script", topic_beat_ids: [13, 14, 15] };
  }
  if (
    norm.includes("tire") ||
    norm.includes("wheel")
  ) {
    return { intent: "question_in_script", topic_beat_ids: [17] };
  }
  if (
    norm.includes("oil change") ||
    norm.includes("maintenance")
  ) {
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

  // 8. Explicit No
  if (
    norm === "no" ||
    norm === "nope" ||
    norm === "not really" ||
    norm === "i don t understand" ||
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

  // 8.6. Pause / Hold request (e.g. "wait a second", "hold on", "give me a moment", "let me think")
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
    norm.includes("hold up")
  ) {
    return { intent: "pause_request", topic_beat_ids: [] };
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

  // 8.8. Vehicle compliment / excitement (e.g. "I love this car", "beautiful vehicle", "drove like a dream")
  if (
    norm.includes("love this car") ||
    norm.includes("love the car") ||
    norm.includes("beautiful car") ||
    norm.includes("great car") ||
    norm.includes("drove like a dream") ||
    norm.includes("love the color") ||
    norm.includes("gorgeous car") ||
    norm.includes("amazing car") ||
    norm.includes("amazing vehicle")
  ) {
    return { intent: "compliment", topic_beat_ids: [] };
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

  // If the sentence starts with an affirmative anchor and has no questions/negations:
  const affirmativeAnchors = ["yes", "yeah", "yep", "yup", "yea", "sure", "ok", "okay", "alright", "right", "sounds good", "go on", "go ahead"];
  if (affirmativeAnchors.some((a) => norm === a || norm.startsWith(`${a} `))) {
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
    "definitely", "absolutely", "please", "ready", "set", "perfect", "true", "to", "me"
  ]);

  if (words.every((w) => affirmativeVocabulary.has(w))) {
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
- "no": Customer says no, disagrees, or indicates confusion ("no", "not really", "i don't get it").
- "question_in_script": Customer asks a question answered by vehicle warranty/protection script topics (coverage, wear and tear, repair costs, tires, oil changes).
- "question_out_of_script": Customer asks a question outside warranty/protection (e.g. APR, loan interest rate, trade-in, dealer doc fee).
- "price_ask": Customer asks what it costs, the price, or daily/monthly payment.
- "garbled": Inaudible, empty, or unintelligible words.
- "repeat_request": Customer explicitly asks Max to repeat what he said ("say that again", "what did you say?").
- "restart_request": Customer asks to restart from the very beginning.
- "human_request": Customer asks for a human manager or real person.
- "ai_question": Customer asks if Max is an AI / robot / real person.
- "pause_request": Customer asks to hold on, pause, or take a moment.
- "overwhelmed": Customer asks Max to slow down or expresses information overload.
- "compliment": Customer compliments the vehicle, features, or experience.
- "identity_question": Customer asks who Max is, what his name is, or who they are speaking with.
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
    });

    if (!res.ok) {
      return fastRuleResult;
    }

    const data = await res.json();
    const raw = data.choices?.[0]?.message?.content || "{}";
    const cleaned = raw.replace(/```json/gi, "").replace(/```/g, "").trim();
    const parsed = JSON.parse(cleaned);

    return {
      intent: parsed.intent || "other",
      topic_beat_ids: Array.isArray(parsed.topic_beat_ids) ? parsed.topic_beat_ids : [],
    };
  } catch (err) {
    console.warn("[beat-controller] LLM classification error, falling back to rule-based:", err);
    return fastRuleResult;
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
    norm.includes("can hear");

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

  // Turn 1 (or repeated tech acknowledgment): customer confirmed audio/video ("i can see you", "yes", etc.)
  // Build rapport & deliver formal greeting asking how their experience was
  if (step0Turns <= 1 || isTechAck) {
    let rapportText = STEP_0_RAPPORT_LINE;
    rapportText = rapportText.replace(/\{\{vehicle_year\}\}/g, dealConfig.vehicle_year);
    rapportText = rapportText.replace(/\{\{vehicle_make\}\}/g, dealConfig.vehicle_make);
    rapportText = rapportText.replace(/\{\{vehicle_model\}\}/g, dealConfig.vehicle_model);
    return {
      text: formatSpeechText(rapportText),
      moveToBeat1: false,
    };
  }

  // Turn 2: customer answered rapport question ("it was great", "good", "fine", etc.) -> smooth transition into Beat 1 Legal Disclosure
  return {
    text: STEP_0_TRANSITION_LINE,
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
    return OUT_OF_SCRIPT_LINE;
  }

  const isXai = Boolean(process.env.XAI_API_KEY);
  const endpoint = isXai ? "https://api.x.ai/v1/chat/completions" : "https://api.openai.com/v1/chat/completions";
  const model = process.env.GROK_MODEL?.trim() || (isXai ? "grok-4.20-0309-non-reasoning" : "gpt-4o-mini");

  const systemPrompt = `You are Max, a polite, focused Digital Finance Manager at a car dealership.
The customer asked an off-script question during their finance paperwork review.
Respond with EXACTLY ONE short, professional sentence (max 20 words) answering or acknowledging their question.

STRICT NEGATIVE CONSTRAINTS:
- NEVER quote, promise, or discuss specific interest rates (APR), monthly payments, loan terms, down payments, discounts, or trade-in values.
- NEVER make mechanical warranty guarantees beyond the manufacturer paperwork.
- NO filler words (do NOT start with "Sure", "Awesome", "Great question", "Got it", "Certainly", "Of course").
- Keep it natural, direct, and under 20 words.
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
      return OUT_OF_SCRIPT_LINE;
    }

    const data = await res.json();
    let reply = (data.choices?.[0]?.message?.content || "").trim();
    reply = formatSpeechText(reply);

    // Safety checks against rate/price promises in output
    const replyNorm = reply.toLowerCase();
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
    console.warn("[beat-controller] Dynamic off-script generation error, falling back to OUT_OF_SCRIPT_LINE:", err);
    return OUT_OF_SCRIPT_LINE;
  }
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
  const state = getOrCreateCallState(sessionId, dealConfig);

  // If already stopped after Beat 22 or handoff, speak HANDOFF_LINE and stop
  if (state.is_stopped) {
    return {
      textToSpeak: HANDOFF_LINE,
      beatId: state.current_beat,
      beatType: "stop",
      toolCalls: [],
      state,
      intent: "human_request",
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
  const classification = mockClassification || (await classifyWithLLM(customerTranscript, state));
  const { intent, topic_beat_ids } = classification;

  console.log(`[beat-controller] Turn Intent: "${intent}", Current Beat: ${state.current_beat}`);

  let textToSpeak = "";
  let beatType: "wait" | "continue" | "stop" = "wait";
  let toolCalls: Array<{ name: string; args: Record<string, any> }> = [];

  switch (intent) {
    case "agree": {
      state.no_count_in_a_row = 0;
      const nextBeatId = state.current_beat + 1;

      // Check if finished Beat 22
      if (nextBeatId > 22) {
        state.is_stopped = true;
        textToSpeak = HANDOFF_LINE;
        beatType = "stop";
        toolCalls = [{ name: "show_content", args: { item: "escalate" } }];
        onScriptComplete(state);
        break;
      }

      state.current_beat = nextBeatId;
      state.delivered_beats.push(nextBeatId);
      const nextBeat = BEATS.find((b) => b.id === nextBeatId)!;
      const baseUtterance = getFullBeatUtterance(nextBeat, state.dealConfig);
      const bridge = BEAT_TRANSITION_BRIDGES[nextBeatId];
      textToSpeak = bridge ? `${bridge} ${baseUtterance}` : baseUtterance;
      beatType = nextBeat.type;
      toolCalls = getBeatToolCalls(nextBeatId);
      break;
    }

    case "no": {
      state.no_count_in_a_row++;
      if (state.no_count_in_a_row >= 2) {
        // After 2 in a row, hand off using HANDOFF_LINE
        state.is_stopped = true;
        textToSpeak = HANDOFF_LINE;
        beatType = "stop";
        toolCalls = [{ name: "show_content", args: { item: "escalate" } }];
        onScriptComplete(state);
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
      // Speak only the sentence(s) from the beat(s) in topic_beat_ids, verbatim,
      // then the check-in of the current beat, then resume. Never summarize or rephrase.
      const matchedSentences: string[] = [];
      const ids = topic_beat_ids.length > 0 ? topic_beat_ids : [state.current_beat];

      for (const id of ids) {
        const beatObj = BEATS.find((b) => b.id === id);
        if (beatObj) {
          matchedSentences.push(formatSpeechText(renderBeatText(beatObj, state.dealConfig)));
        }
      }

      const currentBeat = BEATS.find((b) => b.id === state.current_beat);
      let combined = matchedSentences.join(" ");
      if (currentBeat?.check_in) {
        combined += ` ${formatSpeechText(currentBeat.check_in)}`;
      }

      textToSpeak = combined;
      beatType = "wait";
      break;
    }

    case "question_out_of_script": {
      // Generate constrained dynamic response with strict negative constraints (no pricing/rate promises), then resume
      const dynamicLeadIn = await generateConstrainedOffScriptResponse(customerTranscript, state);
      const nextBeatId = state.current_beat + 1;
      if (nextBeatId <= 22) {
        state.current_beat = nextBeatId;
        state.delivered_beats.push(nextBeatId);
        const nextBeat = BEATS.find((b) => b.id === nextBeatId)!;
        const nextUtterance = getFullBeatUtterance(nextBeat, state.dealConfig);
        textToSpeak = `${dynamicLeadIn} ${nextUtterance}`;
        beatType = nextBeat.type;
        toolCalls = getBeatToolCalls(nextBeatId);
      } else {
        textToSpeak = `${dynamicLeadIn} ${HANDOFF_LINE}`;
        state.is_stopped = true;
        beatType = "stop";
        toolCalls = [{ name: "show_content", args: { item: "escalate" } }];
      }
      break;
    }

    case "price_ask": {
      // Before Beat 22: speak DEFER_LINE, then resume
      if (state.current_beat < 22) {
        const nextBeatId = state.current_beat + 1;
        state.current_beat = nextBeatId;
        state.delivered_beats.push(nextBeatId);
        const nextBeat = BEATS.find((b) => b.id === nextBeatId)!;
        const nextUtterance = getFullBeatUtterance(nextBeat, state.dealConfig);
        textToSpeak = `${DEFER_LINE} ${nextUtterance}`;
        beatType = nextBeat.type;
        toolCalls = getBeatToolCalls(nextBeatId);
      } else {
        // At Beat 22: speak Beat 22 directly
        const beat22 = BEATS.find((b) => b.id === 22)!;
        textToSpeak = getFullBeatUtterance(beat22, state.dealConfig);
        beatType = "wait";
        toolCalls = getBeatToolCalls(22);
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
        textToSpeak = currentBeat.check_in
          ? formatSpeechText(currentBeat.check_in)
          : getFullBeatUtterance(currentBeat, state.dealConfig);
        beatType = "wait";
      } else {
        textToSpeak = STEP_0_GREETING;
        beatType = "wait";
      }
      break;
    }

    case "repeat_request": {
      // Resend the last beat once, verbatim
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
      // Speak HANDOFF_LINE and stop
      state.is_stopped = true;
      textToSpeak = HANDOFF_LINE;
      beatType = "stop";
      toolCalls = [{ name: "show_content", args: { item: "escalate" } }];
      onScriptComplete(state);
      break;
    }

    case "pause_request": {
      // Customer asked to pause or hold on. Respectfully acknowledge and retain current beat
      textToSpeak = PAUSE_LINE;
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
      // Acknowledge excitement and advance to next beat
      const nextBeatId = state.current_beat + 1;
      if (nextBeatId <= 22) {
        state.current_beat = nextBeatId;
        state.delivered_beats.push(nextBeatId);
        const nextBeat = BEATS.find((b) => b.id === nextBeatId)!;
        const nextUtterance = getFullBeatUtterance(nextBeat, state.dealConfig);
        textToSpeak = `${COMPLIMENT_LINE} ${nextUtterance}`;
        beatType = nextBeat.type;
        toolCalls = getBeatToolCalls(nextBeatId);
      } else {
        textToSpeak = `${COMPLIMENT_LINE} ${HANDOFF_LINE}`;
        state.is_stopped = true;
        beatType = "stop";
        toolCalls = [{ name: "show_content", args: { item: "escalate" } }];
      }
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

    case "ai_question": {
      // Speak AI_DISCLOSURE_LINE, then resume
      const nextBeatId = state.current_beat + 1;
      if (nextBeatId <= 22) {
        state.current_beat = nextBeatId;
        state.delivered_beats.push(nextBeatId);
        const nextBeat = BEATS.find((b) => b.id === nextBeatId)!;
        const nextUtterance = getFullBeatUtterance(nextBeat, state.dealConfig);
        textToSpeak = `${AI_DISCLOSURE_LINE} ${nextUtterance}`;
        beatType = nextBeat.type;
        toolCalls = getBeatToolCalls(nextBeatId);
      } else {
        textToSpeak = `${AI_DISCLOSURE_LINE} ${HANDOFF_LINE}`;
        state.is_stopped = true;
        beatType = "stop";
        toolCalls = [{ name: "show_content", args: { item: "escalate" } }];
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

    case "other":
    default: {
      // Prepared for everything: Answer customer's question or off-script comment directly,
      // then seamlessly bridge into the next undelivered beat
      let dynamicAnswer = "";
      const trimmed = customerTranscript.trim();
      if (trimmed.length > 2) {
        dynamicAnswer = await generateConstrainedOffScriptResponse(customerTranscript, state);
      }

      const nextBeatId = state.current_beat + 1;
      if (nextBeatId <= 22) {
        state.current_beat = nextBeatId;
        state.delivered_beats.push(nextBeatId);
        const nextBeat = BEATS.find((b) => b.id === nextBeatId)!;
        const nextUtterance = getFullBeatUtterance(nextBeat, state.dealConfig);
        textToSpeak = dynamicAnswer ? `${dynamicAnswer} ${nextUtterance}` : nextUtterance;
        beatType = nextBeat.type;
        toolCalls = getBeatToolCalls(nextBeatId);
      } else {
        textToSpeak = dynamicAnswer ? `${dynamicAnswer} ${HANDOFF_LINE}` : HANDOFF_LINE;
        state.is_stopped = true;
        beatType = "stop";
        toolCalls = [{ name: "show_content", args: { item: "escalate" } }];
      }
      break;
    }
  }

  state.last_spoken_text = textToSpeak;

  return {
    textToSpeak,
    beatId: state.current_beat,
    beatType,
    toolCalls,
    state,
    intent,
    isScriptComplete: state.is_stopped,
  };
}
