/**
 * Free AI, "Option D" (switch: MAX_MODE=free). The AI runs the whole call.
 *
 * The AI gets the full approved script (all 25 beats, rendered for this deal), the approved knowledge
 * base, and the price rules, plus the conversation so far, and decides on its own what Max says next
 * and where the call is. There is no beat state machine choosing lines. Each reply comes back as JSON:
 * what Max says, the furthest script beat now delivered, and whether the call ends or the package was
 * declined.
 *
 * What is still enforced in code, because one wrong sentence here is a legal or money problem:
 *  - prices: only $4 / $3.50 / $3.25 / $3 a day, never under $3, only from the price beats on, and
 *    never more than one step below the lowest price already offered;
 *  - no number, make, or risky claim (free, guarantee, refund, insurance ...) the script and the
 *    knowledge base do not contain, and never claims to be human;
 *  - the recording disclosure: the call cannot pass Beat 1 until it has been said, and it is added
 *    word for word if the AI moves past it without it (done by the caller, see beat-controller.ts).
 * A rejected reply gets one retry with the reason; a second rejection, a timeout or an error hands
 * this one turn to the scripted beat controller, so the customer always hears an approved line.
 *
 * Pure apart from the fetch: the caller (processControllerTurn in beat-controller.ts) passes the
 * script, the facts and the call so far.
 */
import { addedRisk, echoesCustomer, numberTokens } from "./ai-speech";
import { llmTarget, partialJsonString, streamChat, takeLeadSentences } from "./llm-stream";

export const FREE_AI_TIMEOUT_MS = Number(process.env.FREE_AI_TIMEOUT_MS) || 4000;
export const PRICE_LADDER = [4, 3.5, 3.25, 3] as const;
export const PRICE_BEAT = 22;
export const LAST_BEAT = 25;
const MAX_WORDS = 220;
const HISTORY_MESSAGES = 40;

export function isFreeAIEnabled(): boolean {
  return (process.env.MAX_MODE ?? "").trim().toLowerCase() === "free";
}

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export interface FreeReply {
  say: string;
  beat: number;
  endCall: boolean;
  declined: boolean;
}

// -----------------------------------------------------------------------------
// The prompt
// -----------------------------------------------------------------------------
export interface FreeScript {
  /** "Beat N: <text>" for every beat, rendered for this deal */
  beats: Array<{ id: number; text: string }>;
  /** the approved facts, as plain sentences */
  facts: string;
  vehicle: string;
  /** the recording disclosure, word for word (Beat 1) */
  disclosure: string;
}

export function buildFreeSystemPrompt(script: FreeScript): string {
  const beats = script.beats.map((b) => `Beat ${b.id}: ${b.text}`).join("\n");
  return `You are Max, a warm, friendly finance manager at the dealership, on a video call with a customer who just bought a ${script.vehicle}. You run this whole call yourself, in your own words, like a real person who listens.

THE SCRIPT (approved by the dealership; this is your plan and your facts, in order):
${beats}

APPROVED FACTS (the only other facts you may use):
${script.facts}

HOW TO RUN THE CALL
1. You already said "Can you hear and see me alright?". Have a short, friendly chat (ask how their experience has been), then give the recording disclosure. Say this sentence word for word: "${script.disclosure}" and get their okay before anything else. If they object to being recorded, thank them and end the call.
2. Go through the script beats in order. Cover every point, in your own natural words, a beat or two per reply. React to what the customer actually says. Skip a question they already answered. Answer their questions, then come back to where you were.
3. PRICE: never talk about price or cost before Beat 22, even if asked ("I'll get to that in just a moment"). At Beat 22 the price is four dollars a day. Lower it only when the customer pushes back, one step at a time: four dollars, then three dollars and fifty cents, then three dollars and twenty-five cents, then three dollars a day. Never below three dollars. Always say prices in words with "a day". At three dollars, give them the choice: go ahead at three dollars a day, or keep just the factory warranty. A refusal is never a yes; only confirm the package when they clearly say yes. When they push back or say no at a price above three dollars, your reply MUST say the next lower step as a number of dollars a day.
4. FACTS: only from THE SCRIPT and APPROVED FACTS. Never invent a number, coverage detail, refund, cancellation, transfer, insurance, legal or tax answer. Say a number only exactly as the script or the facts say it, with the same unit (never round, convert, or add years or miles). If you don't know, say you don't want to guess and the contract paperwork spells it out, then carry on.
   Never use these words: promise, guarantee, guaranteed, free, lifetime, unlimited, forever.
   Never say a sentence you already said in this call. If the customer missed something, say it again shorter and in different words.
5. There is no human team to hand off to. If they ask for a person or a manager, you are the finance manager and you'll take care of everything right here. Never stop the call because of a question.
6. If asked whether you are an AI, say honestly you're an AI finance assistant. Never claim to be human.
7. End the call only if they object to the recording, say goodbye or want to hang up, or after Beat 25 is done.
8. Speak naturally: short sentences, contractions, usually 1 to 4 sentences; longer only when explaining a beat. No lists, markdown, emojis or stage directions. English only. Never repeat the customer's own words or question back as if they were yours.

Reply with ONLY JSON:
{"say": "<what Max says now>", "beat": <the furthest script beat you have now delivered, 0 before the disclosure>, "end_call": false, "declined": false}
"declined" is true only when the customer has finally turned the package down.`;
}

