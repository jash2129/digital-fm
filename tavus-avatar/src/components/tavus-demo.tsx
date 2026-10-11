"use client";

import DailyIframe from "@daily-co/daily-js";
import type {
  DailyCall,
  DailyEventObjectAppMessage,
  DailyEventObjectCameraError,
} from "@daily-co/daily-js";
import { DailyAudio, DailyProvider, DailyVideo, useDevices, useParticipantIds } from "@daily-co/daily-react";
import type { DailyAudioHandle } from "@daily-co/daily-react/dist/components/DailyAudio";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";

import { CallSummaryScreen } from "@/components/CallSummaryScreen";
import { CountdownScreen } from "@/components/CountdownScreen";
import { PresentationCanvas } from "@/components/presentation-canvas";
import WarrantyTermsPage from "@/app/content/warranty-terms/page";
import CostBreakdownPage from "@/app/content/cost-breakdown/page";
import PricingLadderPage from "@/app/content/pricing-ladder/page";
import DealSummaryPage from "@/app/content/deal-summary/page";
import EscalatePage from "@/app/content/escalate/page";
import type { CanvasElementSkeleton } from "@/lib/canvas-elements";
import {
  CONTENT_ITEMS,
  resolveContentItemKey,
  type ContentItemKey,
} from "@/lib/content-items";
import { isFinanceEvent } from "@/lib/event";
import { NegotiationStateManager, type PipelineStep } from "@/lib/state-manager";
import { getCustomTavusLlmConfig } from "@/lib/tavus-custom-llms";
import type {
  TavusAppMessage,
  TavusConversationCreateResponse,
  TavusConversationEchoMessage,
  TavusConversationUtteranceMessage,
  TavusToolCallMessage,
} from "@/types/tavus";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type DemoStatus =
  | "idle"
  | "requesting-permissions"
  | "loading"
  | "joining"
  | "connected"
  | "leaving"
  | "error";

type TranscriptEntry = {
  inferenceId?: string;
  text: string;
};

type OverlayState =
  | {
      kind: "content";
      contentItemKey: ContentItemKey;
      query?: Record<string, string>;
    }
  | {
      kind: "canvas";
      elements: CanvasElementSkeleton[];
      products?: { key: string; label: string }[];
      shownProducts?: string[];
      activeProduct?: string | null;
      dailyRate?: number | string | null;
    };

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const START_BUTTON_LABELS: Record<Exclude<DemoStatus, "connected" | "error">, string> = {
  idle: "Start demo",
  "requesting-permissions": "Approve camera and microphone",
  loading: "Creating AI conversation",
  joining: "Joining session",
  leaving: "Ending current session",
};

const FINANCE_START_BUTTON_LABELS: Record<Exclude<DemoStatus, "connected" | "error">, string> = {
  idle: "Start consultation",
  "requesting-permissions": "Approve camera and microphone",
  loading: "Connecting you with Max",
  joining: "Joining the call",
  leaving: "Wrapping up",
};

const REPLICA_READY_EVENT_TYPES = new Set([
  "system.replica_present",
  "system.replica_joined",
  "conversation.replica.started_speaking",
  "conversation.replica.stopped_speaking",
  "conversation.utterance",
  "conversation.tool_call",
  "conversation.echo",
]);

const START_TIMEOUT_MS = 60_000;
// Ceiling on how long we wait, once actually joined, for the avatar to show up before treating
// it as a failure — not a target everyone waits out, just a backstop for the slow case.
const REPLICA_READY_TIMEOUT_MS = 60_000;
const ACTIVE_CONVERSATION_STORAGE_KEY = "tavus_active_conversation_id";

// Layout for the finance event's live-drawn Square 4 grid — a 2x2 box per product plus a
// price banner underneath, filled in progressively as show_pricing/show_payment_breakdown
// tool calls arrive.
const CANVAS_BOX_WIDTH = 260;
const CANVAS_BOX_HEIGHT = 170;
const CANVAS_BOX_GAP = 16;
const CANVAS_GRID_START_X = 48;
const CANVAS_GRID_START_Y = 64;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return "Something went wrong while starting the demo.";
}

/** Rebuilds the full grid skeleton from scratch on every call — the caller owns the
 * accumulated box labels/price, this just lays them out. `boxLabels` only having entries for
 * products shown so far is what makes the grid fill in progressively instead of all at once. */
function buildCanvasSkeleton(
  products: { key: string; label: string }[],
  boxLabels: Map<string, string>,
  priceLabel: string | null,
): CanvasElementSkeleton[] {
  const elements: CanvasElementSkeleton[] = [];

  products.forEach((product, index) => {
    const column = index % 2;
    const row = Math.floor(index / 2);
    const x = CANVAS_GRID_START_X + column * (CANVAS_BOX_WIDTH + CANVAS_BOX_GAP);
    const y = CANVAS_GRID_START_Y + row * (CANVAS_BOX_HEIGHT + CANVAS_BOX_GAP);

    elements.push({
      type: "rectangle",
      id: `box-rect-${product.key}`,
      x,
      y,
      width: CANVAS_BOX_WIDTH,
      height: CANVAS_BOX_HEIGHT,
    });

    const label = boxLabels.get(product.key);
    if (label) {
      elements.push({
        type: "text",
        id: `box-text-${product.key}`,
        x: x + 16,
        y: y + CANVAS_BOX_HEIGHT / 2 - 12,
        text: label,
        fontSize: 18,
      });
    }
  });

  if (priceLabel) {
    elements.push({
      type: "text",
      id: "price-banner",
      x: CANVAS_GRID_START_X,
      y: CANVAS_GRID_START_Y + 2 * CANVAS_BOX_HEIGHT + CANVAS_BOX_GAP + 24,
      text: priceLabel,
      fontSize: 32,
    });
  }

  return elements;
}

function getRequestedLlmName() {
  if (typeof window === "undefined") {
    return null;
  }

  return new URLSearchParams(window.location.search).get("llm");
}

function hasEnabledQueryFlag(name: string) {
  if (typeof window === "undefined") {
    return false;
  }

  const value = new URLSearchParams(window.location.search).get(name);
  return value === "1" || value === "true";
}

function hasAutoStartAlreadyBeenClaimed() {
  if (typeof window === "undefined") {
    return false;
  }

  const globalWindow = window as Window & {
    __tavusAutoStartClaimed__?: boolean;
  };

  if (globalWindow.__tavusAutoStartClaimed__) {
    return true;
  }

  globalWindow.__tavusAutoStartClaimed__ = true;
  return false;
}

function getDeviceDisplayName(label: string | null | undefined, fallback: string) {
  const trimmedLabel = label?.trim();
  return trimmedLabel ? trimmedLabel : fallback;
}

async function playToolCallChime(audioContextRef: { current: AudioContext | null }) {
  if (typeof window === "undefined" || typeof window.AudioContext === "undefined") {
    return;
  }

  const audioContext = audioContextRef.current ?? new window.AudioContext();
  audioContextRef.current = audioContext;

  if (audioContext.state === "suspended") {
    await audioContext.resume();
  }

  const now = audioContext.currentTime;
  const masterGain = audioContext.createGain();
  masterGain.connect(audioContext.destination);
  masterGain.gain.setValueAtTime(0.0001, now);
  masterGain.gain.exponentialRampToValueAtTime(0.024, now + 0.012);
  masterGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.26);

  const lowTone = audioContext.createOscillator();
  lowTone.type = "sine";
  lowTone.frequency.setValueAtTime(784, now);
  lowTone.frequency.exponentialRampToValueAtTime(1046, now + 0.18);
  lowTone.connect(masterGain);

  const highTone = audioContext.createOscillator();
  highTone.type = "triangle";
  highTone.frequency.setValueAtTime(1174, now + 0.03);
  highTone.frequency.exponentialRampToValueAtTime(1318, now + 0.2);
  highTone.connect(masterGain);

  lowTone.start(now);
  lowTone.stop(now + 0.26);
  highTone.start(now + 0.028);
  highTone.stop(now + 0.22);
}

function getConversationEcho(
  toolCall: TavusToolCallMessage,
  text: string,
): TavusConversationEchoMessage {
  return {
    message_type: "conversation",
    event_type: "conversation.echo",
    conversation_id: toolCall.conversation_id,
    properties: {
      inference_id: toolCall.inference_id,
      modality: "text",
      text,
      done: true,
    },
  };
}

function getToolCallKey(toolCall: TavusToolCallMessage) {
  return JSON.stringify({
    conversationId: toolCall.conversation_id,
    inferenceId: toolCall.inference_id ?? "",
    name: toolCall.properties.name,
    arguments: toolCall.properties.arguments,
  });
}

function getUtteranceKey(utterance: TavusConversationUtteranceMessage) {
  return JSON.stringify({
    conversationId: utterance.conversation_id ?? "",
    inferenceId: utterance.inference_id ?? "",
    role: utterance.properties.role,
    speech: utterance.properties.speech,
  });
}

function getProcessedMessageStore(storeName: "__tavusProcessedToolCalls__" | "__tavusProcessedUtterances__") {
  if (typeof window === "undefined") {
    return new Set<string>();
  }

  const globalWindow = window as Window & {
    __tavusProcessedToolCalls__?: Set<string>;
    __tavusProcessedUtterances__?: Set<string>;
  };

  if (!globalWindow[storeName]) {
    globalWindow[storeName] = new Set<string>();
  }

  return globalWindow[storeName];
}

/** Race a promise against an AbortSignal so that hung Daily methods can be escaped. */
function raceAbortSignal<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    return Promise.reject(new Error("The connection timed out."));
  }

  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      signal.addEventListener(
        "abort",
        () => reject(new Error("The connection timed out.")),
        { once: true },
      );
    }),
  ]);
}

// ---------------------------------------------------------------------------
// Type guards
// ---------------------------------------------------------------------------

function isTavusMessage(payload: unknown): payload is TavusAppMessage {
  return (
    typeof payload === "object" &&
    payload !== null &&
    "event_type" in payload &&
    "message_type" in payload
  );
}

function isToolCallMessage(payload: TavusAppMessage): payload is TavusToolCallMessage {
  return payload.event_type === "conversation.tool_call";
}

function isUtteranceMessage(payload: TavusAppMessage): payload is TavusConversationUtteranceMessage {
  return payload.event_type === "conversation.utterance";
}

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

type DemoState = {
  status: DemoStatus;
  errorMessage: string | null;
  callObject: DailyCall | null;
  conversationId: string | null;
  isMicMuted: boolean;
  overlayState: OverlayState | null;
  replicaReady: boolean;
  audioBlocked: boolean;
  latestUserTranscript: TranscriptEntry | null;
  latestReplicaTranscript: TranscriptEntry | null;
  userSpeaking: boolean;
  replicaSpeaking: boolean;
};

const INITIAL_DEMO_STATE: DemoState = {
  status: "idle",
  errorMessage: null,
  callObject: null,
  conversationId: null,
  isMicMuted: false,
  overlayState: null,
  replicaReady: false,
  audioBlocked: false,
  latestUserTranscript: null,
  latestReplicaTranscript: null,
  userSpeaking: false,
  replicaSpeaking: false,
};

type DemoAction =
  | { type: "RESET" }
  | { type: "PREPARE_START" }
  | { type: "CLEAR_SESSION" }
  | { type: "SET_STATUS"; status: DemoStatus }
  | { type: "CONNECTED" }
  | { type: "ERROR"; message: string }
  | { type: "SET_CALL_OBJECT"; callObject: DailyCall | null }
  | { type: "SET_CONVERSATION_ID"; id: string | null }
  | { type: "SET_MIC_MUTED"; muted: boolean }
  | { type: "SET_OVERLAY"; overlay: OverlayState | null }
  | { type: "SET_REPLICA_READY" }
  | { type: "SET_AUDIO_BLOCKED"; blocked: boolean }
  | { type: "SET_USER_TRANSCRIPT"; transcript: TranscriptEntry }
  | { type: "SET_REPLICA_TRANSCRIPT"; transcript: TranscriptEntry }
  | { type: "USER_STARTED_SPEAKING" }
  | { type: "USER_STOPPED_SPEAKING" }
  | { type: "REPLICA_STARTED_SPEAKING" }
  | { type: "REPLICA_STOPPED_SPEAKING" };

