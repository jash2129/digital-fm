/**
 * AI-first understanding (switch: MAX_UNDERSTANDING=ai).
 *
 * The keyword rules understand clear speech ("yes", "too expensive", "goodbye") but not people who do
 * not talk in keywords: in the automated batches the confused, rambling and distrustful customers
 * scored 2.8 / 4.0 / 3.0 out of 10 and mostly never reached the price. Here an AI reads the turn in
 * context (where Max is in the script, what he just asked, the last few turns) and picks what the
 * customer MEANT from a fixed menu. It never writes a word Max says: every meaning maps to an
 * existing intent, and the controller speaks the approved line for it.
 *
 * Guardrails:
 *  - the AI is only asked during the explaining part of the script (Beats 2-21), for replies of 4+
 *    words, and never when the rules already found something that must not be second-guessed
 *    (hang-up, a human / AI / language request, the vehicle, the price ...). Recording consent
 *    (Beat 1) and the whole price and close (Beats 22-25) stay rule-only;
 *  - a meaning off the menu, a low confidence, "ending the call", a timeout or an error all fall back
 *    to the rules' answer, so Max is never worse off than without the AI.
 *
 * Pure apart from the fetch: the caller (classifyWithLLM in beat-controller.ts) passes the context in.
 */
import type { ClassificationResult, ClassifierIntent } from "./beat-controller";

export const AI_UNDERSTANDING_TIMEOUT_MS = Number(process.env.AI_UNDERSTANDING_TIMEOUT_MS) || 1500;
export const MIN_CONFIDENCE = 0.6;

export function isAIFirstEnabled(): boolean {
  return (process.env.MAX_UNDERSTANDING ?? "").trim().toLowerCase() === "ai";
}

/** What the rules found that the AI must never override */
const TRUSTED_RULE_INTENTS = new Set<ClassifierIntent>([
  "hang_up",
  "human_request",
  "ai_question",
  "language_request",
  "vehicle_discrepancy",
  "restart_request",
  "avatar_echo",
  "tech_check_ack",
  "negotiate_price",
  "price_ask",
  "identity_question",
  "spouse_objection",
  "insurance_question",
  "cancellation_question",
  "provided_details",
  "number_clarification",
  "sales_question",
  "call_purpose",
  "why_asking",
  "manufacturer_vs_dealer",
  "greeting_check",
]);

export const AI_FIRST_BEATS = { from: 2, to: 21 };
const MIN_WORDS = 4;

export function shouldAskAI(transcript: string, beatId: number, ruleIntent: ClassifierIntent): boolean {
  if (!isAIFirstEnabled()) return false;
  if (beatId < AI_FIRST_BEATS.from || beatId > AI_FIRST_BEATS.to) return false;
  if (TRUSTED_RULE_INTENTS.has(ruleIntent)) return false;
  const words = transcript.trim().split(/\s+/).filter(Boolean);
  return words.length >= MIN_WORDS;
}

/** The menu: what the customer can mean, and the intent the controller already handles for it */
export const MEANINGS = {
  agree: "Says yes, agrees, or answers Max's question positively (also a yes wrapped in a longer sentence).",
  no: "Says no, or answers Max's question negatively (e.g. hasn't driven it yet).",
  coverage_question: "Asks about what the protection covers: warranty, wear and tear, repair or labor costs, bumper-to-bumper, tires and wheels, maintenance/oil changes.",
  other_question: "Asks any other factual question (cancelling, transferring, the loan, who the warranty company is, is it mandatory ...).",
  price_question: "Asks what it costs, the price, or the payment.",
  price_worry_early: "Worries about or pushes back on the cost before Max has given a price.",
  feels_pressured: "Feels pushed or sold to, says they do not want to be pressured or upsold.",
  trust_concern: "Distrust or worry: hidden fees, being tricked, extra charges later, whether it is a scam, fear of a mistake.",
  confused: "Does not understand what Max said or what it has to do with them, asks for it simpler.",
  role_question: "Asks who Max is or what his role / this call is for.",
  story_or_comment: "Tells a story or makes a remark (often about family, a past car, a repair) that is not a question and not a refusal.",
  frustrated: "Impatient or annoyed, wants Max to hurry up or get to the point.",
  overwhelmed: "Too much information, asks Max to slow down.",
  pause: "Asks Max to hold on or wait a moment.",
  compliment: "Compliments the car, Max or the experience, or laughs.",
  wants_human: "Asks for a human, a manager, or a real person.",
  asks_if_ai: "Asks whether Max is an AI, a robot, or a real person.",
  ending_call: "Wants to hang up or end the call.",
  unclear: "Too cut off or garbled to understand.",
} as const;
export type Meaning = keyof typeof MEANINGS;

