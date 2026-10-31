import { isAvatarScriptEcho } from "./beat-controller";
import type { HeygenCallLog, TurnTimingLog, BargeInLog } from "./heygen-logger";

export interface TimelineBlock {
  id: string;
  speaker: "avatar" | "user" | "system";
  startSec: number;
  endSec: number;
  durationSec: number;
  text: string;
  isInterrupted?: boolean;
  interruptedAtSec?: number;
  spokeDurationSec?: number;
  percentSpoken?: number;
  isEcho?: boolean;
  intent?: string;
  latencyMs?: number;
  status: "smooth" | "interrupted" | "echo" | "flaw";
}

export interface ExperienceFlaw {
  id: string;
  second: number;
  timeFormatted: string;
  category: "echo_loop" | "premature_cutoff" | "dialogue_mashup" | "high_latency" | "rapid_turns" | "barge_in";
  title: string;
  description: string;
  humanImpact: string;
  recommendation: string;
  severity: "critical" | "warning" | "minor";
}

export interface SecondBySecondPoint {
  second: number;
  timeFormatted: string;
  avatarState: "silent" | "speaking" | "interrupted";
  avatarText?: string;
  userState: "silent" | "speaking" | "echo";
  userText?: string;
  events: string[];
  flaw?: ExperienceFlaw;
}

export interface CallExperienceAnalysis {
  sessionId: string;
  totalDurationSec: number;
  startTime: string;
  endTime: string;
  turnsCount: number;
  bargeInsCount: number;
  echoCount: number;
  interruptedTurnsCount: number;
  mashupCount: number;
  averageLatencyMs: number;
  timelineBlocks: TimelineBlock[];
  secondBySecond: SecondBySecondPoint[];
  experienceFlaws: ExperienceFlaw[];
  summaryRating: "Poor" | "Needs Improvement" | "Good" | "Excellent";
  summaryVerdict: string;
}

