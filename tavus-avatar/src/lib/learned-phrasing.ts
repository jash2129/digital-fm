import "server-only";

import { upstashEnabled, upstashPipeline } from "./upstash";

// -----------------------------------------------------------------------------
// LEARNED PHRASING (2026-11-24). When TXM coaches a rewording in a call ("instead of misinstalled,
// say it's a defect", "don't say X, say Y", "change X to Y"), Max uses it at once, with no approval
// step: from the next line of that call and in every call after (saved in Upstash Redis when it is
// connected, otherwise in this server's memory). Applied to every line Max speaks; beats.json is not
// touched. Two locks stay in code: the price ladder figures and the recording disclosure.
// Remove a bad one with DELETE /api/learned?id=<id>.
// -----------------------------------------------------------------------------

export interface Rephrasing {
  id: string;
  /** Max's words as he said them */
  from: string;
  /** what to say instead ("" = leave the words out) */
  to: string;
  createdAt: number;
  sessionId?: string;
  beat?: number;
  /** the trainer's whole note */
  note: string;
}

const KEY = "max:rephrase";
const CACHE_MS = 30_000;
let rules: Rephrasing[] = [];
let loadedAt = 0;

export function currentRephrasings(): Rephrasing[] {
  return rules;
}

/** Fresh rules from the shared store (cached 30 s); this server's memory when there is no store */
export async function loadRephrasings(force = false): Promise<Rephrasing[]> {
  if (!upstashEnabled() || (!force && Date.now() - loadedAt < CACHE_MS)) return rules;
  try {
    const [raw] = await upstashPipeline([["GET", KEY]]);
    rules = typeof raw === "string" ? (JSON.parse(raw) as Rephrasing[]) : [];
    loadedAt = Date.now();
  } catch (err) {
    console.error("[learned-phrasing] load failed, using this server's copy:", err);
  }
  return rules;
}

async function persist(): Promise<void> {
  if (!upstashEnabled()) return;
  try {
    await upstashPipeline([["SET", KEY, JSON.stringify(rules)]]);
    loadedAt = Date.now();
  } catch (err) {
    console.error("[learned-phrasing] save failed; this rewording lives on this server only:", err);
  }
}

export async function addRephrasing(r: Omit<Rephrasing, "id" | "createdAt">): Promise<Rephrasing> {
  await loadRephrasings(true);
  const rule: Rephrasing = { ...r, id: Math.random().toString(36).slice(2, 10), createdAt: Date.now() };
  // A newer coaching of the same words replaces the older one
  rules = [...rules.filter((x) => norm(x.from) !== norm(rule.from)), rule];
  await persist();
  console.log(JSON.stringify({ event: "rephrasing_learned", id: rule.id, from: rule.from, to: rule.to, beat: rule.beat, sessionId: rule.sessionId }));
  return rule;
}

export async function deleteRephrasing(id: string): Promise<boolean> {
  await loadRephrasings(true);
  const before = rules.length;
  rules = rules.filter((r) => r.id !== id);
  if (rules.length === before) return false;
  await persist();
  return true;
}

/** Tests only */
export function resetRephrasings(list: Rephrasing[] = []): void {
  rules = list;
  loadedAt = 0;
}