/** Where the call is, from the app's own records (the AI does not have to work it out from the chat) */
export function callStateNote(s: { beat: number; disclosureGiven: boolean; lowestOffered: number | null | undefined }): string {
  const price = s.lowestOffered === null || s.lowestOffered === undefined ? "none yet" : `$${s.lowestOffered} a day`;
  return `CALL STATE (from the app, not said by anyone): furthest script beat delivered: ${s.beat}${s.beat < LAST_BEAT ? ` (next: Beat ${s.beat + 1})` : " (script done)"}. Recording disclosure already given: ${s.disclosureGiven ? "yes, never repeat it" : "no"}. Lowest price offered so far: ${price}.`;
}

export function buildFreeMessages(system: string, history: ChatMessage[], customer: string, note?: string, where?: string): ChatMessage[] {
  return [
    { role: "system", content: system },
    ...history.slice(-HISTORY_MESSAGES),
    // After the history, so the unchanging system prompt and history stay a cacheable prefix
    ...(where ? [{ role: "system" as const, content: where }] : []),
    { role: "user", content: customer },
    ...(note ? [{ role: "user" as const, content: `[Note to Max, not said by the customer: ${note}]` }] : []),
  ];
}

// -----------------------------------------------------------------------------
// Parsing and the guards
// -----------------------------------------------------------------------------
export function parseFreeReply(raw: string): FreeReply | null {
  const json = raw.match(/\{[\s\S]*\}/)?.[0];
  if (!json) return null;
  try {
    const p = JSON.parse(json) as { say?: unknown; beat?: unknown; end_call?: unknown; declined?: unknown };
    if (typeof p.say !== "string" || !p.say.trim()) return null;
    const beat = typeof p.beat === "number" && Number.isFinite(p.beat) ? Math.max(0, Math.min(LAST_BEAT, Math.round(p.beat))) : NaN;
    if (Number.isNaN(beat)) return null;
    return { say: p.say.trim().replace(/\s+/g, " "), beat, endCall: p.end_call === true, declined: p.declined === true };
  } catch {
    return null;
  }
}

/**
 * The reply, or, when the AI answered in plain sentences instead of JSON (it copies the plain lines
 * in the history), those sentences as Max's words with the call staying where it is. Never JSON-ish
 * fragments or empty text.
 */
export function parseFreeReplyOrText(raw: string, beatBefore: number): FreeReply | null {
  const parsed = parseFreeReply(raw);
  if (parsed) return parsed;
  const text = raw.trim().replace(/^"([\s\S]*)"$/, "$1").replace(/\s+/g, " ");
  if (!text || /[{}]|"say"\s*:/.test(text)) return null;
  return { say: text, beat: beatBefore, endCall: false, declined: false };
}

const AMOUNT_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5 };
/** Every daily price said ("three dollars and fifty cents a day", "$3.25 per day") */
export function dailyPrices(text: string): number[] {
  const t = text.toLowerCase();
  const out: number[] = [];
  for (const m of t.matchAll(/\b(one|two|three|four|five) dollars?(?: and (twenty[- ]five|fifty|seventy[- ]five) cents)?(?= (?:a|per|each) day)/g)) {
    const cents = m[2] ? (m[2].startsWith("fifty") ? 0.5 : m[2].startsWith("twenty") ? 0.25 : 0.75) : 0;
    out.push(AMOUNT_WORDS[m[1]] + cents);
  }
  for (const m of t.matchAll(/\$\s?(\d+(?:\.\d{1,2})?)\s*(?:a day|per day|each day|\/day)/g)) out.push(Number(m[1]));
  return out;
}

