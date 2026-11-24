import "server-only";

import { listCallLogs, loadCallLog, type StoredCallLog } from "./call-log-store";
import { UNKNOWN_QUESTION_LINE } from "./max-lines";
import { adjustSetting, loadSettings, type SettingChange } from "./learned-settings";
import { upstashEnabled, upstashPipeline } from "./upstash";

// -----------------------------------------------------------------------------
// NIGHTLY LEARNING REPORT (Phase 6, 2026-11-24). Reads the calls since the last run and turns what
// happened in them into (1) timing changes Max makes on his own (customers cut off mid-sentence ->
// Max waits longer for them to finish) and (2) a report for TXM and the team: questions Max could
// not answer, the beats where customers get confused or ask for repeats, where calls stop, latency,
// and every coaching note with what Max did with it. Runs nightly (Vercel cron ->
// /api/learning/nightly) or on demand from /learning.
// -----------------------------------------------------------------------------

/** A customer interrupting this soon after Max started, with a real sentence, means Max replied while they were still talking */
export const CUTOFF_MS = 2500;
/** Customers cut off at least this often per call (over 3+ calls) -> Max waits 200 ms longer */
export const CUTOFF_RATE_ACTION = 1;

export interface CallSummary {
  sessionId: string;
  startTime: string;
  turns: number;
  lastBeat: number;
  completed: boolean;
  bargeIns: number;
  cutOffs: number;
  avgLatencyMs: number | null;
  coachingNotes: number;
}

export interface LearningReport {
  generatedAt: string;
  newCalls: number;
  calls: CallSummary[];
  totals: {
    calls: number;
    zeroTurnCalls: number;
    completed: number;
    avgTurns: number;
    cutOffs: number;
    bargeIns: number;
    avgLatencyMs: number | null;
    p90LatencyMs: number | null;
  };
  /** per beat: repeat requests, confusion, unclear words, unanswered questions, calls that stopped there */
  byBeat: Record<number, { repeats: number; confusion: number; unclear: number; unanswered: number; endedHere: number }>;
  unanswered: Array<{ question: string; beat: number; count: number }>;
  coaching: Array<{ sessionId: string; beat: number; note: string; category?: string; applied?: { from: string; to: string }; notApplied?: string; settings?: string[] }>;
  actions: SettingChange[];
  findings: string[];
}

const beatRow = () => ({ repeats: 0, confusion: 0, unclear: 0, unanswered: 0, endedHere: 0 });
const pct = (sorted: number[], p: number) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] : null);

/** The report for these calls (no side effects; the nightly run applies `actions`) */
export function buildReport(logs: StoredCallLog[]): LearningReport {
  const byBeat: LearningReport["byBeat"] = {};
  const row = (b: number) => (byBeat[b] ??= beatRow());
  const unanswered = new Map<string, { question: string; beat: number; count: number }>();
  const coaching: LearningReport["coaching"] = [];
  const latencies: number[] = [];
  const calls: CallSummary[] = [];

  for (const log of logs) {
    const turnLogs = log.turnLogs ?? [];
    const timing = log.timingLogs ?? [];
    const userTurns = turnLogs.length || (log.transcript ?? []).filter((t) => t.role === "user").length;
    const lastBeat = turnLogs.reduce((m, t) => Math.max(m, t.beatAfter ?? 0, t.beatBefore ?? 0), 0);
    const completed = lastBeat >= 25;
    for (const t of turnLogs) {
      const b = t.beatBefore ?? 0;
      if (t.intent === "repeat_request") row(b).repeats++;
      if (t.intent === "confusion" || t.intent === "role_confusion") row(b).confusion++;
      if (t.intent === "garbled") row(b).unclear++;
    }
    const callLatencies: number[] = [];
    for (const t of timing) {
      const ms = t.stageMs?.total ?? t.gaps?.total_latency_ms;
      if (typeof ms === "number" && ms > 0 && ms < 120_000) callLatencies.push(ms);
      if (t.avatarText?.includes(UNKNOWN_QUESTION_LINE) && t.userInput?.trim()) {
        const beat = t.controller?.beatBefore ?? 0;
        row(beat).unanswered++;
        const key = t.userInput.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
        const u = unanswered.get(key) ?? { question: t.userInput.trim(), beat, count: 0 };
        u.count++;
        unanswered.set(key, u);
      }
    }
    latencies.push(...callLatencies);
    const bargeIns = log.bargeIns ?? [];
    const cutOffs = bargeIns.filter((b) => (b.msIntoLine ?? Infinity) < CUTOFF_MS && (b.words ?? 0) >= 3).length;
    if (userTurns > 0 && !completed && lastBeat > 0) row(lastBeat).endedHere++;
    for (const f of log.trainerFeedback ?? []) {
      coaching.push({
        sessionId: log.sessionId,
        beat: f.beat,
        note: f.feedback,
        category: f.category,
        applied: f.applied ? { from: f.applied.from, to: f.applied.to } : undefined,
        notApplied: f.notApplied,
        settings: (f as { settingsChanged?: string[] }).settingsChanged,
      });
    }
    calls.push({
      sessionId: log.sessionId,
      startTime: log.startTime,
      turns: userTurns,
      lastBeat,
      completed,
      bargeIns: bargeIns.length,
      cutOffs,
      avgLatencyMs: callLatencies.length ? Math.round(callLatencies.reduce((a, b) => a + b, 0) / callLatencies.length) : null,
      coachingNotes: (log.trainerFeedback ?? []).length,
    });
  }

  const real = calls.filter((c) => c.turns > 0);
  const sorted = [...latencies].sort((a, b) => a - b);
  const totals = {
    calls: calls.length,
    zeroTurnCalls: calls.length - real.length,
    completed: real.filter((c) => c.completed).length,
    avgTurns: real.length ? Math.round(real.reduce((a, c) => a + c.turns, 0) / real.length) : 0,
    cutOffs: real.reduce((a, c) => a + c.cutOffs, 0),
    bargeIns: real.reduce((a, c) => a + c.bargeIns, 0),
    avgLatencyMs: sorted.length ? Math.round(sorted.reduce((a, b) => a + b, 0) / sorted.length) : null,
    p90LatencyMs: pct(sorted, 0.9),
  };

  const findings: string[] = [];
  const top = [...unanswered.values()].sort((a, b) => b.count - a.count);
  if (top.length) findings.push(`Max could not answer ${top.length} different question(s); most asked: "${top[0].question}" (Beat ${top[0].beat}, ${top[0].count}x). Each needs an approved answer in the knowledge base.`);
  const beats = Object.entries(byBeat).map(([b, r]) => ({ beat: Number(b), ...r }));
  const confusing = beats.filter((r) => r.repeats + r.confusion >= 2).sort((a, b) => b.repeats + b.confusion - (a.repeats + a.confusion));
  for (const r of confusing.slice(0, 3)) findings.push(`Beat ${r.beat}: customers asked for a repeat or were confused ${r.repeats + r.confusion} time(s). A simpler wording here (coach it: "instead of X say Y") would help.`);
  const stops = beats.filter((r) => r.endedHere >= 2).sort((a, b) => b.endedHere - a.endedHere);
  for (const r of stops.slice(0, 2)) findings.push(`${r.endedHere} call(s) stopped at Beat ${r.beat}.`);
  if (real.length && totals.cutOffs / real.length >= CUTOFF_RATE_ACTION) findings.push(`Max cut customers off mid-sentence ${totals.cutOffs} time(s) in ${real.length} call(s).`);
  if (totals.p90LatencyMs && totals.p90LatencyMs > 3000) findings.push(`Slow replies: 1 in 10 took over ${(totals.p90LatencyMs / 1000).toFixed(1)} s.`);
  if (totals.zeroTurnCalls) findings.push(`${totals.zeroTurnCalls} call(s) had no customer turns (connection or microphone).`);
  const notApplied = coaching.filter((c) => c.notApplied);
  if (notApplied.length) findings.push(`${notApplied.length} coaching note(s) could not be applied automatically; see the coaching list.`);
  if (!findings.length && real.length) findings.push("No problems found in these calls.");

  return {
    generatedAt: new Date().toISOString(),
    newCalls: calls.length,
    calls,
    totals,
    byBeat,
    unanswered: top.slice(0, 20),
    coaching,
    actions: [],
    findings,
  };
}