const MEANING_TO_INTENT: Record<Exclude<Meaning, "story_or_comment" | "ending_call">, ClassifierIntent> = {
  agree: "agree",
  no: "no",
  coverage_question: "question_in_script",
  other_question: "question_out_of_script",
  price_question: "price_ask",
  price_worry_early: "early_price_objection",
  feels_pressured: "pressure_objection",
  trust_concern: "customer_anxious",
  confused: "confusion",
  role_question: "role_confusion",
  frustrated: "customer_frustrated",
  overwhelmed: "overwhelmed",
  pause: "pause_request",
  compliment: "compliment",
  wants_human: "human_request",
  asks_if_ai: "ai_question",
  unclear: "garbled",
};

// Which beat to recap for a coverage question (same table as the rule-based classifier's prompt)
const COVERAGE_TOPIC_BEATS = [6, 8, 9, 10, 13, 14, 15, 16, 17, 18];

export interface UnderstandingContext {
  transcript: string;
  beatId: number;
  /** "statement" = Max is explaining and only needs the customer to follow along */
  beatExpects: "statement" | "yes_no" | "open";
  beatText: string;
  lastSpoken: string;
  pendingQuestion: string;
  recentTurns: Array<{ customer: string; max: string }>;
  /** what the rules made of it (fallback) */
  ruleResult: ClassificationResult;
}

const clip = (t: string, n: number) => (t.length > n ? `${t.slice(0, n)}…` : t);

export function buildSystemPrompt(): string {
  const menu = Object.entries(MEANINGS)
    .map(([k, v]) => `- "${k}": ${v}`)
    .join("\n");
  return `You work out what a car buyer MEANS on a phone call with Max, a dealership finance manager who explains a vehicle protection package from a fixed script.
You never write anything Max says. You only pick the customer's meaning from this menu:
${menu}

Rules:
- Judge the whole sentence in context, not single words. "No kidding, my brother had a transmission go out" is a story_or_comment, not a no.
- "Yeah, but how do I know you won't add charges later?" is a trust_concern, not agree.
- "I don't get what the bumper thing has to do with me" is confused.
- When Max is explaining (expects "statement"), a story, remark or musing that is not a question or refusal is story_or_comment.
- When Max asked a yes/no question, a longer answer that clearly means yes is agree, and one that clearly means no is no.
- A question about coverage, repairs, tires or maintenance is coverage_question; set topic_beat_ids from: warranty overview [6]; wear and tear [8,9,10]; parts and labor costs [13,14,15]; bumper to bumper [16]; tires and wheels [17]; maintenance [18].
- If you are unsure, give a low confidence.

Reply with ONLY JSON: {"meaning": "<menu key>", "topic_beat_ids": [], "confidence": 0.0-1.0, "reason": "<max 12 words>"}`;
}

export function buildUserMessage(ctx: UnderstandingContext): string {
  return JSON.stringify({
    beat: ctx.beatId,
    max_is: ctx.beatExpects === "statement" ? "explaining (statement)" : ctx.beatExpects === "yes_no" ? "asking a yes/no question" : "asking an open question",
    beat_script: clip(ctx.beatText, 400),
    max_just_said: clip(ctx.lastSpoken, 400),
    question_max_is_waiting_on: ctx.pendingQuestion,
    recent_turns: ctx.recentTurns.slice(-3).map((t) => ({ customer: clip(t.customer, 200), max: clip(t.max, 200) })),
    customer_now: ctx.transcript,
  });
}

