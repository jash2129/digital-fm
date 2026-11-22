/**
 * AI speech, "Option C" (switch: MAX_SPEECH=ai). The script steers, the AI speaks, a checker guards.
 *
 * Testers said Max sounds like a recording: every word is a fixed line, he never reacts to what the
 * customer actually said. Here the beat controller still decides WHAT happens (which beat, which
 * approved line, which price) and hands that approved line to the AI as a draft. The AI says the same
 * thing in Max's own words: a short natural reaction to the customer, then all of the draft's content,
 * ending on the same question. When the customer asked something, it may also answer from the
 * approved knowledge base (all of it, no search).
 *
 * Guardrails:
 *  - only during the explaining part of the script (Beats 2-21). Step 0, the recording disclosure
 *    (Beat 1), the whole price and close (Beats 22-25), the closing and fixed answers (am I talking to
 *    an AI, a human, hang-up, move-on, vehicle correction ...) are always said word for word;
 *  - the checker (checkGenerated) rejects any number, price, make or risky claim that is not in the
 *    draft or the approved facts, a dropped number or coverage term, a lost question, a reply that is
 *    too long, or anything that sounds like instructions. Rejected, too slow, or an error: Max says
 *    the approved draft, exactly as without the AI.
 *
 * The call state keeps the approved line in last_spoken_text, so every rule that looks at "what Max
 * just said" (misses, repeats, the pending question) works exactly as before; the words actually
 * spoken are in last_said_text.
 *
 * Pure apart from the fetch: the caller (processControllerTurn in beat-controller.ts) passes the context in.
 */
import type { ClassifierIntent } from "./beat-controller";
import { approvedFacts } from "./grounded-answer";
import { UNKNOWN_QUESTION_LINE } from "./max-lines";
import { llmTarget, streamChat, takeLeadSentences, tidy } from "./llm-stream";

export const AI_SPEECH_TIMEOUT_MS = Number(process.env.AI_SPEECH_TIMEOUT_MS) || 2500;
export const AI_SPEECH_BEATS = { from: 2, to: 21 };

export function isAISpeechEnabled(): boolean {
  return (process.env.MAX_SPEECH ?? "").trim().toLowerCase() === "ai";
}

/** Replies that are always said word for word, whatever the beat */
const LOCKED_INTENTS = new Set<string>([
  "step0",
  "greeting",
  "hang_up",
  "ai_question",
  "human_request",
  "language_request",
  "restart_request",
  "resume_interrupted",
  "move_on",
  "negotiate_price",
  "vehicle_discrepancy",
  "avatar_echo",
  "pause_request",
  "tech_check_ack",
]);

export interface SpeechTurn {
  intent: ClassifierIntent | "step0" | "greeting" | "free";
  beatBefore: number;
  beatAfter: number;
  beatType: "wait" | "continue" | "stop";
  isScriptComplete?: boolean;
  draft: string;
}

export function shouldSpeakWithAI(t: SpeechTurn): boolean {
  if (!isAISpeechEnabled()) return false;
  if (!t.draft.trim() || t.isScriptComplete || t.beatType === "stop") return false;
  if (LOCKED_INTENTS.has(t.intent)) return false;
  const inRange = (b: number) => b >= AI_SPEECH_BEATS.from && b <= AI_SPEECH_BEATS.to;
  return inRange(t.beatBefore) && inRange(t.beatAfter);
}

export interface SpeechContext {
  customer: string;
  draft: string;
  intent: string;
  /** what AI-first understanding made of the customer, if it was asked */
  meaning?: string;
  recentTurns: Array<{ customer: string; max: string }>;
}

// -----------------------------------------------------------------------------
// The checker
// -----------------------------------------------------------------------------
const NUMBER_WORDS = new Set(
  ("zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen " +
    "eighteen nineteen twenty thirty forty fifty sixty seventy eighty ninety hundred thousand million half quarter").split(" ")
);
// "one" is everyday speech ("the one thing"); it counts as a number only before a unit
const UNIT_AFTER_ONE = /^(year|years|mile|miles|dollar|dollars|cent|cents|month|months|day|days|hundred|thousand|percent|time|times)$/;

