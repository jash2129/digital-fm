"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { Room, RoomEvent, Track, RemoteTrack, RemoteParticipant } from "livekit-client";
import { DigitalFourSquareMenu } from "./digital-four-square-menu";
import WarrantyTermsPage from "@/app/content/warranty-terms/page";
import CostBreakdownPage from "@/app/content/cost-breakdown/page";
import PricingLadderPage from "@/app/content/pricing-ladder/page";
import DealSummaryPage from "@/app/content/deal-summary/page";
import EscalatePage from "@/app/content/escalate/page";
import { CallSummaryScreen } from "@/components/CallSummaryScreen";

// =============================================================================
// SPEED & BARGE-IN TUNING CONFIGURATION
// All thresholds in one central object for easy tuning without hunting
// =============================================================================
export const SPEED_AND_BARGE_IN_CONFIG = {
  // End of speech silence threshold in milliseconds (minimum 500ms, start at 650ms)
  // Does not wait for Chrome's own final result.
  END_OF_SPEECH_MS: 650,

  // Single words / short phrases that immediately cut Max off:
  BARGE_IN_CUTOFF_WORDS: [
    "wait",
    "stop",
    "no",
    "hold on",
    "sorry",
    "what",
    "hang on",
    "one second",
  ],

  // Minimum words of any reply to trigger cut-off (e.g. 3 or more words):
  MIN_WORDS_ANY_BARGE_IN: 3,

  // Words that do NOT cut Max off (treated as backchannel, letting him finish):
  BACKCHANNEL_WORDS: [
    "mhm",
    "uh huh",
    "yeah",
    "yes",
    "okay",
    "ok",
    "right",
    "sure",
    "go on",
  ],

  // Anti-echo ordered word match threshold (reject only if 80%+ matches avatar):
  ANTI_ECHO_MATCH_RATIO: 0.8,
  ANTI_ECHO_MIN_WORDS: 3,

  // Safeguard: maximum ms audio can stay muted after turn ends
  AUDIO_UNMUTE_SAFEGUARD_MS: 3000,
};

type Message = {
  role: "user" | "assistant";
  content: string;
};

// Helper to determine if incoming user speech should trigger instant barge-in cut-off
export function shouldCutMaxOff(spoken: string): boolean {
  const norm = spoken.toLowerCase().replace(/[^a-z0-9 ]/g, " ").trim();
  const words = norm.split(/\s+/).filter(Boolean);
  if (words.length === 0) return false;

  // 1. Explicit backchannel words do NOT cut Max off
  if (SPEED_AND_BARGE_IN_CONFIG.BACKCHANNEL_WORDS.includes(norm)) {
    return false;
  }
  if (words.every((w) => SPEED_AND_BARGE_IN_CONFIG.BACKCHANNEL_WORDS.includes(w))) {
    return false;
  }

  // 2. Cutoff single words/phrases cut Max off immediately
  for (const cutoff of SPEED_AND_BARGE_IN_CONFIG.BARGE_IN_CUTOFF_WORDS) {
    if (norm === cutoff || norm.startsWith(`${cutoff} `) || norm.endsWith(` ${cutoff}`) || norm.includes(` ${cutoff} `)) {
      return true;
    }
  }

  // 3. Any reply of 3 or more words cuts Max off
  if (words.length >= SPEED_AND_BARGE_IN_CONFIG.MIN_WORDS_ANY_BARGE_IN) {
    return true;
  }

  return false;
}

// Anti-echo without dropping real questions: only reject when near-exact reflection (>= 80% ordered words match)
export function isNearExactEcho(userTranscript: string, lastAvatarText: string): boolean {
  if (!userTranscript || !lastAvatarText) return false;
  const userWords = userTranscript.toLowerCase().replace(/[^a-z0-9 ]/g, " ").trim().split(/\s+/).filter(Boolean);
  const avatarWords = lastAvatarText.toLowerCase().replace(/[^a-z0-9 ]/g, " ").trim().split(/\s+/).filter(Boolean);

  if (userWords.length < SPEED_AND_BARGE_IN_CONFIG.ANTI_ECHO_MIN_WORDS) {
    return false;
  }

  let matchCount = 0;
  let searchIdx = 0;
  for (const uWord of userWords) {
    const foundIdx = avatarWords.indexOf(uWord, searchIdx);
    if (foundIdx !== -1) {
      matchCount++;
      searchIdx = foundIdx + 1;
    }
  }

  const ratio = matchCount / userWords.length;
  return ratio >= SPEED_AND_BARGE_IN_CONFIG.ANTI_ECHO_MATCH_RATIO;
}

