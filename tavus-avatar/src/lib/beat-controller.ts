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
  | "repeat_request"
  | "restart_request"
  | "human_request"
  | "ai_question"
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

// In-memory session state store for controller turns
const activeStates = new Map<string, CallState>();

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

// Clean quotes and bracket tags so HeyGen TTS speaks clean human sentences with zero artifacts
export function formatSpeechText(text: string): string {
  return text
    .replace(/^["'\s]+|["'\s]+$/g, "")
    .replace(/"\s*"/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Formats full utterance for a beat: beat text + check-in line (if present)
export function getFullBeatUtterance(beat: Beat, dealConfig: DealConfig): string {
  const rendered = renderBeatText(beat, dealConfig);
  const cleanBody = formatSpeechText(rendered);
  if (beat.check_in) {
    const cleanCheckIn = formatSpeechText(beat.check_in);
    return `${cleanBody} ${cleanCheckIn}`;
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
    norm.endsWith(" no")
  ) {
    return { intent: "no", topic_beat_ids: [] };
  }

  // 9. Explicit Agree / Affirm
  const agreeTokens = ["yes", "yeah", "yep", "sure", "ok", "okay", "right", "sounds good", "continue", "go on", "makes sense", "understood", "i understand", "with you"];
  if (agreeTokens.some((t) => norm === t || norm.startsWith(`${t} `) || norm.includes(` ${t} `) || norm.endsWith(` ${t}`))) {
    return { intent: "agree", topic_beat_ids: [] };
  }

  return { intent: "other", topic_beat_ids: [] };
}

// LLM Classifier using fast model with temperature: 0
export async function classifyWithLLM(
  customerTranscript: string,
  state: CallState
): Promise<ClassificationResult> {
  const apiKey = process.env.XAI_API_KEY?.trim() || process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    return classifyCustomerInputRuleBased(customerTranscript, state.current_beat);
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
      return classifyCustomerInputRuleBased(customerTranscript, state.current_beat);
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
    return classifyCustomerInputRuleBased(customerTranscript, state.current_beat);
  }
}

// Step 0 Natural Exchange Generator (max 2 short turns, strictly limited, no products/coverage/options)
export async function generateStep0Turn(
  customerTranscript: string,
  step0Turns: number
): Promise<{ text: string; moveToBeat1: boolean }> {
  // If user clearly confirms audio/video ("Yes, I can hear you", "All good", "Loud and clear")
  // or reached maximum 2 turns:
  if (step0Turns >= 1) {
    return {
      text: "",
      moveToBeat1: true,
    };
  }

  const norm = customerTranscript.toLowerCase();
  if (
    norm.includes("yes") ||
    norm.includes("yeah") ||
    norm.includes("hear you") ||
    norm.includes("see you") ||
    norm.includes("all good") ||
    norm.includes("loud and clear")
  ) {
    return {
      text: "",
      moveToBeat1: true,
    };
  }

  // Short natural greeting acknowledgment without products/coverage/options
  return {
    text: "Great to connect with you today.",
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
    const step0Result = await generateStep0Turn(customerTranscript, state.step0_turns);

    if (step0Result.moveToBeat1) {
      state.step0_completed = true;
      state.current_beat = 1;
      const beat1 = BEATS.find((b) => b.id === 1)!;
      const utterance = getFullBeatUtterance(beat1, state.dealConfig);
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
        onScriptComplete(state);
        break;
      }

      state.current_beat = nextBeatId;
      state.delivered_beats.push(nextBeatId);
      const nextBeat = BEATS.find((b) => b.id === nextBeatId)!;
      textToSpeak = getFullBeatUtterance(nextBeat, state.dealConfig);
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
      onScriptComplete(state);
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
      }
      break;
    }

    case "other":
    default: {
      // Speak nothing new, resume with the next undelivered beat
      const nextBeatId = state.current_beat + 1;
      if (nextBeatId <= 22) {
        state.current_beat = nextBeatId;
        state.delivered_beats.push(nextBeatId);
        const nextBeat = BEATS.find((b) => b.id === nextBeatId)!;
        textToSpeak = getFullBeatUtterance(nextBeat, state.dealConfig);
        beatType = nextBeat.type;
        toolCalls = getBeatToolCalls(nextBeatId);
      } else {
        textToSpeak = HANDOFF_LINE;
        state.is_stopped = true;
        beatType = "stop";
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
