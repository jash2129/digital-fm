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
}

// Recall keywords per fact. Deliberately conservative: a question must hit a real
// keyword, and anything TXM has not answered (mechanic, refund, battery, hail) is absent on purpose.
const KEYWORDS: Record<string, string[]> = {
  disclosure: ["recorded", "recording", "required by law", "why do you need"],
  manufacturer_warranty: ["powertrain", "power train", "base limited", "factory warranty", "manufacturer warranty", "two warranties"],
  warranty_fine_print: ["manual", "glovebox", "glove box", "page 4", "page four", "mis built", "misbuilt", "defect"],
  wear_and_tear: ["wear and tear", "ware and tear", "95", "ninety five", "three reasons", "main reasons"],
  climate: ["climate", "heat", "hot", "110", "cold", "weather"],
  road: ["road", "pothole", "construction"],
  driving_habits: ["driving habit", "how i drive", "my driving"],
  breakdown_process: ["who pays", "who will pay", "diagnose", "breaks down", "break down", "broke down", "manufacturer decide", "who decides"],
  repair_costs: ["how much does an engine", "engine cost", "transmission cost", "repair cost", "cost to repair", "cost to fix"],
  screen_sensor: ["screen", "sensor", "dashboard", "electronics cost"],
  labor: ["labor", "labour", "per hour", "hourly", "how many hours"],
  bumper_to_bumper: ["bumper", "deductible", "what does it cover", "what is covered", "what's covered", "blanket", "full coverage"],
  service_location: ["come here", "service location", "service center", "metroplex", "where do i get service", "where do i service"],
  tire_wheel: ["tire", "tires", "wheel", "wheels", "rim"],
  maintenance: ["oil change", "maintenance", "filter", "rotation"],
  gas_only: ["gas", "fuel"],
  price_framing: ["coffee", "starbucks"],
  two_most_valuable: ["which two", "most value"],
  confirm: ["confirm"],
  verify: ["legal name", "mailing address", "verify my"],
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

function approvedFacts(): Array<{ id: string; answer: string; keywords: string[] }> {
  const out: Array<{ id: string; answer: string; keywords: string[] }> = [];
  for (const f of (kbData as { facts: Fact[] }).facts) {
    if (f.status !== "script" && f.status !== "approved") continue;
    out.push({ id: f.id, answer: cleanAnswer(f.answer), keywords: KEYWORDS[f.id] ?? [] });
  }
  for (const n of (kbData as { needs_txm: NeedsEntry[] }).needs_txm) {
    if (n.status === "approved" && n.answer) {
      out.push({ id: `txm:${n.question}`, answer: n.answer.trim(), keywords: tokens(n.question) });
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
  return scored.filter((s) => s.score >= 2).sort((a, b) => b.score - a.score).slice(0, k);
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
  try {
    const res = await fetch(endpoint, {
      method: "POST",
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
    return "";
  }
}

export async function answerFromKnowledgeBase(question: string): Promise<GroundedResult> {
  const hits = retrieve(question);
  if (hits.length === 0) return { kind: "handoff", text: UNKNOWN_QUESTION_LINE, sources: [] };
  const passages = hits.map((h) => h.answer);

  const llm = await rewriteWithLLM(question, passages);
  if (llm && llm !== "NO_ANSWER" && isSupported(llm, passages)) {
    return { kind: "answer", text: llm, sources: hits.map((h) => h.id) };
  }
  if (llm === "NO_ANSWER") return { kind: "handoff", text: UNKNOWN_QUESTION_LINE, sources: [] };

  // No key, or the draft failed the checks: use TXM's approved sentences directly.
  const text = firstSentences(passages[0], 2);
  return { kind: "answer", text, sources: [hits[0].id] };
}

/** Looks like a customer question or objection that deserves an answer, as opposed to a filler sound. */
export function looksLikeQuestion(text: string): boolean {
  const t = text.trim().toLowerCase();
  if (t.includes("?")) return true;
  if (/^(what|how|why|when|where|who|which|can|could|does|do|is|are|will|would|should|did|am|may)\b/.test(t)) return true;
  return t.split(/\s+/).length >= 5;
}
