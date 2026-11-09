import "server-only";

import { activeStates, type CallState } from "./beat-controller";
import { getHeygenAudio, type HeygenCallLog } from "./heygen-logger";
import { loadCallLog, saveCallLog } from "./call-log-store";
import { UNKNOWN_QUESTION_LINE } from "./max-lines";
import { analyzeFinishedCall, type PostCallAnalysis } from "./post-call-analysis";
import { upstashEnabled, upstashPipeline } from "./upstash";

// Sends each finished call to the call log sheet (a Make.com webhook, see docs/MAKE-CALL-LOG.md).
// Needs CALL_LOG_WEBHOOK_URL; CALL_LOG_SECRET is checked by the scenario's filter. With no URL set
// it does nothing, so local development and tests never post anywhere.

/**
 * Recordings above this are left out (Make limits webhook and file sizes; base64 adds a third); the
 * row is still added. At the recorder's 24 kbps this is about 17 minutes of call.
 */
export const MAX_RECORDING_BYTES = 3 * 1024 * 1024;
const MAX_TRANSCRIPT_CHARS = 45_000;
const MAX_LOG_CHARS = 2_000_000;
const SEND_TIMEOUT_MS = 20_000;

// Calls already sent from this process, so a double "end" never adds two rows
const globalForCallLog = globalThis as unknown as { sentCallLogs?: Set<string> };
const sent = (globalForCallLog.sentCallLogs ??= new Set<string>());

const NO_ANALYSIS: PostCallAnalysis = {
  aiScore: "",
  aiVerdict: "",
  callSummary: "",
  customerSentiment: "",
  problemsFound: "",
  wentWell: "",
  suggestedFixes: "",
  complianceCheck: "",
};

export interface CallLogPayload extends PostCallAnalysis {
  secret: string;
  callId: string;
  startTime: string;
  durationSec: number | "";
  environment: string;
  endedHow: string;
  furthestBeat: number | "";
  finalPrice: number | "";
  customerTurns: number;
  avgReplyMs: number | "";
  slowestReplyMs: number | "";
  interruptions: number;
  echoDrops: number;
  unknownReplies: number;
  transcriptText: string;
  inspectorUrl: string;
  recordingBase64: string;
  recordingMimeType: string;
  logJson: string;
}

function howItEnded(state: CallState | undefined): string {
  if (!state) return "unknown (call state no longer in server memory)";
  if (state.is_stopped && state.current_beat >= 25) return "script complete";
  if (state.is_stopped) return "ended by Max (goodbye or recording objection)";
  return "customer ended the call";
}

/** The sheet row for one call: its numbers, transcript, links and attachments. Pure, for tests. */
export function buildCallLogPayload(
  log: HeygenCallLog,
  opts: {
    secret: string;
    origin: string;
    environment: string;
    state?: CallState;
    recording?: Buffer | null;
    analysis?: PostCallAnalysis;
  }
): CallLogPayload {
  const transcript = log.transcript ?? [];
  const latencies = (log.timingLogs ?? [])
    .map((t: { stageMs?: { total?: number }; gaps?: { total_latency_ms?: number } }) => t.stageMs?.total ?? t.gaps?.total_latency_ms)
    .filter((n): n is number => typeof n === "number" && n > 0);
  const furthestBeat = opts.state ? Math.max(opts.state.current_beat, ...opts.state.delivered_beats) : "";
  // A price was only ever offered from Beat 22 on
  const finalPrice = typeof furthestBeat === "number" && furthestBeat >= 22 && log.finalDailyRate ? Number(log.finalDailyRate) : "";

  let transcriptText = transcript.map((t) => `${t.role === "user" ? "Customer" : "Max"}: ${t.text}`).join("\n");
  if (transcriptText.length > MAX_TRANSCRIPT_CHARS) {
    transcriptText = `${transcriptText.slice(0, MAX_TRANSCRIPT_CHARS)}\n... (cut: full transcript in the log file)`;
  }
  let logJson = JSON.stringify(log);
  if (logJson.length > MAX_LOG_CHARS) logJson = JSON.stringify({ ...log, timingLogs: [], turnLogs: [], note: "timing and turn logs cut for size" });

  const recording = opts.recording && opts.recording.byteLength <= MAX_RECORDING_BYTES ? opts.recording : null;

  return {
    secret: opts.secret,
    callId: log.sessionId,
    startTime: log.startTime,
    durationSec: log.durationSeconds ?? "",
    // e.g. "production · deepgram", so calls can be compared by speech recognition
    environment: log.sttEngine ? `${opts.environment} · ${log.sttEngine}` : opts.environment,
    endedHow: howItEnded(opts.state),
    furthestBeat,
    finalPrice,
    customerTurns: transcript.filter((t) => t.role === "user").length,
    avgReplyMs: latencies.length ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : "",
    slowestReplyMs: latencies.length ? Math.max(...latencies) : "",
    interruptions: (log.bargeIns ?? []).length,
    echoDrops: (log.turnLogs ?? []).filter(
      (e: { event?: string; reason?: string }) => e.event === "transcript_dropped" && (e.reason === "avatar_echo" || e.reason === "echo_fragment")
    ).length,
    unknownReplies: transcript.filter((t) => t.role !== "user" && t.text?.includes(UNKNOWN_QUESTION_LINE)).length,
    transcriptText,
    inspectorUrl: `${opts.origin}/inspector?session=${encodeURIComponent(log.sessionId)}`,
    recordingBase64: recording ? recording.toString("base64") : "",
    recordingMimeType: "audio/webm",
    logJson,
    ...(opts.analysis ?? NO_ANALYSIS),
  };
}

