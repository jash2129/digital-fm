/**
 * Option C in ONE AI call (MAX_UNDERSTANDING=ai + MAX_SPEECH=ai): understand the customer and word
 * Max's reply together, instead of one call to understand and a second to word it (about 2 s of AI
 * time on those turns, the slowest in the 2026-11-21 latency comparison).
 *
 * The beat controller first works out, without AI and in a few milliseconds, the approved line every
 * possible meaning would lead to (beat-controller.ts, combinedTurn). The AI gets those options, picks
 * what the customer meant, and says the matching option in Max's own words:
 *
 *   line 1: {"meaning": "...", "option": "B", "topics": [], "confidence": 0.9, "reason": "..."}
 *   line 2+: only the words Max says
 *
 * The meaning goes through the same validator as AI-first understanding (menu only, confidence, never
 * "ending the call"), and the words through the same checker as Option C (nothing new, nothing
 * dropped). With streaming, the first sentence is sent once it passes "adds nothing new"; the rest
 * only after the whole reply passes. Locked options (fixed answers) are always said word for word.
 */
import { MEANINGS, MIN_CONFIDENCE, type Meaning } from "./ai-understanding";
import { checkAdditions, checkGenerated } from "./ai-speech";
import { llmTarget, streamChat, takeLeadSentences, tidy } from "./llm-stream";

export const AI_REPLY_TIMEOUT_MS = Number(process.env.AI_REPLY_TIMEOUT_MS) || 3000;

export interface ReplyOption {
  id: string;
  meanings: Meaning[];
  /** coverage-question topic beats this option recaps */
  topics: number[];
  /** the approved line the controller would say */
  draft: string;
  /** a fixed answer (AI question, human request, move-on ...): always said word for word */
  locked: boolean;
}

export interface CombinedContext {
  transcript: string;
  beatId: number;
  beatExpects: "statement" | "yes_no" | "open";
  lastSpoken: string;
  pendingQuestion: string;
  recentTurns: Array<{ customer: string; max: string }>;
  options: ReplyOption[];
  /** approved facts, when the customer asked something (allowed in the words, see ai-speech factsFor) */
  facts: string;
}

export function buildCombinedSystemPrompt(): string {
  const menu = Object.entries(MEANINGS)
    .map(([k, v]) => `- "${k}": ${v}`)
    .join("\n");
  return `You are Max, a warm, friendly finance manager at a car dealership, on a video call with a customer who just bought a car. Each turn you do two things.

1. Work out what the customer MEANS, from this menu:
${menu}
Judge the whole sentence in context, not single words ("No kidding, my brother had a transmission go out" is story_or_comment, not no). If unsure, give a low confidence.

2. Pick the OPTION listed for that meaning and say its reply the way a real person who was listening would:
- If the customer shared something, start with ONE short, genuine reaction in your own words (vary it). If they only said yes / okay, skip it or keep it to two or three words.
- Then say ALL of the option's reply: every fact, number and coverage name, in plain spoken English. Keep numbers exactly, in words as written.
- If the reply asks a question, end with that question and nothing after it.
- Never repeat the customer's own words or question back as if they were yours.
- If the customer asked something and APPROVED_FACTS answers it, you may answer in one or two sentences from those facts only.
- Never add a fact, number, price, cost, discount, promise, guarantee, refund, cancellation, insurance, legal or tax statement that is not in the reply or APPROVED_FACTS. Never say you are human. No lists, markdown or quotes.

Answer in exactly this shape:
Line 1: {"meaning": "<menu key>", "option": "<option id>", "topics": [], "confidence": 0.0-1.0, "reason": "<max 12 words>"}
Then a line break, then ONLY the words Max says.`;
}

const clip = (t: string, n: number) => (t.length > n ? `${t.slice(0, n)}…` : t);

export function buildCombinedUserMessage(ctx: CombinedContext): string {
  return JSON.stringify({
    beat: ctx.beatId,
    max_is: ctx.beatExpects === "statement" ? "explaining (statement)" : ctx.beatExpects === "yes_no" ? "asking a yes/no question" : "asking an open question",
    max_just_said: clip(ctx.lastSpoken, 400),
    question_max_is_waiting_on: ctx.pendingQuestion,
    recent_turns: ctx.recentTurns.slice(-3).map((t) => ({ customer: clip(t.customer, 200), max: clip(t.max, 240) })),
    customer_now: ctx.transcript,
    OPTIONS: ctx.options.map((o) => ({ option: o.id, for_meanings: o.meanings, ...(o.topics.length ? { topics: o.topics } : {}), reply: o.draft })),
    ...(ctx.facts ? { APPROVED_FACTS: ctx.facts } : {}),
  });
}

export interface ReplyHeader {
  meaning: Meaning;
  option: ReplyOption;
  confidence: number;
  reason: string;
}