function demoReducer(state: DemoState, action: DemoAction): DemoState {
  switch (action.type) {
    case "RESET":
      return { ...INITIAL_DEMO_STATE, isMicMuted: state.isMicMuted };
    case "PREPARE_START":
      return {
        ...state,
        errorMessage: null,
        audioBlocked: false,
        overlayState: null,
        replicaReady: false,
        latestUserTranscript: null,
        latestReplicaTranscript: null,
        userSpeaking: false,
        replicaSpeaking: false,
      };
    case "CLEAR_SESSION":
      return {
        ...state,
        conversationId: null,
        overlayState: null,
        replicaReady: false,
        audioBlocked: false,
        latestUserTranscript: null,
        latestReplicaTranscript: null,
        userSpeaking: false,
        replicaSpeaking: false,
      };
    case "SET_STATUS":
      return { ...state, status: action.status };
    case "CONNECTED":
      return { ...state, status: "connected", errorMessage: null };
    case "ERROR":
      return { ...state, status: "error", errorMessage: action.message };
    case "SET_CALL_OBJECT":
      return { ...state, callObject: action.callObject };
    case "SET_CONVERSATION_ID":
      return { ...state, conversationId: action.id };
    case "SET_MIC_MUTED":
      return { ...state, isMicMuted: action.muted };
    case "SET_OVERLAY":
      return { ...state, overlayState: action.overlay };
    case "SET_REPLICA_READY":
      return { ...state, replicaReady: true };
    case "SET_AUDIO_BLOCKED":
      return { ...state, audioBlocked: action.blocked };
    case "SET_USER_TRANSCRIPT":
      return { ...state, latestUserTranscript: action.transcript, userSpeaking: false };
    case "SET_REPLICA_TRANSCRIPT":
      return { ...state, latestReplicaTranscript: action.transcript };
    case "USER_STARTED_SPEAKING":
      return { ...state, userSpeaking: true, replicaSpeaking: false };
    case "USER_STOPPED_SPEAKING":
      return { ...state, userSpeaking: false };
    case "REPLICA_STARTED_SPEAKING":
      return { ...state, replicaSpeaking: true, userSpeaking: false };
    case "REPLICA_STOPPED_SPEAKING":
      return { ...state, replicaSpeaking: false };
    default:
      return state;
  }
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

type TranscriptPanelProps = {
  latestReplicaTranscript: TranscriptEntry | null;
  latestUserTranscript: TranscriptEntry | null;
  replicaSpeaking: boolean;
  userSpeaking: boolean;
};

function TranscriptPanel({
  latestReplicaTranscript,
  latestUserTranscript,
  replicaSpeaking,
  userSpeaking,
}: TranscriptPanelProps) {
  const showPanel =
    userSpeaking || replicaSpeaking || Boolean(latestUserTranscript?.text || latestReplicaTranscript?.text);

  if (!showPanel) {
    return null;
  }

  const userText = userSpeaking && !latestUserTranscript?.text
    ? "Listening..."
    : latestUserTranscript?.text ?? "Waiting for your first question.";
  const replicaText = replicaSpeaking && !latestReplicaTranscript?.text
    ? "Speaking..."
    : latestReplicaTranscript?.text ?? "Agent responses appear here.";

  return (
    <div className="absolute bottom-24 left-3 z-20 w-[min(34rem,calc(100vw-1.5rem-9.5rem))] rounded-[1.75rem] border border-white/10 bg-slate-950/55 p-4 shadow-[0_24px_80px_rgba(0,0,0,0.45)] backdrop-blur-xl sm:bottom-28 sm:left-6">
      <div className="space-y-3">
        <TranscriptPanelRow active={userSpeaking} label="You" text={userText} />
        <TranscriptPanelRow active={replicaSpeaking} label="Agent" text={replicaText} />
      </div>
    </div>
  );
}

type TranscriptPanelRowProps = {
  active: boolean;
  label: string;
  text: string;
};

function TranscriptPanelRow({ active, label, text }: TranscriptPanelRowProps) {
  return (
    <div
      className={
        active
          ? "rounded-[1.25rem] border border-sky-300/20 bg-sky-400/10 px-4 py-3"
          : "rounded-[1.25rem] border border-white/8 bg-white/5 px-4 py-3"
      }
    >
      <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.28em] text-slate-400">
        <span className={active ? "size-2 rounded-full bg-sky-300" : "size-2 rounded-full bg-slate-500"} />
        {label}
      </div>
      <p className={active ? "mt-2 text-sm leading-6 text-slate-50" : "mt-2 text-sm leading-6 text-slate-200/90"}>
        {text}
      </p>
    </div>
  );
}

type FloatingMicControlProps = {
  isMuted: boolean;
  isOverlayActive?: boolean;
  micName?: string | null;
  onToggle(): void;
  onCycleMic?(): void;
  onCycleSpeaker?(): void;
  speakerName?: string | null;
};

function FloatingMicControl({
  isMuted,
  isOverlayActive,
  micName,
  onToggle,
  onCycleMic,
  onCycleSpeaker,
  speakerName,
}: FloatingMicControlProps) {
  const [isHovered, setIsHovered] = useState(false);
  const isCollapsed = isOverlayActive && !isHovered;

  return (
    <div
      className={`absolute left-2 top-2 z-40 overflow-hidden rounded-[1rem] border border-white/10 bg-slate-950/78 px-2.5 py-2 shadow-[0_18px_44px_rgba(0,0,0,0.35)] backdrop-blur-xl transition-all duration-200 sm:left-4 sm:top-4 ${isCollapsed ? "w-[4.5rem]" : "w-28 sm:w-[11.5rem]"}`}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <div className="flex items-center gap-2">
        <span
          className={isMuted ? "size-1.5 shrink-0 rounded-full bg-rose-400" : "size-1.5 shrink-0 rounded-full bg-emerald-300"}
        />
        {!isCollapsed && (
          <div className="min-w-0 flex-1">
            <p className="text-[0.45rem] uppercase tracking-[0.32em] text-slate-500">Mic</p>
            <p className="text-[0.6rem] font-medium uppercase tracking-[0.16em] text-white">
              {isMuted ? "Muted" : "Live"}
            </p>
          </div>
        )}
        <button
          className={
            isMuted
              ? "shrink-0 rounded-full border border-emerald-300/30 bg-emerald-400/12 px-2 py-0.5 text-[0.52rem] font-semibold uppercase tracking-[0.18em] text-emerald-100 transition hover:bg-emerald-400/18"
              : "shrink-0 rounded-full border border-rose-300/30 bg-rose-400/12 px-2 py-0.5 text-[0.52rem] font-semibold uppercase tracking-[0.18em] text-rose-100 transition hover:bg-rose-400/18"
          }
          onClick={onToggle}
          type="button"
        >
          {isMuted ? "Unmute" : "Mute"}
        </button>
      </div>

      {!isCollapsed && (
        <div className="mt-1.5 hidden space-y-1 border-t border-white/8 pt-1.5 sm:block">
          <button
            className="flex w-full items-center gap-2 rounded-[0.75rem] bg-white/5 px-2 py-1 text-left transition hover:bg-white/8 disabled:cursor-default disabled:hover:bg-white/5"
            disabled={!onCycleMic}
            onClick={onCycleMic}
            type="button"
          >
            <span className="shrink-0 text-[0.42rem] uppercase tracking-[0.26em] text-slate-500">Mic</span>
            <span className="min-w-0 flex-1 truncate text-[0.54rem] text-slate-200">
              {getDeviceDisplayName(micName, "Waiting")}
            </span>
            <span className="shrink-0 text-[0.42rem] uppercase tracking-[0.16em] text-slate-500">^F</span>
          </button>

          <button
            className="flex w-full items-center gap-2 rounded-[0.75rem] bg-white/5 px-2 py-1 text-left transition hover:bg-white/8 disabled:cursor-default disabled:hover:bg-white/5"
            disabled={!onCycleSpeaker}
            onClick={onCycleSpeaker}
            type="button"
          >
            <span className="shrink-0 text-[0.42rem] uppercase tracking-[0.22em] text-slate-500">Out</span>
            <span className="min-w-0 flex-1 truncate text-[0.54rem] text-slate-200">
              {getDeviceDisplayName(speakerName, "Waiting")}
            </span>
            <span className="shrink-0 text-[0.42rem] uppercase tracking-[0.16em] text-slate-500">^G</span>
          </button>

          <p className="px-1 text-[0.42rem] uppercase tracking-[0.16em] text-slate-500">
            Ctrl+D mute
          </p>
        </div>
      )}
    </div>
  );
}

type CallControlBarProps = {
  isMuted: boolean;
  onEndCall(): void;
  onToggleMute(): void;
};

