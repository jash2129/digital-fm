import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { resolve } from "path";
import "server-only";

export type HeygenUtteranceEntry = {
  role: "user" | "assistant";
  text: string;
  timestamp: string;
};

/** Server-side breakdown of one controller turn (from /api/chat/grok `metrics`). */
export type ControllerTurnMetrics = {
  classifierMs: number;
  controllerMs: number;
  usedLLM: boolean;
  classifierTimedOut: boolean;
  intent: string;
  beatBefore: number;
  beatAfter: number;
  /** AI-first understanding: who decided the meaning ("ai" or "rules") and the AI's reason */
  understanding?: "rules" | "ai";
  aiReason?: string;
  /** AI speech (MAX_SPEECH=ai): who worded Max's reply, why the approved line was kept, and the time */
  speech?: "ai" | "script";
  speechReason?: string;
  speechMs?: number;
  /** Free AI (MAX_MODE=free): who ran the turn, and why the script took over */
  mode?: "free" | "script";
  freeReason?: string;
  freeMs?: number;
  freeAttempts?: number;
};

export type TurnTimingLog = {
  turnId: number;
  /** The recognizer that heard this turn ("deepgram" or "webspeech"), and why Deepgram fell back */
  sttEngine?: string;
  sttFallbackReason?: string;
  userInput: string;
  avatarText: string;
  /** controller breakdown; total_latency_ms (end of customer speech -> avatar audio) is in `gaps` */
  controller?: ControllerTurnMetrics;
  /**
   * Live-call stage timestamps (epoch ms). chatRouteStart/End are on the server clock; the rest on
   * the browser clock. Use stageMs for comparisons, which never mixes the two clocks.
   */
  stages?: {
    speechEnd: number;
    sttFinal: number;
    turnDispatched: number;
    chatRequestSent: number;
    chatRouteStart?: number;
    chatRouteEnd?: number;
    chatResponseReceived: number;
    heygenSpeakSent: number;
    firstAudio: number;
  };
  /** Per-stage durations in ms: stt, endpointing, route, network, speakQueue, heygen, total */
  stageMs?: Record<string, number>;
  timestamps: {
    user_speech_end: number;
    final_transcript: number;
    controller_decision: number;
    speak_sent: number;
    avatar_audio_start: number;
  };
  gaps: {
    transcription_gap_ms: number;
    controller_gap_ms: number;
    speak_sent_gap_ms: number;
    avatar_render_gap_ms: number;
    total_latency_ms: number;
  };
};

export type BargeInLog = {
  timestamp: number;
  spokenText: string;
  avatarTextWhenInterrupted: string;
  honored: boolean;
  reason?: string;
  /** words in the transcript that triggered it */
  words?: number;
  /** how far into Max's line (from first audio) the cut happened */
  msIntoLine?: number;
};

export type TrainerFeedbackLog = {
  timestampMs: number;
  timeOffsetSec?: number;
  beat: number;
  lastSpoken: string;
  feedback: string;
  category: string;
  /** a coached rewording Max now uses in every call (learned-phrasing.ts) */
  applied?: { id: string; from: string; to: string };
  /** why a rewording in the note could not be used */
  notApplied?: string;
};

export type HeygenCallLog = {
  sessionId: string;
  engine: "heygen-grok";
  /** Speech recognition the call used: "deepgram" or "webspeech" (the browser's) */
  sttEngine?: string;
  /** Why the call fell back from Deepgram to the browser recognizer (missing key, token, connection) */
  sttFallbackReason?: string;
  avatarId: string;
  avatarName: string;
  startTime: string;
  endTime: string | null;
  durationSeconds: number | null;
  status: "active" | "completed";
  productsCovered?: string[];
  finalDailyRate?: number | string | null;
  transcript: HeygenUtteranceEntry[];
  timingLogs?: TurnTimingLog[];
  bargeIns?: BargeInLog[];
  trainerFeedback?: TrainerFeedbackLog[];
  turnLogs?: Array<{
    ts: string;
    rawTranscript: string;
    avatarSpeaking: boolean;
    intent: string;
    beatBefore: number;
    beatAfter: number;
    reason: string;
    classifierMs?: number;
    controllerMs?: number;
    usedLLM?: boolean;
    classifierTimedOut?: boolean;
    understanding?: "rules" | "ai";
    aiReason?: string;
    speech?: "ai" | "script";
    speechReason?: string;
    mode?: "free" | "script";
    freeReason?: string;
  }>;
};

export function getHeygenLogsDir() {
  // Vercel's app folder is read-only; /tmp is writable but private to one instance and temporary,
  // so there the call log sheet (src/lib/call-log-webhook.ts) is the lasting copy
  const logsDir = process.env.VERCEL ? "/tmp/logs-heygen" : resolve(process.cwd(), "logs-heygen");
  if (!existsSync(logsDir)) {
    mkdirSync(logsDir, { recursive: true });
  }
  return logsDir;
}

export function getHeygenLogPath(sessionId: string) {
  const direct = resolve(getHeygenLogsDir(), `${sessionId}.json`);
  if (existsSync(direct)) return direct;
  const match = sessionId.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  if (match) {
    const fallback = resolve(getHeygenLogsDir(), `${match[0]}.json`);
    if (existsSync(fallback)) return fallback;
  }
  return direct;
}

export function getHeygenAudioPath(sessionId: string) {
  const direct = resolve(getHeygenLogsDir(), `${sessionId}.webm`);
  if (existsSync(direct)) return direct;
  const match = sessionId.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  if (match) {
    const fallback = resolve(getHeygenLogsDir(), `${match[0]}.webm`);
    if (existsSync(fallback)) return fallback;
  }
  return direct;
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
