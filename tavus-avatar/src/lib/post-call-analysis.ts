import "server-only";

import type { CallState } from "./beat-controller";
import { analyzeCallExperience } from "./call-experience-analyzer";
import type { HeygenCallLog } from "./heygen-logger";

// Post-call analysis for the call log sheet, from three sources:
//  - the turn-taking analyzer the Inspector uses (rating, timestamped echo / cut-off / latency problems)
//  - compliance checks in code (disclosure given, price never under the $3 floor, no handoff promised)
//  - one LLM review of the transcript (summary, sentiment, score, what went wrong / well, fixes)
// The LLM part is best effort: on no key, timeout or bad output the row gets the other two.

export const JUDGE_TIMEOUT_MS = 25_000;
const MAX_TRANSCRIPT_FOR_JUDGE = 24_000;

export interface PostCallAnalysis {
  aiScore: number | "";
  aiVerdict: string;
  callSummary: string;
  customerSentiment: string;
  problemsFound: string;
  wentWell: string;
  suggestedFixes: string;
  complianceCheck: string;
}

export interface JudgeResult {
  score: number;
  summary: string;
  sentiment: string;
  wentWrong: string[];
  wentWell: string[];
  fixes: string[];
}

const maxLines = (log: HeygenCallLog) => (log.transcript ?? []).filter((t) => t.role !== "user").map((t) => t.text ?? "");

/** Deterministic checks of what Max said. "not reached" when the call ended before it mattered. */
export function complianceChecks(log: HeygenCallLog, state?: CallState): string {
  const said = maxLines(log).join(" ");
  const furthest = state ? Math.max(state.current_beat, ...state.delivered_beats) : 0;

  const disclosure = /recorded audio and video/i.test(said) ? "PASS" : furthest > 1 ? "FAIL" : "not reached";
  // Any daily amount under the $3 hard floor, in words or digits
  const underFloor = /\b(one|two) dollars?\b|\btwo (fifty|twenty five|seventy five)\b|\$\s?[0-2](\.\d+)?\b/i.test(said);
  const priceOffered = /\b(four|three) dollars?\b|\$\s?[3-4](\.\d+)?\b/i.test(said);
  const priceFloor = underFloor ? "FAIL" : priceOffered ? "PASS" : "not reached";
  const handoff = /\b(bring in|transfer you|connect you (with|to)|member of our team will|someone from our team will|let me get (a|my) manager)\b/i.test(said)
    ? "FAIL"
    : "PASS";

  return `Disclosure given: ${disclosure} | Price never under $3/day: ${priceFloor} | No human handoff promised: ${handoff}`;
}

/** The analyzer's timestamped problems, worst first, as sheet lines. Never throws: odd logs get a note. */
function timingProblems(log: HeygenCallLog): { verdict: string; rating: string; lines: string[] } {
  let a: ReturnType<typeof analyzeCallExperience>;
  try {
    a = analyzeCallExperience(log);
  } catch (err) {
    console.warn("[post-call-analysis] turn-taking analysis failed:", err);
    return { rating: "Unknown", verdict: "turn-taking analysis unavailable for this call", lines: [] };
  }
  const order = { critical: 0, warning: 1, minor: 2 } as const;
  const lines = [...a.experienceFlaws]
    .sort((x, y) => order[x.severity] - order[y.severity] || x.second - y.second)
    .slice(0, 8)
    .map((f) => `[${f.timeFormatted}] ${f.title} (${f.severity})`);
  return { verdict: a.summaryVerdict, rating: a.summaryRating, lines };
}