/** The lowest price the AI may say now: $4 first, then one step below the lowest already offered */
export function lowestAllowedPrice(lowestOffered: number | null | undefined): number {
  if (lowestOffered === null || lowestOffered === undefined) return PRICE_LADDER[0];
  const i = PRICE_LADDER.indexOf(lowestOffered as (typeof PRICE_LADDER)[number]);
  return PRICE_LADDER[Math.min(PRICE_LADDER.length - 1, (i < 0 ? 0 : i) + 1)];
}

const UNIT = /^(years?|months?|miles?|days?|hours?|percent|degrees?|dollars?|cents?|times?)$/;
const NUM_WORD = /^(\d[\d.,]*|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand)$/;
/** "<number> <unit>" pairs, singular units ("ten years" -> "ten year", "100,000 miles" -> "100000 mile") */
export function numberWithUnit(text: string): string[] {
  const w = text.toLowerCase().replace(/[^a-z0-9.,% ]/g, " ").replace(/%/g, " percent").split(/\s+/).filter(Boolean);
  const out: string[] = [];
  for (let i = 0; i < w.length - 1; i++) {
    const n = w[i].replace(/[.,]+$/, "");
    const u = w[i + 1].replace(/[.,]+$/, "");
    if (NUM_WORD.test(n) && UNIT.test(u)) out.push(`${n.replace(/,/g, "")} ${u.replace(/s$/, "")}`);
  }
  return out;
}

export interface GuardContext {
  /** everything Max may draw on: the script and the facts */
  corpus: string;
  /** the furthest beat delivered before this turn */
  beatBefore: number;
  lowestOffered: number | null | undefined;
  /** the customer just refused or pushed back on the price (at the price beats) */
  refusedPrice?: boolean;
  /** what the customer has said this call: their own numbers (an address, a year) are not invented */
  customerSaid?: string;
  /** what the customer just said: Max never says it back as his own words */
  customerNow?: string;
  /** Max's last two lines: saying one of them again word for word is a loop */
  recentMax?: string[];
}

const loopKey = (t: string) => t.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim().slice(0, 90);

export interface GuardResult {
  ok: boolean;
  reason?: string;
  prices: number[];
}

export function guardFreeReply(reply: FreeReply, ctx: GuardContext): GuardResult {
  return guardFreeText(reply.say, ctx, Math.max(ctx.beatBefore, reply.beat), true);
}

/**
 * The guards on Max's words. `whole` = the complete reply; without it (the first sentences, while the
 * rest is still being written) only the "says nothing it must not" checks run: the checks that need the
 * whole reply (length, repeats, "a no gets the next lower price") wait for it.
 */