function CallControlBar({ isMuted, onEndCall, onToggleMute }: CallControlBarProps) {
  return (
    <div className="absolute inset-x-0 bottom-0 z-30 flex justify-center border-t border-white/10 bg-slate-950/85 px-3 py-3 backdrop-blur-xl">
      <div className="flex items-center gap-3">
        <button
          aria-label={isMuted ? "Unmute microphone" : "Mute microphone"}
          className={
            isMuted
              ? "flex size-11 shrink-0 items-center justify-center rounded-full border border-rose-300/30 bg-rose-500/90 text-white transition hover:bg-rose-500"
              : "flex size-11 shrink-0 items-center justify-center rounded-full border border-white/15 bg-white/10 text-white transition hover:bg-white/20"
          }
          onClick={onToggleMute}
          type="button"
        >
          {isMuted ? (
            <svg fill="none" height="20" viewBox="0 0 24 24" width="20" xmlns="http://www.w3.org/2000/svg">
              <path d="M3 3l18 18M9 9v3a3 3 0 0 0 4.24 2.73M15 9.34V6a3 3 0 0 0-5.94-.6M5 11a7 7 0 0 0 9.9 6.37M19 11a7 7 0 0 1-.94 3.52M12 18v3" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
            </svg>
          ) : (
            <svg fill="none" height="20" viewBox="0 0 24 24" width="20" xmlns="http://www.w3.org/2000/svg">
              <path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3z" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
              <path d="M5 11a7 7 0 0 0 14 0M12 18v3" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
            </svg>
          )}
        </button>

        <button
          aria-label="End call"
          className="flex h-11 shrink-0 items-center justify-center gap-2 rounded-full bg-rose-600 px-4 text-sm font-semibold text-white transition hover:bg-rose-500 sm:px-5"
          onClick={onEndCall}
          type="button"
        >
          <svg fill="none" height="18" viewBox="0 0 24 24" width="18" xmlns="http://www.w3.org/2000/svg">
            <path d="M3.6 9.6c5.6-5 11.2-5 16.8 0a1.2 1.2 0 0 1 .18 1.6l-2.1 2.8a1.2 1.2 0 0 1-1.62.28l-2.35-1.57a1.2 1.2 0 0 0-1.36.04c-.6.44-1.42.44-2.15.44-.73 0-1.55 0-2.15-.44a1.2 1.2 0 0 0-1.36-.04l-2.35 1.57a1.2 1.2 0 0 1-1.62-.28l-2.1-2.8a1.2 1.2 0 0 1 .18-1.6z" fill="currentColor" />
          </svg>
          <span className="hidden sm:inline">End call</span>
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// TavusSession – renders the active call with video, overlays, and audio
// ---------------------------------------------------------------------------

type TavusSessionProps = {
  audioBlocked: boolean;
  callObject: DailyCall;
  isMicMuted: boolean;
  latestReplicaTranscript: TranscriptEntry | null;
  latestUserTranscript: TranscriptEntry | null;
  onEndCall(): void;
  onToggleMicMute(): void;
  overlayState: OverlayState | null;
  replicaReady: boolean;
  replicaSpeaking: boolean;
  onAudioBlockedChange(nextValue: boolean): void;
  userSpeaking: boolean;
};

function TavusSession({
  audioBlocked,
  callObject,
  isMicMuted,
  latestReplicaTranscript,
  latestUserTranscript,
  onEndCall,
  onToggleMicMute,
  overlayState,
  replicaReady,
  replicaSpeaking,
  onAudioBlockedChange,
  userSpeaking,
}: TavusSessionProps) {
  const remoteParticipantIds = useParticipantIds({ filter: "remote" });
  const localParticipantId = useParticipantIds({ filter: "local" })[0] ?? null;
  const { currentMic, currentSpeaker, refreshDevices, setSpeaker, speakers } = useDevices();
  const audioHandleRef = useRef<DailyAudioHandle | null>(null);

  const activeContent = useMemo(() => {
    if (!overlayState || overlayState.kind !== "content") {
      return null;
    }

    const item = CONTENT_ITEMS[overlayState.contentItemKey];
    const query = overlayState.query ? new URLSearchParams(overlayState.query).toString() : "";

    return { ...item, url: query ? `${item.url}?${query}` : item.url };
  }, [overlayState]);

  const activeContentItemKey = overlayState?.kind === "content" ? overlayState.contentItemKey : null;
  const activeCanvas = overlayState?.kind === "canvas" ? overlayState : null;

  const avatarSessionId = remoteParticipantIds[0] ?? null;
  const canRenderAvatar = Boolean(avatarSessionId);

  useEffect(() => {
    void refreshDevices();
  }, [refreshDevices]);

  const handleCycleMic = useCallback(async () => {
    if (callObject.isDestroyed()) {
      return;
    }

    await callObject.cycleMic();
  }, [callObject]);

  const handleCycleSpeaker = useCallback(async () => {
    if (speakers.length === 0) {
      return;
    }

    const selectedSpeakerIndex = speakers.findIndex((speaker) => speaker.selected);
    const currentSpeakerIndex = selectedSpeakerIndex >= 0
      ? selectedSpeakerIndex
      : speakers.findIndex((speaker) => speaker.device.deviceId === currentSpeaker?.device.deviceId);
    const nextSpeaker = speakers[(currentSpeakerIndex + 1 + speakers.length) % speakers.length];

    if (!nextSpeaker?.device.deviceId) {
      return;
    }

    await setSpeaker(nextSpeaker.device.deviceId);
  }, [currentSpeaker?.device.deviceId, setSpeaker, speakers]);

  useEffect(() => {
    const handleDeviceHotkeys = (event: KeyboardEvent) => {
      if (
        event.repeat ||
        !event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        event.shiftKey
      ) {
        return;
      }

      const key = event.key.toLowerCase();

      if (key === "f") {
        event.preventDefault();
        void handleCycleMic();
        return;
      }

      if (key === "g") {
        event.preventDefault();
        void handleCycleSpeaker();
      }
    };

    window.addEventListener("keydown", handleDeviceHotkeys);
    return () => {
      window.removeEventListener("keydown", handleDeviceHotkeys);
    };
  }, [handleCycleMic, handleCycleSpeaker]);

  const handleResumeAudio = useCallback(async () => {
    const audioElements = audioHandleRef.current?.getAllAudio() ?? [];

    if (audioElements.length === 0) {
      onAudioBlockedChange(false);
      return;
    }

    const playResults = await Promise.allSettled(
      audioElements.map((audioElement) => audioElement.play()),
    );

    onAudioBlockedChange(playResults.some((result) => result.status === "rejected"));
  }, [onAudioBlockedChange]);

  return (
    <>
      <div className={`relative h-screen w-screen overflow-hidden ${overlayState ? "bg-slate-950" : "bg-black"}`}>
        <FloatingMicControl
          isMuted={isMicMuted}
          isOverlayActive={Boolean(overlayState)}
          micName={currentMic?.device.label}
          onCycleMic={() => {
            void handleCycleMic();
          }}
          onCycleSpeaker={() => {
            void handleCycleSpeaker();
          }}
          onToggle={onToggleMicMute}
          speakerName={currentSpeaker?.device.label}
        />

        {/* 1. Luxury F&I Presentation Overlay Layer - 100% Native React Components */}
        {overlayState ? (
          <div className="absolute inset-0 z-10 h-full w-full overflow-y-auto">
            {activeContentItemKey === "warranty_terms" ? (
              <WarrantyTermsPage />
            ) : activeContentItemKey === "cost_breakdown" ? (
              <CostBreakdownPage />
            ) : activeContentItemKey === "pricing_ladder" ? (
              <PricingLadderPage />
            ) : activeContentItemKey === "deal_summary" ? (
              <DealSummaryPage />
            ) : activeContentItemKey === "escalate_to_human" ? (
              <EscalatePage />
            ) : (
              <PresentationCanvas
                elements={activeCanvas?.elements}
                shownProducts={activeCanvas?.shownProducts ?? []}
                activeProduct={activeCanvas?.activeProduct}
                dailyRate={activeCanvas?.dailyRate ?? 4.0}
              />
            )}
          </div>
        ) : null}

        {/* 2. Persistent Single Avatar Video Container - Never unmounted on layout toggle */}
        <div
          className={
            overlayState
              ? "absolute right-4 top-4 z-20 h-[96px] w-[128px] overflow-hidden rounded-[1.1rem] border border-white/15 bg-slate-950/90 shadow-2xl backdrop-blur transition-all duration-300 sm:h-[108px] sm:w-[144px] md:h-[120px] md:w-[160px]"
              : "absolute inset-0 z-0 h-full w-full bg-black transition-all duration-300"
          }
        >
          {avatarSessionId ? (
            <DailyVideo
              className="h-full w-full bg-slate-950 object-cover"
              fit="cover"
              sessionId={avatarSessionId}
              type="video"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-slate-950 text-slate-400">
              <div className="flex flex-col items-center gap-3">
                <div className="h-8 w-8 animate-spin rounded-full border-2 border-sky-400 border-t-transparent" />
                <span className="text-xs uppercase tracking-wider text-slate-400">
                  {replicaReady ? "Connecting video stream..." : "Connecting with Max..."}
                </span>
              </div>
            </div>
          )}
        </div>

        {/* 3. Live Conversation Transcript Panel - only active in full-screen conversation mode */}
        {!overlayState && (
          <TranscriptPanel
            latestReplicaTranscript={latestReplicaTranscript}
            latestUserTranscript={latestUserTranscript}
            replicaSpeaking={replicaSpeaking}
            userSpeaking={userSpeaking}
          />
        )}

        <div className="absolute bottom-24 right-3 z-20 h-[88px] w-[118px] overflow-hidden rounded-[1.1rem] border border-white/15 bg-slate-950/90 shadow-2xl backdrop-blur sm:h-[108px] sm:w-[144px] md:right-4 md:h-[120px] md:w-[160px]">
          {localParticipantId ? (
            <DailyVideo
              className="h-full w-full bg-slate-950 object-cover"
              fit="cover"
              mirror
              sessionId={localParticipantId}
              type="video"
            />
          ) : (
            <div className="flex h-full items-center justify-center text-[0.6rem] uppercase tracking-[0.2em] text-slate-500">
              Camera off
            </div>
          )}
          <span className="absolute bottom-1 left-1.5 rounded-full bg-black/50 px-1.5 py-0.5 text-[0.5rem] font-semibold uppercase tracking-[0.16em] text-white/80">
            You
          </span>
        </div>

        <CallControlBar isMuted={isMicMuted} onEndCall={onEndCall} onToggleMute={onToggleMicMute} />

        {audioBlocked ? (
          <div className="absolute inset-x-3 bottom-[13.5rem] z-30 mx-auto flex w-fit max-w-full flex-wrap items-center justify-center gap-3 rounded-full border border-amber-300/30 bg-amber-400/15 px-4 py-3 text-sm text-amber-50 backdrop-blur sm:inset-x-0 sm:bottom-24">
            <span>Browser blocked audio playback.</span>
            <button
              className="rounded-full bg-amber-300 px-4 py-1.5 text-xs font-semibold uppercase tracking-[0.2em] text-slate-950 transition hover:bg-amber-200"
              onClick={() => void handleResumeAudio()}
              type="button"
            >
              Enable audio
            </button>
          </div>
        ) : null}
      </div>

      <div className="pointer-events-none absolute size-0 overflow-hidden opacity-0">
        <DailyAudio
          maxSpeakers={1}
          onPlayFailed={() => {
            onAudioBlockedChange(true);
          }}
          ref={audioHandleRef}
        />
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// TavusDemo – top-level component managing the full session lifecycle
// ---------------------------------------------------------------------------

export function TavusDemo() {
  const [state, dispatch] = useReducer(demoReducer, INITIAL_DEMO_STATE);
  const {
    status,
    errorMessage,
    callObject,
    conversationId,
    isMicMuted,
    overlayState,
    replicaReady,
    audioBlocked,
    latestUserTranscript,
    latestReplicaTranscript,
    userSpeaking,
    replicaSpeaking,
  } = state;
  const [personas, setPersonas] = useState<{ persona_id: string; persona_name: string }[]>([]);
  const [selectedPersonaId, setSelectedPersonaId] = useState<string>("");
  const [callSummary, setCallSummary] = useState<{ productLabels: string[]; dailyRate: number | null; conversationId?: string | null } | null>(null);

  // Refs that mirror state for use inside async callbacks where reading state
  // directly would capture a stale closure.
  const callObjectRef = useRef<DailyCall | null>(null);
  const conversationIdRef = useRef<string | null>(null);
  const statusRef = useRef<DemoStatus>("idle");
  const isMicMutedRef = useRef(false);

  const toolCallAudioContextRef = useRef<AudioContext | null>(null);
  const processedToolCallsRef = useRef<Set<string> | null>(null);
  const processedUtterancesRef = useRef<Set<string> | null>(null);
  const startInFlightRef = useRef(false);
  const isManualTeardownRef = useRef(false);
  const autoStartAttemptedRef = useRef(false);
  // Which show_pricing products have already been shown this call — drives the progress
  // stepper on the product panels. Session-local only, not a dedup/correctness store.
  const shownProductsRef = useRef<Set<string>>(new Set());
  // Last daily_rate actually shown — used for the post-call summary screen.
  const lastRateRef = useRef<number | null>(null);
  // Product order/labels and approved rates for the finance event's live-drawn grid — fetched
  // once from /api/finance-config since pricing.json is server-only (fs-backed, not bundled).
  const financeProductsRef = useRef<{ key: string; label: string }[]>([]);
  const approvedDailyRatesRef = useRef<number[]>([4, 3.5, 3.25, 3]);
  // Accumulated grid state across this call's draw_grid_outline/show_pricing/
  // show_payment_breakdown calls — rebuilt into a fresh element list on every call so the grid
  // fills in progressively instead of jumping straight to the finished layout.
  const canvasBoxLabelsRef = useRef<Map<string, string>>(new Map());
  const canvasPriceLabelRef = useRef<string | null>(null);
  const stateManagerRef = useRef<NegotiationStateManager>(new NegotiationStateManager());
  const activeProductRef = useRef<string | null>(null);
  const audioRecorderRef = useRef<{ stopAndUpload: (convId: string) => Promise<void> } | null>(null);
  const [pipelineStep, setPipelineStep] = useState<PipelineStep>("rapport");

  // Keep refs in sync with state
  useEffect(() => { callObjectRef.current = callObject; }, [callObject]);
  useEffect(() => { conversationIdRef.current = conversationId; }, [conversationId]);
  useEffect(() => { statusRef.current = status; }, [status]);
  useEffect(() => { isMicMutedRef.current = isMicMuted; }, [isMicMuted]);

  // Initialize global deduplication stores
  if (processedToolCallsRef.current == null) {
    processedToolCallsRef.current = getProcessedMessageStore("__tavusProcessedToolCalls__");
  }

  if (processedUtterancesRef.current == null) {
    processedUtterancesRef.current = getProcessedMessageStore("__tavusProcessedUtterances__");
  }

  const financeMode = isFinanceEvent();
  const showPersonaSelector = typeof window !== "undefined" && new URLSearchParams(window.location.search).has("personas");

  useEffect(() => {
    if (!showPersonaSelector) return;

    let cancelled = false;
    fetch("/api/personas", { cache: "no-store" })
      .then((res) => res.json())
      .then((data: { personas?: { persona_id: string; persona_name: string }[]; default_persona_id?: string }) => {
        if (cancelled) return;
        if (data.personas) {
          setPersonas(data.personas);
        }
        if (data.default_persona_id) {
          setSelectedPersonaId(data.default_persona_id);
        }
      })
      .catch(() => {
        // Persona list is best-effort; the default env var persona will still be used.
      });
    return () => { cancelled = true; };
  }, [showPersonaSelector]);

  useEffect(() => {
    if (!financeMode) return;

    let cancelled = false;
    fetch("/api/finance-config", { cache: "no-store" })
      .then((res) => res.json())
      .then((data: { products?: { key: string; label: string }[]; tiersUsd?: number[] }) => {
        if (cancelled) return;
        if (data.products) {
          financeProductsRef.current = data.products;
        }
        if (data.tiersUsd) {
          approvedDailyRatesRef.current = data.tiersUsd;
        }
      })
      .catch(() => {
        // The grid just won't render correctly until this loads; tool calls before then are rare
        // since draw_grid_outline only fires once the call is underway and Square 4 has started.
      });
    return () => { cancelled = true; };
  }, [financeMode]);

  // -------------------------------------------------------------------------
  // Mic control
  // -------------------------------------------------------------------------

  const syncMicMutedState = useCallback((currentCallObject: DailyCall | null) => {
    if (!currentCallObject || currentCallObject.isDestroyed()) {
      return;
    }

    dispatch({ type: "SET_MIC_MUTED", muted: !currentCallObject.localAudio() });
  }, []);

  const handleToggleMicMute = useCallback(() => {
    const nextMuted = !isMicMutedRef.current;
    dispatch({ type: "SET_MIC_MUTED", muted: nextMuted });

    const currentCallObject = callObjectRef.current;
    if (currentCallObject && !currentCallObject.isDestroyed()) {
      currentCallObject.setLocalAudio(!nextMuted);
    }
  }, []);

  // -------------------------------------------------------------------------
  // Tavus app-message handler
  // -------------------------------------------------------------------------

  // All values accessed are either stable (dispatch) or refs, so deps are empty.
  const handleAppMessage = useCallback((event: DailyEventObjectAppMessage<TavusAppMessage>) => {
    const payload = event.data;
    if (typeof window !== "undefined") {
      (window as any).__handleAppMessage = (p: any) => handleAppMessage({ data: p, fromId: "test-user" } as any);
    }

    if (!isTavusMessage(payload)) {
      return;
    }

    console.log("[Tavus event]", {
      fromId: event.fromId,
      payload,
    });

    if (REPLICA_READY_EVENT_TYPES.has(payload.event_type)) {
      dispatch({ type: "SET_REPLICA_READY" });
    }

    switch (payload.event_type) {
      case "conversation.user.started_speaking":
        dispatch({ type: "USER_STARTED_SPEAKING" });
        break;
      case "conversation.user.stopped_speaking":
        dispatch({ type: "USER_STOPPED_SPEAKING" });
        break;
      case "conversation.replica.started_speaking":
        dispatch({ type: "REPLICA_STARTED_SPEAKING" });
        break;
      case "conversation.replica.stopped_speaking":
      case "conversation.replica_interrupted":
        dispatch({ type: "REPLICA_STOPPED_SPEAKING" });
        break;
      default:
        break;
    }

    if (isUtteranceMessage(payload)) {
      const speech = payload.properties.speech.trim();

      if (!speech) {
        return;
      }

      const utteranceKey = getUtteranceKey(payload);

      if (processedUtterancesRef.current?.has(utteranceKey)) {
        return;
      }

      if (processedUtterancesRef.current && processedUtterancesRef.current.size >= 100) {
        processedUtterancesRef.current.clear();
      }

      processedUtterancesRef.current?.add(utteranceKey);

      const transcriptEntry = {
        inferenceId: payload.inference_id,
        text: speech,
      };

      if (payload.properties.role === "user") {
        dispatch({ type: "SET_USER_TRANSCRIPT", transcript: transcriptEntry });
      } else if (payload.properties.role === "replica") {
        dispatch({ type: "SET_REPLICA_READY" });
        dispatch({ type: "SET_REPLICA_TRANSCRIPT", transcript: transcriptEntry });

        const currentStep = stateManagerRef.current?.getState().call_state.current_step;
        const isPrePresentation =
          currentStep === "rapport" ||
          currentStep === "greeting" ||
          currentStep === "disclosure" ||
          currentStep === "qualifying";

        const lowerSpeech = speech.toLowerCase();
        if (
          lowerSpeech.includes("three years thirty-six thousand") ||
          lowerSpeech.includes("two different warranty not one") ||
          lowerSpeech.includes("two different warranties") ||
          lowerSpeech.includes("base limited warranty") ||
          lowerSpeech.includes("when they build a vehicle they put warranty in it")
        ) {
          const nextKey = resolveContentItemKey("warranty_terms");
          if (nextKey) {
            const cur = stateManagerRef.current?.getState().call_state.current_step;
            if (
              cur === "rapport" ||
              cur === "greeting" ||
              cur === "disclosure" ||
              cur === "qualifying"
            ) {
              try {
                stateManagerRef.current?.setStep("four_square");
                setPipelineStep("four_square");
              } catch (err) {
                console.warn("[stateManager] Could not advance step on fallback", err);
              }
            }
            dispatch({
              type: "SET_OVERLAY",
              overlay: { kind: "content", contentItemKey: nextKey },
            });
          }
        } else if (
          lowerSpeech.includes("95% of the time, when a vehicle breaks down") ||
          lowerSpeech.includes("three reasons usually cause the wear and tear") ||
          lowerSpeech.includes("three reasons usually cause wear and tear")
        ) {
          const nextKey = resolveContentItemKey("cost_breakdown");
          if (nextKey) {
            dispatch({
              type: "SET_OVERLAY",
              overlay: { kind: "content", contentItemKey: nextKey },
            });
          }
        } else if (
          lowerSpeech.includes("protection menu") ||
          lowerSpeech.includes("presentation grid") ||
          lowerSpeech.includes("four-box") ||
          lowerSpeech.includes("four box") ||
          lowerSpeech.includes("blanket cover") ||
          lowerSpeech.includes("bumper to bumper") ||
          lowerSpeech.includes("bumper-to-bumper") ||
          lowerSpeech.includes("tire and wheel") ||
          lowerSpeech.includes("maintenance package")
        ) {
          if (lowerSpeech.includes("blanket cover") || lowerSpeech.includes("bumper")) {
            shownProductsRef.current.add("vsc");
            canvasBoxLabelsRef.current.set("vsc", "Vehicle Service Contract");
          }
          if (lowerSpeech.includes("tire and wheel") || lowerSpeech.includes("eight tires")) {
            shownProductsRef.current.add("tire_wheel");
            canvasBoxLabelsRef.current.set("tire_wheel", "Tire & Wheel Protection");
          }
          if (lowerSpeech.includes("maintenance") || lowerSpeech.includes("oil change")) {
            shownProductsRef.current.add("maintenance");
            canvasBoxLabelsRef.current.set("maintenance", "Prepaid Maintenance");
          }
          if (lowerSpeech.includes("four dollars a day") || lowerSpeech.includes("coffee a day")) {
            lastRateRef.current = 4;
            canvasPriceLabelRef.current = "$4 / day";
          }

          const cur = stateManagerRef.current?.getState().call_state.current_step;
          if (
            cur === "rapport" ||
            cur === "greeting" ||
            cur === "disclosure" ||
            cur === "qualifying" ||
            cur === "four_square"
          ) {
            try {
              stateManagerRef.current?.setStep("four_square");
              setPipelineStep("four_square");
            } catch (err) {
              console.warn("[stateManager] Could not advance step on canvas fallback", err);
            }
          }

          dispatch({
            type: "SET_OVERLAY",
            overlay: {
              kind: "canvas",
              elements: buildCanvasSkeleton(
                financeProductsRef.current,
                canvasBoxLabelsRef.current,
                canvasPriceLabelRef.current
              ),
              products: financeProductsRef.current,
              shownProducts: Array.from(shownProductsRef.current),
              activeProduct: activeProductRef.current,
              dailyRate: lastRateRef.current,
            },
          });
        }
      }

      const currentConversationId = conversationIdRef.current;
      if (currentConversationId) {
        fetch("/api/conversation/log-utterance", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            conversationId: currentConversationId,
            role: payload.properties.role,
            text: speech,
          }),
          keepalive: true,
        }).catch(() => {});
      }

      return;
    }

    if (!isToolCallMessage(payload)) {
      return;
    }

    const toolCallKey = getToolCallKey(payload);

    if (processedToolCallsRef.current?.has(toolCallKey)) {
      console.debug("[Tavus tool call duplicate ignored]", {
        fromId: event.fromId,
        inferenceId: payload.inference_id,
        name: payload.properties.name,
      });
      return;
    }

    if (processedToolCallsRef.current && processedToolCallsRef.current.size >= 100) {
      processedToolCallsRef.current.clear();
    }

    processedToolCallsRef.current?.add(toolCallKey);
    void playToolCallChime(toolCallAudioContextRef);

    console.log("[Tavus tool call]", {
      fromId: event.fromId,
      payload,
    });

    let responseText = "I updated the screen.";

    try {
      const rawArguments = payload.properties.arguments;
      const parsedArguments =
        typeof rawArguments === "string" && rawArguments.length > 0
          ? (JSON.parse(rawArguments) as {
              item?: string;
              columns?: Array<{
                markdown?: string;
                markdown_table?: string;
                table?: string;
                title?: string;
              }>;
              markdown?: string;
              markdown_table?: string;
              table?: string;
              title?: string;
            })
          : typeof rawArguments === "object" && rawArguments !== null
            ? (rawArguments as {
                item?: string;
                columns?: Array<{
                  markdown?: string;
                  markdown_table?: string;
                  table?: string;
                  title?: string;
                }>;
                markdown?: string;
                markdown_table?: string;
                table?: string;
                title?: string;
              })
            : {};

      switch (payload.properties.name) {
        case "show_content": {
          const itemArg = parsedArguments.item || (parsedArguments as any).view;
          const normalized = (itemArg || "").toLowerCase().trim();

          // 1. If asking for the Four Square menu or all products
          if (
            normalized === "four_square" ||
            normalized === "protection_menu" ||
            normalized === "protection_plan" ||
            normalized === "products" ||
            normalized === "menu" ||
            normalized === "all_products"
          ) {
            dispatch({
              type: "SET_OVERLAY",
              overlay: {
                kind: "canvas",
                elements: buildCanvasSkeleton(financeProductsRef.current, canvasBoxLabelsRef.current, canvasPriceLabelRef.current),
                products: financeProductsRef.current,
                shownProducts: Array.from(shownProductsRef.current),
                activeProduct: null,
                dailyRate: lastRateRef.current,
              },
            });
            responseText = "Displaying the Digital Four Square Protection Menu.";
            break;
          }

          // 2. If customer has a doubt or question about a specific product (e.g. VSC, tire & wheel, maintenance, GAP)
          const matchedProduct = financeProductsRef.current.find((p) => {
            if (p.key === normalized) return true;
            if (p.key === "vsc" && (normalized.includes("vsc") || normalized.includes("bumper") || normalized.includes("blanket") || normalized.includes("wrap"))) return true;
            if (p.key === "tire_wheel" && (normalized.includes("tire") || normalized.includes("wheel"))) return true;
            if (p.key === "maintenance" && (normalized.includes("maint") || normalized.includes("oil") || normalized.includes("service"))) return true;
            if (p.key === "gap" && normalized.includes("gap")) return true;
            return false;
          });
          if (matchedProduct) {
            shownProductsRef.current.add(matchedProduct.key);
            activeProductRef.current = matchedProduct.key;
            dispatch({
              type: "SET_OVERLAY",
              overlay: {
                kind: "canvas",
                elements: buildCanvasSkeleton(financeProductsRef.current, canvasBoxLabelsRef.current, canvasPriceLabelRef.current),
                products: financeProductsRef.current,
                shownProducts: Array.from(shownProductsRef.current),
                activeProduct: matchedProduct.key,
                dailyRate: lastRateRef.current,
              },
            });
            responseText = `Focusing on ${matchedProduct.label} in the Protection Menu.`;
            break;
          }

          // 3. Standard F&I slides
          const nextContentItemKey = resolveContentItemKey(itemArg) ?? "warranty_terms";

          const query: Record<string, string> = {
            rate: String(lastRateRef.current ?? 4.0),
            customer: "Valued Customer",
            vehicle: "2026 Mazda CX-5",
            step: stateManagerRef.current.getState().call_state.current_step,
          };

          const cur = stateManagerRef.current?.getState().call_state.current_step;
          if (
            cur === "rapport" ||
            cur === "greeting" ||
            cur === "disclosure" ||
            cur === "qualifying"
          ) {
            try {
              stateManagerRef.current.setStep("four_square");
              setPipelineStep("four_square");
            } catch (err) {
              console.warn("[stateManager] Could not advance step on show_content", err);
            }
          }

          dispatch({
            type: "SET_OVERLAY",
            overlay: { kind: "content", contentItemKey: nextContentItemKey, query },
          });
          responseText = `Showing ${CONTENT_ITEMS[nextContentItemKey].label}.`;
          break;
        }
        case "propose_concession": {
          const stage = Number((parsedArguments as any).stage) || 1;
          const result = stateManagerRef.current.executeConcession(stage);
          if (!result.success) {
            responseText = result.message;
            break;
          }

          const dailyRate = result.newPriceDaily;
          lastRateRef.current = dailyRate;
          canvasPriceLabelRef.current = `${dailyRate % 1 === 0 ? `$${dailyRate}` : `$${dailyRate.toFixed(2)}`} / day`;

          // Keep customer on the active presentation menu with the dynamically updated dailyRate banner
          dispatch({
            type: "SET_OVERLAY",
            overlay: {
              kind: "canvas",
              elements: buildCanvasSkeleton(financeProductsRef.current, canvasBoxLabelsRef.current, canvasPriceLabelRef.current),
              products: financeProductsRef.current,
              shownProducts: Array.from(shownProductsRef.current),
              activeProduct: activeProductRef.current,
              dailyRate,
            },
          });
          responseText = result.message;
          break;
        }
        case "advance_stage": {
          const targetStep = (parsedArguments as any).targetStep as PipelineStep;
          try {
            stateManagerRef.current.setStep(targetStep);
            setPipelineStep(targetStep);
            responseText = `Stage advanced to ${targetStep}.`;
          } catch (err: any) {
            responseText = err.message;
          }
          break;
        }
        case "draw_grid_outline": {
          canvasBoxLabelsRef.current = new Map();
          canvasPriceLabelRef.current = null;
          shownProductsRef.current.clear();

          dispatch({
            type: "SET_OVERLAY",
            overlay: {
              kind: "canvas",
              elements: buildCanvasSkeleton(financeProductsRef.current, canvasBoxLabelsRef.current, null),
              products: financeProductsRef.current,
              shownProducts: [],
              activeProduct: null,
              dailyRate: null,
            },
          });
          responseText = "Drawing the grid.";
          break;
        }
        case "show_pricing": {
          const rawProduct = (parsedArguments as { product?: string }).product || "";
          const normalizedProd = rawProduct.toLowerCase().trim();
          const productInfo = financeProductsRef.current.find((p) => {
            if (p.key === normalizedProd) return true;
            if (p.key === "vsc" && (normalizedProd.includes("vsc") || normalizedProd.includes("bumper") || normalizedProd.includes("blanket") || normalizedProd.includes("wrap"))) return true;
            if (p.key === "tire_wheel" && (normalizedProd.includes("tire") || normalizedProd.includes("wheel"))) return true;
            if (p.key === "maintenance" && (normalizedProd.includes("maint") || normalizedProd.includes("oil") || normalizedProd.includes("service"))) return true;
            if (p.key === "gap" && normalizedProd.includes("gap")) return true;
            return false;
          });
          if (!productInfo) {
            responseText = "I could not find pricing for that product.";
            break;
          }

          shownProductsRef.current.add(productInfo.key);
          canvasBoxLabelsRef.current.set(productInfo.key, productInfo.label);

          dispatch({
            type: "SET_OVERLAY",
            overlay: {
              kind: "canvas",
              elements: buildCanvasSkeleton(
                financeProductsRef.current,
                canvasBoxLabelsRef.current,
                canvasPriceLabelRef.current,
              ),
              products: financeProductsRef.current,
              shownProducts: Array.from(shownProductsRef.current),
              activeProduct: productInfo.key,
              dailyRate: lastRateRef.current,
            },
          });
          responseText = `Showing ${productInfo.label} on the grid.`;
          break;
        }
        case "show_payment_breakdown": {
          const rawDailyRate = (parsedArguments as { daily_rate?: number }).daily_rate;
          const approvedDailyRates = approvedDailyRatesRef.current;
          const dailyRate = approvedDailyRates.includes(rawDailyRate as number)
            ? (rawDailyRate as number)
            : approvedDailyRates[0];
          lastRateRef.current = dailyRate;
          canvasPriceLabelRef.current = `${dailyRate % 1 === 0 ? `$${dailyRate}` : `$${dailyRate.toFixed(2)}`} / day`;

          let stage = 1;
          if (dailyRate === 3.5) stage = 2;
          else if (dailyRate === 3.25) stage = 3;
          else if (dailyRate === 3.0) stage = 4;
          stateManagerRef.current.executeConcession(stage);

          dispatch({
            type: "SET_OVERLAY",
            overlay: {
              kind: "canvas",
              elements: buildCanvasSkeleton(
                financeProductsRef.current,
                canvasBoxLabelsRef.current,
                canvasPriceLabelRef.current,
              ),
              products: financeProductsRef.current,
              shownProducts: Array.from(shownProductsRef.current),
              activeProduct: null,
              dailyRate: dailyRate,
            },
          });
          responseText = `Confirmed: price updated to $${dailyRate} a day ($${Number((dailyRate * 30).toFixed(0))}/month). Active agreed rate is $${dailyRate}/day.`;
          break;
        }
        case "clear_canvas": {
          canvasBoxLabelsRef.current = new Map();
          canvasPriceLabelRef.current = null;
          dispatch({ type: "SET_OVERLAY", overlay: null });
          responseText = "Cleared the screen.";
          break;
        }
        case "show_schedule": {
          dispatch({
            type: "SET_OVERLAY",
            overlay: {
              kind: "canvas",
              elements: buildCanvasSkeleton(financeProductsRef.current, canvasBoxLabelsRef.current, canvasPriceLabelRef.current),
              products: financeProductsRef.current,
              shownProducts: Array.from(shownProductsRef.current),
              activeProduct: null,
              dailyRate: lastRateRef.current,
            },
          });
          responseText = "Displaying the protection plan menu.";
          break;
        }
        case "escalate_to_human": {
          const nextContentItemKey = resolveContentItemKey("escalate_to_human");
          if (!nextContentItemKey) {
            responseText = "I could not find the hand-off screen.";
            break;
          }

          const reason = (parsedArguments as { reason?: string }).reason;
          fetch("/api/escalation", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ conversationId: payload.conversation_id, reason }),
            keepalive: true,
          }).catch(() => {
            // Best-effort logging only — never block the hand-off panel on this.
          });

          dispatch({
            type: "SET_OVERLAY",
            overlay: { kind: "content", contentItemKey: nextContentItemKey },
          });
          responseText = "Connecting the customer with a team member.";
          break;
        }
        case "dismiss_content": {
          // Safeguard: do not dismiss during active presentation or negotiation unless completed
          const currentStep = stateManagerRef.current.getState().call_state.current_step;
          if (currentStep === "four_square" || currentStep === "objection") {
            responseText = "Preserving the active presentation view.";
            break;
          }
          canvasBoxLabelsRef.current = new Map();
          canvasPriceLabelRef.current = null;
          dispatch({ type: "SET_OVERLAY", overlay: null });
          responseText = "Returning to the full conversation view.";
          break;
        }
        default: {
          responseText = `I do not recognize the tool ${payload.properties.name}.`;
        }
      }
    } catch (error) {
      responseText = `I hit an error while handling that screen request: ${getErrorMessage(error)}`;
    }

    callObjectRef.current?.sendAppMessage(getConversationEcho(payload, responseText), event.fromId);
  }, []);

  // -------------------------------------------------------------------------
  // Register app-message handler on callObject & window for test mode
  // -------------------------------------------------------------------------

  useEffect(() => {
    if (typeof window !== "undefined") {
      (window as any).__handleAppMessage = (p: any) => handleAppMessage({ data: p, fromId: "test-user" } as any);
    }
    return () => {
      if (typeof window !== "undefined") {
        delete (window as any).__handleAppMessage;
      }
    };
  }, [handleAppMessage]);

  useEffect(() => {
    if (!callObject) {
      return;
    }

    callObject.off("app-message", handleAppMessage);
    callObject.on("app-message", handleAppMessage);

    return () => {
      callObject.off("app-message", handleAppMessage);
    };
  }, [callObject, handleAppMessage]);

  // -------------------------------------------------------------------------
  // Sync mic muted state from Daily events
  // -------------------------------------------------------------------------

  useEffect(() => {
    if (!callObject) {
      return;
    }

    const syncFromCallObject = () => {
      syncMicMutedState(callObject);
    };

    callObject.on("started-camera", syncFromCallObject);
    callObject.on("joined-meeting", syncFromCallObject);
    callObject.on("participant-updated", syncFromCallObject);

    return () => {
      callObject.off("started-camera", syncFromCallObject);
      callObject.off("joined-meeting", syncFromCallObject);
      callObject.off("participant-updated", syncFromCallObject);
    };
  }, [callObject, syncMicMutedState]);

  // -------------------------------------------------------------------------
  // API helpers
  // -------------------------------------------------------------------------

  const createConversation = useCallback(async (signal?: AbortSignal) => {
    const llmName = getRequestedLlmName();
    const params = new URLSearchParams();
    if (llmName) params.set("llm", llmName);
    if (selectedPersonaId) params.set("persona", selectedPersonaId);
    const qs = params.toString();
    const conversationUrl = qs ? `/api/conversation?${qs}` : "/api/conversation";

    const response = await fetch(conversationUrl, {
      method: "POST",
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        "ngrok-skip-browser-warning": "true",
      },
      signal,
    });

    const responseText = await response.text();
    const responseJson = responseText
      ? (JSON.parse(responseText) as TavusConversationCreateResponse | { error?: string })
      : null;

    if (!response.ok || !responseJson || !("conversation_id" in responseJson)) {
      const message =
        responseJson && "error" in responseJson && responseJson.error
          ? responseJson.error
          : "Could not start a valid conversation.";
      throw new Error(message);
    }

    return responseJson;
  }, [selectedPersonaId]);

  const endConversation = useCallback(async (id: string, keepalive = false) => {
    try {
      if (keepalive && typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
        navigator.sendBeacon(`/api/conversation/${id}`);
      } else {
        await fetch(`/api/conversation/${id}`, {
          method: "POST",
          keepalive,
          cache: "no-store",
        });
      }
    } catch {
      // Best effort cleanup only.
    }
  }, []);


  const destroyCallObject = useCallback(async (currentCallObject: DailyCall | null) => {
    if (!currentCallObject || currentCallObject.isDestroyed()) {
      return;
    }

    try {
      await currentCallObject.destroy();
    } catch {
      // Best effort cleanup only.
    }
  }, []);

  // -------------------------------------------------------------------------
  // Session lifecycle
  // -------------------------------------------------------------------------

  const cleanupAfterLeave = useCallback(
    async (currentCallObject: DailyCall | null) => {
      if (financeMode) {
        const productLabels = Array.from(shownProductsRef.current)
          .map((productKey) => financeProductsRef.current.find((p) => p.key === productKey)?.label ?? null)
          .filter((label): label is string => Boolean(label));

        setCallSummary({ productLabels, dailyRate: lastRateRef.current, conversationId: conversationIdRef.current });
      }

      if (conversationIdRef.current && audioRecorderRef.current) {
        try {
          await audioRecorderRef.current.stopAndUpload(conversationIdRef.current);
        } catch (e) {
          console.warn("[audio-recorder] Cleanup upload failed:", e);
        }
        audioRecorderRef.current = null;
      }

      await destroyCallObject(currentCallObject);

      if (callObjectRef.current === currentCallObject) {
        callObjectRef.current = null;
      }

      conversationIdRef.current = null;
      dispatch({ type: "RESET" });
    },
    [destroyCallObject, financeMode],
  );

  const teardownDemo = useCallback(
    async (options?: { keepalive?: boolean }) => {
      const keepalive = options?.keepalive ?? false;
      const activeConversationId = conversationIdRef.current;
      const currentCallObject = callObjectRef.current;

      conversationIdRef.current = null;
      localStorage.removeItem(ACTIVE_CONVERSATION_STORAGE_KEY);
      dispatch({ type: "CLEAR_SESSION" });

      if (!currentCallObject) {
        if (activeConversationId) {
          await endConversation(activeConversationId, keepalive);
        }

        if (!keepalive) {
          dispatch({ type: "SET_STATUS", status: "idle" });
        }
        return;
      }

      if (keepalive) {
        await destroyCallObject(currentCallObject);
        callObjectRef.current = null;
        dispatch({ type: "SET_CALL_OBJECT", callObject: null });
        return;
      }

      dispatch({ type: "SET_STATUS", status: "leaving" });
      isManualTeardownRef.current = true;

      try {
        const meetingState = currentCallObject.meetingState();
        if (meetingState !== "new" && meetingState !== "left-meeting") {
          await currentCallObject.leave();
        }
      } catch {
        // Fall through to hard cleanup.
      }

      await cleanupAfterLeave(currentCallObject);

      if (activeConversationId) {
        await endConversation(activeConversationId, keepalive);
      }

      isManualTeardownRef.current = false;
    },
    [cleanupAfterLeave, destroyCallObject, endConversation],
  );

  // -------------------------------------------------------------------------
  // Start / restart
  // -------------------------------------------------------------------------

  const handleStart = useCallback(async () => {
    if (startInFlightRef.current || statusRef.current === "leaving") {
      return;
    }

    const isMock = hasEnabledQueryFlag("mock");
    if (isMock) {
      dispatch({ type: "CONNECTED" });
      dispatch({ type: "SET_REPLICA_READY" });
      dispatch({
        type: "SET_CALL_OBJECT",
        callObject: {
          isDestroyed: () => false,
          localAudio: () => true,
          meetingState: () => "joined-meeting",
          leave: async () => {},
          destroy: async () => {},
          sendAppMessage: () => {},
          on: () => {},
          off: () => {},
        } as any,
      });
      startInFlightRef.current = false;
      return;
    }

    startInFlightRef.current = true;
    isManualTeardownRef.current = false;
    dispatch({ type: "PREPARE_START" });

    // Clear deduplication stores for the new session so stale keys from a
    // previous session can never suppress a legitimate message in this one.
    processedToolCallsRef.current?.clear();
    processedUtterancesRef.current?.clear();
    shownProductsRef.current.clear();
    lastRateRef.current = null;
    canvasBoxLabelsRef.current = new Map();
    canvasPriceLabelRef.current = null;

    let nextCallObject: DailyCall | null = null;
    let nextConversationId: string | null = null;
    let connectTimeoutId: NodeJS.Timeout | null = null;

    try {
      if (callObjectRef.current) {
        await teardownDemo();
      }

      // Recover any conversation ID that survived a previous crash or failed pagehide.
      // End it before starting a new one to avoid accumulating orphaned billable sessions.
      const storedConversationId = localStorage.getItem(ACTIVE_CONVERSATION_STORAGE_KEY);
      if (storedConversationId) {
        localStorage.removeItem(ACTIVE_CONVERSATION_STORAGE_KEY);
        await endConversation(storedConversationId);
      }

      nextCallObject = DailyIframe.createCallObject({
        subscribeToTracksAutomatically: true,
      });
      nextCallObject.on("app-message", handleAppMessage);
      callObjectRef.current = nextCallObject;
      dispatch({ type: "SET_CALL_OBJECT", callObject: nextCallObject });

      const requestedLlmName = getRequestedLlmName();
      const requestedLlmConfig = requestedLlmName ? getCustomTavusLlmConfig(requestedLlmName) : null;
      const shouldDisableVideo = requestedLlmConfig?.disableVideo === true;

      dispatch({ type: "SET_STATUS", status: "requesting-permissions" });
      const permAbortController = new AbortController();
      const permTimeoutId = setTimeout(() => permAbortController.abort(), 120_000);

      // Low-latency WebRTC audio capture track with hardware AEC
      let audioSource: MediaStreamTrack | boolean = true;
      if (typeof navigator !== "undefined" && navigator.mediaDevices?.getUserMedia) {
        try {
          const userMediaStream = await navigator.mediaDevices.getUserMedia({
            audio: {
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true,
              channelCount: 1,
            },
          });
          const audioTrack = userMediaStream.getAudioTracks()[0];
          if (audioTrack) {
            audioSource = audioTrack;
          }
        } catch {
          audioSource = true;
        }
      }

      try {
        await raceAbortSignal(
          nextCallObject.startCamera(
            shouldDisableVideo
              ? { audioSource, videoSource: false }
              : { audioSource },
          ),
          permAbortController.signal,
        );
      } catch (cameraErr: any) {
        // Fall back to audio-only if camera is blocked/dismissed
        console.warn("Camera failed or dismissed, falling back to audio-only...", cameraErr);
        try {
          await raceAbortSignal(
            nextCallObject.startCamera({ audioSource, videoSource: false }),
            permAbortController.signal,
          );
        } catch (audioErr: any) {
          throw new Error(
            "Microphone permission is required to speak with Max. Please check your browser's address bar to allow microphone access, then click Start Consultation again."
          );
        }
      } finally {
        clearTimeout(permTimeoutId);
      }

      if (shouldDisableVideo) {
        nextCallObject.setLocalVideo(false);
      }

      nextCallObject.setLocalAudio(!isMicMutedRef.current);

      // Dedicated 60s timeout for Tavus conversation creation and Daily room joining
      const connectAbortController = new AbortController();
      connectTimeoutId = setTimeout(() => connectAbortController.abort(), START_TIMEOUT_MS);

      dispatch({ type: "SET_STATUS", status: "loading" });
      const conversation = await createConversation(connectAbortController.signal);
      nextConversationId = conversation.conversation_id;
      localStorage.setItem(ACTIVE_CONVERSATION_STORAGE_KEY, nextConversationId);
      conversationIdRef.current = conversation.conversation_id;
      dispatch({ type: "SET_CONVERSATION_ID", id: conversation.conversation_id });

      dispatch({ type: "SET_STATUS", status: "joining" });
      await raceAbortSignal(
        nextCallObject.join({ url: conversation.conversation_url }),
        connectAbortController.signal,
      );

      // Initialize audio recorder for user mic + replica voice stream
      try {
        const audioChunks: Blob[] = [];
        const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
        const destNode = audioCtx.createMediaStreamDestination();
        const attachedTrackIds = new Set<string>();

        const attachParticipantAudio = () => {
          if (!nextCallObject) return;
          const participants = nextCallObject.participants();
          Object.values(participants).forEach((participant: any) => {
            const track = participant?.tracks?.audio?.persistentTrack;
            if (track && track.kind === "audio" && !attachedTrackIds.has(track.id)) {
              attachedTrackIds.add(track.id);
              try {
                const source = audioCtx.createMediaStreamSource(new MediaStream([track]));
                source.connect(destNode);
              } catch (e) {
                console.warn("[audio-recorder] Track connect warning:", e);
              }
            }
          });
        };

        attachParticipantAudio();
        nextCallObject.on("track-started", attachParticipantAudio);
        nextCallObject.on("participant-updated", attachParticipantAudio);

        const recorder = new MediaRecorder(destNode.stream);
        recorder.ondataavailable = (e) => {
          if (e.data && e.data.size > 0) {
            audioChunks.push(e.data);
          }
        };

        recorder.start(500);

        audioRecorderRef.current = {
          stopAndUpload: async (convId: string) => {
            if (recorder.state !== "inactive") {
              recorder.stop();
            }
            audioCtx.close().catch(() => {});
            const audioBlob = new Blob(audioChunks, { type: "audio/webm" });
            if (audioBlob.size > 0) {
              try {
                await fetch(`/api/conversation/${convId}/audio`, {
                  method: "POST",
                  body: audioBlob,
                });
                console.log(`[audio-recorder] Recorded & saved call audio for ${convId} (${audioBlob.size} bytes)`);
              } catch (err) {
                console.error("[audio-recorder] Audio upload failed:", err);
              }
            }
          },
        };
      } catch (recErr) {
        console.warn("[audio-recorder] Could not start audio recorder:", recErr);
      }

    } catch (error) {
      if (nextConversationId) {
        await endConversation(nextConversationId);
      }

      conversationIdRef.current = null;

      const message = getErrorMessage(error);
      dispatch({ type: "ERROR", message });
      dispatch({ type: "SET_CALL_OBJECT", callObject: null });
      dispatch({ type: "SET_CONVERSATION_ID", id: null });

      if (nextCallObject) {
        await destroyCallObject(nextCallObject);
      }

      if (callObjectRef.current === nextCallObject) {
        callObjectRef.current = null;
      }

    } finally {
      if (connectTimeoutId) {
        clearTimeout(connectTimeoutId);
      }
      startInFlightRef.current = false;
      isManualTeardownRef.current = false;
    }
  }, [createConversation, destroyCallObject, endConversation, teardownDemo]);

  // -------------------------------------------------------------------------
  // Keyboard shortcuts
  // -------------------------------------------------------------------------

  useEffect(() => {
    return () => {
      isManualTeardownRef.current = false;
    };
  }, []);



  useEffect(() => {
    const handleMicHotkey = (event: KeyboardEvent) => {
      if (
        event.repeat ||
        !event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        event.shiftKey ||
        event.key.toLowerCase() !== "d"
      ) {
        return;
      }

      event.preventDefault();
      handleToggleMicMute();
    };

    window.addEventListener("keydown", handleMicHotkey);
    return () => {
      window.removeEventListener("keydown", handleMicHotkey);
    };
  }, [handleToggleMicMute]);

  // -------------------------------------------------------------------------
  // Meeting state change & camera-error handlers
  // -------------------------------------------------------------------------

  useEffect(() => {
    const isMeetingEndText = (text: unknown): boolean => {
      if (!text) return false;
      const str = typeof text === "string" ? text : (text as any)?.message || (text as any)?.errorMsg || "";
      return (
        str.includes("Meeting has ended") ||
        str.includes("Meeting ended in error") ||
        str.includes("meeting-ended") ||
        str.includes("Meeting ended") ||
        str.includes("NotAllowedError") ||
        str.includes("Permission denied") ||
        str.includes("Devices Error") ||
        str.includes("Preferred cam not found")
      );
    };

    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      if (isMeetingEndText(event.reason)) {
        event.preventDefault();
      }
    };

    const handleGlobalError = (event: ErrorEvent) => {
      if (isMeetingEndText(event.message) || isMeetingEndText(event.error)) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    };

    const originalConsoleError = console.error;
    console.error = (...args: unknown[]) => {
      if (
        args.some((arg) => {
          const str = typeof arg === "string" ? arg : (arg as any)?.message || String(arg || "");
          return isMeetingEndText(arg) || str.includes("bis_skin_checked");
        })
      ) {
        return;
      }
      originalConsoleError.apply(console, args);
    };

    window.addEventListener("unhandledrejection", handleUnhandledRejection);
    window.addEventListener("error", handleGlobalError);
    return () => {
      window.removeEventListener("unhandledrejection", handleUnhandledRejection);
      window.removeEventListener("error", handleGlobalError);
      console.error = originalConsoleError;
    };
  }, []);

  useEffect(() => {
    const currentCallObject = callObject;

    if (!currentCallObject) {
      return;
    }

    const handleMeetingStateChange = (event?: any) => {
      const meetingState = currentCallObject.meetingState();

      switch (meetingState) {
        case "joined-meeting":
          dispatch({ type: "CONNECTED" });
          break;
        case "left-meeting":
          if (isManualTeardownRef.current) {
            return;
          }

          void cleanupAfterLeave(currentCallObject);
          break;
        case "error": {
          const rawError = event?.error;
          const errorMsg =
            event?.errorMsg ||
            event?.msg ||
            event?.message ||
            (typeof rawError === "string"
              ? rawError
              : rawError?.msg || rawError?.message || "") ||
            "";
          if (
            errorMsg.includes("Meeting has ended") ||
            errorMsg.includes("Meeting ended") ||
            errorMsg.includes("meeting-ended") ||
            event?.action === "meeting-ended"
          ) {
            void cleanupAfterLeave(currentCallObject);
            return;
          }
          // Do NOT tear down the call on non-fatal media or track warnings!
          console.warn("[Daily non-fatal warning]:", errorMsg);
          break;
        }
        default:
          break;
      }
    };

    const handleCameraError = (event: DailyEventObjectCameraError) => {
      console.warn("[Daily camera warning (non-fatal)]:", event);
      // Do NOT abort the entire call if the camera is locked by another app (e.g. Google Meet).
      // WebRTC audio communication with Max continues normally.
    };

    currentCallObject.on("joined-meeting", handleMeetingStateChange);
    currentCallObject.on("left-meeting", handleMeetingStateChange);
    currentCallObject.on("error", handleMeetingStateChange);
    currentCallObject.on("camera-error", handleCameraError);
    handleMeetingStateChange();

    return () => {
      currentCallObject.off("joined-meeting", handleMeetingStateChange);
      currentCallObject.off("left-meeting", handleMeetingStateChange);
      currentCallObject.off("error", handleMeetingStateChange);
      currentCallObject.off("camera-error", handleCameraError);
    };
  }, [callObject, cleanupAfterLeave]);

  // -------------------------------------------------------------------------
  // Replica-ready watchdog — the customer has joined the room but the avatar
  // hasn't shown up. Give it REPLICA_READY_TIMEOUT_MS, then fail loudly
  // instead of leaving the customer staring at an empty call indefinitely.
  // -------------------------------------------------------------------------

  useEffect(() => {
    if (status !== "connected" || replicaReady) {
      return;
    }

    // Fallback: If WebRTC connected, ensure avatar state is confirmed ready
    // rather than ever aborting an active consultation with a timer.
    const timeoutId = setTimeout(() => {
      dispatch({ type: "SET_REPLICA_READY" });
    }, 15_000);

    return () => clearTimeout(timeoutId);
  }, [status, replicaReady]);

  // -------------------------------------------------------------------------
  // Page-hide & unmount cleanup
  // -------------------------------------------------------------------------

  useEffect(() => {
    // Keep live WebRTC sessions running even if user switches tabs to Google Meet or notes.
    // Tavus backend enforces participant_left_timeout (600s) if the tab is truly closed.
    // Do NOT send eager kill-switch beacons on tab switch / backgrounding.
    const handlePageHide = () => {};

    window.addEventListener("pagehide", handlePageHide);
    return () => {
      window.removeEventListener("pagehide", handlePageHide);
    };
  }, []);

  useEffect(() => {
    return () => {
      // In development / Fast Refresh, unmounting happens during HMR edits.
      // Do not kill the active conversation on Tavus here.
      // True page unloads and navigations are handled by the pagehide event listener above.
      const currentCallObject = callObjectRef.current;
      if (currentCallObject && !currentCallObject.isDestroyed()) {
        void currentCallObject.destroy();
      }
    };
  }, []);

  useEffect(() => {
    if (
      !hasEnabledQueryFlag("autostart") ||
      autoStartAttemptedRef.current ||
      hasAutoStartAlreadyBeenClaimed()
    ) {
      return;
    }

    autoStartAttemptedRef.current = true;
    void handleStart();
  }, [handleStart]);

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  const showStartScreen = !callObject || status === "idle" || status === "error";
  const showSession = Boolean(callObject) && !showStartScreen;

  const handleManualStart = useCallback(() => {
    void handleStart();
  }, [handleStart]);

  const handleEndCall = useCallback(() => {
    if (financeMode) {
      const productLabels = Array.from(shownProductsRef.current)
        .map((productKey) => financeProductsRef.current.find((p) => p.key === productKey)?.label ?? null)
        .filter((label): label is string => Boolean(label));

      setCallSummary({ productLabels, dailyRate: lastRateRef.current, conversationId: conversationIdRef.current });
    }

    void teardownDemo();
  }, [financeMode, teardownDemo]);

  const handleStartNewCallFromSummary = useCallback(() => {
    setCallSummary(null);
  }, []);

  const handleAudioBlockedChange = useCallback(
    (blocked: boolean) => dispatch({ type: "SET_AUDIO_BLOCKED", blocked }),
    [],
  );

  if (showSession && callObject) {
    const isMock = hasEnabledQueryFlag("mock");
    if (isMock) {
      return (
        <MockSession
          audioBlocked={audioBlocked}
          isMicMuted={isMicMuted}
          latestReplicaTranscript={latestReplicaTranscript}
          latestUserTranscript={latestUserTranscript}
          onEndCall={handleEndCall}
          onToggleMicMute={handleToggleMicMute}
          overlayState={overlayState}
          replicaReady={replicaReady}
          replicaSpeaking={replicaSpeaking}
          onAudioBlockedChange={handleAudioBlockedChange}
          userSpeaking={userSpeaking}
        />
      );
    }

    return (
      <DailyProvider callObject={callObject}>
        <TavusSession
          audioBlocked={audioBlocked}
          callObject={callObject}
          isMicMuted={isMicMuted}
          latestReplicaTranscript={latestReplicaTranscript}
          latestUserTranscript={latestUserTranscript}
          onEndCall={handleEndCall}
          onToggleMicMute={handleToggleMicMute}
          overlayState={overlayState}
          replicaReady={replicaReady}
          replicaSpeaking={replicaSpeaking}
          onAudioBlockedChange={handleAudioBlockedChange}
          userSpeaking={userSpeaking}
        />
      </DailyProvider>
    );
  }

  return (
    <div
      className="relative h-screen overflow-y-auto bg-[radial-gradient(circle_at_top,_rgba(41,80,200,0.35),_transparent_38%),linear-gradient(180deg,_#09101d_0%,_#060912_100%)] text-white"
      suppressHydrationWarning
    >
      {callSummary ? (
        <CallSummaryScreen
          dailyRate={callSummary.dailyRate}
          conversationId={callSummary.conversationId}
          onStartNewCall={handleStartNewCallFromSummary}
          productLabels={callSummary.productLabels}
        />
      ) : null}

      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(120deg,rgba(255,255,255,0.04),transparent_38%),radial-gradient(circle_at_bottom,_rgba(123,204,163,0.2),_transparent_35%)]" />

      {financeMode ? (
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <div
            className="absolute -left-32 -top-32 size-[28rem] rounded-full bg-sky-500/25 blur-[100px]"
            style={{ animation: "orb-drift-a 16s ease-in-out infinite" }}
          />
          <div
            className="absolute -right-24 top-1/3 size-[24rem] rounded-full bg-violet-500/20 blur-[110px]"
            style={{ animation: "orb-drift-b 20s ease-in-out infinite" }}
          />
          <div
            className="absolute bottom-[-8rem] left-1/3 size-[26rem] rounded-full bg-emerald-400/15 blur-[110px]"
            style={{ animation: "orb-drift-c 18s ease-in-out infinite" }}
          />
          <div
            className="absolute inset-0 opacity-[0.07]"
            style={{
              backgroundImage:
                "linear-gradient(rgba(255,255,255,0.6) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.6) 1px, transparent 1px)",
              backgroundSize: "48px 48px",
              animation: "grid-pan 40s linear infinite",
            }}
          />
        </div>
      ) : null}

      <div className="relative z-10 mx-auto flex min-h-full w-full max-w-7xl flex-col px-6 py-8 md:px-10">
        <header
          className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between"
          style={financeMode ? { animation: "fade-in-up 0.6s ease-out both" } : undefined}
        >
          <div>
            <p className="flex items-center gap-2 text-xs uppercase tracking-[0.4em] text-sky-200/80">
              {financeMode ? (
                <span
                  className="size-2 rounded-full bg-emerald-400 shadow-[0_0_12px_2px_rgba(52,211,153,0.7)]"
                  style={{ animation: "pulse-dot 2s ease-in-out infinite" }}
                />
              ) : null}
              {financeMode
                ? (process.env.DEALERSHIP_NAME || "Digital Finance Manager")
                : "AWS Summit Sydney 2026"}
            </p>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight md:text-4xl">
              {financeMode ? "F&I Pricing Walkthrough" : "Conversational Voice AI"}
            </h1>
          </div>

          <div className="flex flex-col items-start gap-2 md:items-end">
            {showPersonaSelector && personas.length > 0 ? (
              <select
                className="min-h-10 rounded-full border border-white/15 bg-slate-800/80 px-4 py-2 text-sm text-white backdrop-blur transition hover:border-white/25 focus:border-sky-400/60 focus:outline-none"
                value={selectedPersonaId}
                onChange={(e) => setSelectedPersonaId(e.target.value)}
              >
                {personas.map((p) => (
                  <option key={p.persona_id} value={p.persona_id}>
                    {p.persona_name}
                  </option>
                ))}
              </select>
            ) : null}
            <button
              className={
                financeMode
                  ? "inline-flex min-h-12 items-center justify-center rounded-full bg-sky-400 px-6 py-3 text-base font-semibold text-slate-950 transition hover:scale-[1.03] hover:bg-sky-300 disabled:cursor-not-allowed disabled:bg-slate-600 disabled:text-slate-300 disabled:hover:scale-100"
                  : "inline-flex min-h-12 items-center justify-center rounded-full bg-sky-400 px-6 py-3 text-base font-semibold text-slate-950 transition hover:bg-sky-300 disabled:cursor-not-allowed disabled:bg-slate-600 disabled:text-slate-300"
              }
              style={
                financeMode && (status === "idle" || status === "error")
                  ? { animation: "button-glow 2.5s ease-in-out infinite" }
                  : undefined
              }
              disabled={status !== "idle" && status !== "error"}
              onClick={handleManualStart}
              type="button"
            >
              {(financeMode ? FINANCE_START_BUTTON_LABELS : START_BUTTON_LABELS)[
                status as keyof typeof START_BUTTON_LABELS
              ] ?? "Start demo"}
            </button>
          </div>
        </header>

        <section className="flex flex-1 items-center justify-center py-8">
          <div
            className={
              financeMode
                ? "grid w-full max-w-5xl gap-6 rounded-[2rem] border border-white/10 bg-slate-950/55 p-6 shadow-[0_30px_120px_rgba(0,0,0,0.35),0_0_80px_rgba(56,189,248,0.08)] backdrop-blur-xl md:grid-cols-[1.25fr_0.95fr] md:p-10"
                : "grid w-full max-w-5xl gap-6 rounded-[2rem] border border-white/10 bg-slate-950/55 p-6 shadow-[0_30px_120px_rgba(0,0,0,0.35)] backdrop-blur md:grid-cols-[1.25fr_0.95fr] md:p-10"
            }
            style={financeMode ? { animation: "fade-in-up 0.7s ease-out 0.1s both" } : undefined}
          >
            <div className="flex flex-col justify-between gap-8">
              <div className="space-y-5">
                <span
                  className="inline-flex w-fit rounded-full border border-emerald-300/30 bg-emerald-400/10 px-3 py-1 text-xs font-medium uppercase tracking-[0.3em] text-emerald-200"
                  style={financeMode ? { animation: "fade-in-up 0.6s ease-out 0.2s both" } : undefined}
                >
                  {financeMode ? "Video finance consultation" : "Camera-aware voice AI demo"}
                </span>
                <div className="space-y-4">
                  <h2
                    className={
                      financeMode
                        ? "max-w-2xl bg-gradient-to-r from-sky-300 via-white to-emerald-300 bg-clip-text text-4xl font-semibold leading-tight text-transparent md:text-5xl"
                        : "max-w-2xl text-4xl font-semibold leading-tight text-white md:text-5xl"
                    }
                    style={
                      financeMode
                        ? {
                            backgroundSize: "200% auto",
                            animation:
                              "fade-in-up 0.6s ease-out 0.3s both, gradient-shift 6s ease-in-out infinite 0.9s",
                          }
                        : undefined
                    }
                  >
                    {financeMode
                      ? "Meet Max, your digital finance manager."
                      : "Start the voice AI booth experience with a single click."}
                  </h2>
                  <p
                    className="max-w-2xl text-base leading-8 text-slate-300 md:text-lg"
                    style={financeMode ? { animation: "fade-in-up 0.6s ease-out 0.4s both" } : undefined}
                  >
                    {financeMode
                      ? "Max will confirm a few details with you, walk through your protection options at your own pace, and answer any questions along the way — just like sitting down with a finance manager in person."
                      : "The demo requests camera and microphone access, creates an AI conversation, joins the session room, and listens for tool calls that can change the on-screen content while the avatar keeps speaking."}
                  </p>
                </div>

                {financeMode ? (
                  <ul
                    className="flex flex-wrap gap-3 text-xs text-slate-300"
                    style={{ animation: "fade-in-up 0.6s ease-out 0.5s both" }}
                  >
                    <li className="flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-2">
                      <svg fill="none" height="14" viewBox="0 0 24 24" width="14" xmlns="http://www.w3.org/2000/svg">
                        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" stroke="#7dd3fc" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.75" />
                      </svg>
                      Private, one-on-one video call
                    </li>
                    <li className="flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-2">
                      <svg fill="none" height="14" viewBox="0 0 24 24" width="14" xmlns="http://www.w3.org/2000/svg">
                        <circle cx="12" cy="12" r="9" stroke="#7dd3fc" strokeWidth="1.75" />
                        <path d="M12 7v5l3.5 2" stroke="#7dd3fc" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.75" />
                      </svg>
                      About 10–15 minutes
                    </li>
                    <li className="flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-2">
                      <svg fill="none" height="14" viewBox="0 0 24 24" width="14" xmlns="http://www.w3.org/2000/svg">
                        <rect height="14" rx="2" stroke="#7dd3fc" strokeWidth="1.75" width="16" x="4" y="6" />
                        <path d="M9 6V4h6v2" stroke="#7dd3fc" strokeLinecap="round" strokeWidth="1.75" />
                      </svg>
                      Recorded for your protection, same as in person
                    </li>
                  </ul>
                ) : null}
              </div>

              {errorMessage ? (
                <div className="rounded-3xl border border-rose-300/20 bg-rose-500/10 px-5 py-4 text-sm text-rose-100">
                  <p className="font-semibold">{errorMessage}</p>
                  {errorMessage.toLowerCase().includes("credits") ? (
                    <div className="mt-4 p-4 rounded-2xl bg-sky-500/15 border border-sky-400/20 space-y-2">
                      <p className="text-xs text-sky-200">
                        You can test the progressive Excalidraw presentation panel in **Local Mock Mode** without spending credits.
                      </p>
                      <button
                        className="rounded-full bg-sky-400 px-4 py-2 text-xs font-semibold text-slate-950 transition hover:bg-sky-300"
                        onClick={() => {
                          if (typeof window !== "undefined") {
                            window.location.search = "?mock=true";
                          }
                        }}
                        type="button"
                      >
                        Launch Mock Mode
                      </button>
                    </div>
                  ) : (
                    <div className="mt-3">
                      <button
                        className="rounded-full border border-rose-300/30 bg-rose-400/20 px-4 py-1.5 text-xs font-semibold uppercase tracking-[0.2em] text-rose-100 transition hover:bg-rose-400/30"
                        onClick={handleManualStart}
                        type="button"
                      >
                        Retry
                      </button>
                    </div>
                  )}
                </div>
              ) : null}
            </div>

            <div className="grid gap-4 text-sm text-slate-200">
              <div
                className={
                  financeMode
                    ? "rounded-[1.5rem] border border-white/10 bg-white/5 p-5 transition hover:border-sky-300/30 hover:bg-white/[0.07]"
                    : "rounded-[1.5rem] border border-white/10 bg-white/5 p-5"
                }
                style={financeMode ? { animation: "fade-in-up 0.6s ease-out 0.5s both" } : undefined}
              >
                <p className="text-xs uppercase tracking-[0.3em] text-sky-200/70">
                  {financeMode ? "What to expect" : "Join Flow"}
                </p>
                <ol className="mt-4 space-y-3 text-slate-200">
                  {financeMode ? (
                    <>
                      <li>1. Say hello to Max.</li>
                      <li>2. Confirm a few details about you and your vehicle.</li>
                      <li>3. Go through your protection options together, at your pace.</li>
                      <li>4. Ask questions any time — Max will slow down or explain more.</li>
                    </>
                  ) : (
                    <>
                      <li>1. Request camera and microphone permissions.</li>
                      <li>2. Create an AI conversation via the API.</li>
                      <li>3. Join the session room.</li>
                      <li>4. Render avatar video and audio.</li>
                    </>
                  )}
                </ol>
              </div>
              <div
                className={
                  financeMode
                    ? "rounded-[1.5rem] border border-white/10 bg-white/5 p-5 transition hover:border-emerald-300/30 hover:bg-white/[0.07]"
                    : "rounded-[1.5rem] border border-white/10 bg-white/5 p-5"
                }
                style={financeMode ? { animation: "fade-in-up 0.6s ease-out 0.6s both" } : undefined}
              >
                <p className="text-xs uppercase tracking-[0.3em] text-emerald-200/70">
                  {financeMode ? "Try asking Max" : "Tool Use Demo"}
                </p>
                <p className="mt-4 leading-7 text-slate-300">
                  {financeMode ? (
                    <>
                      <em>&ldquo;Can you show me the GAP coverage?&rdquo;</em> or{" "}
                      <em>&ldquo;What&apos;s the payment breakdown?&rdquo;</em> — Max will bring up the
                      right screen while explaining it.
                    </>
                  ) : (
                    <>
                      Ask the agent to show content on screen. Try{" "}
                      <em>&ldquo;Show the voice agent guidance&rdquo;</em> or{" "}
                      <em>&ldquo;Show me the schedule&rdquo;</em>.
                    </>
                  )}
                </p>
              </div>
              <div
                className={
                  financeMode
                    ? "rounded-[1.5rem] border border-white/10 bg-white/5 p-5 transition hover:border-violet-300/30 hover:bg-white/[0.07]"
                    : "rounded-[1.5rem] border border-white/10 bg-white/5 p-5"
                }
                style={financeMode ? { animation: "fade-in-up 0.6s ease-out 0.7s both" } : undefined}
              >
                <p className="text-xs uppercase tracking-[0.3em] text-violet-200/70">
                  {financeMode ? "Have a document handy?" : "Visual Reasoning Check"}
                </p>
                <p className="mt-4 leading-7 text-slate-300">
                  {financeMode
                    ? "You can hold your ID or vehicle registration up to the camera, and Max can read it back to confirm the details with you."
                    : "After the call connects, ask what the agent can see. The avatar should be able to answer questions about your camera feed."}
                </p>
              </div>
            </div>
          </div>
        </section>

        {!financeMode ? (
          <footer className="flex items-center justify-center gap-8 pb-4">
            <svg className="h-10 w-auto opacity-40" viewBox="0 0 304 182" fill="none" xmlns="http://www.w3.org/2000/svg" aria-label="AWS"><path d="M86.4 66.4c0 3.7.4 6.7 1.1 8.9.8 2.2 1.8 4.6 3.2 7.1.5.8.7 1.6.7 2.3 0 1-.6 2-1.9 3l-6.3 4.2c-.9.6-1.8.9-2.6.9-1 0-2-.5-3-1.4-1.4-1.5-2.6-3.1-3.6-4.7-1-1.7-2-3.6-3.1-5.9-7.8 9.2-17.6 13.8-29.4 13.8-8.4 0-15.1-2.4-20-7.2-4.9-4.8-7.4-11.2-7.4-19.2 0-8.5 3-15.4 9.1-20.6 6.1-5.2 14.2-7.8 24.5-7.8 3.4 0 6.9.3 10.6.8 3.7.5 7.5 1.3 11.5 2.2v-7.3c0-7.6-1.6-12.9-4.7-16-3.2-3.1-8.6-4.6-16.3-4.6-3.5 0-7.1.4-10.8 1.3-3.7.9-7.3 2-10.8 3.4-1.6.7-2.8 1.1-3.5 1.3-.7.2-1.2.3-1.6.3-1.4 0-2.1-1-2.1-3.1v-4.9c0-1.6.2-2.8.7-3.5.5-.7 1.4-1.4 2.8-2.1 3.5-1.8 7.7-3.3 12.6-4.5 4.9-1.3 10.1-1.9 15.6-1.9 11.9 0 20.6 2.7 26.2 8.1 5.5 5.4 8.3 13.6 8.3 24.6v32.4h.1zm-40.6 15.2c3.3 0 6.7-.6 10.3-1.8 3.6-1.2 6.8-3.4 9.5-6.4 1.6-1.9 2.8-4 3.4-6.4.6-2.4 1-5.3 1-8.7v-4.2c-2.8-.7-5.8-1.3-8.9-1.7-3.1-.4-6.1-.6-9.1-.6-6.7 0-11.6 1.3-14.9 4-3.3 2.7-4.9 6.5-4.9 11.5 0 4.7 1.2 8.2 3.7 10.6 2.4 2.5 5.9 3.7 9.9 3.7zm80.3 10.8c-1.8 0-3-.3-3.8-1-.8-.6-1.5-2-2.1-3.9L96.7 10.2c-.6-2-.9-3.3-.9-4 0-1.6.8-2.5 2.4-2.5h9.8c1.9 0 3.2.3 3.9 1 .8.6 1.4 2 2 3.9l16.8 66.2 15.6-66.2c.5-2 1.1-3.3 1.9-3.9.8-.6 2.2-1 4-1h8c1.9 0 3.2.3 4 1 .8.6 1.5 2 1.9 3.9l15.8 67 17.3-67c.6-2 1.3-3.3 2-3.9.8-.6 2.1-1 3.9-1h9.3c1.6 0 2.5.8 2.5 2.5 0 .5-.1 1-.2 1.6-.1.6-.3 1.4-.7 2.5l-24.1 77.3c-.6 2-1.3 3.3-2.1 3.9-.8.6-2.1 1-3.8 1h-8.6c-1.9 0-3.2-.3-4-1-.8-.7-1.5-2-1.9-4L156 23l-15.4 64.4c-.5 2-1.1 3.3-1.9 4-.8.7-2.2 1-4 1h-8.6zm128.5 2.7c-5.2 0-10.4-.6-15.4-1.8-5-1.2-8.9-2.5-11.5-4-1.6-.9-2.7-1.9-3.1-2.8-.4-.9-.6-1.9-.6-2.8v-5.1c0-2.1.8-3.1 2.3-3.1.6 0 1.2.1 1.8.3.6.2 1.5.6 2.5 1 3.4 1.5 7.1 2.7 11 3.5 4 .8 7.9 1.2 11.9 1.2 6.3 0 11.2-1.1 14.6-3.3 3.4-2.2 5.2-5.4 5.2-9.5 0-2.8-.9-5.1-2.7-7-1.8-1.9-5.2-3.6-10.1-5.2L246 52c-7.3-2.3-12.7-5.7-16-10.2-3.3-4.4-5-9.3-5-14.5 0-4.2.9-7.9 2.7-11.1 1.8-3.2 4.2-6 7.2-8.2 3-2.3 6.4-4 10.4-5.2 4-1.2 8.2-1.7 12.6-1.7 2.2 0 4.5.1 6.7.4 2.3.3 4.4.7 6.5 1.1 2 .5 3.9 1 5.7 1.6 1.8.6 3.2 1.2 4.2 1.8 1.4.8 2.4 1.6 3 2.5.6.8.9 1.8.9 3.3v4.7c0 2.1-.8 3.2-2.3 3.2-.8 0-2.1-.4-3.8-1.2-5.7-2.6-12.1-3.9-19.2-3.9-5.7 0-10.2.9-13.3 2.8-3.1 1.9-4.7 4.8-4.7 8.9 0 2.8 1 5.2 3 7.1 2 1.9 5.7 3.8 11 5.5l14.2 4.5c7.2 2.3 12.4 5.5 15.5 9.6 3.1 4.1 4.6 8.8 4.6 14 0 4.3-.9 8.2-2.6 11.6-1.8 3.4-4.2 6.4-7.3 8.8-3.1 2.5-6.8 4.3-11.1 5.6-4.5 1.4-9.2 2.1-14.3 2.1z" fill="white"/><path d="M273.5 143.7c-32.9 24.3-80.7 37.2-121.8 37.2-57.6 0-109.5-21.3-148.7-56.7-3.1-2.8-.3-6.6 3.4-4.4 42.4 24.6 94.7 39.5 148.8 39.5 36.5 0 76.6-7.6 113.5-23.2 5.6-2.3 10.2 3.7 4.8 7.6z" fill="white"/><path d="M287.2 128.1c-4.2-5.4-27.8-2.6-38.5-1.3-3.2.4-3.7-2.4-.8-4.5 18.8-13.2 49.7-9.4 53.3-5 3.6 4.5-1 35.4-18.6 50.2-2.7 2.3-5.3 1.1-4.1-1.9 4-9.9 12.9-32.2 8.7-37.5z" fill="white"/></svg>
            <img className="h-10 w-auto opacity-40 invert" src="/deepgram-logo.png" alt="Deepgram" />
            <img className="h-9 w-auto opacity-40 invert" src="/pipecat-logo.png" alt="Pipecat" />
          </footer>
        ) : null}
      </div>

      {financeMode ? (
        <style>{`
          @keyframes fade-in-up {
            0% { opacity: 0; transform: translateY(14px); }
            100% { opacity: 1; transform: translateY(0); }
          }
          @keyframes orb-drift-a {
            0%, 100% { transform: translate(0, 0) scale(1); }
            50% { transform: translate(40px, 30px) scale(1.08); }
          }
          @keyframes orb-drift-b {
            0%, 100% { transform: translate(0, 0) scale(1); }
            50% { transform: translate(-30px, 40px) scale(1.1); }
          }
          @keyframes orb-drift-c {
            0%, 100% { transform: translate(0, 0) scale(1); }
            50% { transform: translate(20px, -35px) scale(1.06); }
          }
          @keyframes grid-pan {
            0% { background-position: 0 0; }
            100% { background-position: 48px 48px; }
          }
          @keyframes pulse-dot {
            0%, 100% { opacity: 1; transform: scale(1); }
            50% { opacity: 0.5; transform: scale(0.8); }
          }
          @keyframes gradient-shift {
            0%, 100% { background-position: 0% 50%; }
            50% { background-position: 100% 50%; }
          }
          @keyframes button-glow {
            0%, 100% { box-shadow: 0 0 0 0 rgba(56, 189, 248, 0.45); }
            50% { box-shadow: 0 0 0 10px rgba(56, 189, 248, 0); }
          }
          @media (prefers-reduced-motion: reduce) {
            *, *::before, *::after {
              animation-duration: 0.01ms !important;
              animation-iteration-count: 1 !important;
            }
          }
        `}</style>
      ) : null}
    </div>
  );
}