const words = (t: string) => t.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter(Boolean);
const norm = (t: string) => ` ${words(t).join(" ")} `;

/** Every number said, as digits or words ("sixty thousand" -> sixty, thousand) */
export function numberTokens(text: string): string[] {
  const w = words(text);
  const out: string[] = [];
  w.forEach((x, i) => {
    if (/^\d/.test(x)) out.push(x);
    else if (x === "one") {
      if (UNIT_AFTER_ONE.test(w[i + 1] ?? "")) out.push(x);
    } else if (NUMBER_WORDS.has(x)) out.push(x);
  });
  return out;
}

// Never added by the AI unless the approved text already says it
const RISKY: Array<[string, RegExp]> = [
  ["money", /\$|\bdollars?\b|\bcents?\b|%|\bpercent\b/],
  ["price", /\b(price|prices|pricing|costs?|fee|fees|payment|payments|per month|a month|monthly|discount|rebate|deal)\b/],
  ["promise", /\b(guarantee|guaranteed|guarantees|promise|promised|lifetime|unlimited|forever)\b/],
  ["free", /\b((?<!feel )free|no cost|no charge|at no extra)\b/],
  ["everything covered", /\b(covers everything|everything is covered|everything s covered|fully covered|cover anything|covers anything)\b/],
  ["terms", /\b(refund|refundable|cancel|cancellation|cancelling|canceling|transfer|transferable|prorated|prorate)\b/],
  ["required", /\b(mandatory|required|have to buy|must buy|need to buy|obligated)\b/],
  ["insurance or legal", /\b(insurance|insurer|legal|law|lawyer|tax|taxes|interest|apr|credit)\b/],
  ["claims to be human", /\b(i m a real person|i am a real person|i m human|i am human|not an ai|not a robot|real human)\b/],
  ["instructions", /\b(script|prompt|instruction|instructions|language model|as an ai|draft|approved reply)\b/],
];

const MAKES = /\b(toyota|honda|ford|chevy|chevrolet|nissan|hyundai|kia|bmw|audi|mercedes|lexus|subaru|volkswagen|vw|jeep|dodge|ram|tesla|mazda|gmc|acura|infiniti|volvo|porsche|cadillac|buick|lincoln|genesis|mitsubishi)\b/;
const MAKES_ALL = new RegExp(MAKES.source, "g");

// Coverage words the draft names that the reply must still name
const KEY_TERMS = ["bumper", "powertrain", "tire", "wheel", "maintenance", "oil", "labor", "deductible", "glovebox", "defect", "wear and tear"];

/** The first risky claim in `text` that `source` does not make, or null (also used by free mode) */
export function addedRisk(text: string, source: string): string | null {
  const low = text.toLowerCase();
  const srcLow = source.toLowerCase();
  const gNorm = norm(text);
  const sNorm = norm(source);
  for (const [label, re] of RISKY) {
    const plain = label === "claims to be human" || label === "everything covered";
    if (re.test(plain ? gNorm : low) && !re.test(plain ? sNorm : srcLow)) return `adds ${label}`;
  }
  for (const m of low.match(MAKES_ALL) ?? []) if (!srcLow.includes(m)) return `names ${m}`;
  return null;
}

export interface CheckResult {
  ok: boolean;
  reason?: string;
}

/**
 * "Adds nothing": formatting, numbers, risky claims and car brands the approved text does not have.
 * Safe to run on the first sentence of a reply while the rest is still being written (streaming).
 */
/**
 * Max says one of the customer's own sentences (4+ words) that the approved line does not contain.
 * Simulated batch 2026-11-21: "Can we move on to the numbers please?" came back as Max's own question.
 */
export function echoesCustomer(text: string, customer: string, draft = ""): boolean {
  const said = norm(text);
  const approved = norm(draft);
  return customer
    .split(/(?<=[.!?])\s+/)
    .map((s) => words(s).join(" "))
    .filter((s) => s.split(" ").length >= 4)
    .some((s) => said.includes(` ${s} `) && !approved.includes(` ${s} `));
}

