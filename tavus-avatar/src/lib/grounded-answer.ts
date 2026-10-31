/**
 * Grounded answers for out-of-script questions.
 *
 * Max may answer a question the script does not cover ONLY from max-knowledge-base.json:
 *   - facts with status "script" (TXM's own script) or "approved"
 *   - needs_txm entries once TXM fills in `answer`
 * Everything else returns a handoff. The model never answers from general knowledge.
 *
 * Pipeline: retrieve -> (optional LLM rewrite from passages only) -> deterministic checks -> answer or handoff.
 * Without an API key it answers with the approved sentences themselves, so it is safe offline.
 */
import kbData from "./max-knowledge-base.json" with { type: "json" };
import { UNKNOWN_QUESTION_LINE } from "./max-lines";

interface Fact {
  id: string;
  topic: string;
  answer: string;
  status: string;
  /** retrieval keywords defined in the JSON itself, merged with KEYWORDS below */
  keywords?: string[];
}
interface NeedsEntry {
  question: string;
  answer: string | null;
  status: string;
}

export interface GroundedResult {
  kind: "answer" | "handoff";
  text: string;
  sources: string[];
  /** a remote LLM rewrite was attempted (for per-turn latency logging) */
  usedLLM?: boolean;
}

// Recall keywords per fact. Deliberately conservative: a question must hit a real
// keyword, and anything TXM has not answered (mechanic, refund, battery, hail) is absent on purpose.
const KEYWORDS: Record<string, string[]> = {
  disclosure: ["recorded", "recording", "required by law", "why do you need", "being recorded", "why record"],
  manufacturer_warranty: ["powertrain", "power train", "base limited", "factory warranty", "manufacturer warranty", "two warranties", "comes with the car", "already have a warranty", "factory coverage"],
  warranty_fine_print: ["manual", "glovebox", "glove box", "page 4", "page four", "mis built", "misbuilt", "defect", "defects only", "only defects", "what does the factory cover"],
  wear_and_tear: ["wear and tear", "ware and tear", "95", "ninety five", "three reasons", "main reasons", "why do cars break", "what causes", "normal use"],
  // No bare "weather"/"hot"/"cold"/"heat": "What's the weather like today?" is small talk, not this fact
  climate: ["climate", "110", "texas heat", "texas summer"],
  road: ["road", "pothole", "construction", "bad roads"],
  driving_habits: ["driving habit", "how i drive", "my driving", "the way i drive", "drive hard"],
  breakdown_process: ["who pays", "who will pay", "diagnose", "breaks down", "break down", "broke down", "manufacturer decide", "who decides", "manufacturer pays", "who covers", "who is responsible", "my fault", "wear and tear", "who pays for repairs"],
  repair_costs: ["how much does an engine", "engine cost", "transmission cost", "repair cost", "cost to repair", "cost to fix", "how expensive", "expensive to fix", "cost of repairs"],
  screen_sensor: ["screen", "sensor", "dashboard", "electronics cost", "infotainment"],
  labor: ["labor", "labour", "per hour", "hourly", "how many hours", "labor rate", "mechanic charge"],
  bumper_to_bumper: ["bumper", "deductible", "what does it cover", "what is covered", "what's covered", "blanket", "full coverage", "whats included", "what's included", "covers everything"],
  service_location: ["come here", "service location", "service center", "metroplex", "where do i get service", "where do i service"],
  tire_wheel: ["tire", "tires", "wheel", "wheels", "rim", "flat tire", "blowout"],
  maintenance: ["oil change", "maintenance", "filter", "rotation", "oil changes", "service visits"],
  gas_only: ["gas", "fuel", "what else do i pay", "anything else to pay", "out of pocket"],
  price_framing: ["coffee", "starbucks"],
  two_most_valuable: ["which two", "most value"],
  confirm: ["confirm"],
  verify: ["legal name", "mailing address", "verify my"],
};

// Facts that only count when the question is about the car, not small talk ("how's the climate here?")
const NEEDS_CAR_CONTEXT: Record<string, RegExp> = {
  climate: /\b(warrant\w*|cover\w*|damag\w*|car|cars|vehicle|engine|ac|sensors?|electronics?|transmission|cooling|break\w*|parts?|wear|110)\b/,
};