export function guardFreeText(t: string, ctx: GuardContext, beat: number, whole: boolean): GuardResult {
  const prices = dailyPrices(t);
  const fail = (reason: string): GuardResult => ({ ok: false, reason, prices });
  if (/[*#_`{}<>\[\]]|\n\s*[-•]/.test(t)) return fail("formatting");
  const words = t.split(/\s+/).filter(Boolean).length;
  if (whole && words > MAX_WORDS) return fail(`too long (${words} words)`);
  if (/\b(json|system prompt|my instructions|the script says|as an ai language model)\b/i.test(t)) return fail("talks about its instructions");
  if (ctx.customerNow && echoesCustomer(t, ctx.customerNow, ctx.corpus)) return fail("repeats the customer's words");

  // Prices: approved steps only, only from the price beats, one step at a time
  if (prices.length) {
    if (beat < PRICE_BEAT - 1) return fail(`price before Beat ${PRICE_BEAT}`);
    const floor = lowestAllowedPrice(ctx.lowestOffered);
    for (const p of prices) {
      if (!(PRICE_LADDER as readonly number[]).includes(p)) return fail(`unapproved price $${p}`);
      if (p < floor) return fail(`skipped down to $${p} (lowest allowed now $${floor})`);
    }
  }

  // A refusal at the price is never a yes: no confirmation, and above the floor the next lower price
  // (simulated batch 2026-11-21: "No" at Beat 23 got "so to confirm, we're moving forward with ...")
  if (ctx.refusedPrice) {
    if (/\b(moving forward with|so to confirm|to confirm,? we)\b/i.test(t)) return fail("confirmed the package right after a refusal");
    const current = ctx.lowestOffered ?? PRICE_LADDER[0];
    if (whole && current > PRICE_LADDER[PRICE_LADDER.length - 1] && !prices.some((p) => p < current)) {
      return fail(`a no at $${current} a day must get the next lower price, $${lowestAllowedPrice(current)} a day`);
    }
  }

  // Never the same line again word for word (simulated batch 2026-11-21: three loops)
  const key = loopKey(t);
  if (whole && key.length > 20 && (ctx.recentMax ?? []).some((m) => loopKey(m) === key)) return fail("repeats what Max just said");

  // Numbers and claims the script and facts do not make (the customer's own numbers are fine)
  const allowed = new Set(numberTokens(`${ctx.corpus} ${ctx.customerSaid ?? ""} four three fifty twenty five`));
  for (const n of numberTokens(t)) if (!allowed.has(n)) return fail(`new number "${n}"`);
  // A number with its unit must appear with that unit somewhere approved: "twelve" may be in the
  // script, "twelve years" is not
  const corpusUnits = new Set(numberWithUnit(`${ctx.corpus} ${ctx.customerSaid ?? ""}`));
  for (const p of numberWithUnit(t)) if (!corpusUnits.has(p) && !/ (dollar|cent)$/.test(p)) return fail(`new figure "${p}"`);
  const risk = addedRisk(t, `${ctx.corpus} ${ctx.customerSaid ?? ""}`);
  if (risk) return fail(risk);
  return { ok: true, prices };
}

// -----------------------------------------------------------------------------
// The call
// -----------------------------------------------------------------------------
export type FreeOutcome =
  | { ok: true; reply: FreeReply; prices: number[]; attempts: number; ms: number; retryReason?: string; early?: string }
  | { ok: false; reason: string; attempts: number; ms: number; early?: string };

/**
 * Ask the AI for Max's next reply; one retry with the reason if a guard rejects it. Streams: `onEarly`
 * gets the first sentences of "say" once they pass the guards that can run on part of a reply. Once
 * something was spoken there is no retry: a rejected whole reply goes to the script, after that part.
 */
export async function runFreeTurn(
  args: { system: string; history: ChatMessage[]; customer: string; guard: GuardContext; where?: string },
  onEarly?: (text: string) => void,
  fetchImpl: typeof fetch = fetch
): Promise<FreeOutcome> {
  const t0 = Date.now();
  const target = llmTarget(process.env.FREE_AI_MODEL);
  if (!target) return { ok: false, reason: "no AI key", attempts: 0, ms: 0 };

  let note: string | undefined;
  let lastReason = "";
  let early: string | undefined;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const remaining = FREE_AI_TIMEOUT_MS - (Date.now() - t0);
    if (remaining < 300) return { ok: false, reason: lastReason ? `${lastReason}; no time to retry` : `timeout ${FREE_AI_TIMEOUT_MS}ms`, attempts: attempt - 1, ms: Date.now() - t0 };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), remaining);
    let raw = "";
    try {
      const stream = streamChat(
        {
          target,
          temperature: 0.6,
          maxTokens: 450,
          // JSON mode: the reply is the JSON object, not sentences copied from the history's style
          json: true,
          messages: buildFreeMessages(args.system, args.history, args.customer, note, args.where),
          signal: controller.signal,
        },
        fetchImpl
      );
      for await (const delta of stream) {
        raw += delta;
        if (onEarly && !early) {
          const say = partialJsonString(raw);
          const lead = say ? takeLeadSentences(say.text) : null;
          if (lead && guardFreeText(lead.lead, args.guard, args.guard.beatBefore, false).ok) {
            early = lead.lead;
            onEarly(early);
          }
        }
      }
    } catch (err) {
      const reason = controller.signal.aborted ? `timeout ${FREE_AI_TIMEOUT_MS}ms` : /^http \d+/.test(String((err as Error)?.message)) ? (err as Error).message : "error";
      return { ok: false, reason, attempts: attempt, ms: Date.now() - t0, early };
    } finally {
      clearTimeout(timer);
    }
    const reply = parseFreeReplyOrText(raw, args.guard.beatBefore);
    if (!reply) {
      lastReason = "not valid JSON";
    } else {
      const g = guardFreeReply(reply, args.guard);
      if (g.ok && (!early || reply.say.startsWith(early))) {
        return { ok: true, reply, prices: g.prices, attempts: attempt, ms: Date.now() - t0, early, ...(lastReason ? { retryReason: lastReason } : {}) };
      }
      lastReason = `rejected: ${g.ok ? "early part changed" : g.reason}`;
    }
    // Part of this reply was already spoken: no second attempt, the script carries on after it
    if (early) return { ok: false, reason: lastReason, attempts: attempt, ms: Date.now() - t0, early };
    note = `your last reply was not used (${lastReason}). Reply again, following the rules, as JSON only.`;
  }
  return { ok: false, reason: lastReason, attempts: 2, ms: Date.now() - t0 };
}