export function formatTimeSec(seconds: number): string {
  const m = Math.floor(Math.max(0, seconds) / 60);
  const s = Math.floor(Math.max(0, seconds) % 60);
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

export function analyzeCallExperience(log: HeygenCallLog): CallExperienceAnalysis {
  const callStartTimeMs = log.startTime ? new Date(log.startTime).getTime() : 0;
  const timingLogs: TurnTimingLog[] = log.timingLogs || [];
  const bargeIns: BargeInLog[] = log.bargeIns || [];
  const transcript = log.transcript || [];

  // Determine true start and end time
  let minTimeMs = callStartTimeMs;
  let maxTimeMs = log.endTime ? new Date(log.endTime).getTime() : callStartTimeMs + (log.durationSeconds || 45) * 1000;

  for (const t of timingLogs) {
    if (t.timestamps.user_speech_end && (!minTimeMs || t.timestamps.user_speech_end < minTimeMs)) {
      minTimeMs = t.timestamps.user_speech_end;
    }
    const endT = t.timestamps.avatar_audio_start || t.timestamps.speak_sent || 0;
    if (endT > maxTimeMs) maxTimeMs = endT;
  }
  for (const b of bargeIns) {
    if (b.timestamp > maxTimeMs) maxTimeMs = b.timestamp;
  }

  const durationSec = Math.max(log.durationSeconds || 0, Math.ceil((maxTimeMs - minTimeMs) / 1000));
  const timelineBlocks: TimelineBlock[] = [];
  const experienceFlaws: ExperienceFlaw[] = [];

  let echoCount = 0;
  let interruptedTurnsCount = 0;
  let mashupCount = 0;
  let totalLatency = 0;
  let latencyCount = 0;

  // Whole words only ("ok" is not inside "okay" or "look"); "ok" and "okay" are the same word
  const normText = (t: string) =>
    t.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim().replace(/\bok\b/g, "okay");
  const containsWords = (hay: string[], needle: string[]) =>
    needle.length > 0 && hay.some((_, i) => needle.every((w, j) => hay[i + j] === w));
  let prevAvatarEndRelSec: number | null = null;

  // Process timing logs into blocks
  timingLogs.forEach((turn, idx) => {
    const userInputStr = turn.userInput || "";
    const avatarTextStr = turn.avatarText || "";
    const userEndRelSec = Math.max(0, ((turn.timestamps?.user_speech_end || minTimeMs) - minTimeMs) / 1000);
    const userWordsCount = userInputStr.split(/\s+/).filter(Boolean).length;
    const userStartRelSec = Math.max(0, userEndRelSec - Math.max(0.6, userWordsCount * 0.3));
    const avatarStartRelSec = turn.timestamps?.avatar_audio_start 
      ? Math.max(0, (turn.timestamps.avatar_audio_start - minTimeMs) / 1000)
      : userEndRelSec + 0.8;

    const words = avatarTextStr.trim().split(/\s+/).filter(Boolean);
    const estimatedSpokenSec = Math.max(1.2, words.length / 2.6);
    let avatarEndRelSec = avatarStartRelSec + estimatedSpokenSec;

    // Check if this turn had a barge-in
    let wasInterrupted = false;
    let interruptedAtSec = 0;
    let spokeDurationSec = estimatedSpokenSec;
    let percentSpoken = 100;

    const matchingBargeIn = bargeIns.find((b) => {
      const bSec = (b.timestamp - minTimeMs) / 1000;
      return bSec >= avatarStartRelSec - 0.2 && bSec <= avatarEndRelSec + 1.0;
    });

    if (matchingBargeIn) {
      wasInterrupted = true;
      interruptedTurnsCount++;
      interruptedAtSec = Math.max(avatarStartRelSec, (matchingBargeIn.timestamp - minTimeMs) / 1000);
      spokeDurationSec = Math.max(0.3, interruptedAtSec - avatarStartRelSec);
      percentSpoken = Math.min(100, Math.round((spokeDurationSec / estimatedSpokenSec) * 100));
      avatarEndRelSec = interruptedAtSec;
    }

    // Check if user input was patched/display-only
    const isPatched = (turn as any).inputType === "PATCHED_DISPLAY_ONLY" || userInputStr === "Call Start" || userInputStr === "[NO_CUSTOMER_INPUT]";

    // Check if user input was acoustic echo (ignore patched inputs).
    // A short reply that only matches Max's final word(s) ("okay" after "...understand first okay.")
    // arriving in the last 1.5 s of his line, or after it, is the customer answering, not echo.
    const prevAvatarNorm = idx > 0 ? normText(timingLogs[idx - 1]?.avatarText || "") : "";
    const userNorm = normText(userInputStr);
    const userWordList = userNorm.split(" ").filter(Boolean);
    const prevWordList = prevAvatarNorm.split(" ").filter(Boolean);
    const matchesOnlyFinalWords =
      userWordList.length > 0 &&
      userWordList.length <= 2 &&
      prevWordList.slice(-userWordList.length).join(" ") === userNorm &&
      !containsWords(prevWordList.slice(0, -userWordList.length), userWordList);
    const arrivedAtEndOfLine = prevAvatarEndRelSec === null || userEndRelSec >= prevAvatarEndRelSec - 1.5;
    const containedInPrevLine = containsWords(prevWordList, userWordList);
    const isEcho =
      !isPatched &&
      (isAvatarScriptEcho(userInputStr) || (containedInPrevLine && !(matchesOnlyFinalWords && arrivedAtEndOfLine)));

    if (isEcho) {
      echoCount++;
      experienceFlaws.push({
        id: `flaw-echo-${idx}`,
        second: Math.round(userStartRelSec),
        timeFormatted: formatTimeSec(userStartRelSec),
        category: "echo_loop",
        title: "Acoustic Speaker-to-Mic Echo",
        description: `Microphone captured Max's own voice: "${turn.userInput}"`,
        humanImpact: "Max reacted to his own voice, triggering premature turns without the human speaking.",
        recommendation: "Reject transcripts matching recent avatar script utterances and suppress microphone during avatar playback.",
        severity: "critical",
      });
    }


    // Check for Dialogue Mash-Up (e.g. "How can I assist you today? What's your understanding...")
    if (
      turn.avatarText.includes("How can I assist you today?") &&
      turn.avatarText.includes("What's your understanding")
    ) {
      mashupCount++;
      experienceFlaws.push({
        id: `flaw-mashup-${idx}`,
        second: Math.round(avatarStartRelSec),
        timeFormatted: formatTimeSec(avatarStartRelSec),
        category: "dialogue_mashup",
        title: "Dialogue Mash-Up: Contradictory Lines Merged",
        description: "Max said 'How can I assist you today?' merged with 'What's your understanding of the warranty?'",
        humanImpact: "Sounds like a confused bot talking over itself rather than a calm human finance manager.",
        recommendation: "Do not append script beats to generic greetings; handle 'Hey' with a natural presence acknowledgement.",
        severity: "critical",
      });
    }

    if (turn.gaps?.total_latency_ms) {
      totalLatency += turn.gaps.total_latency_ms;
      latencyCount++;
      if (turn.gaps.total_latency_ms > 2400) {
        experienceFlaws.push({
          id: `flaw-latency-${idx}`,
          second: Math.round(userEndRelSec),
          timeFormatted: formatTimeSec(userEndRelSec),
          category: "high_latency",
          title: `Long Turn Latency (${turn.gaps.total_latency_ms} ms)`,
          description: `Took ${(turn.gaps.total_latency_ms / 1000).toFixed(1)}s from customer finishing speech to Max opening mouth.`,
          humanImpact: "Awkward dead air made the user wonder if the call froze.",
          recommendation: "Use fast-path rule classification to bypass LLM round-trips for standard answers.",
          severity: "warning",
        });
      }
    }

    // User speech block
    timelineBlocks.push({
      id: `user-${turn.turnId}`,
      speaker: "user",
      startSec: userStartRelSec,
      endSec: userEndRelSec,
      durationSec: userEndRelSec - userStartRelSec,
      text: turn.userInput,
      isEcho,
      status: isEcho ? "echo" : "smooth",
    });

    // Avatar speech block
    timelineBlocks.push({
      id: `avatar-${turn.turnId}`,
      speaker: "avatar",
      startSec: avatarStartRelSec,
      endSec: avatarEndRelSec,
      durationSec: avatarEndRelSec - avatarStartRelSec,
      text: turn.avatarText,
      isInterrupted: wasInterrupted,
      interruptedAtSec,
      spokeDurationSec,
      percentSpoken,
      latencyMs: turn.gaps?.total_latency_ms || 0,
      status: wasInterrupted ? "interrupted" : "smooth",
    });
    prevAvatarEndRelSec = avatarEndRelSec;
  });

  // Every barge-in is a cut, listed with what triggered it, so the count here always matches the
  // session picker's "N cuts" (several cuts during one line used to be counted once).
  bargeIns.forEach((b, i) => {
    const sec = Math.max(0, (b.timestamp - minTimeMs) / 1000);
    const line = timelineBlocks.find((blk) => blk.speaker === "avatar" && sec >= blk.startSec - 0.2 && sec <= blk.endSec + 1.0);
    const msIntoLine = b.msIntoLine ?? (line ? Math.max(0, Math.round((sec - line.startSec) * 1000)) : undefined);
    const wordCount = b.words ?? b.spokenText.trim().split(/\s+/).filter(Boolean).length;
    const early = msIntoLine !== undefined && msIntoLine < 2000;
    const when = msIntoLine !== undefined ? ` ${(msIntoLine / 1000).toFixed(1)}s into Max's line` : "";
    experienceFlaws.push({
      id: `flaw-bargein-${i}`,
      second: Math.round(sec),
      timeFormatted: formatTimeSec(sec),
      category: "barge_in",
      title: `Cut ${i + 1} of ${bargeIns.length}: "${b.spokenText.slice(0, 40)}"${when}`,
      description:
        `Triggered by "${b.spokenText}" (${wordCount} word${wordCount === 1 ? "" : "s"}${b.reason ? `, rule: ${b.reason}` : ""}) ` +
        `while Max was saying "${(b.avatarTextWhenInterrupted || line?.text || "").slice(0, 70)}..."`,
      humanImpact: early
        ? "Max was cut before his point landed, so the customer may never have heard his question."
        : "The customer took the floor mid-line.",
      recommendation: early
        ? "Backchannels and the first 1.5 s of a line must not cut Max off (bargeInDecision in turn-taking.ts)."
        : "Expected when the customer genuinely interrupts; check the reply resumed the cut line.",
      severity: early ? "critical" : "warning",
    });
  });

  // Build second-by-second timeline array
  const secondBySecond: SecondBySecondPoint[] = [];
  const maxSec = Math.max(durationSec, Math.ceil(Math.max(...timelineBlocks.map((b) => b.endSec), 1)));

  for (let s = 0; s <= maxSec; s++) {
    const avatarBlock = timelineBlocks.find((b) => b.speaker === "avatar" && s >= Math.floor(b.startSec) && s <= Math.ceil(b.endSec));
    const userBlock = timelineBlocks.find((b) => b.speaker === "user" && s >= Math.floor(b.startSec) && s <= Math.ceil(b.endSec));
    const matchingFlaw = experienceFlaws.find((f) => f.second === s);

    const events: string[] = [];
    if (avatarBlock && Math.floor(avatarBlock.startSec) === s) {
      events.push(`Max began speaking: "${avatarBlock.text.substring(0, 35)}..."`);
    }
    if (avatarBlock?.isInterrupted && Math.round(avatarBlock.interruptedAtSec || 0) === s) {
      events.push(`⚠️ Max INTERRUPTED after ${avatarBlock.spokeDurationSec?.toFixed(1)}s (${avatarBlock.percentSpoken}% completed)`);
    }
    if (userBlock && Math.floor(userBlock.startSec) === s) {
      events.push(userBlock.isEcho ? `🔊 Mic echoed Max's voice: "${userBlock.text}"` : `User spoke: "${userBlock.text}"`);
    }

    secondBySecond.push({
      second: s,
      timeFormatted: formatTimeSec(s),
      avatarState: avatarBlock ? (avatarBlock.isInterrupted && s >= Math.floor(avatarBlock.interruptedAtSec || 0) ? "interrupted" : "speaking") : "silent",
      avatarText: avatarBlock?.text,
      userState: userBlock ? (userBlock.isEcho ? "echo" : "speaking") : "silent",
      userText: userBlock?.text,
      events,
      flaw: matchingFlaw,
    });
  }

  // Calculate summary verdict
  const avgLatency = latencyCount > 0 ? Math.round(totalLatency / latencyCount) : 0;
  let summaryRating: "Poor" | "Needs Improvement" | "Good" | "Excellent" = "Good";
  let summaryVerdict = "Call progressed smoothly with clean conversational exchanges.";

  if (echoCount >= 2 || bargeIns.length >= 2 || mashupCount >= 1) {
    summaryRating = "Poor";
    summaryVerdict = `High friction detected: ${echoCount} speaker-to-mic echo loops and ${bargeIns.length} mid-sentence cutoffs made Max feel erratic and robotic.`;
  } else if (echoCount > 0 || bargeIns.length > 0) {
    summaryRating = "Needs Improvement";
    summaryVerdict = "Occasional echo or early interruption interrupted conversational pacing.";
  }

  return {
    sessionId: log.sessionId,
    totalDurationSec: maxSec,
    startTime: log.startTime,
    endTime: log.endTime || "",
    turnsCount: timingLogs.length,
    bargeInsCount: bargeIns.length,
    echoCount,
    interruptedTurnsCount,
    mashupCount,
    averageLatencyMs: avgLatency,
    timelineBlocks,
    secondBySecond,
    experienceFlaws,
    summaryRating,
    summaryVerdict,
  };
}