const JUDGE_SYSTEM = `You review recorded calls between "Max", an AI finance manager at a car dealership, and a customer (here often a tester role-playing a customer).
Max follows an approved script: a short greeting, a legally required recording disclosure, qualifying questions (test drive, walkaround, warranty understanding), an explanation of why cars break down and what the factory warranty does not cover, then a vehicle protection package at $4/day, which he may lower to $3.50, $3.25 and a hard floor of $3/day. He must never quote under $3, never promise a human handoff, and must not invent facts.
Judge the call from the customer's point of view: was Max clear, did he listen and respond to what was actually said, did the conversation flow, did he stay compliant.
Transcripts come from speech recognition: odd fragments in the customer's lines may be recognition errors or Max's own voice picked up by the microphone. Say so rather than blaming the customer.
Reply with ONLY a JSON object:
{"score": 1-10, "summary": "2 sentences: what happened and how it ended", "sentiment": "one word from Positive, Neutral, Negative or Frustrated, a colon, then the reason in under 15 words", "wentWrong": ["up to 5 specific problems, each quoting or pointing to the moment"], "wentWell": ["up to 3 specific things"], "fixes": ["up to 3 concrete changes to Max, most important first"]}`;

/** Pulls the JSON object out of the model's reply; null if it is not usable. */
export function parseJudgeReply(content: string): JudgeResult | null {
  const match = content.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const raw = JSON.parse(match[0]);
    const list = (v: unknown) => (Array.isArray(v) ? v.map(String).filter(Boolean).slice(0, 5) : []);
    const score = Math.round(Number(raw.score));
    if (!Number.isFinite(score) || score < 1 || score > 10) return null;
    return {
      score,
      summary: String(raw.summary ?? "").trim(),
      sentiment: String(raw.sentiment ?? "").trim(),
      wentWrong: list(raw.wentWrong),
      wentWell: list(raw.wentWell).slice(0, 3),
      fixes: list(raw.fixes).slice(0, 3),
    };
  } catch {
    return null;
  }
}

/** One LLM review of the call. Same keys and model choice as the rest of the app (xAI first, then OpenAI). */
export async function judgeCall(transcriptText: string, facts: string): Promise<JudgeResult | null> {
  const apiKey = process.env.XAI_API_KEY?.trim() || process.env.OPENAI_API_KEY?.trim();
  if (!apiKey || !transcriptText.trim()) return null;
  const isXai = Boolean(process.env.XAI_API_KEY?.trim());
  const endpoint = isXai ? "https://api.x.ai/v1/chat/completions" : "https://api.openai.com/v1/chat/completions";
  const model = process.env.GROK_MODEL?.trim() || (isXai ? "grok-4.20-0309-non-reasoning" : "gpt-4o-mini");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), JUDGE_TIMEOUT_MS);
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        max_tokens: 700,
        messages: [
          { role: "system", content: JUDGE_SYSTEM },
          { role: "user", content: `CALL FACTS:\n${facts}\n\nTRANSCRIPT:\n${transcriptText.slice(0, MAX_TRANSCRIPT_FOR_JUDGE)}` },
        ],
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return parseJudgeReply(data.choices?.[0]?.message?.content ?? "");
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Everything the sheet's analysis columns need for one call. */
export function combineAnalysis(log: HeygenCallLog, state: CallState | undefined, judge: JudgeResult | null): PostCallAnalysis {
  const timing = timingProblems(log);
  const bullets = (items: string[]) => items.map((s) => `• ${s}`).join("\n");
  const problems = [...(judge?.wentWrong ?? []), ...timing.lines.map((l) => `Timing: ${l}`)];
  return {
    aiScore: judge?.score ?? "",
    aiVerdict: `${timing.rating}: ${timing.verdict}`,
    callSummary: judge?.summary || "(AI review unavailable for this call)",
    customerSentiment: judge?.sentiment ?? "",
    problemsFound: problems.length ? bullets(problems) : "None found",
    wentWell: bullets(judge?.wentWell ?? []),
    suggestedFixes: bullets(judge?.fixes ?? []),
    complianceCheck: complianceChecks(log, state),
  };
}

/** Runs the whole analysis for a finished call. Never throws: a failed AI review only blanks its columns. */
export async function analyzeFinishedCall(
  log: HeygenCallLog,
  state: CallState | undefined,
  transcriptText: string,
  facts: string
): Promise<PostCallAnalysis> {
  let judge: JudgeResult | null = null;
  try {
    judge = await judgeCall(transcriptText, facts);
  } catch {
    judge = null;
  }
  return combineAnalysis(log, state, judge);
}