/** The changes Max makes on his own from these calls (no approval); only on calls not seen before */
export async function applySignals(report: LearningReport): Promise<SettingChange[]> {
  const real = report.calls.filter((c) => c.turns >= 3);
  const actions: SettingChange[] = [];
  if (real.length >= 3) {
    const cut = real.reduce((a, c) => a + c.cutOffs, 0);
    if (cut / real.length >= CUTOFF_RATE_ACTION) {
      const c = await adjustSetting("endOfTurnExtraMs", 200, "signals", `customers cut off mid-sentence ${cut} time(s) in ${real.length} calls`);
      if (c) actions.push(c);
    }
  }
  return actions;
}

const LATEST = "max:report:latest";
const LAST_RUN = "max:report:last-run";
let memLatest: LearningReport | null = null;
let memLastRun = 0;

export async function latestReport(): Promise<LearningReport | null> {
  if (!upstashEnabled()) return memLatest;
  try {
    const [raw] = await upstashPipeline([["GET", LATEST]]);
    return typeof raw === "string" ? (JSON.parse(raw) as LearningReport) : null;
  } catch {
    return memLatest;
  }
}

/** Builds the report from the calls since the last run, applies what it learned, and saves it */
export async function runLearning(opts: { maxCalls?: number } = {}): Promise<LearningReport> {
  await loadSettings(true);
  let lastRun = memLastRun;
  if (upstashEnabled()) {
    try {
      const [raw] = await upstashPipeline([["GET", LAST_RUN]]);
      if (raw) lastRun = Number(raw) || 0;
    } catch {
      /* first run */
    }
  }
  const startedAt = Date.now();
  const summaries = (await listCallLogs()).filter((s) => Date.parse(s.lastModified) > lastRun).slice(0, opts.maxCalls ?? 30);
  const logs: StoredCallLog[] = [];
  for (const s of summaries) {
    const log = await loadCallLog(s.sessionId).catch(() => null);
    if (log) logs.push(log);
  }
  const report = buildReport(logs);
  report.actions = await applySignals(report);
  memLatest = report;
  memLastRun = startedAt;
  if (upstashEnabled()) {
    try {
      await upstashPipeline([
        ["SET", LATEST, JSON.stringify(report)],
        ["SET", `max:report:${report.generatedAt.slice(0, 10)}`, JSON.stringify(report), "EX", 60 * 24 * 60 * 60],
        ["SET", LAST_RUN, String(startedAt)],
      ]);
    } catch (err) {
      console.error("[learning-report] save failed:", err);
    }
  }
  console.log(JSON.stringify({ event: "learning_report", calls: report.newCalls, actions: report.actions.length, findings: report.findings.length }));
  return report;
}