const norm = (t: string) => t.toLowerCase().replace(/['’]/g, "").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
const escape = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Matches the words with any spacing/punctuation between them, never inside another word */
function phraseRegex(phrase: string): RegExp | null {
  const words = phrase.split(/[^A-Za-z0-9'’]+/).filter(Boolean).map((w) => escape(w).replace(/['’]/g, "['’]?"));
  if (!words.length) return null;
  // Zero or more separators: Max's polish writes "mis installed" as "misinstalled"
  return new RegExp(`(?<![A-Za-z0-9])${words.join("[\\s,;:\\-–—]*")}(?![A-Za-z0-9])`, "gi");
}

/** Every learned rewording applied to one line Max is about to say. Safe to run twice. */
export function applyRephrasings(text: string, list: Rephrasing[] = rules): string {
  if (!text || !list.length) return text;
  let out = text;
  let removed = false;
  for (const r of list) {
    const re = phraseRegex(r.from);
    if (!re) continue;
    if (!r.to && re.test(out)) removed = true;
    re.lastIndex = 0;
    // Words already in their new form are left alone, so applying twice changes nothing
    const kept: string[] = [];
    const toRe = r.to ? phraseRegex(r.to) : null;
    if (toRe) out = out.replace(toRe, (m) => `\u0000${kept.push(m) - 1}\u0000`);
    out = out.replace(re, (m) => {
      if (!r.to) return "";
      return /^[A-Z]/.test(m) ? r.to.charAt(0).toUpperCase() + r.to.slice(1) : r.to;
    });
    out = out.replace(/\u0000(\d+)\u0000/g, (_m, i) => kept[Number(i)]);
  }
  if (!removed) return out;
  // Tidy what a removal leaves behind
  return out
    .replace(/([.!?])\s*[.,;]+/g, "$1")
    .replace(/\s+([,.!?])/g, "$1")
    .replace(/([,;])\s*([,.;!?])/g, "$2")
    .replace(/\s{2,}/g, " ")
    .replace(/^[\s,;.!?]+/, "")
    .replace(/(^|[.!?]\s+)([a-z])/g, (_m, p, c) => p + c.toUpperCase())
    .trim();
}

const clean = (t: string) =>
  t
    .trim()
    .replace(/^(?:the (?:word|words|phrase|line)|that you say|saying|it as|it)\s+/i, "")
    .replace(/^["'“”‘’]+|["'“”‘’]+$/g, "")
    .replace(/[\s,.;:!?]+$/g, "")
    .replace(/^["'“”‘’]+|["'“”‘’]+$/g, "")
    .trim();

/** The rewording in a trainer's note: { from, to } (to = "" removes the words), or null */
export function parseRephrase(note: string): { from: string; to: string } | null {
  const t = note.replace(/\s+/g, " ").trim();
  const patterns: Array<[RegExp, (m: RegExpMatchArray) => { from: string; to: string }]> = [
    [/\b(?:instead of|rather than)\s+(?:saying\s+)?(.+?)[,;.]?\s+(?:you should\s+|just\s+|please\s+)?(?:say|use)\s+(.+)$/i, (m) => ({ from: m[1], to: m[2] })],
    [/\b(?:don'?t|do not|never)\s+say\s+(.+?)[,;.]?\s+(?:instead\s+)?(?:say|use|you should say)\s+(.+)$/i, (m) => ({ from: m[1], to: m[2] })],
    [/\bsay\s+(.+?)\s+instead of\s+(?:saying\s+)?(.+)$/i, (m) => ({ from: m[2], to: m[1] })],
    [/\buse\s+(.+?)\s+instead of\s+(.+)$/i, (m) => ({ from: m[2], to: m[1] })],
    [/\b(?:change|replace|switch)\s+(.+?)\s+(?:to|with|into|for)\s+(.+)$/i, (m) => ({ from: m[1], to: m[2] })],
    [/\brephrase\s+(.+?)\s+(?:as|to|into)\s+(.+)$/i, (m) => ({ from: m[1], to: m[2] })],
    [/\b(?:don'?t|do not|never|stop)\s+(?:say|saying)\s+(.+)$/i, (m) => ({ from: m[1], to: "" })],
  ];
  for (const [re, pick] of patterns) {
    const m = t.match(re);
    if (!m) continue;
    const { from, to } = pick(m);
    const f = clean(from);
    const s = clean(to);
    if (f && (s || /\b(?:don'?t|do not|never|stop)\s+(?:say|saying)\b/i.test(t))) return { from: f, to: s };
  }
  return null;
}

// The two things coaching cannot reword: the price ladder and the recording disclosure
const PRICE_LOCK = /\b(a day|per day|daily|four dollars|three dollars|fifty cents|twenty five cents|twenty-five cents)\b|\$\s?\d/i;
const DISCLOSURE_LOCK = /\b(recorded|recording|audio and video|required by (the )?law)\b/i;

/** Why this rewording cannot be used, or null when it can */
export function lockedReason(from: string, to: string): string | null {
  if (PRICE_LOCK.test(from) || PRICE_LOCK.test(to)) return "prices come from the price ladder";
  if (DISCLOSURE_LOCK.test(from) || DISCLOSURE_LOCK.test(to)) return "the recording disclosure stays word for word";
  if (to.split(/\s+/).length > 60) return "the new wording is too long";
  return null;
}

/**
 * Finds the trainer's words in what Max says (the recognizer writes "mis installed" as
 * "misinstalled"): returns Max's own spelling of them, or null when Max never says them.
 */
export function findMaxWords(phrase: string, maxText: string): string | null {
  const target = phrase.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (target.length < 3) return null;
  const idx: number[] = [];
  let compact = "";
  for (let i = 0; i < maxText.length; i++) {
    const c = maxText[i].toLowerCase();
    if (/[a-z0-9]/.test(c)) {
      compact += c;
      idx.push(i);
    }
  }
  let at = compact.indexOf(target);
  while (at >= 0) {
    const start = idx[at];
    const end = idx[at + target.length - 1] + 1;
    // Whole words only
    if (!/[A-Za-z0-9]/.test(maxText[start - 1] ?? "") && !/[A-Za-z0-9]/.test(maxText[end] ?? "")) return maxText.slice(start, end);
    at = compact.indexOf(target, at + 1);
  }
  return null;
}