const STOP = new Set("a an the is are was were do does did can could would should i you me my your it its to of for on in at and or but so if then that this what how why when where who which about with be have has".split(" "));

function tokens(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w && !STOP.has(w));
}

function cleanAnswer(a: string): string {
  return a.replace(/\{\{[A-Z_]+\}\}/g, "").replace(/\s+/g, " ").trim();
}

function approvedFacts(): Array<{ id: string; topic: string; answer: string; keywords: string[] }> {
  const out: Array<{ id: string; topic: string; answer: string; keywords: string[] }> = [];
  for (const f of (kbData as { facts: Fact[] }).facts) {
    if (f.status !== "script" && f.status !== "approved") continue;
    out.push({ id: f.id, topic: f.topic, answer: cleanAnswer(f.answer), keywords: [...(KEYWORDS[f.id] ?? []), ...(f.keywords ?? [])] });
  }
  for (const n of (kbData as { needs_txm: NeedsEntry[] }).needs_txm) {
    if (n.status === "approved" && n.answer) {
      out.push({ id: `txm:${n.question}`, topic: n.question, answer: n.answer.trim(), keywords: tokens(n.question) });
    }
  }
  return out;
}

export function retrieve(question: string, k = 2) {
  const norm = " " + question.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ") + " ";
  const qTokens = new Set(tokens(question));
  const scored = approvedFacts().map((f) => {
    let score = 0;
    for (const kw of f.keywords) {
      const k2 = kw.toLowerCase();
      if (k2.includes(" ") ? norm.includes(" " + k2 + " ") || norm.includes(k2) : qTokens.has(k2)) score += 2;
    }
    return { ...f, score };
  });
  return scored
    .filter((s) => s.score >= 2 && (NEEDS_CAR_CONTEXT[s.id]?.test(norm) ?? true))
    .sort((a, b) => b.score - a.score).slice(0, k);
}

const RISKY = ["refund", "transferable", "prorat", "pro-rat", "guarantee", "insurance", "lawsuit", "legal advice"];

/** Deterministic checks. A draft passes only if every number and every risky word comes from the passages. */
export function isSupported(draft: string, passages: string[]): boolean {
  const src = passages.join(" ").toLowerCase();
  const d = draft.toLowerCase();
  const nums = d.match(/\d[\d,\.]*/g) ?? [];
  for (const n of nums) if (!src.includes(n.replace(/[,\.]$/, ""))) return false;
  for (const w of RISKY) if (d.includes(w) && !src.includes(w)) return false;
  return draft.trim().length > 0 && draft.split(/\s+/).length <= 60;
}

function firstSentences(text: string, n: number): string {
  const parts = text.match(/[^.!?]+[.!?]+/g) ?? [text];
  return parts.slice(0, n).join(" ").trim();
}

async function rewriteWithLLM(question: string, passages: string[]): Promise<string> {
  const apiKey = process.env.XAI_API_KEY?.trim() || process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) return "";
  const isXai = Boolean(process.env.XAI_API_KEY);
  const endpoint = isXai ? "https://api.x.ai/v1/chat/completions" : "https://api.openai.com/v1/chat/completions";
  const model = process.env.GROK_MODEL?.trim() || (isXai ? "grok-4.20-0309-non-reasoning" : "gpt-4o-mini");
  const system = `You are Max, a calm finance manager. Answer the customer's question in at most two short spoken sentences using ONLY the PASSAGES.
Rules: do not add any fact, number, price, promise or guarantee that is not in the passages. If the passages do not answer the question, output exactly: NO_ANSWER.
Do not sell or pressure. Plain speech, no markdown.`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REMOTE_TIMEOUT_MS);
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        temperature: 0,
        max_tokens: 90,
        messages: [
          { role: "system", content: system },
          { role: "user", content: `PASSAGES:\n- ${passages.join("\n- ")}\n\nCUSTOMER QUESTION: ${question}` },
        ],
      }),
    });
    if (!res.ok) return "";
    const data = await res.json();
    return (data.choices?.[0]?.message?.content || "").trim();
  } catch {
    // Timeout or network error: the caller falls back to the approved sentences as written
    return "";
  } finally {
    clearTimeout(timer);
  }
}

// The rewrite gives up after this and falls back to the approved sentences as written.
// Dead air hurts more than a plainer answer.
export const REMOTE_TIMEOUT_MS = 800;