export function LiveAvatarDemo() {
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [avatarName, setAvatarName] = useState<string>("Max (Finance Manager)");
  const [isAvatarSpeaking, setIsAvatarSpeaking] = useState(false);
  const [isUserSpeaking, setIsUserSpeaking] = useState(false);
  const [isMicMuted, setIsMicMuted] = useState(false);
  const [canPlaybackAudio, setCanPlaybackAudio] = useState(true);
  const [isGrokThinking, setIsGrokThinking] = useState(false);

  // Verified Avatar Preview URL (novus.ai6) & Remote Tracks
  const [avatarPreviewUrl, setAvatarPreviewUrl] = useState<string | null>(
    "https://static.liveavatar.com/spaces/956ee8af13524a9684f952c54e4cb223/image_uploads/abdf763e-0460-4e16-b2ad-c1545fd63adf"
  );
  const [remoteVideoTrack, setRemoteVideoTrack] = useState<RemoteTrack | null>(null);
  const [remoteAudioTrack, setRemoteAudioTrack] = useState<RemoteTrack | null>(null);
  const remoteVideoTrackRef = useRef<RemoteTrack | null>(null);
  const remoteAudioTrackRef = useRef<RemoteTrack | null>(null);
  const attachedAudioElsRef = useRef<HTMLMediaElement[]>([]);
  const isGrokProcessingRef = useRef(false);
  const avatarWatchdogTimerRef = useRef<any>(null);
  const silenceEndTimerRef = useRef<any>(null);
  const muteSafeguardTimerRef = useRef<any>(null);
  const audioActivityCtxRef = useRef<AudioContext | null>(null);

  // Latency & Barge-In Instrumentation Refs
  const userSpeechEndTimestampRef = useRef<number>(0);
  const continuePauseTimerRef = useRef<any>(null);
  const currentTurnTimingRef = useRef<{
    turnId: number;
    userInput: string;
    avatarText: string;
    user_speech_end: number;
    final_transcript: number;
    controller_decision: number;
    speak_sent: number;
    avatar_audio_start: number;
  } | null>(null);
  const turnCounterRef = useRef<number>(0);
  const timingLogsRef = useRef<any[]>([]);
  const bargeInsRef = useRef<any[]>([]);
  const lastBeatTypeRef = useRef<"wait" | "continue" | "stop">("wait");

  // User Camera (Webcam Preview & In-Call PiP)
  const [localVideoStream, setLocalVideoStream] = useState<MediaStream | null>(null);
  const [isCameraOff, setIsCameraOff] = useState(false);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const preJoinVideoRef = useRef<HTMLVideoElement | null>(null);

  // Call End / Recording Summary state
  const [callFinished, setCallFinished] = useState(false);
  const [savedAudioUrl, setSavedAudioUrl] = useState<string | null>(null);
  const startTimeRef = useRef<string | null>(null);
  const audioRecorderRef = useRef<{
    stopAndUpload: (id: string) => Promise<string | null>;
  } | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const audioDestRef = useRef<MediaStreamAudioDestinationNode | null>(null);

  // Transcript
  const [messages, setMessages] = useState<Message[]>([]);
  const [currentReplicaText, setCurrentReplicaText] = useState("");
  const [latestUserTranscript, setLatestUserTranscript] = useState("");
  const [textInput, setTextInput] = useState("");

  // Presentation & Overlay State
  const [activeOverlay, setActiveOverlay] = useState<
    "warranty_terms" | "cost_breakdown" | "four_square" | "pricing_ladder" | "deal_summary" | "escalate" | null
  >(null);
  const [shownProducts, setShownProducts] = useState<string[]>([]);
  const [activeProduct, setActiveProduct] = useState<string | null>(null);
  const [dailyRate, setDailyRate] = useState<number | string | null>(4.0);
  const [currentBeat, setCurrentBeat] = useState<{ id: number; label: string }>({
    id: 0,
    label: "Tech Check & Greeting",
  });
  const lastSpokenByAvatarRef = useRef<string>("");
  const recentAvatarTextsRef = useRef<Array<{ text: string; timestamp: number }>>([]);
  const avatarFinishedAtRef = useRef<number>(0);

  // LiveKit WebRTC references
  const roomRef = useRef<Room | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const speechRecognitionRef = useRef<any>(null);

  // Sync state into refs for async events
  const isConnectedRef = useRef(isConnected);
  isConnectedRef.current = isConnected;

  const isMicMutedRef = useRef(isMicMuted);
  isMicMutedRef.current = isMicMuted;

  const isAvatarSpeakingRef = useRef(isAvatarSpeaking);
  isAvatarSpeakingRef.current = isAvatarSpeaking;

  const sessionIdRef = useRef(sessionId);
  sessionIdRef.current = sessionId;

  const messagesRef = useRef(messages);
  messagesRef.current = messages;

  const conversationHistoryRef = useRef<Message[]>([]);

  const shownProductsRef = useRef(shownProducts);
  shownProductsRef.current = shownProducts;

  const dailyRateRef = useRef(dailyRate);
  dailyRateRef.current = dailyRate;

  // ---------------------------------------------------------------------------
  // Local Remote Audio Mute Controller (Instant Barge-in & Safeguard)
  // ---------------------------------------------------------------------------
  const setRemoteAudioMutedLocally = useCallback((muted: boolean) => {
    if (audioRef.current) {
      audioRef.current.volume = muted ? 0 : 1.0;
      audioRef.current.muted = muted;
    }
    attachedAudioElsRef.current.forEach((el) => {
      el.volume = muted ? 0 : 1.0;
      el.muted = muted;
    });

    if (muted) {
      if (muteSafeguardTimerRef.current) clearTimeout(muteSafeguardTimerRef.current);
      muteSafeguardTimerRef.current = setTimeout(() => {
        // Safeguard so volume can never stay at 0 after turn ends
        console.warn("[liveavatar] Audio unmute safeguard triggered: restoring volume = 1.0");
        if (audioRef.current) {
          audioRef.current.volume = 1.0;
          audioRef.current.muted = false;
        }
        attachedAudioElsRef.current.forEach((el) => {
          el.volume = 1.0;
          el.muted = false;
        });
      }, SPEED_AND_BARGE_IN_CONFIG.AUDIO_UNMUTE_SAFEGUARD_MS);
    } else {
      if (muteSafeguardTimerRef.current) {
        clearTimeout(muteSafeguardTimerRef.current);
        muteSafeguardTimerRef.current = null;
      }
    }
  }, []);

  // ---------------------------------------------------------------------------
  // Audio Playback / Latency Instrumentation Callback
  // ---------------------------------------------------------------------------
  const recordAvatarAudioStarted = useCallback(() => {
    const audioStartTime = Date.now();
    if (currentTurnTimingRef.current && !currentTurnTimingRef.current.avatar_audio_start) {
      currentTurnTimingRef.current.avatar_audio_start = audioStartTime;
      const timing = currentTurnTimingRef.current;
      const transcriptionGapMs = Math.max(0, timing.final_transcript - timing.user_speech_end);
      const controllerGapMs = Math.max(0, timing.controller_decision - timing.final_transcript);
      const speakSentGapMs = Math.max(0, timing.speak_sent - timing.controller_decision);
      const avatarRenderGapMs = Math.max(0, timing.avatar_audio_start - timing.speak_sent);
      const totalLatencyMs = Math.max(0, timing.avatar_audio_start - timing.user_speech_end);

      const completedTurnLog = {
        turnId: timing.turnId,
        userInput: timing.userInput,
        avatarText: timing.avatarText,
        timestamps: {
          user_speech_end: timing.user_speech_end,
          final_transcript: timing.final_transcript,
          controller_decision: timing.controller_decision,
          speak_sent: timing.speak_sent,
          avatar_audio_start: timing.avatar_audio_start,
        },
        gaps: {
          transcription_gap_ms: transcriptionGapMs,
          controller_gap_ms: controllerGapMs,
          speak_sent_gap_ms: speakSentGapMs,
          avatar_render_gap_ms: avatarRenderGapMs,
          total_latency_ms: totalLatencyMs,
        },
      };

      timingLogsRef.current.push(completedTurnLog);

      console.log(
        `%c[TURN LATENCY REPORT #${timing.turnId}]\n` +
          `• user_speech_end:      ${new Date(timing.user_speech_end).toISOString()}\n` +
          `• final_transcript:     +${transcriptionGapMs}ms (silence VAD)\n` +
          `• controller_decision:  +${controllerGapMs}ms (beat classification)\n` +
          `• speak_sent:           +${speakSentGapMs}ms (WebRTC publish)\n` +
          `• avatar_audio_start:   +${avatarRenderGapMs}ms (HeyGen render & WebRTC play)\n` +
          `-------------------------------------------------\n` +
          `TOTAL TURN LATENCY:     ${totalLatencyMs}ms (${(totalLatencyMs / 1000).toFixed(2)}s)`,
        "color: #38bdf8; font-weight: bold;"
      );

      if (sessionIdRef.current) {
        void fetch(`/api/heygen/logs/${sessionIdRef.current}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            timingLogs: timingLogsRef.current,
            bargeIns: bargeInsRef.current,
          }),
        }).catch(() => {});
      }
    }
  }, []);

  // ---------------------------------------------------------------------------
  // Send speech command to LiveAvatar
  // ---------------------------------------------------------------------------
  const speakWithAvatar = useCallback(async (text: string) => {
    const room = roomRef.current;
    if (!room || !text.trim()) return;

    try {
      const clean = text.trim();
      lastSpokenByAvatarRef.current = clean;
      recentAvatarTextsRef.current.push({ text: clean, timestamp: Date.now() });
      if (recentAvatarTextsRef.current.length > 15) {
        recentAvatarTextsRef.current.shift();
      }
      console.log("[liveavatar] avatar.speak_text:", clean);

      // Restore volume before Max's next utterance starts
      setRemoteAudioMutedLocally(false);

      // Immediately set speaking flag to prevent race condition before speak_started event
      setIsAvatarSpeaking(true);
      isAvatarSpeakingRef.current = true;

      // Start safety watchdog: in case stop event is delayed, auto-reset based on speech rate (~2.8 words/sec)
      const wordCount = clean.split(/\s+/).length;
      const expectedDurationMs = Math.min(10000, Math.max(1800, (wordCount / 2.8) * 1000 + 1200));
      if (avatarWatchdogTimerRef.current) clearTimeout(avatarWatchdogTimerRef.current);
      avatarWatchdogTimerRef.current = setTimeout(() => {
        if (isAvatarSpeakingRef.current) {
          console.warn("[liveavatar] Watchdog timer fired: auto-resetting isAvatarSpeaking");
          setIsAvatarSpeaking(false);
          isAvatarSpeakingRef.current = false;
          avatarFinishedAtRef.current = Date.now();
          setRemoteAudioMutedLocally(false);
        }
      }, expectedDurationMs);

      // Dual-compatible payload to support all LiveAvatar API schema revisions
      const payload = new TextEncoder().encode(
        JSON.stringify({
          event_type: "avatar.speak_text",
          event: "avatar.speak_text",
          text: clean,
          data: { text: clean },
          payload: { text: clean },
        })
      );
      await room.localParticipant.publishData(payload, { reliable: true, topic: "agent-control" });

      // Record speak_sent timestamp for latency calculation
      if (currentTurnTimingRef.current) {
        currentTurnTimingRef.current.speak_sent = Date.now();
      }
    } catch (err) {
      console.error("[liveavatar] Failed to publish speak_text:", err);
    }
  }, [setRemoteAudioMutedLocally]);

  // ---------------------------------------------------------------------------
  // Interrupt Avatar (Barge-in / Cut-off)
  // ---------------------------------------------------------------------------
  const interruptAvatar = useCallback(async () => {
    const room = roomRef.current;
    if (!room) return;

    if (avatarWatchdogTimerRef.current) {
      clearTimeout(avatarWatchdogTimerRef.current);
    }

    try {
      console.log("[liveavatar] Sending avatar.interrupt (barge-in)");
      // Instant local mute on barge-in
      setRemoteAudioMutedLocally(true);

      const payload = new TextEncoder().encode(
        JSON.stringify({
          event_type: "avatar.interrupt",
          event: "avatar.interrupt",
        })
      );
      await room.localParticipant.publishData(payload, { reliable: true, topic: "agent-control" });
      setIsAvatarSpeaking(false);
      isAvatarSpeakingRef.current = false;
      avatarFinishedAtRef.current = Date.now();
      setCurrentReplicaText((prev) => (prev ? `${prev} — [Interrupted]` : ""));
    } catch (err) {
      console.error("[liveavatar] Failed to interrupt avatar:", err);
    }
  }, [setRemoteAudioMutedLocally]);

  // ---------------------------------------------------------------------------
  // Handle Chat with Grok & Tool Execution
  // ---------------------------------------------------------------------------
  const sendToGrok = useCallback(
    async (userInput: string) => {
      if (!userInput.trim()) return;

      if (isGrokProcessingRef.current) {
        console.log("[sendToGrok] Request already in flight, skipping duplicate call");
        return;
      }
      isGrokProcessingRef.current = true;
      setIsGrokThinking(true);

      // Cut off avatar immediately if it was speaking when user spoke
      if (isAvatarSpeakingRef.current) {
        void interruptAvatar();
      }

      const updatedHistory: Message[] = [
        ...conversationHistoryRef.current,
        { role: "user", content: userInput.trim() },
      ];
      conversationHistoryRef.current = updatedHistory;
      setMessages(updatedHistory);
      setIsUserSpeaking(false);

      // Initialize turn timing instrumentation
      const speechEndTime = userSpeechEndTimestampRef.current || Date.now();
      const finalTranscriptTime = Date.now();
      const turnId = ++turnCounterRef.current;
      currentTurnTimingRef.current = {
        turnId,
        userInput: userInput.trim(),
        avatarText: "",
        user_speech_end: speechEndTime,
        final_transcript: finalTranscriptTime,
        controller_decision: 0,
        speak_sent: 0,
        avatar_audio_start: 0,
      };

      try {
        const res = await fetch("/api/chat/grok", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: updatedHistory,
            sessionId: sessionIdRef.current || sessionId || "live_session",
          }),
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error || `Grok error (${res.status})`);
        }

        const data = await res.json();
        const assistantText = data.text || "";

        // Record controller decision timestamp
        const decisionTime = Date.now();
        if (currentTurnTimingRef.current) {
          currentTurnTimingRef.current.controller_decision = decisionTime;
          currentTurnTimingRef.current.avatarText = assistantText;
        }
        if (data.beatType) {
          lastBeatTypeRef.current = data.beatType;
        }

        if (data.currentBeatId !== undefined) {
          setCurrentBeat({
            id: data.currentBeatId,
            label: data.beatLabel || `Beat ${data.currentBeatId}`,
          });
        }

        // Process function calls
        if (data.toolCalls?.length) {
          for (const tc of data.toolCalls) {
            console.log("[grok tool execution]:", tc.name, tc.args);
            if (tc.name === "show_content") {
              if (tc.args.item === "warranty_terms") {
                setActiveOverlay("warranty_terms");
              } else if (tc.args.item === "cost_breakdown") {
                setActiveOverlay("cost_breakdown");
              } else if (tc.args.item === "four_square") {
                setActiveOverlay("four_square");
              } else if (tc.args.item === "pricing_ladder") {
                setActiveOverlay("pricing_ladder");
              } else if (tc.args.item === "deal_summary") {
                setActiveOverlay("deal_summary");
              } else if (tc.args.item === "escalate") {
                setActiveOverlay("escalate");
              } else if (tc.args.item === "welcome") {
                setActiveOverlay(null);
              }
            } else if (tc.name === "draw_grid_outline") {
              setActiveOverlay("four_square");
            } else if (tc.name === "show_pricing") {
              setActiveOverlay("four_square");
              if (tc.args.product) {
                setShownProducts((prev) => Array.from(new Set([...prev, tc.args.product])));
                setActiveProduct(tc.args.product);
              }
            } else if (tc.name === "show_payment_breakdown") {
              setActiveOverlay("four_square");
              if (tc.args.daily_rate) {
                setDailyRate(tc.args.daily_rate);
              }
            } else if (tc.name === "propose_concession") {
              setActiveOverlay("pricing_ladder");
              if (tc.args.stage) {
                const stageRates: Record<number, number> = { 1: 4.0, 2: 3.5, 3: 3.25, 4: 3.0 };
                setDailyRate(stageRates[tc.args.stage] || 3.5);
              }
            } else if (tc.name === "escalate_to_human") {
              setActiveOverlay("escalate");
            } else if (tc.name === "dismiss_content" || tc.name === "clear_canvas") {
              setActiveOverlay(null);
            }
          }
        }

        if (assistantText) {
          conversationHistoryRef.current = [
            ...conversationHistoryRef.current,
            { role: "assistant", content: assistantText },
          ];
          setMessages([...conversationHistoryRef.current]);
          setCurrentReplicaText(assistantText);
          await speakWithAvatar(assistantText);
        }
      } catch (err: any) {
        console.error("[chat/grok error]:", err);
        setError(err.message || "Failed to communicate with Grok.");
      } finally {
        isGrokProcessingRef.current = false;
        setIsGrokThinking(false);
      }
    },
    [speakWithAvatar, interruptAvatar]
  );

  // ---------------------------------------------------------------------------
  // Speech Recognition (Web Speech API) with Auto-Recovery & Echo Guard
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (typeof window === "undefined") return;
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    const recognizer = new SpeechRecognition();
    recognizer.continuous = true;
    recognizer.interimResults = true;
    recognizer.lang = "en-US";

    recognizer.onresult = (event: any) => {
      let interimText = "";
      let finalTranscript = "";

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalTranscript += transcript;
        } else {
          interimText += transcript;
          setIsUserSpeaking(true);
        }
      }

      const currentSpoken = (interimText || finalTranscript).trim();
      if (!currentSpoken) return;

      userSpeechEndTimestampRef.current = Date.now();
      if (continuePauseTimerRef.current) {
        clearTimeout(continuePauseTimerRef.current);
        continuePauseTimerRef.current = null;
      }

      // 1. Anti-echo without dropping real questions:
      // Only reject when transcript is near-exact reflection of Max's last spoken text (>= 80% ordered words match)
      if (
        isAvatarSpeakingRef.current &&
        isNearExactEcho(currentSpoken, lastSpokenByAvatarRef.current || "")
      ) {
        console.warn(
          `[anti-echo] REJECTED transcript as echo (match >= ${
            SPEED_AND_BARGE_IN_CONFIG.ANTI_ECHO_MATCH_RATIO * 100
          }%): "${currentSpoken}" against avatar text: "${lastSpokenByAvatarRef.current}"`
        );
        return;
      }

      // 2. Barge-in on short words, with filter:
      // Cutoff words immediately cut Max off; backchannel words let him finish
      if (isAvatarSpeakingRef.current && shouldCutMaxOff(currentSpoken)) {
        console.log("[liveavatar] Barge-in triggered by user speech:", currentSpoken);
        bargeInsRef.current.push({
          timestamp: Date.now(),
          spokenText: currentSpoken,
          avatarTextWhenInterrupted: lastSpokenByAvatarRef.current,
          honored: true,
        });
        if (sessionIdRef.current) {
          void fetch(`/api/heygen/logs/${sessionIdRef.current}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              timingLogs: timingLogsRef.current,
              bargeIns: bargeInsRef.current,
            }),
          }).catch(() => {});
        }
        setRemoteAudioMutedLocally(true);
        void interruptAvatar();
      }

      setLatestUserTranscript(currentSpoken);

      // 3. Debounced end-of-speech detection:
      // Uses natural silence pause so multi-word sentences (e.g. "Yeah, I can see you") are never fragmented into separate turns
      if (silenceEndTimerRef.current) clearTimeout(silenceEndTimerRef.current);
      const delayMs = finalTranscript.trim() ? 250 : SPEED_AND_BARGE_IN_CONFIG.END_OF_SPEECH_MS;
      silenceEndTimerRef.current = setTimeout(() => {
        const spoken = (finalTranscript || interimText || currentSpoken).trim();
        if (spoken.length > 0 && !isGrokProcessingRef.current) {
          console.log(
            `[speech-recognition] Speech silence timeout (${delayMs}ms) fired turn dispatch:`,
            spoken
          );
          setIsUserSpeaking(false);
          void sendToGrok(spoken);
        }
      }, delayMs);
    };

    let restartTimer: any = null;
    const scheduleRestart = (delay = 400) => {
      if (restartTimer) clearTimeout(restartTimer);
      restartTimer = setTimeout(() => {
        if (isConnectedRef.current && !isMicMutedRef.current) {
          try {
            recognizer.start();
          } catch {}
        }
      }, delay);
    };

    recognizer.onerror = (e: any) => {
      if (e.error !== "no-speech" && e.error !== "aborted") {
        console.warn("[speech-recognition warning]:", e.error);
      }
      setIsUserSpeaking(false);
      scheduleRestart(600);
    };

    recognizer.onend = () => {
      setIsUserSpeaking(false);
      scheduleRestart(300);
    };

    speechRecognitionRef.current = recognizer;
  }, [sendToGrok]);

  // ---------------------------------------------------------------------------
  // User Camera & Audio Preview Lifecycle
  // ---------------------------------------------------------------------------
  // Hardware Audio Constraints for Studio Demos (anti-echo & speaker suppression)
  const AUDIO_MEDIA_CONSTRAINTS: MediaTrackConstraints = {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  };

  useEffect(() => {
    let isMounted = true;
    const startCameraPreview = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: "user" },
          audio: AUDIO_MEDIA_CONSTRAINTS,
        });
        if (!isMounted) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        setLocalVideoStream(stream);
      } catch (camErr) {
        console.warn("[webcam] Video permission denied or device not found, falling back to audio only:", camErr);
        try {
          const audioStream = await navigator.mediaDevices.getUserMedia({ audio: AUDIO_MEDIA_CONSTRAINTS });
          if (!isMounted) {
            audioStream.getTracks().forEach((track) => track.stop());
            return;
          }
          setLocalVideoStream(audioStream);
          setIsCameraOff(true);
        } catch (audioErr) {
          console.warn("[webcam] Neither camera nor microphone accessible:", audioErr);
        }
      }
    };

    void startCameraPreview();

    return () => {
      isMounted = false;
    };
  }, []);

  // Stop camera tracks on component unmount
  useEffect(() => {
    return () => {
      if (localVideoStream) {
        localVideoStream.getTracks().forEach((track) => track.stop());
      }
    };
  }, [localVideoStream]);

  // Attach local video stream to preview elements
  useEffect(() => {
    if (preJoinVideoRef.current) {
      if (localVideoStream && !isCameraOff && localVideoStream.getVideoTracks().some((t) => t.enabled)) {
        preJoinVideoRef.current.srcObject = localVideoStream;
        preJoinVideoRef.current.play().catch(() => {});
      } else {
        preJoinVideoRef.current.srcObject = null;
      }
    }

    if (localVideoRef.current) {
      if (localVideoStream && !isCameraOff && localVideoStream.getVideoTracks().some((t) => t.enabled)) {
        localVideoRef.current.srcObject = localVideoStream;
        localVideoRef.current.play().catch(() => {});
      } else {
        localVideoRef.current.srcObject = null;
      }
    }
  }, [localVideoStream, isCameraOff, isConnected]);

  // Robust Track Attachment helpers for WebRTC
  const attachRemoteVideo = useCallback((track: RemoteTrack | null) => {
    if (!track) return;
    remoteVideoTrackRef.current = track;
    setRemoteVideoTrack(track);
    if (videoRef.current) {
      try {
        track.attach(videoRef.current);
        videoRef.current.play().catch((e) => console.warn("[liveavatar] Video play err:", e));
      } catch (err) {
        console.warn("[liveavatar] Video attach err:", err);
      }
    }
  }, []);

  const attachRemoteAudio = useCallback((track: RemoteTrack | null) => {
    if (!track) return;
    remoteAudioTrackRef.current = track;
    setRemoteAudioTrack(track);

    // 1. Attach directly to persistent root HTMLAudioElement
    if (audioRef.current) {
      try {
        audioRef.current.muted = false;
        audioRef.current.volume = 1.0;
        audioRef.current.onplaying = () => {
          recordAvatarAudioStarted();
        };
        track.attach(audioRef.current);
        audioRef.current.play().catch((e) => console.warn("[liveavatar] Root audio play deferred by browser policy:", e));
      } catch (err) {
        console.warn("[liveavatar] Root audio attach err:", err);
      }
    }

    // 2. Secondary guarantee: let LiveKit attach its own managed audio element
    try {
      const autoEl = track.attach();
      autoEl.muted = false;
      autoEl.volume = 1.0;
      autoEl.onplaying = () => {
        recordAvatarAudioStarted();
      };
      autoEl.play().catch((e) => console.warn("[liveavatar] LiveKit auto-managed audio play err:", e));
      attachedAudioElsRef.current.push(autoEl);
    } catch (err) {
      console.warn("[liveavatar] Failed auto track.attach():", err);
    }
  }, [recordAvatarAudioStarted]);

  // Re-attach remote tracks whenever video/audio elements mount or connection state changes
  useEffect(() => {
    if (isConnected) {
      if (videoRef.current && remoteVideoTrackRef.current) {
        try {
          remoteVideoTrackRef.current.attach(videoRef.current);
          videoRef.current.play().catch((e) => console.warn("[liveavatar] Video play caught:", e));
        } catch (e) {
          console.warn("[liveavatar] Video reattach error:", e);
        }
      }
      if (audioRef.current && remoteAudioTrackRef.current) {
        try {
          audioRef.current.muted = false;
          audioRef.current.volume = 1.0;
          remoteAudioTrackRef.current.attach(audioRef.current);
          audioRef.current.play().catch((e) => console.warn("[liveavatar] Audio play caught:", e));
        } catch (e) {
          console.warn("[liveavatar] Audio reattach error:", e);
        }
      }
    }
  }, [isConnected, remoteVideoTrack, remoteAudioTrack]);

  // Global user interaction listener to unlock WebRTC audio if blocked by browser autoplay
  useEffect(() => {
    if (!isConnected) return;
    const unlockAudio = async () => {
      const room = roomRef.current;
      if (room && !room.canPlaybackAudio) {
        try {
          await room.startAudio();
          setCanPlaybackAudio(room.canPlaybackAudio);
          console.log("[liveavatar] Audio unlocked via user interaction. canPlaybackAudio:", room.canPlaybackAudio);
        } catch (e) {
          console.warn("[liveavatar] Audio unlock on click failed:", e);
        }
      }
      if (audioRef.current && audioRef.current.paused) {
        audioRef.current.play().catch(() => {});
      }
      attachedAudioElsRef.current.forEach((el) => {
        if (el.paused) {
          el.play().catch(() => {});
        }
      });
    };

    window.addEventListener("click", unlockAudio);
    window.addEventListener("keydown", unlockAudio);
    window.addEventListener("touchstart", unlockAudio);
    return () => {
      window.removeEventListener("click", unlockAudio);
      window.removeEventListener("keydown", unlockAudio);
      window.removeEventListener("touchstart", unlockAudio);
    };
  }, [isConnected]);

  // ---------------------------------------------------------------------------
  // Start Consultation Session
  // ---------------------------------------------------------------------------
  const handleStart = async () => {
    // 0. Prime root HTMLAudioElement immediately within user click gesture
    if (audioRef.current) {
      audioRef.current.muted = false;
      audioRef.current.volume = 1.0;
      audioRef.current.play().catch(() => {});
    }

    setIsConnecting(true);
    setError(null);
    setActiveOverlay(null);
    setShownProducts([]);
    setActiveProduct(null);
    setDailyRate(4.0);

    try {
      // Step 1: Create session via our server route
      const res = await fetch("/api/heygen/session", { method: "POST" });
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || "Failed to initialize HeyGen LiveAvatar session.");
      }

      const session = await res.json();
      setSessionToken(session.sessionToken);
      const activeSessionId = session.sessionId || `heygen_${Date.now()}`;
      setSessionId(activeSessionId);
      setAvatarName(session.avatarName);
      if (session.avatarPreviewUrl) {
        setAvatarPreviewUrl(session.avatarPreviewUrl);
      }
      startTimeRef.current = new Date().toISOString();

      // Initialize Call Audio Recorder (saving to logs-heygen/)
      try {
        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
        const audioCtx = new AudioContextClass();
        const destNode = audioCtx.createMediaStreamDestination();
        audioCtxRef.current = audioCtx;
        audioDestRef.current = destNode;

        // Capture local microphone for recording
        try {
          let streamForRecording = localVideoStream;
          if (!streamForRecording || streamForRecording.getAudioTracks().length === 0) {
            try {
              streamForRecording = await navigator.mediaDevices.getUserMedia({
                video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: "user" },
                audio: AUDIO_MEDIA_CONSTRAINTS,
              });
              setLocalVideoStream(streamForRecording);
            } catch {
              streamForRecording = await navigator.mediaDevices.getUserMedia({ audio: AUDIO_MEDIA_CONSTRAINTS });
              setLocalVideoStream(streamForRecording);
              setIsCameraOff(true);
            }
          }
          if (streamForRecording && streamForRecording.getAudioTracks().length > 0) {
            const micSource = audioCtx.createMediaStreamSource(streamForRecording);
            micSource.connect(destNode);
          }
        } catch (micErr) {
          console.warn("[audio-rec] Could not attach local mic to call recorder:", micErr);
        }

        const audioChunks: Blob[] = [];
        const recorder = new MediaRecorder(destNode.stream, {
          mimeType: MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
            ? "audio/webm;codecs=opus"
            : "audio/webm",
        });

        recorder.ondataavailable = (e) => {
          if (e.data && e.data.size > 0) audioChunks.push(e.data);
        };
        recorder.start(500);

        audioRecorderRef.current = {
          stopAndUpload: async (sid: string) => {
            return new Promise((resolvePromise) => {
              if (recorder.state !== "inactive") {
                recorder.onstop = async () => {
                  audioCtx.close().catch(() => {});
                  const blob = new Blob(audioChunks, { type: "audio/webm" });
                  if (blob.size > 0) {
                    try {
                      await fetch(`/api/heygen/logs/${sid}/audio`, {
                        method: "POST",
                        body: blob,
                      });
                      resolvePromise(`/api/heygen/logs/${sid}/audio`);
                      return;
                    } catch (uploadErr) {
                      console.error("[audio-rec] Upload error:", uploadErr);
                    }
                  }
                  resolvePromise(null);
                };
                recorder.stop();
              } else {
                audioCtx.close().catch(() => {});
                resolvePromise(null);
              }
            });
          },
        };
      } catch (recErr) {
        console.warn("[audio-rec] AudioRecorder init warning:", recErr);
      }

      // Step 2: Connect LiveKit Room
      const room = new Room({
        adaptiveStream: true,
        dynacast: true,
      });
      roomRef.current = room;

      let greetingSent = false;
      const triggerSpokenGreeting = (delay = 1800) => {
        if (greetingSent) return;
        greetingSent = true;
        setTimeout(() => {
          const greeting = "Can you hear and see me alright?";
          setCurrentReplicaText(greeting);
          conversationHistoryRef.current = [{ role: "assistant", content: greeting }];
          setMessages([{ role: "assistant", content: greeting }]);
          void speakWithAvatar(greeting);
        }, delay);
      };

      room.on(RoomEvent.TrackSubscribed, (track: RemoteTrack) => {
        console.log("[liveavatar] TrackSubscribed event fired:", track.kind);
        if (track.kind === Track.Kind.Video) {
          attachRemoteVideo(track);
          triggerSpokenGreeting(1800);
        }
        if (track.kind === Track.Kind.Audio) {
          attachRemoteAudio(track);

          // Pipe avatar's speech into the call audio recorder
          if (audioCtxRef.current && audioDestRef.current && (track as any).mediaStreamTrack) {
            try {
              const remoteStream = new MediaStream([(track as any).mediaStreamTrack]);
              const remoteSource = audioCtxRef.current.createMediaStreamSource(remoteStream);
              remoteSource.connect(audioDestRef.current);
            } catch (pipeErr) {
              console.warn("[audio-rec] Failed to pipe remote avatar audio:", pipeErr);
            }
          }
        }
      });

      room.on(RoomEvent.DataReceived, (payload: Uint8Array, _, __, topic?: string) => {
        try {
          const parsed = JSON.parse(new TextDecoder().decode(payload));
          console.log("[liveavatar event]", topic, parsed);
          const ev = (parsed.event_type || parsed.event || parsed.type || "").toLowerCase();
          if (
            ev.includes("start_talking") ||
            ev.includes("started_speaking") ||
            ev.includes("speak_started")
          ) {
            recordAvatarAudioStarted();
            setIsAvatarSpeaking(true);
            isAvatarSpeakingRef.current = true;
          } else if (
            ev.includes("stop_talking") ||
            ev.includes("stopped_speaking") ||
            ev.includes("finished_speaking") ||
            ev.includes("speak_ended") ||
            ev.includes("talking_stop")
          ) {
            setIsAvatarSpeaking(false);
            isAvatarSpeakingRef.current = false;
            avatarFinishedAtRef.current = Date.now();
            setRemoteAudioMutedLocally(false);
            if (avatarWatchdogTimerRef.current) {
              clearTimeout(avatarWatchdogTimerRef.current);
              avatarWatchdogTimerRef.current = null;
            }

            // Section 3.3: continue beats pause 1000ms. If user does not speak, send next beat.
            if (lastBeatTypeRef.current === "continue" && isConnectedRef.current && !isUserSpeakingRef.current) {
              if (continuePauseTimerRef.current) clearTimeout(continuePauseTimerRef.current);
              console.log("[beat-controller] Continue beat finished. Pausing 1000ms before auto-advancing to next beat...");
              continuePauseTimerRef.current = setTimeout(() => {
                if (isConnectedRef.current && !isUserSpeakingRef.current && !isGrokProcessingRef.current) {
                  console.log("[beat-controller] 1000ms pause elapsed without user speech. Advancing to next beat!");
                  void sendToGrok("proceed");
                }
              }, 1000);
            }
          }
        } catch {
          // non-json
        }
      });

      // Handle browser autoplay policy events for WebRTC audio
      room.on(RoomEvent.AudioPlaybackStatusChanged, () => {
        const canPlay = room.canPlaybackAudio;
        console.log("[liveavatar] AudioPlaybackStatusChanged -> canPlaybackAudio:", canPlay);
        setCanPlaybackAudio(canPlay);
        if (!canPlay) {
          room.startAudio().catch(() => {});
        }
      });

      await room.connect(session.livekitUrl, session.livekitClientToken);
      setIsConnected(true);
      isConnectedRef.current = true;
      setIsConnecting(false);

      // Explicitly authorize LiveKit WebRTC audio playback
      try {
        await room.startAudio();
        console.log("[liveavatar] room.startAudio() succeeded, canPlaybackAudio:", room.canPlaybackAudio);
        setCanPlaybackAudio(room.canPlaybackAudio);
      } catch (audioErr) {
        console.warn("[liveavatar] room.startAudio() deferred:", audioErr);
      }

      // Stop LiveAvatar's internal chatbot from listening to mic audio (Grok handles dialog exclusively)
      try {
        const stopListeningPayload = new TextEncoder().encode(
          JSON.stringify({
            event_type: "avatar.stop_listening",
            event: "avatar.stop_listening",
          })
        );
        await room.localParticipant.publishData(stopListeningPayload, { reliable: true, topic: "agent-control" });
        console.log("[liveavatar] Published avatar.stop_listening to agent-control");
      } catch (stopErr) {
        console.warn("[liveavatar] Failed to publish stop_listening:", stopErr);
      }

      // Immediately scan remote participants for tracks that subscribed during room connection
      room.remoteParticipants.forEach((participant) => {
        participant.trackPublications.forEach((pub) => {
          if (pub.track) {
            if (pub.track.kind === Track.Kind.Video) {
              attachRemoteVideo(pub.track);
              triggerSpokenGreeting(1800);
            }
            if (pub.track.kind === Track.Kind.Audio) {
              attachRemoteAudio(pub.track);
            }
          }
        });
      });

      // Safety fallback: if track subscription takes longer, ensure initial greeting is delivered
      setTimeout(() => {
        if (!greetingSent && isConnectedRef.current) {
          console.log("[liveavatar] Fallback trigger for initial greeting");
          triggerSpokenGreeting(500);
        }
      }, 4000);

      // Start listening with mic
      if (speechRecognitionRef.current && !isMicMuted) {
        try {
          speechRecognitionRef.current.start();
        } catch {
          // already started
        }
      }
    } catch (err: any) {
      console.error("[LiveAvatar handleStart error]:", err);
      setError(err.message || "Failed to start consultation.");
      setIsConnecting(false);
    }
  };

  // ---------------------------------------------------------------------------
  // End Consultation Session
  // ---------------------------------------------------------------------------
  const handleEnd = async () => {
    const currentSessionId = sessionIdRef.current;

    // 1. Upload audio recording to logs-heygen/
    let audioUrl: string | null = null;
    if (audioRecorderRef.current && currentSessionId) {
      try {
        audioUrl = await audioRecorderRef.current.stopAndUpload(currentSessionId);
      } catch (e) {
        console.error("[handleEnd] Audio upload failed:", e);
      }
      audioRecorderRef.current = null;
    }

    // 2. Save full transcript JSON to logs-heygen/
    if (currentSessionId) {
      const now = new Date().toISOString();
      const start = startTimeRef.current || now;
      const durationSeconds = Math.round(
        (new Date(now).getTime() - new Date(start).getTime()) / 1000
      );

      const allMessages =
        conversationHistoryRef.current.length > 0
          ? conversationHistoryRef.current
          : messagesRef.current;
      try {
        await fetch(`/api/heygen/logs/${currentSessionId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            avatarId: "heygen-liveavatar",
            avatarName,
            startTime: start,
            endTime: now,
            durationSeconds,
            status: "completed",
            productsCovered: shownProductsRef.current,
            finalDailyRate: dailyRateRef.current,
            transcript: allMessages.map((m) => ({
              role: m.role,
              text: m.content,
              timestamp: new Date().toISOString(),
            })),
          }),
        });
        console.log(`[heygen-logger] Transcript saved to logs-heygen/${currentSessionId}.json (${allMessages.length} entries)`);
      } catch (logErr) {
        console.error("[heygen-logger] Failed to save transcript:", logErr);
      }
    }

    if (speechRecognitionRef.current) {
      try {
        speechRecognitionRef.current.stop();
      } catch {}
    }

    if (roomRef.current) {
      roomRef.current.disconnect();
      roomRef.current = null;
    }

    // Clean up all dynamically attached audio elements
    attachedAudioElsRef.current.forEach((el) => {
      try {
        el.pause();
        el.srcObject = null;
        el.remove();
      } catch {}
    });
    attachedAudioElsRef.current = [];
    if (audioRef.current) {
      try {
        audioRef.current.pause();
        audioRef.current.srcObject = null;
      } catch {}
    }

    if (audioActivityCtxRef.current && audioActivityCtxRef.current.state !== "closed") {
      audioActivityCtxRef.current.close().catch(() => {});
      audioActivityCtxRef.current = null;
    }
    if (silenceEndTimerRef.current) {
      clearTimeout(silenceEndTimerRef.current);
      silenceEndTimerRef.current = null;
    }

    if (sessionToken) {
      void fetch("/api/heygen/session", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionToken }),
      });
    }

    setIsConnected(false);
    isConnectedRef.current = false;
    remoteVideoTrackRef.current = null;
    remoteAudioTrackRef.current = null;
    setRemoteVideoTrack(null);
    setRemoteAudioTrack(null);
    setSessionToken(null);
    setCurrentReplicaText("");
    setActiveOverlay(null);

    // 3. Show Call Summary Screen
    setSavedAudioUrl(audioUrl);
    setCallFinished(true);
  };

  // ---------------------------------------------------------------------------
  // Call UX Enhancements: Duration, Captions, Mic Volume Meter, Shortcuts
  // ---------------------------------------------------------------------------
  const [showCaptions, setShowCaptions] = useState(true);
  const [callDuration, setCallDuration] = useState(0);
  const [micVolume, setMicVolume] = useState(0);

  // Call duration counter
  useEffect(() => {
    if (!isConnected) {
      setCallDuration(0);
      return;
    }
    const interval = setInterval(() => {
      setCallDuration((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, [isConnected]);

  const formatDuration = (totalSeconds: number) => {
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  // Real-time microphone audio volume analyser for reactive UI feedback
  useEffect(() => {
    if (!localVideoStream || isMicMuted) {
      setMicVolume(0);
      return;
    }
    const audioTracks = localVideoStream.getAudioTracks();
    if (audioTracks.length === 0 || !audioTracks[0].enabled) {
      setMicVolume(0);
      return;
    }

    let animationFrameId: number;
    let audioContext: AudioContext | null = null;
    try {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioContextClass) return;
      audioContext = new AudioContextClass();
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 32;
      analyser.smoothingTimeConstant = 0.4;
      const source = audioContext.createMediaStreamSource(localVideoStream);
      source.connect(analyser);

      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      const updateVolume = () => {
        analyser.getByteFrequencyData(dataArray);
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
          sum += dataArray[i];
        }
        const avg = sum / dataArray.length;
        const normalized = Math.min(100, Math.round((avg / 128) * 100));
        setMicVolume(normalized);
        animationFrameId = requestAnimationFrame(updateVolume);
      };
      updateVolume();
    } catch {
      // AudioContext autoplay or permission fallback
    }

    return () => {
      if (animationFrameId) cancelAnimationFrame(animationFrameId);
      if (audioContext && audioContext.state !== "closed") {
        audioContext.close().catch(() => {});
      }
    };
  }, [localVideoStream, isMicMuted]);

  const handleToggleMic = () => {
    setIsMicMuted((prev) => {
      const next = !prev;
      isMicMutedRef.current = next;
      if (speechRecognitionRef.current) {
        if (next) {
          try {
            speechRecognitionRef.current.stop();
          } catch {}
        } else {
          try {
            speechRecognitionRef.current.start();
          } catch {}
        }
      }
      return next;
    });
  };

  const handleToggleCamera = () => {
    setIsCameraOff((prev) => {
      const next = !prev;
      if (localVideoStream) {
        localVideoStream.getVideoTracks().forEach((track) => {
          track.enabled = !next;
        });
      }
      return next;
    });
  };

  // Power user keyboard shortcuts: Space/M (Mute), Esc (Close Slide), C (Captions), B (Interrupt)
  useEffect(() => {
    if (!isConnected) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const targetTag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      if (targetTag === "input" || targetTag === "textarea") return;

      if (e.code === "Space" || e.key.toLowerCase() === "m") {
        e.preventDefault();
        handleToggleMic();
      } else if (e.key === "Escape") {
        if (activeOverlay) {
          e.preventDefault();
          setActiveOverlay(null);
        }
      } else if (e.key.toLowerCase() === "c") {
        e.preventDefault();
        setShowCaptions((prev) => !prev);
      } else if (e.key.toLowerCase() === "b") {
        if (isAvatarSpeakingRef.current) {
          e.preventDefault();
          void interruptAvatar();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isConnected, activeOverlay, interruptAvatar]);

  const handleManualTextSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!textInput.trim()) return;
    const txt = textInput.trim();
    setTextInput("");
    setLatestUserTranscript(txt);
    if (isAvatarSpeakingRef.current) {
      void interruptAvatar();
    }
    void sendToGrok(txt);
  };

  if (callFinished) {
    const productLabelMap: Record<string, string> = {
      vsc: "7-Year / 100,000-Mile Bumper-to-Bumper ($0 Deductible)",
      tire_wheel: "5-Year Tire and Wheel Protection",
      maintenance: "4-Year Scheduled Maintenance Package",
      gap: "Total GAP Deficiency Balance Waiver",
    };

    return (
      <CallSummaryScreen
        conversationId={sessionId || "call"}
        audioUrl={savedAudioUrl}
        folderName="logs-heygen"
        dailyRate={typeof dailyRate === "number" ? dailyRate : parseFloat(dailyRate || "4.0")}
        productLabels={shownProducts.map((p) => productLabelMap[p] || p)}
        transcriptCount={messages.length}
        onStartNewCall={() => {
          setCallFinished(false);
          setSavedAudioUrl(null);
          setMessages([]);
          setShownProducts([]);
          setActiveProduct(null);
          setDailyRate(4.0);
          setSessionId(null);
        }}
      />
    );
  }

  return (
    <div className="relative h-screen w-full bg-slate-950 font-sans text-slate-100 overflow-hidden flex flex-col select-none">
      {/* Permanent, Always-Mounted Audio Element for LiveKit Remote Audio Track */}
      <audio ref={audioRef} autoPlay playsInline className="hidden" />

      {/* Browser Autoplay Blocked Banner */}
      {isConnected && !canPlaybackAudio && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 z-50">
          <button
            type="button"
            onClick={async () => {
              if (roomRef.current) {
                await roomRef.current.startAudio();
                setCanPlaybackAudio(roomRef.current.canPlaybackAudio);
              }
              if (audioRef.current) {
                audioRef.current.play().catch(() => {});
              }
            }}
            className="flex items-center gap-2 rounded-full bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs px-4 py-2 shadow-2xl animate-pulse cursor-pointer"
          >
            <span>🔊</span>
            <span>Click to Unmute Max&apos;s Voice (Browser Blocked Audio)</span>
          </button>
        </div>
      )}

      {/* Background Gradient */}
      <div className="pointer-events-none absolute -left-32 -top-32 size-[28rem] rounded-full bg-sky-500/20 blur-[100px]" />
      <div className="pointer-events-none absolute -right-24 top-1/3 size-[24rem] rounded-full bg-violet-500/15 blur-[110px]" />

      {/* Header Bar - Floats over video in-call just like Tavus */}
      <header
        className={`${
          isConnected ? "absolute top-0 inset-x-0 z-30 bg-slate-950/60" : "relative z-30 bg-slate-950/75 shrink-0"
        } flex items-center justify-between border-b border-white/10 px-5 py-2.5 backdrop-blur-xl`}
      >
        <div className="flex items-center gap-3">
          <div className="flex size-9 items-center justify-center rounded-xl border border-sky-400/40 bg-gradient-to-br from-sky-500/20 to-indigo-600/30 text-sky-300 font-black shadow-[0_0_15px_rgba(56,189,248,0.25)]">
            N
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-sm font-bold tracking-tight text-white">Novus Digital Finance Suite</h1>
              <span className="rounded-full border border-sky-400/30 bg-sky-500/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-sky-300">
                LiveAvatar Ultra-HD
              </span>
            </div>
            <p className="text-[11px] text-slate-400 flex items-center gap-1.5">
              <span>{avatarName}</span>
              <span className="size-1 rounded-full bg-slate-600" />
              <span className="text-emerald-400 font-medium">xAI Grok (~150ms TTFT)</span>
            </p>
          </div>
        </div>

        {isConnected && (
          <div className="flex items-center gap-2.5">
            {/* Live Call Duration Stopwatch */}
            <div className="flex items-center gap-1.5 rounded-full border border-white/10 bg-slate-900/80 px-3 py-1 text-xs font-mono text-slate-200 backdrop-blur-md shadow-inner">
              <span className="size-2 rounded-full bg-rose-500 animate-pulse" />
              <span className="font-semibold">{formatDuration(callDuration)}</span>
            </div>

            {/* Deterministic Beat Controller Progress Badge */}
            <div className="hidden md:flex items-center gap-2 rounded-full border border-sky-400/30 bg-sky-950/60 px-3 py-1 text-xs text-sky-200 backdrop-blur-md">
              <span className="size-1.5 rounded-full bg-sky-400 animate-pulse" />
              <span className="font-semibold text-sky-300">Beat {currentBeat.id}/16:</span>
              <span className="max-w-[180px] truncate text-slate-300">{currentBeat.label}</span>
            </div>

            {/* Closed Captions Toggle */}
            <button
              onClick={() => setShowCaptions((prev) => !prev)}
              type="button"
              className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold transition ${
                showCaptions
                  ? "border border-sky-400/40 bg-sky-500/20 text-sky-200 shadow-[0_0_12px_rgba(56,189,248,0.25)]"
                  : "border border-white/15 bg-white/5 text-slate-400 hover:bg-white/10 hover:text-slate-200"
              }`}
              title="Toggle Subtitles / Closed Captions (Shortcut: C)"
            >
              <span>CC</span>
              <span className="text-[10px] uppercase font-mono">{showCaptions ? "ON" : "OFF"}</span>
            </button>

            {/* Camera Quick Toggle */}
            <button
              onClick={handleToggleCamera}
              type="button"
              className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold uppercase tracking-wider transition ${
                isCameraOff
                  ? "border border-rose-500/40 bg-rose-500/20 text-rose-300 hover:bg-rose-500/30"
                  : "border border-white/20 bg-white/5 text-slate-200 hover:bg-white/10"
              }`}
              title="Toggle Camera (Shortcut: V)"
            >
              <span className={`size-2 rounded-full ${isCameraOff ? "bg-rose-400" : "bg-emerald-400"}`} />
              <span className="hidden sm:inline">{isCameraOff ? "Cam Off" : "Cam On"}</span>
            </button>

            {/* Mic Quick Toggle */}
            <button
              onClick={handleToggleMic}
              type="button"
              className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold uppercase tracking-wider transition ${
                isMicMuted
                  ? "border border-rose-500/40 bg-rose-500/20 text-rose-300 hover:bg-rose-500/30"
                  : "border border-emerald-500/40 bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30"
              }`}
              title="Toggle Microphone (Shortcut: Space or M)"
            >
              <span className={`size-2 rounded-full ${isMicMuted ? "bg-rose-400" : "bg-emerald-400 animate-pulse"}`} />
              <span className="hidden sm:inline">{isMicMuted ? "Muted" : "Mic Live"}</span>
            </button>

            {/* Canonical Red End Consultation Button */}
            <button
              onClick={handleEnd}
              type="button"
              className="flex items-center gap-1.5 rounded-full border border-rose-500 bg-rose-600 px-3.5 py-1.5 text-xs font-bold uppercase tracking-wider text-white shadow-[0_0_20px_rgba(225,29,72,0.4)] transition hover:bg-rose-500 hover:scale-105 active:scale-95"
              title="End consultation and generate summary"
            >
              <span>🔴</span>
              <span>End Call</span>
            </button>
          </div>
        )}
      </header>

      {/* Main Presentation Stage - Full screen viewport when in-call */}
      <main
        className={`${
          isConnected ? "absolute inset-0 z-0 h-full w-full" : "relative flex-1 w-full min-h-0"
        } overflow-hidden`}
      >
        {!isConnected ? (
          /* Pre-Join Luxury Dealership Virtual Suite Lobby */
          <div className="h-full w-full flex items-center justify-center p-4 sm:p-6 lg:p-8 overflow-y-auto no-scrollbar">
            <div className="z-10 w-full max-w-5xl rounded-3xl border border-white/10 bg-slate-900/70 p-6 sm:p-8 lg:p-10 shadow-2xl backdrop-blur-2xl">
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
                {/* Left Column: Real-time Video Mirror & Live Audio Meter */}
                <div className="lg:col-span-6 flex flex-col items-center">
                  <div className="relative h-60 sm:h-72 w-full overflow-hidden rounded-2xl border border-white/15 bg-slate-950 shadow-2xl flex items-center justify-center group">
                    <video
                      ref={preJoinVideoRef}
                      autoPlay
                      playsInline
                      muted
                      className={`h-full w-full object-cover scale-x-[-1] transition-opacity duration-300 ${
                        !isCameraOff && localVideoStream?.getVideoTracks().some((t) => t.enabled)
                          ? "opacity-100"
                          : "opacity-0"
                      }`}
                    />
                    {(!localVideoStream ||
                      isCameraOff ||
                      !localVideoStream.getVideoTracks().some((t) => t.enabled)) && (
                      <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950 text-slate-400">
                        <span className="text-4xl mb-2">📷</span>
                        <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                          Camera is inactive
                        </span>
                        <span className="text-[11px] text-slate-600 mt-1">Audio-only consultation enabled</span>
                      </div>
                    )}

                    {/* Top Status Pill: 1080p WebRTC Ready */}
                    <div className="absolute top-3 left-3 flex items-center gap-1.5 rounded-full bg-black/60 px-3 py-1 text-[10px] font-semibold text-white/90 backdrop-blur-md border border-white/10">
                      <span className="size-2 rounded-full bg-emerald-400 animate-pulse" />
                      <span>1080p Ultra-HD Direct Stream</span>
                    </div>

                    {/* Bottom Controls & Reactive Audio Equalizer */}
                    <div className="absolute bottom-3 inset-x-3 flex items-center justify-between">
                      {/* Live 5-Bar Reactive Audio Equalizer */}
                      <div className="flex items-center gap-2 rounded-full bg-black/70 px-3 py-1.5 border border-white/10 backdrop-blur-md">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-300">Mic</span>
                        <div className="flex items-end gap-1 h-3.5">
                          {[0.3, 0.7, 1.0, 0.8, 0.4].map((mult, i) => (
                            <span
                              key={i}
                              className={`w-1 rounded-full transition-all duration-75 ${
                                isMicMuted
                                  ? "bg-rose-500 h-1 opacity-60"
                                  : micVolume > 5
                                  ? "bg-emerald-400"
                                  : "bg-slate-600 h-1 opacity-40"
                              }`}
                              style={{
                                height: isMicMuted
                                  ? "4px"
                                  : `${Math.max(4, Math.min(14, (micVolume / 100) * 14 * mult))}px`,
                              }}
                            />
                          ))}
                        </div>
                        <span className="text-[10px] font-mono text-emerald-400">
                          {isMicMuted ? "MUTED" : micVolume > 5 ? `${micVolume}%` : "READY"}
                        </span>
                      </div>

                      {/* Hardware Toggles */}
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={handleToggleCamera}
                          className={`rounded-full px-3 py-1 text-xs font-semibold backdrop-blur-md transition ${
                            isCameraOff
                              ? "bg-rose-500/80 text-white hover:bg-rose-500 shadow-md"
                              : "bg-black/60 text-white/90 hover:bg-black/80 border border-white/10"
                          }`}
                        >
                          {isCameraOff ? "📷 Cam Off" : "📷 Cam On"}
                        </button>
                        <button
                          type="button"
                          onClick={handleToggleMic}
                          className={`rounded-full px-3 py-1 text-xs font-semibold backdrop-blur-md transition ${
                            isMicMuted
                              ? "bg-rose-500/80 text-white hover:bg-rose-500 shadow-md"
                              : "bg-black/60 text-white/90 hover:bg-black/80 border border-white/10"
                          }`}
                        >
                          {isMicMuted ? "🎤 Muted" : "🎤 Mic On"}
                        </button>
                      </div>
                    </div>
                  </div>

                  <p className="text-[11px] text-slate-400 mt-2.5 text-center">
                    Speak into your microphone to verify audio metering before entering.
                  </p>
                </div>

                {/* Right Column: Executive Consultation Brief & CTA */}
                <div className="lg:col-span-6 flex flex-col justify-center text-left">
                  <div className="inline-flex items-center gap-2 rounded-full border border-sky-400/30 bg-sky-500/10 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-sky-300 w-fit mb-3">
                    <span className="size-1.5 rounded-full bg-sky-400 animate-pulse" />
                    <span>Novus Luxury Automotive Group • F&I Advisory</span>
                  </div>

                  <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-white mb-2">
                    Executive Digital Finance Consultation
                  </h2>
                  <p className="text-xs sm:text-sm text-slate-300 mb-5 leading-relaxed">
                    Meet with <strong>Max Reynolds</strong>, Senior Director of Financial Services, for an interactive review of vehicle protection, warranty tiers, and personalized financing structures.
                  </p>

                  {/* Advisor Verified Profile Card */}
                  <div className="flex items-center gap-3.5 p-3.5 rounded-2xl bg-white/[0.04] border border-white/10 mb-5">
                    <div className="size-12 rounded-xl overflow-hidden border border-emerald-400/50 relative bg-slate-800 shrink-0 shadow-lg">
                      {avatarPreviewUrl ? (
                        <img
                          src={avatarPreviewUrl}
                          alt="Verified Avatar Max"
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <span className="flex items-center justify-center h-full text-2xl">👤</span>
                      )}
                      <span className="absolute bottom-0 right-0 size-3 rounded-full bg-emerald-400 border-2 border-slate-900" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-bold text-white flex items-center gap-2">
                        <span>Max Reynolds (novus.ai6)</span>
                        <span className="rounded bg-emerald-500/20 px-1.5 py-0.5 text-[9px] font-semibold text-emerald-300 border border-emerald-500/30">
                          VERIFIED ADVISOR
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-400 truncate mt-0.5">
                        Senior F&I Director • LiveAvatar Low-Latency WebRTC
                      </div>
                    </div>
                  </div>

                  {/* Appointment Specs Pill Card */}
                  <div className="grid grid-cols-2 gap-2.5 p-3 rounded-xl bg-slate-950/60 border border-white/10 text-xs mb-6">
                    <div>
                      <span className="text-[10px] uppercase font-bold text-slate-500 block">Vehicle</span>
                      <span className="text-white font-medium">2026 Mazda CX-5 Carbon</span>
                    </div>
                    <div>
                      <span className="text-[10px] uppercase font-bold text-slate-500 block">Base Price</span>
                      <span className="text-emerald-400 font-semibold">$34,850 Agreed</span>
                    </div>
                    <div>
                      <span className="text-[10px] uppercase font-bold text-slate-500 block">Financing</span>
                      <span className="text-white font-medium">60 Mo • Tier 1 Prime</span>
                    </div>
                    <div>
                      <span className="text-[10px] uppercase font-bold text-slate-500 block">AI Intelligence</span>
                      <span className="text-sky-300 font-medium">Grok (~150ms TTFT)</span>
                    </div>
                  </div>

                  {error && (
                    <div className="w-full mb-4 rounded-xl border border-rose-500/30 bg-rose-500/15 p-3 text-xs text-rose-200">
                      {error}
                    </div>
                  )}

                  {/* Glowing Start Button */}
                  <button
                    onClick={handleStart}
                    disabled={isConnecting}
                    type="button"
                    className="w-full rounded-2xl bg-gradient-to-r from-sky-500 via-indigo-600 to-sky-500 bg-[length:200%_auto] hover:bg-[position:right_center] px-6 py-4 text-base font-bold text-white shadow-[0_0_35px_rgba(56,189,248,0.4)] transition-all duration-300 hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {isConnecting ? (
                      <>
                        <span className="size-4 rounded-full border-2 border-white border-t-transparent animate-spin" />
                        <span>Initializing Secure Stream...</span>
                      </>
                    ) : (
                      <>
                        <span>Enter Consultation Suite</span>
                        <span className="text-lg">→</span>
                      </>
                    )}
                  </button>

                  {/* Audio echo prevention note for tester */}
                  <div className="flex items-center gap-2.5 rounded-xl border border-sky-400/25 bg-sky-500/10 px-3.5 py-2.5 text-xs text-sky-200 mt-3.5 shadow-sm">
                    <span className="text-base select-none">🎧</span>
                    <div className="leading-snug">
                      <span className="font-semibold text-white">Tester Note:</span> Please wear headphones for demos to eliminate room speaker echo and ensure seamless barge-in.
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : (
          /* Live Consultation Stage - Full Screen Widescreen Immersion */
          <div className="absolute inset-0 h-full w-full overflow-hidden bg-black">
            {/* 1. Traditional Screen-Share Presentation Stage (Zoom / Teams Style) */}
            {activeOverlay && (
              <div className="absolute inset-0 z-10 flex flex-col bg-slate-950/95 backdrop-blur-3xl animate-in fade-in duration-500">
                {/* Screen Share Header Bar */}
                <div className="flex items-center justify-between px-6 py-3.5 border-b border-white/10 bg-slate-900/80 backdrop-blur-xl">
                  <div className="flex items-center gap-3">
                    <span className="flex size-2.5 rounded-full bg-emerald-400 animate-pulse" />
                    <span className="text-xs font-semibold tracking-wide text-slate-300">
                      Screen Sharing Active • <span className="text-sky-400 font-bold">2026 Mazda CX-5 Finance Review</span>
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setActiveOverlay(null)}
                    className="flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-4 py-1.5 text-xs font-semibold text-slate-200 hover:bg-white/20 hover:text-white transition active:scale-95 shadow-md"
                  >
                    <span>✕</span>
                    <span>Stop Screen Share (Return to Full Video)</span>
                  </button>
                </div>

                {/* Document Canvas Content */}
                <div className="flex-1 overflow-y-auto no-scrollbar relative w-full h-full">
                  {activeOverlay === "warranty_terms" && <WarrantyTermsPage />}
                  {activeOverlay === "cost_breakdown" && <CostBreakdownPage />}
                  {activeOverlay === "four_square" && (
                    <DigitalFourSquareMenu
                      shownProducts={shownProducts}
                      activeProduct={activeProduct}
                      dailyRate={dailyRate}
                    />
                  )}
                  {activeOverlay === "pricing_ladder" && <PricingLadderPage />}
                  {activeOverlay === "deal_summary" && <DealSummaryPage />}
                  {activeOverlay === "escalate" && <EscalatePage />}
                  {activeOverlay !== "warranty_terms" &&
                    activeOverlay !== "cost_breakdown" &&
                    activeOverlay !== "four_square" &&
                    activeOverlay !== "pricing_ladder" &&
                    activeOverlay !== "deal_summary" &&
                    activeOverlay !== "escalate" && (
                      <div className="p-8">
                        <div className="rounded-3xl border border-white/15 bg-slate-900/70 p-6 sm:p-8 shadow-2xl backdrop-blur-xl">
                          <h2 className="text-2xl font-extrabold text-white">2026 Mazda CX-5 Consultation</h2>
                          <p className="mt-2 text-sm text-slate-300 leading-relaxed">
                            Review in progress. Your finance documentation is being prepared.
                          </p>
                        </div>
                      </div>
                    )}
                </div>
              </div>
            )}

            {/* 2. Persistent Single Avatar Video Container (Zoom/Teams Smooth Transition) */}
            <div
              className={
                activeOverlay
                  ? "absolute right-6 top-16 z-30 h-[135px] w-[180px] sm:h-[160px] sm:w-[220px] overflow-hidden rounded-2xl border-2 border-sky-400/60 bg-slate-950/95 shadow-[0_20px_50px_rgba(0,0,0,0.8)] backdrop-blur transition-all duration-500 ease-in-out"
                  : "absolute inset-0 z-0 h-full w-full bg-black transition-all duration-500 ease-in-out overflow-hidden"
              }
            >
              {/* Fallback portrait avatar before live video stream arrives */}
              {!remoteVideoTrack && avatarPreviewUrl && (
                <img
                  src={avatarPreviewUrl}
                  alt={avatarName}
                  className="h-full w-full object-cover"
                />
              )}

              <video
                ref={(el) => {
                  videoRef.current = el;
                  if (el && remoteVideoTrackRef.current) {
                    try {
                      remoteVideoTrackRef.current.attach(el);
                      el.play().catch(() => {});
                    } catch (e) {}
                  }
                }}
                autoPlay
                playsInline
                muted
                poster={avatarPreviewUrl || undefined}
                className="h-full w-full object-cover"
              />

              {/* Enhanced Active Presence & Reactive Equalizer */}
              <div className="absolute bottom-2 left-2 z-20 flex items-center gap-2 rounded-full border border-white/15 bg-slate-950/85 px-3 py-1.5 backdrop-blur-md shadow-lg">
                {isAvatarSpeaking ? (
                  <>
                    <span className="size-2 rounded-full bg-sky-400 animate-pulse shadow-[0_0_8px_rgba(56,189,248,0.8)]" />
                    <span className="text-[10px] font-bold tracking-wider uppercase text-sky-300">
                      Speaking
                    </span>
                  </>
                ) : isGrokThinking ? (
                  <>
                    <span className="size-2 rounded-full bg-amber-400 animate-ping shadow-[0_0_8px_rgba(251,191,36,0.8)]" />
                    <span className="text-[10px] font-bold tracking-wider uppercase text-amber-300">
                      Reviewing...
                    </span>
                  </>
                ) : isUserSpeaking ? (
                  <>
                    <span className="size-2 rounded-full bg-emerald-400 animate-ping shadow-[0_0_8px_rgba(52,211,153,0.8)]" />
                    <span className="text-[10px] font-bold tracking-wider uppercase text-emerald-300">
                      Listening
                    </span>
                    {/* Live Micro-Equalizer Reacting to Voice Activity */}
                    <div className="flex items-end gap-0.5 h-2.5">
                      {[0.4, 0.9, 0.6, 1.0].map((h, idx) => (
                        <span
                          key={idx}
                          className="w-0.5 rounded-full bg-emerald-400 transition-all duration-75"
                          style={{
                            height: `${Math.max(3, Math.min(10, (micVolume / 100) * 10 * h))}px`,
                          }}
                        />
                      ))}
                    </div>
                  </>
                ) : (
                  <>
                    <span className="size-2 rounded-full bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.5)]" />
                    <span className="text-[10px] font-semibold tracking-wider uppercase text-slate-300">
                      Live
                    </span>
                  </>
                )}
              </div>
            </div>

            {/* Non-Obstructing Live Dual-Speaker Subtitle Panel */}
            <TranscriptPanel
              latestReplicaTranscript={currentReplicaText}
              latestUserTranscript={latestUserTranscript}
              replicaSpeaking={isAvatarSpeaking}
              userSpeaking={isUserSpeaking}
              isOverlayActive={Boolean(activeOverlay)}
              showCaptions={showCaptions}
              isThinking={isGrokThinking}
            />

            {/* 3. Floating User Camera PiP Box */}
            <div className="absolute bottom-24 right-4 z-20 h-[100px] w-[140px] sm:h-[120px] sm:w-[160px] md:h-[135px] md:w-[180px] overflow-hidden rounded-2xl border border-white/20 bg-slate-950/90 shadow-2xl backdrop-blur transition-all duration-300">
              <video
                ref={localVideoRef}
                autoPlay
                playsInline
                muted
                className={`h-full w-full object-cover scale-x-[-1] transition-opacity duration-300 ${
                  !isCameraOff && localVideoStream?.getVideoTracks().some((t) => t.enabled)
                    ? "opacity-100"
                    : "opacity-0"
                }`}
              />
              {(!localVideoStream ||
                isCameraOff ||
                !localVideoStream.getVideoTracks().some((t) => t.enabled)) && (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950 text-slate-500">
                  <span className="text-xl mb-0.5">📷</span>
                  <span className="text-[10px] uppercase font-bold tracking-wider">Camera off</span>
                </div>
              )}
              <span className="absolute bottom-1.5 left-2 rounded-md bg-black/60 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-white/90 backdrop-blur-md">
                You
              </span>
            </div>
          </div>
        )}
      </main>

      {/* Bottom Bar: Manual Controls & Text Chat Input - Floats over video in-call just like Tavus */}
      {isConnected && (
        <footer className="absolute bottom-0 inset-x-0 z-30 border-t border-white/10 bg-slate-950/75 px-4 py-2.5 backdrop-blur-xl">
          <div className="max-w-4xl mx-auto flex flex-col gap-2">
            {/* Stage Stepper Navigation Pills */}
            <div className="flex items-center justify-center gap-1.5 overflow-x-auto no-scrollbar py-0.5 text-xs font-semibold text-slate-300">
              <span className="text-slate-500 uppercase tracking-widest text-[9px] mr-1 hidden sm:inline">
                Stage:
              </span>
              <button
                type="button"
                onClick={() => setActiveOverlay("warranty_terms")}
                className={`rounded-full px-3 py-1 border transition ${
                  activeOverlay === "warranty_terms"
                    ? "bg-sky-500/30 border-sky-400 text-sky-200 shadow-[0_0_12px_rgba(56,189,248,0.3)]"
                    : "border-white/10 bg-slate-900/60 hover:bg-slate-800 text-slate-300"
                }`}
              >
                1. Warranty
              </button>
              <button
                type="button"
                onClick={() => setActiveOverlay("cost_breakdown")}
                className={`rounded-full px-3 py-1 border transition ${
                  activeOverlay === "cost_breakdown"
                    ? "bg-sky-500/30 border-sky-400 text-sky-200 shadow-[0_0_12px_rgba(56,189,248,0.3)]"
                    : "border-white/10 bg-slate-900/60 hover:bg-slate-800 text-slate-300"
                }`}
              >
                2. Wear & Costs
              </button>
              <button
                type="button"
                onClick={() => {
                  setActiveOverlay("four_square");
                  setShownProducts(["vsc", "tire_wheel", "maintenance", "gap"]);
                }}
                className={`rounded-full px-3 py-1 border transition ${
                  activeOverlay === "four_square"
                    ? "bg-sky-500/30 border-sky-400 text-sky-200 shadow-[0_0_12px_rgba(56,189,248,0.3)]"
                    : "border-white/10 bg-slate-900/60 hover:bg-slate-800 text-slate-300"
                }`}
              >
                3. Four Square
              </button>
              <button
                type="button"
                onClick={() => setActiveOverlay("pricing_ladder")}
                className={`rounded-full px-3 py-1 border transition ${
                  activeOverlay === "pricing_ladder"
                    ? "bg-sky-500/30 border-sky-400 text-sky-200 shadow-[0_0_12px_rgba(56,189,248,0.3)]"
                    : "border-white/10 bg-slate-900/60 hover:bg-slate-800 text-slate-300"
                }`}
              >
                4. Concessions
              </button>
              <button
                type="button"
                onClick={() => setActiveOverlay("deal_summary")}
                className={`rounded-full px-3 py-1 border transition ${
                  activeOverlay === "deal_summary"
                    ? "bg-sky-500/30 border-sky-400 text-sky-200 shadow-[0_0_12px_rgba(56,189,248,0.3)]"
                    : "border-white/10 bg-slate-900/60 hover:bg-slate-800 text-slate-300"
                }`}
              >
                5. Close
              </button>
              <button
                type="button"
                onClick={() => setActiveOverlay("escalate")}
                className={`rounded-full px-3 py-1 border transition ${
                  activeOverlay === "escalate"
                    ? "bg-sky-500/30 border-sky-400 text-sky-200 shadow-[0_0_12px_rgba(56,189,248,0.3)]"
                    : "border-white/10 bg-slate-900/60 hover:bg-slate-800 text-slate-300"
                }`}
              >
                6. Escalate
              </button>
              {activeOverlay && (
                <button
                  type="button"
                  onClick={() => setActiveOverlay(null)}
                  className="rounded-full px-3 py-1 border border-rose-500/40 bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 transition"
                  title="Return to full screen avatar video"
                >
                  ✕ Close Slide
                </button>
              )}
            </div>

            {/* Bottom Row: Controls, Barge-In, Text Chat */}
            <div className="flex items-center gap-3">
              {/* Mic Toggle with Live Speaking / Reactive Glow */}
              <button
                type="button"
                onClick={handleToggleMic}
                className={`flex items-center gap-2 rounded-full px-3.5 py-1.5 text-xs font-semibold border transition shrink-0 ${
                  isMicMuted
                    ? "border-rose-500/40 bg-rose-500/15 text-rose-300 hover:bg-rose-500/25"
                    : isUserSpeaking
                    ? "border-emerald-400 bg-emerald-500/25 text-emerald-300 shadow-[0_0_15px_rgba(52,211,153,0.3)] animate-pulse"
                    : "border-white/15 bg-white/5 text-slate-300 hover:bg-white/10"
                }`}
                title="Toggle Mic (Space / M)"
              >
                <span
                  className={`size-2 rounded-full ${
                    isMicMuted ? "bg-rose-400" : isUserSpeaking ? "bg-emerald-400 animate-ping" : "bg-sky-400"
                  }`}
                />
                <span>{isMicMuted ? "Mic Muted" : isUserSpeaking ? "Listening..." : "Mic On"}</span>
                {!isMicMuted && isUserSpeaking && (
                  <div className="flex items-end gap-0.5 h-2.5 ml-1">
                    {[0.5, 1.0, 0.7].map((h, idx) => (
                      <span
                        key={idx}
                        className="w-0.5 rounded-full bg-emerald-300 transition-all duration-75"
                        style={{
                          height: `${Math.max(3, Math.min(10, (micVolume / 100) * 10 * h))}px`,
                        }}
                      />
                    ))}
                  </div>
                )}
              </button>

              {/* Instant Barge-in / Interrupt Button */}
              {isAvatarSpeaking && (
                <button
                  type="button"
                  onClick={() => void interruptAvatar()}
                  className="flex items-center gap-1.5 rounded-full border border-amber-400/50 bg-amber-500/20 px-3 py-1.5 text-xs font-bold text-amber-200 hover:bg-amber-500/30 transition shadow-lg animate-pulse shrink-0"
                  title="Interrupt Max mid-sentence (Keyboard: B)"
                >
                  <span>🛑</span>
                  <span>Interrupt (B)</span>
                </button>
              )}

              {/* Input Message Form */}
              <form onSubmit={handleManualTextSubmit} className="flex-1 min-w-0 flex items-center gap-2">
                <input
                  type="text"
                  value={textInput}
                  onChange={(e) => setTextInput(e.target.value)}
                  placeholder="Speak into your mic or type to Max..."
                  className="flex-1 min-w-0 rounded-full border border-white/15 bg-slate-900/90 px-4 py-2 text-xs text-white placeholder-slate-400 focus:border-sky-400 focus:outline-none transition"
                />
                <button
                  type="submit"
                  disabled={isGrokThinking}
                  className="rounded-full bg-gradient-to-r from-sky-500 to-indigo-600 px-4 py-2 text-xs font-bold text-white shadow-lg transition hover:scale-105 active:scale-95 disabled:opacity-60 shrink-0 flex items-center gap-1.5"
                >
                  {isGrokThinking ? (
                    <>
                      <span className="size-1.5 rounded-full bg-amber-300 animate-ping" />
                      <span>Thinking...</span>
                    </>
                  ) : (
                    <span>Send</span>
                  )}
                </button>
              </form>
            </div>
          </div>
        </footer>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Non-Obstructing Live Dual-Speaker Subtitle Component
// ---------------------------------------------------------------------------

type TranscriptPanelProps = {
  latestReplicaTranscript: string | null;
  latestUserTranscript: string | null;
  replicaSpeaking: boolean;
  userSpeaking: boolean;
  isOverlayActive: boolean;
  showCaptions?: boolean;
  isThinking?: boolean;
};

function TranscriptPanel({
  latestReplicaTranscript,
  latestUserTranscript,
  replicaSpeaking,
  userSpeaking,
  isOverlayActive,
  showCaptions = true,
  isThinking = false,
}: TranscriptPanelProps) {
  if (!showCaptions) return null;

  const showPanel =
    userSpeaking || replicaSpeaking || isThinking || Boolean(latestUserTranscript || latestReplicaTranscript);

  if (!showPanel) return null;

  const userText =
    userSpeaking && !latestUserTranscript
      ? "Listening to you..."
      : latestUserTranscript || "Waiting for your question...";
  const replicaText =
    isThinking
      ? "Max is reviewing your paperwork..."
      : replicaSpeaking && !latestReplicaTranscript
      ? "Max is speaking..."
      : latestReplicaTranscript || "Max's responses appear here.";

  return (
    <div
      className={`absolute z-30 transition-all duration-300 pointer-events-none ${
        isOverlayActive
          ? "bottom-28 left-1/2 -translate-x-1/2 max-w-2xl w-[92%] sm:w-[34rem]"
          : "bottom-28 left-4 sm:left-6 max-w-xl w-[calc(100vw-2rem)] sm:w-[32rem]"
      } rounded-[1.75rem] border border-white/10 bg-slate-950/80 p-3 shadow-[0_24px_80px_rgba(0,0,0,0.6)] backdrop-blur-2xl`}
    >
      <div className="space-y-1.5 pointer-events-auto">
        <TranscriptPanelRow active={userSpeaking} label="You" text={userText} role="user" />
        <TranscriptPanelRow
          active={replicaSpeaking || isThinking}
          isThinking={isThinking}
          label="Max (Finance Manager)"
          text={replicaText}
          role="assistant"
        />
      </div>
    </div>
  );
}

function TranscriptPanelRow({
  active,
  label,
  text,
  role,
  isThinking = false,
}: {
  active: boolean;
  label: string;
  text: string;
  role: "user" | "assistant";
  isThinking?: boolean;
}) {
  return (
    <div
      className={
        isThinking
          ? "rounded-2xl border border-amber-400/40 bg-amber-500/10 px-3 py-1.5 shadow-lg backdrop-blur-md transition-all"
          : active
          ? "rounded-2xl border border-sky-400/30 bg-sky-500/15 px-3 py-1.5 shadow-lg backdrop-blur-md transition-all"
          : "rounded-2xl border border-white/5 bg-slate-900/60 px-3 py-1.5 backdrop-blur-md transition-all"
      }
    >
      <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">
        <span
          className={`size-2 rounded-full ${
            isThinking
              ? "bg-amber-400 animate-pulse"
              : active
              ? role === "user"
                ? "bg-emerald-400 animate-ping"
                : "bg-sky-400 animate-ping"
              : "bg-slate-600"
          }`}
        />
        <span
          className={
            isThinking
              ? "text-amber-300 font-semibold"
              : active
              ? role === "user"
                ? "text-emerald-300 font-semibold"
                : "text-sky-300 font-semibold"
              : "text-slate-400"
          }
        >
          {label}
        </span>
        {isThinking && (
          <span className="ml-auto flex items-center gap-1 text-[10px] text-amber-300 font-normal lowercase tracking-normal">
            <span className="size-1 rounded-full bg-amber-400 animate-ping" />
            thinking...
          </span>
        )}
      </div>
      <p
        className={
          isThinking
            ? "mt-0.5 text-xs sm:text-sm leading-relaxed text-amber-200/90 font-medium italic animate-pulse"
            : active
            ? "mt-0.5 text-xs sm:text-sm leading-relaxed text-white font-medium"
            : "mt-0.5 text-xs sm:text-sm leading-relaxed text-slate-300"
        }
      >
        {text}
      </p>
    </div>
  );
}
