import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { resolve } from "path";
import "server-only";

export type HeygenUtteranceEntry = {
  role: "user" | "assistant";
  text: string;
  timestamp: string;
};

export type HeygenCallLog = {
  sessionId: string;
  engine: "heygen-grok";
  avatarId: string;
  avatarName: string;
  startTime: string;
  endTime: string | null;
  durationSeconds: number | null;
  status: "active" | "completed";
  productsCovered?: string[];
  finalDailyRate?: number | string | null;
  transcript: HeygenUtteranceEntry[];
};

export function getHeygenLogsDir() {
  const logsDir = resolve(process.cwd(), "logs-heygen");
  if (!existsSync(logsDir)) {
    mkdirSync(logsDir, { recursive: true });
  }
  return logsDir;
}

export function getHeygenLogPath(sessionId: string) {
  return resolve(getHeygenLogsDir(), `${sessionId}.json`);
}

export function getHeygenAudioPath(sessionId: string) {
  return resolve(getHeygenLogsDir(), `${sessionId}.webm`);
}

export function saveHeygenTranscript(logData: HeygenCallLog): void {
  try {
    const logPath = getHeygenLogPath(logData.sessionId);
    writeFileSync(logPath, JSON.stringify(logData, null, 2), "utf8");
    console.log(`[heygen-logger] Saved transcript to logs-heygen/${logData.sessionId}.json`);
  } catch (error) {
    console.error("[heygen-logger] Error saving transcript:", error);
  }
}

export function getHeygenTranscript(sessionId: string): HeygenCallLog | null {
  try {
    const logPath = getHeygenLogPath(sessionId);
    if (!existsSync(logPath)) return null;
    return JSON.parse(readFileSync(logPath, "utf8"));
  } catch (error) {
    console.error("[heygen-logger] Error reading transcript:", error);
    return null;
  }
}

export function saveHeygenAudio(sessionId: string, buffer: Buffer): void {
  try {
    const audioPath = getHeygenAudioPath(sessionId);
    writeFileSync(audioPath, buffer);
    console.log(`[heygen-logger] Saved ${buffer.byteLength} bytes to logs-heygen/${sessionId}.webm`);
  } catch (error) {
    console.error("[heygen-logger] Error saving audio:", error);
  }
}

export function getHeygenAudio(sessionId: string): Buffer | null {
  try {
    const audioPath = getHeygenAudioPath(sessionId);
    if (!existsSync(audioPath)) return null;
    return readFileSync(audioPath);
  } catch (error) {
    console.error("[heygen-logger] Error reading audio:", error);
    return null;
  }
}