/**
 * If the scenario's webhook response includes the recording's Drive link
 * ({"ok": true, "recordingUrl": "..."}), keep it on the stored log so the Inspector can link to the
 * recording on hosts with no audio file (Vercel). Any other response is fine and ignored.
 */
async function rememberRecordingLink(res: Response, log: HeygenCallLog): Promise<void> {
  try {
    const data = (await res.json()) as { recordingUrl?: unknown };
    if (typeof data.recordingUrl === "string" && data.recordingUrl.startsWith("http")) {
      const saved = (await loadCallLog(log.sessionId)) ?? log;
      await saveCallLog({ ...saved, recordingUrl: data.recordingUrl });
    }
  } catch {
    // Make's default reply is plain text ("Accepted"): nothing to remember
  }
}

// Claims a call for sending, across every server instance when the shared store is set up (Vercel
// ran two instances that each sent the same call: duplicate rows). Local memory otherwise.
const SENT_TTL_SECONDS = 24 * 60 * 60;
async function claimSend(sessionId: string): Promise<boolean> {
  if (sent.has(sessionId)) return false;
  sent.add(sessionId);
  if (!upstashEnabled()) return true;
  try {
    const [claimed] = await upstashPipeline([["SET", `max:sent:${sessionId}`, "1", "NX", "EX", SENT_TTL_SECONDS]]);
    return claimed === "OK";
  } catch {
    return true; // the store is down: better a possible duplicate row than a lost call
  }
}
async function releaseSend(sessionId: string): Promise<void> {
  sent.delete(sessionId);
  if (!upstashEnabled()) return;
  try {
    await upstashPipeline([["DEL", `max:sent:${sessionId}`]]);
  } catch {}
}

export type SendResult = { sent: true; status: number } | { sent: false; reason: string };

/**
 * Posts a finished call to the call log webhook. The app sends the log and recording with the
 * request (serverless hosts have no lasting disk); without them they are read from the saved files.
 */
export async function sendCallLog(
  sessionId: string,
  origin: string,
  provided: { log?: HeygenCallLog | null; recording?: Buffer | null } = {}
): Promise<SendResult> {
  const url = process.env.CALL_LOG_WEBHOOK_URL?.trim();
  if (!url) return { sent: false, reason: "CALL_LOG_WEBHOOK_URL not set" };
  if (sent.has(sessionId)) return { sent: false, reason: "already sent" };
  const log = provided.log ?? (await loadCallLog(sessionId));
  if (!log) return { sent: false, reason: "no saved log for this call" };

  const base = {
    secret: process.env.CALL_LOG_SECRET?.trim() ?? "",
    origin,
    environment: process.env.RENDER ? "render" : process.env.NODE_ENV === "production" ? "production" : "local",
    state: activeStates.get(sessionId),
    recording: provided.recording ?? getHeygenAudio(sessionId),
  };
  // Claimed before the slow AI review, so a second "end" (on any server) cannot race it
  if (!(await claimSend(sessionId))) return { sent: false, reason: "already sent" };

  // Post-call analysis: the facts the reviewer gets are the measured ones, so it does not guess them
  const draft = buildCallLogPayload(log, base);
  const facts = [
    `Duration: ${draft.durationSec}s, ended: ${draft.endedHow}, furthest script beat: ${draft.furthestBeat || "unknown"} of 25`,
    `Average reply time: ${draft.avgReplyMs || "?"} ms, slowest: ${draft.slowestReplyMs || "?"} ms`,
    `Max was interrupted ${draft.interruptions} times; ${draft.echoDrops} transcripts were dropped as Max's own voice (speaker echo)`,
  ].join("\n");
  const analysis = await analyzeFinishedCall(log, base.state, draft.transcriptText, facts);
  const payload = { ...draft, ...analysis };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!res.ok) {
      await releaseSend(sessionId); // let a retry go through
      return { sent: false, reason: `webhook answered ${res.status}` };
    }
    await rememberRecordingLink(res, log);
    return { sent: true, status: res.status };
  } catch (err) {
    await releaseSend(sessionId);
    return { sent: false, reason: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timer);
  }
}