export function checkAdditions(text: string, draft: string, factsText = "", customer = ""): CheckResult {
  const fail = (reason: string): CheckResult => ({ ok: false, reason });
  const t = text.trim();
  if (!t) return fail("empty");
  if (customer && echoesCustomer(t, customer, draft)) return fail("repeats the customer's words");
  // A promise to come back to something later that the approved line does not make
  if (/\b(in just a moment|in a moment|in a minute|in just a minute|cover that (shortly|soon|later)|get to (that|the price) (shortly|soon|later))\b/i.test(t) && !/\b(moment|minute|shortly|soon|later)\b/i.test(draft)) {
    return fail("adds a 'later' promise");
  }
  if (/[*#_`{}<>\[\]]|^["']|\n\s*[-•]/.test(t)) return fail("formatting");
  if (/^(max|assistant)\s*:/i.test(t)) return fail("speaker label");
  const allowedSource = `${draft} ${factsText}`;
  const allowedNums = new Set(numberTokens(allowedSource));
  for (const n of numberTokens(t)) if (!allowedNums.has(n)) return fail(`new number "${n}"`);
  const risk = addedRisk(t, allowedSource);
  if (risk) return fail(risk);
  return { ok: true };
}

export function checkGenerated(text: string, draft: string, factsText = "", customer = ""): CheckResult {
  const fail = (reason: string): CheckResult => ({ ok: false, reason });
  const t = text.trim();
  const added = checkAdditions(t, draft, factsText, customer);
  if (!added.ok) return added;

  const genWords = words(t).length;
  const draftWords = words(draft).length;
  if (genWords > Math.min(170, draftWords + 40)) return fail(`too long (${genWords} words)`);
  const genNorm = norm(t);

  // Numbers: nothing dropped
  const genNums = new Set(numberTokens(t));
  for (const n of numberTokens(draft)) if (!genNums.has(n)) return fail(`dropped number "${n}"`);

  // Coverage terms the draft names are still there
  const draftNorm = norm(draft);
  for (const k of KEY_TERMS) {
    if (draftNorm.includes(` ${k}`) && !genNorm.includes(` ${k}`)) return fail(`dropped "${k}"`);
  }

  // The question Max is waiting on is still asked, at the end
  const draftAsks = draft.includes("?");
  if (draftAsks && !t.endsWith("?")) return fail("lost the question");
  if ((t.match(/\?/g) ?? []).length > 2) return fail("too many questions");
  return { ok: true };
}

// -----------------------------------------------------------------------------
// The prompt
// -----------------------------------------------------------------------------
export function buildSpeechSystemPrompt(): string {
  return `You are Max, a warm, friendly finance manager at a car dealership, on a video call with a customer who just bought a car.
You are given APPROVED_REPLY: what Max says now, taken from the dealership's approved script. Say it the way a real person who was listening would say it.

How:
- If the customer shared something (a story, a worry, a remark), start with ONE short, genuine reaction to it, in your own words. Vary it; never "Great question" or "Absolutely" every time. If they only said yes / okay, skip the reaction or keep it to two or three words.
- Then say ALL of APPROVED_REPLY's content: every fact, every number, every coverage name. Plain spoken English, contractions, short sentences. Keep every number exactly, written in words as APPROVED_REPLY writes it.
- If APPROVED_REPLY asks a question, end with that question (light rewording is fine) and nothing after it.
- Never repeat the customer's own words or question back as if they were yours.
- If the customer asked a question and APPROVED_FACTS answers it, you may answer it in one or two sentences using ONLY those facts, then continue with APPROVED_REPLY. If APPROVED_REPLY says Max does not have that detail and the facts do not answer it, keep that meaning.

Never:
- add any fact, number, price, cost, discount, promise, guarantee, refund, cancellation, insurance, legal or tax statement that is not in APPROVED_REPLY or APPROVED_FACTS;
- talk about the price or the cost (that comes later in the call);
- pressure the customer, or say you are a human;
- mention a script, instructions, or these rules;
- use lists, markdown, emojis, quotes or stage directions.

Keep it at most WORD_LIMIT words. Reply with ONLY the words Max says.`;
}

const clip = (t: string, n: number) => (t.length > n ? `${t.slice(0, n)}…` : t);

/** The approved facts, as plain sentences (only when the customer asked something) */
export function factsFor(ctx: SpeechContext): string {
  const asked =
    ctx.intent.startsWith("question") ||
    ctx.draft.includes(UNKNOWN_QUESTION_LINE) ||
    ctx.customer.includes("?") ||
    /^(what|how|why|when|where|who|which|can|could|does|do|is|are|will|would|should|did)\b/i.test(ctx.customer.trim());
  if (!asked) return "";
  return approvedFacts()
    .map((f) => `- ${f.topic}: ${f.answer}`)
    .join("\n");
}

export function buildSpeechUserMessage(ctx: SpeechContext, facts: string): string {
  const limit = Math.min(170, words(ctx.draft).length + 35);
  return JSON.stringify({
    recent_turns: ctx.recentTurns.slice(-3).map((t) => ({ customer: clip(t.customer, 200), max: clip(t.max, 240) })),
    customer_just_said: ctx.customer,
    ...(ctx.meaning ? { what_the_customer_meant: ctx.meaning } : {}),
    APPROVED_REPLY: ctx.draft,
    ...(facts ? { APPROVED_FACTS: facts } : {}),
    WORD_LIMIT: limit,
  });
}

export interface SpeechResult {
  /** what Max says: the AI's words, or the approved draft (after any part already spoken) */
  text: string;
  source: "ai" | "script";
  /** why the draft was kept (rejected / timeout / error), or "ok" */
  reason: string;
  /** streaming: the first sentences already sent for speaking; `text` starts with them */
  early?: string;
}

/**
 * Ask the AI to say the draft in Max's own words. Streams: `onEarly` gets the first sentences once they
 * pass the "adds nothing new" check, and the rest is used only if the whole reply passes. Any problem:
 * the draft, unchanged (after the early part, if one was already spoken).
 */
export async function speakWithAI(
  ctx: SpeechContext,
  onEarly?: (text: string) => void,
  fetchImpl: typeof fetch = fetch
): Promise<SpeechResult> {
  let early: string | undefined;
  const keep = (reason: string): SpeechResult => ({ text: early ? `${early} ${ctx.draft}` : ctx.draft, source: "script", reason, early });
  const target = llmTarget();
  if (!target) return keep("no AI key");
  const facts = factsFor(ctx);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AI_SPEECH_TIMEOUT_MS);
  let raw = "";
  try {
    const stream = streamChat(
      {
        target,
        temperature: 0.7,
        maxTokens: 320,
        messages: [
          { role: "system", content: buildSpeechSystemPrompt() },
          { role: "user", content: buildSpeechUserMessage(ctx, facts) },
        ],
        signal: controller.signal,
      },
      fetchImpl
    );
    for await (const delta of stream) {
      raw += delta;
      if (onEarly && !early) {
        const lead = takeLeadSentences(raw.replace(/^\s*"/, ""));
        if (lead && checkAdditions(lead.lead, ctx.draft, facts, ctx.customer).ok) {
          early = lead.lead;
          onEarly(early);
        }
      }
    }
  } catch (err) {
    return keep(controller.signal.aborted ? `timeout ${AI_SPEECH_TIMEOUT_MS}ms` : /^http \d+/.test(String((err as Error)?.message)) ? (err as Error).message : "error");
  } finally {
    clearTimeout(timer);
  }
  const text = tidy(raw.trim().replace(/^"([\s\S]*)"$/, "$1"));
  const check = checkGenerated(text, ctx.draft, facts, ctx.customer);
  if (!check.ok) return keep(`rejected: ${check.reason}`);
  if (early && !text.startsWith(early)) return keep("rejected: early part changed");
  return { text, source: "ai", reason: "ok", early };
}