export interface AIUnderstanding extends ClassificationResult {
  meaning: Meaning;
  confidence: number;
  reason: string;
}

/** The validator: a reply the controller can act on, or null to keep the rules' answer */
export function parseUnderstanding(raw: string, ctx: Pick<UnderstandingContext, "beatId" | "beatExpects">): AIUnderstanding | null {
  const json = raw.match(/\{[\s\S]*\}/)?.[0];
  if (!json) return null;
  let parsed: { meaning?: unknown; topic_beat_ids?: unknown; confidence?: unknown; reason?: unknown };
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  const meaning = parsed.meaning;
  if (typeof meaning !== "string" || !(meaning in MEANINGS)) return null;
  const confidence = typeof parsed.confidence === "number" ? parsed.confidence : 0;
  if (confidence < MIN_CONFIDENCE) return null;
  // Ending the call is the rules' decision alone
  if (meaning === "ending_call") return null;
  const reason = typeof parsed.reason === "string" ? clip(parsed.reason, 120) : "";

  let intent: ClassifierIntent;
  if (meaning === "story_or_comment") {
    // While Max explains, a story means "carry on"; at a question it is acknowledged and re-asked
    intent = ctx.beatExpects === "statement" ? "agree" : "acknowledge";
  } else {
    intent = MEANING_TO_INTENT[meaning as keyof typeof MEANING_TO_INTENT];
  }
  const topics =
    intent === "question_in_script" && Array.isArray(parsed.topic_beat_ids)
      ? parsed.topic_beat_ids.filter((n): n is number => typeof n === "number" && COVERAGE_TOPIC_BEATS.includes(n))
      : [];
  return { intent, topic_beat_ids: topics, usedLLM: true, source: "ai", meaning: meaning as Meaning, confidence, reason };
}

/**
 * Ask the AI. Falls back to the rules' answer (ctx.ruleResult) on any problem; the result says which
 * one was used (source "ai" or "rules").
 */
export async function understandWithAI(ctx: UnderstandingContext, fetchImpl: typeof fetch = fetch): Promise<ClassificationResult> {
  const fallback = (why: string): ClassificationResult => ({ ...ctx.ruleResult, usedLLM: true, source: "rules", aiReason: why });
  const apiKey = process.env.XAI_API_KEY?.trim() || process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) return { ...ctx.ruleResult, source: "rules" };
  const isXai = Boolean(process.env.XAI_API_KEY?.trim());
  const endpoint = isXai ? "https://api.x.ai/v1/chat/completions" : "https://api.openai.com/v1/chat/completions";
  const model = process.env.GROK_MODEL?.trim() || (isXai ? "grok-4.20-0309-non-reasoning" : "gpt-4o-mini");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AI_UNDERSTANDING_TIMEOUT_MS);
  try {
    const res = await fetchImpl(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        temperature: 0,
        max_tokens: 120,
        messages: [
          { role: "system", content: buildSystemPrompt() },
          { role: "user", content: buildUserMessage(ctx) },
        ],
      }),
      signal: controller.signal,
    });
    if (!res.ok) return fallback(`http ${res.status}`);
    const data = await res.json();
    const raw: string = data.choices?.[0]?.message?.content ?? "";
    const understood = parseUnderstanding(raw, ctx);
    if (!understood) return fallback(`rejected: ${clip(raw.replace(/\s+/g, " "), 100)}`);
    return { ...understood, aiReason: `${understood.meaning} (${understood.confidence}): ${understood.reason}` };
  } catch {
    return fallback(controller.signal.aborted ? `timeout ${AI_UNDERSTANDING_TIMEOUT_MS}ms` : "error");
  } finally {
    clearTimeout(timer);
  }
}