// The fact picker gets longer than the rewrite: the live model answers in ~700-850 ms, and a pick
// that lands saves an "I don't have that detail" when the answer exists. Override with the env var.
export const FACT_PICKER_TIMEOUT_MS = Number(process.env.FACT_PICKER_TIMEOUT_MS) || 1200;

/**
 * Lets the model choose which approved fact answers the question. It returns ONLY a fact id or
 * NONE, never text, so nothing it says is spoken. Catches everyday phrasing that keywords miss.
 */
async function pickFactWithLLM(
  question: string,
  facts: Array<{ id: string; topic: string }>
): Promise<{ id: string | null; timedOut: boolean }> {
  const apiKey = process.env.XAI_API_KEY?.trim() || process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) return { id: null, timedOut: false };
  const isXai = Boolean(process.env.XAI_API_KEY);
  const endpoint = isXai ? "https://api.x.ai/v1/chat/completions" : "https://api.openai.com/v1/chat/completions";
  const model = process.env.GROK_MODEL?.trim() || (isXai ? "grok-4.20-0309-non-reasoning" : "gpt-4o-mini");
  const list = facts.map((f) => `${f.id}: ${f.topic}`).join("\n");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FACT_PICKER_TIMEOUT_MS);
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        temperature: 0,
        max_tokens: 12,
        messages: [
          {
            role: "system",
            content: `Pick the ONE fact id below that answers the customer's question. Reply with only the id, or NONE if none answers it. No other words.\n\nFACTS:\n${list}`,
          },
          { role: "user", content: question },
        ],
      }),
    });
    if (!res.ok) return { id: null, timedOut: false };
    const data = await res.json();
    const answer = (data.choices?.[0]?.message?.content || "").trim().replace(/[^\w:.-]/g, "");
    return { id: facts.some((f) => f.id === answer) ? answer : null, timedOut: false };
  } catch {
    return { id: null, timedOut: controller.signal.aborted };
  } finally {
    clearTimeout(timer);
  }
}

export async function answerFromKnowledgeBase(question: string): Promise<GroundedResult> {
  const usedLLM = Boolean(process.env.XAI_API_KEY?.trim() || process.env.OPENAI_API_KEY?.trim());

  // 1. With a key, the model picks the fact id and Max speaks that fact's approved sentences.
  if (usedLLM) {
    const facts = approvedFacts();
    const pick = await pickFactWithLLM(question, facts);
    const fact = pick.id ? facts.find((f) => f.id === pick.id) : undefined;
    if (fact) return { kind: "answer", text: firstSentences(fact.answer, 2), sources: [fact.id], usedLLM };
    if (pick.timedOut) {
      // The remote model is slow right now: keywords plus approved sentences, no second remote call
      const quick = retrieve(question);
      if (quick.length === 0) return { kind: "handoff", text: UNKNOWN_QUESTION_LINE, sources: [], usedLLM };
      return { kind: "answer", text: firstSentences(quick[0].answer, 2), sources: [quick[0].id], usedLLM };
    }
  }

  // 2. No key, or the model said NONE: keywords as before (the rewrite can still say NO_ANSWER)
  const hits = retrieve(question);
  if (hits.length === 0) return { kind: "handoff", text: UNKNOWN_QUESTION_LINE, sources: [], usedLLM };
  const passages = hits.map((h) => h.answer);

  const llm = await rewriteWithLLM(question, passages);
  if (llm && llm !== "NO_ANSWER" && isSupported(llm, passages)) {
    return { kind: "answer", text: llm, sources: hits.map((h) => h.id), usedLLM };
  }
  if (llm === "NO_ANSWER") return { kind: "handoff", text: UNKNOWN_QUESTION_LINE, sources: [], usedLLM };

  // No key, or the draft failed the checks: use TXM's approved sentences directly.
  const text = firstSentences(passages[0], 2);
  return { kind: "answer", text, sources: [hits[0].id], usedLLM };
}

/** Looks like a customer question or objection that deserves an answer, as opposed to a filler sound. */
export function looksLikeQuestion(text: string): boolean {
  const t = text.trim().toLowerCase();
  if (t.includes("?")) return true;
  if (/^(what|how|why|when|where|who|which|can|could|does|do|is|are|will|would|should|did|am|may)\b/.test(t)) return true;
  return t.split(/\s+/).length >= 5;
}
