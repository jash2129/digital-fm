"use client";

import { useEffect, useRef } from "react";
import { useMediaTrack } from "@daily-co/daily-react";

interface SyncedAvatarVideoProps {
  sessionId: string;
  fit?: "contain" | "cover";
  className?: string;
  lipSyncDelayMs?: number;
  onPlayFailed?: () => void;
}

export function SyncedAvatarVideo({
  sessionId,
  fit = "cover",
  className = "",
  lipSyncDelayMs = 120, // 120ms default: perfectly offsets neural video rendering latency
  onPlayFailed,
}: SyncedAvatarVideoProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const delayNodeRef = useRef<DelayNode | null>(null);
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const destinationRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const currentAudioTrackIdRef = useRef<string | null>(null);

  // Retrieve persistent WebRTC tracks from Daily
  const videoState = useMediaTrack(sessionId, "video");
  const audioState = useMediaTrack(sessionId, "audio");
  const videoTrack = videoState?.persistentTrack;
  const audioTrack = audioState?.persistentTrack;

  // Dynamically update audio delay in real time without glitching the stream
  useEffect(() => {
    if (delayNodeRef.current && audioContextRef.current) {
      const targetSec = Math.max(0, lipSyncDelayMs / 1000);
      try {
        delayNodeRef.current.delayTime.setTargetAtTime(
          targetSec,
          audioContextRef.current.currentTime,
          0.02
        );
      } catch {
        delayNodeRef.current.delayTime.value = targetSec;
      }
    }
  }, [lipSyncDelayMs]);

  useEffect(() => {
    const videoEl = videoRef.current;
    if (!videoEl) return;

    if (!videoTrack && !audioTrack) {
      videoEl.srcObject = null;
      return;
    }

    let activeAudioTrack: MediaStreamTrack | null = null;

    if (audioTrack && audioTrack.readyState === "live") {
      try {
        const AudioCtx =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;

        if (!audioContextRef.current || audioContextRef.current.state === "closed") {
          audioContextRef.current = new AudioCtx();
        }

        const ctx = audioContextRef.current;
        if (ctx.state === "suspended") {
          void ctx.resume();
        }

        // Reconnect audio nodes if the underlying track changes
        if (currentAudioTrackIdRef.current !== audioTrack.id) {
          currentAudioTrackIdRef.current = audioTrack.id;

          if (sourceNodeRef.current) {
            try {
              sourceNodeRef.current.disconnect();
            } catch {}
          }

          const rawAudioStream = new MediaStream([audioTrack]);
          const sourceNode = ctx.createMediaStreamSource(rawAudioStream);
          const delayNode = ctx.createDelay(1.0);
          delayNode.delayTime.value = Math.max(0, lipSyncDelayMs / 1000);

          const destination = ctx.createMediaStreamDestination();
          sourceNode.connect(delayNode);
          delayNode.connect(destination);

          sourceNodeRef.current = sourceNode;
          delayNodeRef.current = delayNode;
          destinationRef.current = destination;
        }

        if (destinationRef.current) {
          const delayedTracks = destinationRef.current.stream.getAudioTracks();
          if (delayedTracks.length > 0) {
            activeAudioTrack = delayedTracks[0];
          }
        }
      } catch (err) {
        console.warn("Web Audio delay processing fallback to direct track:", err);
      }

      if (!activeAudioTrack) {
        activeAudioTrack = audioTrack;
      }
    }

    // Build unified MediaStream for browser's internal A/V Lip Sync Coordinator
    const unifiedStream = new MediaStream();
    if (videoTrack && videoTrack.readyState === "live") {
      unifiedStream.addTrack(videoTrack);
    }
    if (activeAudioTrack && activeAudioTrack.readyState === "live") {
      unifiedStream.addTrack(activeAudioTrack);
    }

    videoEl.srcObject = unifiedStream;

    const playPromise = videoEl.play();
    if (playPromise !== undefined) {
      playPromise.catch((err) => {
        console.warn("Avatar video playback interrupted or blocked:", err);
        onPlayFailed?.();
      });
    }

    return () => {
      // Stream cleanup handled on track change or unmount
    };
  }, [sessionId, videoTrack, audioTrack, lipSyncDelayMs, onPlayFailed]);

  // Clean up AudioContext on unmount
  useEffect(() => {
    return () => {
      if (audioContextRef.current && audioContextRef.current.state !== "closed") {
        try {
          void audioContextRef.current.close();
        } catch {}
      }
    };
  }, []);

  return (
    <video
      autoPlay
      className={`h-full w-full ${className}`}
      playsInline
      ref={videoRef}
      style={{ objectFit: fit }}
    />
  );
}