type MockSessionProps = {
  audioBlocked: boolean;
  isMicMuted: boolean;
  latestReplicaTranscript: TranscriptEntry | null;
  latestUserTranscript: TranscriptEntry | null;
  onEndCall(): void;
  onToggleMicMute(): void;
  overlayState: OverlayState | null;
  replicaReady: boolean;
  replicaSpeaking: boolean;
  onAudioBlockedChange(nextValue: boolean): void;
  userSpeaking: boolean;
};

function MockSession({
  isMicMuted,
  latestReplicaTranscript,
  latestUserTranscript,
  onEndCall,
  onToggleMicMute,
  overlayState,
  replicaSpeaking,
  userSpeaking,
}: MockSessionProps) {
  const activeContent = useMemo(() => {
    if (!overlayState || overlayState.kind !== "content") {
      return null;
    }

    const item = CONTENT_ITEMS[overlayState.contentItemKey];
    const query = overlayState.query ? new URLSearchParams(overlayState.query).toString() : "";

    return { ...item, url: query ? `${item.url}?${query}` : item.url };
  }, [overlayState]);

  const activeContentItemKey = overlayState?.kind === "content" ? overlayState.contentItemKey : null;
  const activeSchedule = (overlayState as any)?.kind === "schedule" ? overlayState : null;
  const activeCanvas = overlayState?.kind === "canvas" ? overlayState : null;
  const isDebugMode = typeof window !== "undefined" && (new URLSearchParams(window.location.search).get("debug") === "1" || new URLSearchParams(window.location.search).get("debug") === "true");

  const triggerTool = (name: string, args: any = {}) => {
    if (typeof window !== "undefined" && (window as any).__handleAppMessage) {
      (window as any).__handleAppMessage({
        event_type: "conversation.tool_call",
        message_type: "conversation",
        properties: {
          name,
          arguments: JSON.stringify(args)
        }
      });
    }
  };

  return (
    <>
      <div className={`relative h-screen w-screen overflow-hidden ${overlayState ? "bg-slate-950" : "bg-black"}`}>
        <FloatingMicControl
          isMuted={isMicMuted}
          isOverlayActive={Boolean(overlayState)}
          micName="Test Microphone"
          onToggle={onToggleMicMute}
          speakerName="Test Speaker"
        />

        {/* Presentation Overlay Layer */}
        {overlayState ? (
          <div className="absolute inset-0 z-10 h-full w-full overflow-y-auto">
            {activeContentItemKey === "warranty_terms" ? (
              <WarrantyTermsPage />
            ) : activeContentItemKey === "cost_breakdown" ? (
              <CostBreakdownPage />
            ) : activeContentItemKey === "pricing_ladder" ? (
              <PricingLadderPage />
            ) : activeContentItemKey === "deal_summary" ? (
              <DealSummaryPage />
            ) : activeContentItemKey === "escalate_to_human" ? (
              <EscalatePage />
            ) : (
              <PresentationCanvas
                elements={activeCanvas?.elements}
                shownProducts={activeCanvas?.shownProducts}
                activeProduct={activeCanvas?.activeProduct}
                dailyRate={activeCanvas?.dailyRate ?? 4.0}
              />
            )}
          </div>
        ) : null}

        {/* Persistent Avatar Container (Test Mode) */}
        <div
          className={
            overlayState
              ? "absolute right-4 top-4 z-20 h-[96px] w-[128px] overflow-hidden rounded-[1.1rem] border border-white/15 bg-slate-950/90 shadow-2xl backdrop-blur transition-all duration-300 sm:h-[108px] sm:w-[144px] md:h-[120px] md:w-[160px]"
              : "absolute inset-0 z-0 flex h-full w-full items-center justify-center bg-slate-950 transition-all duration-300"
          }
        >
          {overlayState ? (
            <div className="flex h-full flex-col items-center justify-center bg-slate-900 text-center p-2 border border-sky-500/25">
              <div className="text-[10px] uppercase font-bold text-sky-400">Max (Test Mode)</div>
              <div className="text-[9px] text-slate-400 mt-1">{replicaSpeaking ? "Speaking..." : "Idle"}</div>
            </div>
          ) : (
            <div className="text-center space-y-4">
              <div className="size-36 rounded-full border border-sky-500/25 bg-slate-900 mx-auto flex items-center justify-center shadow-2xl">
                <span className="text-4xl">👨‍💼</span>
              </div>
              <h3 className="text-lg font-semibold text-white">Digital Finance Manager Consultation</h3>
              <p className="text-sm text-slate-400 max-w-md mx-auto">
                Interactive Showroom Walkthrough for 2026 Mazda CX-5.
              </p>
            </div>
          )}
        </div>

        {/* Transcript Panel (only shown when not in presentation overlay) */}
        {!overlayState && (
          <TranscriptPanel
            latestReplicaTranscript={latestReplicaTranscript}
            latestUserTranscript={latestUserTranscript}
            replicaSpeaking={replicaSpeaking}
            userSpeaking={userSpeaking}
          />
        )}

        <div className="absolute bottom-24 right-3 z-20 h-[88px] w-[118px] overflow-hidden rounded-[1.1rem] border border-white/15 bg-slate-950/90 shadow-2xl backdrop-blur sm:h-[108px] sm:w-[144px] md:right-4 md:h-[120px] md:w-[160px]">
          <div className="flex h-full items-center justify-center text-[0.6rem] uppercase tracking-[0.2em] text-slate-500">
            Camera Off
          </div>
          <span className="absolute bottom-1 left-1.5 rounded-full bg-black/50 px-1.5 py-0.5 text-[0.5rem] font-semibold uppercase tracking-[0.16em] text-white/80">
            You
          </span>
        </div>

        <CallControlBar isMuted={isMicMuted} onEndCall={onEndCall} onToggleMute={onToggleMicMute} />

        {isDebugMode && (
          <div className="fixed bottom-20 left-4 z-50 flex flex-col gap-2 max-w-2xl rounded-2xl border border-white/20 bg-slate-900/95 p-4 shadow-2xl backdrop-blur">
            <div className="flex items-center justify-between">
              <div className="text-xs font-bold uppercase tracking-wider text-sky-400">
                DFM Test &amp; Pipeline Debug Controller
              </div>
            </div>

            <div className="flex flex-wrap gap-1 text-[11px] font-medium text-slate-300">
              <span className="text-slate-500 font-semibold">Stage Pipeline:</span>
              <button onClick={() => triggerTool("advance_stage", { targetStep: "rapport" })} className="rounded bg-slate-800 hover:bg-slate-700 px-2 py-0.5 text-[10px] text-slate-200">0. Rapport</button>
              <button onClick={() => triggerTool("advance_stage", { targetStep: "greeting" })} className="rounded bg-slate-800 hover:bg-slate-700 px-2 py-0.5 text-[10px] text-slate-200">1. Greeting</button>
              <button onClick={() => triggerTool("advance_stage", { targetStep: "disclosure" })} className="rounded bg-slate-800 hover:bg-slate-700 px-2 py-0.5 text-[10px] text-slate-200">2. Disclosure</button>
              <button onClick={() => triggerTool("advance_stage", { targetStep: "qualifying" })} className="rounded bg-slate-800 hover:bg-slate-700 px-2 py-0.5 text-[10px] text-slate-200">3. Qualifying</button>
              <button onClick={() => triggerTool("advance_stage", { targetStep: "four_square" })} className="rounded bg-sky-800 hover:bg-sky-700 px-2 py-0.5 text-[10px] text-sky-200">4. Protection Plan</button>
              <button onClick={() => triggerTool("advance_stage", { targetStep: "objection" })} className="rounded bg-indigo-800 hover:bg-indigo-700 px-2 py-0.5 text-[10px] text-indigo-200">5. Negotiation</button>
              <button onClick={() => triggerTool("advance_stage", { targetStep: "close" })} className="rounded bg-emerald-800 hover:bg-emerald-700 px-2 py-0.5 text-[10px] text-emerald-200">6. Verbal Close</button>
              <button onClick={() => triggerTool("advance_stage", { targetStep: "verification" })} className="rounded bg-amber-800 hover:bg-amber-700 px-2 py-0.5 text-[10px] text-amber-200">7. Verify (Guarded)</button>
            </div>

            <div className="flex flex-wrap gap-1 text-[11px] font-medium text-slate-300">
              <span className="text-slate-500 font-semibold">Courtesy Rate Test:</span>
              <button onClick={() => triggerTool("propose_concession", { stage: 1 })} className="rounded bg-indigo-500/20 hover:bg-indigo-500/40 px-2.5 py-1 text-xs text-indigo-200">$4.00/day</button>
              <button onClick={() => triggerTool("propose_concession", { stage: 2 })} className="rounded bg-indigo-500/20 hover:bg-indigo-500/40 px-2.5 py-1 text-xs text-indigo-200">$3.50/day</button>
              <button onClick={() => triggerTool("propose_concession", { stage: 3 })} className="rounded bg-indigo-500/20 hover:bg-indigo-500/40 px-2.5 py-1 text-xs text-indigo-200">$3.25/day</button>
              <button onClick={() => triggerTool("propose_concession", { stage: 4 })} className="rounded bg-indigo-500/20 hover:bg-indigo-500/40 px-2.5 py-1 text-xs text-indigo-200">$3.00/day</button>
              <button onClick={() => triggerTool("propose_concession", { stage: 5 })} className="rounded bg-rose-500/20 hover:bg-rose-500/40 px-2.5 py-1 text-xs text-rose-300">Test Floor Breach (&lt;$3)</button>
            </div>

            <div className="flex flex-wrap gap-1 text-[11px] font-medium text-slate-300">
              <span className="text-slate-500 font-semibold">Canvas &amp; Views:</span>
              <button onClick={() => triggerTool("show_content", { item: "warranty_terms" })} className="rounded bg-sky-500/20 hover:bg-sky-500/40 px-2.5 py-1 text-xs text-sky-200">Warranty</button>
              <button onClick={() => triggerTool("show_content", { item: "cost_breakdown" })} className="rounded bg-sky-500/20 hover:bg-sky-500/40 px-2.5 py-1 text-xs text-sky-200">Costs</button>
              <button onClick={() => triggerTool("show_content", { view: "four_square" })} className="rounded bg-sky-500/20 hover:bg-sky-500/40 px-2.5 py-1 text-xs text-sky-200">Protection Menu</button>
              <button onClick={() => triggerTool("show_content", { view: "pricing_ladder" })} className="rounded bg-indigo-500/20 hover:bg-indigo-500/40 px-2.5 py-1 text-xs text-indigo-200">Investment Summary</button>
              <button onClick={() => triggerTool("show_content", { view: "deal_summary" })} className="rounded bg-emerald-500/20 hover:bg-emerald-500/40 px-2.5 py-1 text-xs text-emerald-200">Deal Summary</button>
              <button onClick={() => triggerTool("show_pricing", { product: "vsc" })} className="rounded bg-emerald-500/20 hover:bg-emerald-500/40 px-2 py-1 text-xs text-emerald-200">+VSC</button>
              <button onClick={() => triggerTool("show_pricing", { product: "maintenance" })} className="rounded bg-emerald-500/20 hover:bg-emerald-500/40 px-2 py-1 text-xs text-emerald-200">+Maint</button>
              <button onClick={() => triggerTool("show_pricing", { product: "tire_wheel" })} className="rounded bg-emerald-500/20 hover:bg-emerald-500/40 px-2 py-1 text-xs text-emerald-200">+Tire</button>
              <button onClick={() => triggerTool("show_pricing", { product: "gap" })} className="rounded bg-emerald-500/20 hover:bg-emerald-500/40 px-2 py-1 text-xs text-emerald-200">+GAP</button>
              <button onClick={() => triggerTool("clear_canvas")} className="rounded bg-rose-500/20 hover:bg-rose-500/40 px-2 py-1 text-xs text-rose-200">Reset</button>
              <button onClick={() => triggerTool("dismiss_content")} className="rounded bg-slate-500/20 hover:bg-slate-500/40 px-2 py-1 text-xs text-slate-200">Dismiss</button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
