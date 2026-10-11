import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { resolve } from "path";
import "server-only";

export type UtteranceEntry = {
  role: "user" | "replica";
  text: string;
  timestamp: string;
};

export type CallLog = {
  conversationId: string;
  personaId: string;
  visitorId: string | null;
  dealId: string | null;
  startTime: string;
  endTime: string | null;
  durationSeconds: number | null;
  status: "active" | "completed";
  transcript: UtteranceEntry[];
};

function getLogsDir() {
  const logsDir = resolve(process.cwd(), "logs");
  if (!existsSync(logsDir)) {
    mkdirSync(logsDir, { recursive: true });
  }
  return logsDir;
}

function getLogPath(conversationId: string) {
  return resolve(getLogsDir(), `${conversationId}.json`);
}

export function initCallLog(
  conversationId: string,
  personaId: string,
  visitorId: string | null,
  dealId: string | null,
) {
  try {
    const logPath = getLogPath(conversationId);
    const initialLog: CallLog = {
      conversationId,
      personaId,
      visitorId,
      dealId,
      startTime: new Date().toISOString(),
      endTime: null,
      durationSeconds: null,
      status: "active",
      transcript: [],
    };
    writeFileSync(logPath, JSON.stringify(initialLog, null, 2), "utf8");
    console.log(`[call-logger] Initialized log for ${conversationId}`);
  } catch (error) {
    console.error("[call-logger] Error initializing log:", error);
  }
}

export function appendUtterance(conversationId: string, role: "user" | "replica", text: string) {
  try {
    const logPath = getLogPath(conversationId);
    if (!existsSync(logPath)) {
      return;
    }
    const logContent = readFileSync(logPath, "utf8").trim();
    if (!logContent) {
      return;
    }
    const log: CallLog = JSON.parse(logContent);

    log.transcript.push({
      role,
      text,
      timestamp: new Date().toISOString(),
    });

    writeFileSync(logPath, JSON.stringify(log, null, 2), "utf8");
  } catch (error) {
    console.error("[call-logger] Error appending utterance:", error);
  }
}

export function finalizeCallLog(conversationId: string, durationSeconds: number | null) {
  try {
    const logPath = getLogPath(conversationId);
    if (!existsSync(logPath)) {
      return;
    }
    const logContent = readFileSync(logPath, "utf8").trim();
    if (!logContent) {
      return;
    }
    const log: CallLog = JSON.parse(logContent);

    log.endTime = new Date().toISOString();
    log.durationSeconds = durationSeconds;
    log.status = "completed";

    writeFileSync(logPath, JSON.stringify(log, null, 2), "utf8");
    console.log(`[call-logger] Finalized log for ${conversationId} (${durationSeconds}s)`);
  } catch (error) {
    console.error("[call-logger] Error finalizing log:", error);
  }
}
