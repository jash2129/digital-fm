import "server-only";

import { existsSync, readdirSync, statSync } from "fs";
import { resolve } from "path";
import { getHeygenLogsDir, getHeygenTranscript, saveHeygenTranscript, type HeygenCallLog } from "./heygen-logger";
import { upstashEnabled, upstashPipeline } from "./upstash";

// Where the Inspector's call logs live. Always the logs-heygen files (your PC, Render); also Upstash
// when it is set up, because on Vercel each request can land on a different server and the files
// there are temporary. Recordings stay on disk locally and in Google Drive (the call log sheet);
// they are too big for Upstash's free plan.

/** Logs are kept in Upstash this long */
export const LOG_TTL_SECONDS = 30 * 24 * 60 * 60;
/** Upstash's free plan refuses very large requests; bigger logs drop their detail tables first */
export const MAX_STORED_LOG_CHARS = 900_000;
const INDEX_KEY = "max:logs";
const LIST_LIMIT = 200;
const logKey = (id: string) => `max:log:${id}`;

export type StoredCallLog = HeygenCallLog & {
  /** Google Drive link to the recording, returned by the Make scenario's webhook response */
  recordingUrl?: string;
};

export interface CallLogSummary {
  sessionId: string;
  lastModified: string;
  durationSeconds: number;
  turnsCount: number;
  bargeInsCount: number;
  hasAudio: boolean;
  audioSizeBytes: number;
  recordingUrl?: string;
  avatarName: string;
  status: string;
}

/** For /api/health: is Upstash reachable, how many call logs it holds, and is this call's log there. */
export async function storeStatus(sessionId?: string): Promise<{ reachable: boolean; logs: number | null; thisCall?: boolean; error?: string }> {
  if (!upstashEnabled()) return { reachable: false, logs: null, error: "no Upstash settings found" };
  try {
    const [pong, count, exists] = await upstashPipeline([
      ["PING"],
      ["ZCARD", INDEX_KEY],
      ...(sessionId ? [["EXISTS", logKey(sessionId)]] : []),
    ]);
    return {
      reachable: pong === "PONG",
      logs: typeof count === "number" ? count : null,
      ...(sessionId ? { thisCall: exists === 1 } : {}),
    };
  } catch (err) {
    return { reachable: false, logs: null, error: err instanceof Error ? err.message : String(err) };
  }
}

/** The log as JSON, small enough for Upstash: drops turn logs, then timing logs, if it must */
export function fitForStore(log: StoredCallLog): string {
  let json = JSON.stringify(log);
  if (json.length > MAX_STORED_LOG_CHARS) json = JSON.stringify({ ...log, turnLogs: [] });
  if (json.length > MAX_STORED_LOG_CHARS) json = JSON.stringify({ ...log, turnLogs: [], timingLogs: [] });
  return json;
}

/** Saves a call's log to disk and, when set up, to Upstash. Never throws. */
export async function saveCallLog(log: StoredCallLog): Promise<void> {
  try {
    saveHeygenTranscript(log);
  } catch (err) {
    console.warn("[call-log-store] could not write the log file:", err);
  }
  if (!upstashEnabled()) return;
  const startMs = Date.parse(log.startTime) || Date.now();
  try {
    await upstashPipeline([
      ["SET", logKey(log.sessionId), fitForStore(log), "EX", LOG_TTL_SECONDS],
      ["ZADD", INDEX_KEY, startMs, log.sessionId],
      ["ZREMRANGEBYSCORE", INDEX_KEY, "-inf", Date.now() - LOG_TTL_SECONDS * 1000],
    ]);
  } catch (err) {
    console.error("[call-log-store] could not save the log to Upstash:", err);
  }
}

/** A call's log: Upstash first (the copy every server shares), then the log file. */
export async function loadCallLog(sessionId: string): Promise<StoredCallLog | null> {
  if (upstashEnabled()) {
    try {
      const [json] = await upstashPipeline([["GET", logKey(sessionId)]]);
      if (typeof json === "string") return JSON.parse(json) as StoredCallLog;
    } catch (err) {
      console.error("[call-log-store] could not read the log from Upstash:", err);
    }
  }
  return getHeygenTranscript(sessionId) as StoredCallLog | null;
}

function summarize(log: StoredCallLog, lastModified: string, audioSizeBytes: number): CallLogSummary {
  return {
    sessionId: log.sessionId,
    lastModified,
    durationSeconds: log.durationSeconds || 0,
    turnsCount: log.transcript?.length || 0,
    bargeInsCount: log.bargeIns?.length || 0,
    hasAudio: audioSizeBytes > 0,
    audioSizeBytes,
    recordingUrl: log.recordingUrl,
    avatarName: log.avatarName || "Max (Finance Manager)",
    status: log.status || "completed",
  };
}

function listFromFiles(): CallLogSummary[] {
  const dir = getHeygenLogsDir();
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .flatMap((file) => {
      const sessionId = file.replace(/\.json$/, "");
      try {
        const log = getHeygenTranscript(sessionId);
        if (!log) return [];
        const webm = resolve(dir, `${sessionId}.webm`);
        const audio = existsSync(webm) ? statSync(webm).size : 0;
        return [summarize({ ...log, sessionId }, statSync(resolve(dir, file)).mtime.toISOString(), audio)];
      } catch {
        return [];
      }
    });
}

async function listFromUpstash(): Promise<CallLogSummary[]> {
  if (!upstashEnabled()) return [];
  try {
    const [ids] = await upstashPipeline([["ZREVRANGE", INDEX_KEY, 0, LIST_LIMIT - 1]]);
    if (!Array.isArray(ids) || ids.length === 0) return [];
    const [jsons] = await upstashPipeline([["MGET", ...ids.map((id) => logKey(String(id)))]]);
    return (Array.isArray(jsons) ? jsons : []).flatMap((json) => {
      if (typeof json !== "string") return [];
      const log = JSON.parse(json) as StoredCallLog;
      return [summarize(log, log.endTime || log.startTime, 0)];
    });
  } catch (err) {
    console.error("[call-log-store] could not list logs from Upstash:", err);
    return [];
  }
}

/** Every call the Inspector can open, newest first. A call in both places keeps the file's audio info. */
export async function listCallLogs(): Promise<CallLogSummary[]> {
  const byId = new Map<string, CallLogSummary>();
  for (const s of await listFromUpstash()) byId.set(s.sessionId, s);
  for (const s of listFromFiles()) {
    const shared = byId.get(s.sessionId);
    byId.set(s.sessionId, { ...s, recordingUrl: s.recordingUrl ?? shared?.recordingUrl });
  }
  return [...byId.values()].sort((a, b) => Date.parse(b.lastModified) - Date.parse(a.lastModified));
}