/** Line 1, validated: a meaning on the menu, confident, not "ending the call", and an option for it */
export function parseReplyHeader(line: string, options: ReplyOption[]): ReplyHeader | { error: string } {
  const json = line.match(/\{[\s\S]*\}/)?.[0];
  if (!json) return { error: "no header" };
  let p: { meaning?: unknown; option?: unknown; confidence?: unknown; reason?: unknown };
  try {
    p = JSON.parse(json);
  } catch {
    return { error: "header not JSON" };
  }
  const meaning = p.meaning;
  if (typeof meaning !== "string" || !(meaning in MEANINGS)) return { error: `meaning off the menu: ${String(meaning)}` };
  if (meaning === "ending_call") return { error: "ending the call is the rules' decision" };
  const confidence = typeof p.confidence === "number" ? p.confidence : 0;
  if (confidence < MIN_CONFIDENCE) return { error: `low confidence ${confidence}` };
  // The option must be one listed for that meaning; if the id is wrong, the meaning decides
  const byId = options.find((o) => o.id === p.option && o.meanings.includes(meaning as Meaning));
  const option = byId ?? options.find((o) => o.meanings.includes(meaning as Meaning));
  if (!option) return { error: `no option for ${meaning}` };
  return { meaning: meaning as Meaning, option, confidence, reason: typeof p.reason === "string" ? clip(p.reason, 120) : "" };
}

export type CombinedOutcome =
  | {
      ok: true;
      header: ReplyHeader;
      /** what Max says: the AI's words if they passed, else the option's approved line (after any early part) */
      text: string;
      speech: "ai" | "script";
      speechReason: string;
      /** the first sentences already sent for speaking, if any */
      early?: string;
      ms: number;
    }
  | { ok: false; reason: string; ms: number };

/**
 * The one AI call. `onEarly` receives the first sentences once they pass the "adds nothing" check
 * (only for an unlocked option); the returned text always starts with them.
 */
export async function understandAndSpeak(
  ctx: CombinedContext,
  onEarly?: (text: string) => void,
  fetchImpl: typeof fetch = fetch
): Promise<CombinedOutcome> {
  const t0 = Date.now();
  const target = llmTarget();
  if (!target) return { ok: false, reason: "no AI key", ms: 0 };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AI_REPLY_TIMEOUT_MS);
  let raw = "";
  let header: ReplyHeader | null = null;
  let early: string | undefined;
  try {
    const stream = streamChat(
      {
        target,
        temperature: 0.6,
        maxTokens: 380,
        messages: [
          { role: "system", content: buildCombinedSystemPrompt() },
          { role: "user", content: buildCombinedUserMessage(ctx) },
        ],
        signal: controller.signal,
      },
      fetchImpl
    );
    for await (const delta of stream) {
      raw += delta;
      if (!header) {
        const nl = raw.indexOf("\n");
        const closed = raw.indexOf("}");
        if (nl < 0 && closed < 0) continue;
        const parsed = parseReplyHeader(raw.slice(0, nl >= 0 ? nl : closed + 1), ctx.options);
        if ("error" in parsed) return { ok: false, reason: `rejected: ${parsed.error}`, ms: Date.now() - t0 };
        header = parsed;
        if (header.option.locked) break; // a fixed answer: the words are not used
        continue;
      }
      if (!early && onEarly) {
        const words = raw.slice(raw.indexOf("}") + 1);
        const lead = takeLeadSentences(words);
        if (lead && checkAdditions(lead.lead, header.option.draft, ctx.facts, ctx.transcript).ok) {
          early = lead.lead;
          onEarly(early);
        }
      }
    }
  } catch (err) {
    if (!header) return { ok: false, reason: controller.signal.aborted ? `timeout ${AI_REPLY_TIMEOUT_MS}ms` : String((err as Error)?.message ?? "error"), ms: Date.now() - t0 };
    // The words were cut off: the meaning stands, the approved line is said (after any early part)
  } finally {
    clearTimeout(timer);
  }
  if (!header) return { ok: false, reason: "no header", ms: Date.now() - t0 };

  const draft = header.option.draft;
  const ms = Date.now() - t0;
  if (header.option.locked) return { ok: true, header, text: draft, speech: "script", speechReason: "fixed answer", ms };
  const words = tidy(raw.slice(raw.indexOf("}") + 1).replace(/^["']|["']$/g, ""));
  const check = words ? checkGenerated(words, draft, ctx.facts, ctx.transcript) : { ok: false, reason: "no words" };
  if (check.ok && (!early || words.startsWith(early))) return { ok: true, header, text: words, speech: "ai", speechReason: "ok", early, ms };
  const reason = `rejected: ${check.ok ? "early part changed" : check.reason}`;
  return { ok: true, header, text: early ? `${early} ${draft}` : draft, speech: "script", speechReason: reason, early, ms };
}
