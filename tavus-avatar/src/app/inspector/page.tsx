"use client";

import React, { useState, useEffect, useRef } from "react";
import type { CallExperienceAnalysis, TimelineBlock, ExperienceFlaw } from "@/lib/call-experience-analyzer";
import type { TurnTimingLog } from "@/lib/heygen-logger";

type SessionSummary = {
  sessionId: string;
  lastModified: string;
  durationSeconds: number;
  turnsCount: number;
  bargeInsCount: number;
  hasAudio: boolean;
  audioSizeBytes: number;
  avatarName: string;
  status: string;
};

export default function CallInspectorPage() {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string>("");
  const [analysis, setAnalysis] = useState<CallExperienceAnalysis | null>(null);
  const [turnTimings, setTurnTimings] = useState<TurnTimingLog[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Audio player sync state
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [currentTimeSec, setCurrentTimeSec] = useState<number>(0);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [selectedBlock, setSelectedBlock] = useState<TimelineBlock | null>(null);

  // Fetch session list on mount
  useEffect(() => {
    async function fetchSessions() {
      try {
        setLoading(true);
        const res = await fetch("/api/heygen/logs");
        if (!res.ok) throw new Error("Failed to load call session logs");
        const data = await res.json();
        const list: SessionSummary[] = data.sessions || [];
        setSessions(list);
        
        // Prioritize session from query params ?session=...
        const params = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : null;
        const qSession = params?.get("session");

        if (qSession) {
          setSelectedSessionId(qSession);
        } else if (list.length > 0) {
          setSelectedSessionId(list[0].sessionId);
        }
      } catch (err: any) {
        setError(err.message || "Failed to fetch sessions");
      } finally {
        setLoading(false);
      }
    }
    void fetchSessions();
  }, []);

  // Fetch analysis when selectedSessionId changes
  useEffect(() => {
    if (!selectedSessionId) return;
    async function fetchAnalysis() {
      try {
        setLoading(true);
        setError(null);
        setSelectedBlock(null);
        const res = await fetch(`/api/heygen/logs/${selectedSessionId}/analysis`);
        if (!res.ok) throw new Error("Failed to load call analysis");
        const data: CallExperienceAnalysis = await res.json();
        setAnalysis(data);
        // Raw log for the per-turn latency table (the analysis only keeps timeline blocks)
        const raw = await fetch(`/api/heygen/logs/${selectedSessionId}`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
        setTurnTimings(raw?.timingLogs || []);
      } catch (err: any) {
        setError(err.message || "Failed to analyze call");
      } finally {
        setLoading(false);
      }
    }
    void fetchAnalysis();
  }, [selectedSessionId]);

  // Audio time update handler
  const handleTimeUpdate = () => {
    if (audioRef.current) {
      setCurrentTimeSec(audioRef.current.currentTime);
    }
  };

  const seekToSecond = (sec: number) => {
    if (audioRef.current) {
      audioRef.current.currentTime = sec;
      setCurrentTimeSec(sec);
      if (!isPlaying) {
        audioRef.current.play().catch(() => {});
        setIsPlaying(true);
      }
    } else {
      setCurrentTimeSec(sec);
    }
  };

  const formatMinSec = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  };

  const totalDuration = analysis?.totalDurationSec || 45;

  return (
    <div className="min-h-screen w-full bg-slate-950 text-slate-100 flex flex-col font-sans overflow-y-auto" suppressHydrationWarning>
      {/* Top Navigation Bar */}
      <header className="border-b border-slate-800 bg-slate-900/90 backdrop-blur px-6 py-4 flex flex-wrap items-center justify-between gap-4 sticky top-0 z-50">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-blue-600/20 border border-blue-500/30 flex items-center justify-center text-blue-400 font-bold text-lg shadow-inner">
            🎙️
          </div>
          <div>
            <h1 className="text-lg font-bold tracking-tight text-white flex items-center gap-2">
              Max Call Experience Inspector
              <span className="text-xs px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-400 border border-blue-500/30 font-medium">
                Second-by-Second
              </span>
            </h1>
            <p className="text-xs text-slate-400">
              Interactive timeline, acoustic echo diagnostics, and conversational friction analyzer
            </p>
          </div>
        </div>

        {/* Call Selector */}
        <div className="flex items-center gap-3">
          <label className="text-xs font-medium text-slate-400">Select Call:</label>
          <select
            className="bg-slate-800 border border-slate-700 text-white text-xs rounded-lg px-3 py-2 outline-none focus:border-blue-500 max-w-[280px] truncate"
            value={selectedSessionId}
            onChange={(e) => setSelectedSessionId(e.target.value)}
          >
            {sessions.map((s) => (
              <option key={s.sessionId} value={s.sessionId}>
                {s.sessionId.substring(0, 8)}... ({s.durationSeconds}s, {s.bargeInsCount} cuts) - {new Date(s.lastModified).toLocaleTimeString()}
              </option>
            ))}
          </select>
          <a
            href="/"
            className="text-xs px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 font-medium transition"
          >
            ← Back to Avatar Call
          </a>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-6 space-y-6">
        {error && (
          <div className="p-4 rounded-xl bg-red-950/60 border border-red-800 text-red-200 text-sm">
            <strong>Error:</strong> {error}
          </div>
        )}

        {loading && !analysis && (
          <div className="py-24 text-center text-slate-400 animate-pulse text-sm">
            Analyzing call audio & timeline logs...
          </div>
        )}

        {analysis && (
          <>
            {/* Top Stat Cards & Rating */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 flex flex-col justify-between">
                <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Human Experience Rating</span>
                <div className="mt-2 flex items-baseline gap-2">
                  <span
                    className={`text-2xl font-black ${
                      analysis.summaryRating === "Poor"
                        ? "text-red-400"
                        : analysis.summaryRating === "Needs Improvement"
                        ? "text-amber-400"
                        : "text-emerald-400"
                    }`}
                  >
                    {analysis.summaryRating}
                  </span>
                </div>
                <p className="mt-2 text-xs text-slate-400 leading-relaxed">{analysis.summaryVerdict}</p>
              </div>

              <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 flex flex-col justify-between">
                <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Premature Cut-Offs</span>
                <div className="mt-2 flex items-baseline gap-2">
                  <span className="text-2xl font-black text-rose-400">{analysis.interruptedTurnsCount}</span>
                  <span className="text-xs text-slate-400">mid-sentence interruptions</span>
                </div>
                <p className="mt-2 text-xs text-slate-400">
                  Times Max was abruptly stopped before finishing his sentences
                </p>
              </div>

              <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 flex flex-col justify-between">
                <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Acoustic Echo Loops</span>
                <div className="mt-2 flex items-baseline gap-2">
                  <span className="text-2xl font-black text-purple-400">{analysis.echoCount}</span>
                  <span className="text-xs text-slate-400">speaker leakages</span>
                </div>
                <p className="mt-2 text-xs text-slate-400">
                  Turns triggered by laptop speakers feeding back into mic
                </p>
              </div>

              <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 flex flex-col justify-between">
                <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Dialogue Mash-Ups</span>
                <div className="mt-2 flex items-baseline gap-2">
                  <span className="text-2xl font-black text-amber-400">{analysis.mashupCount}</span>
                  <span className="text-xs text-slate-400">bot stitched lines</span>
                </div>
                <p className="mt-2 text-xs text-slate-400">
                  E.g. merging &quot;How can I assist you today?&quot; with paperwork beats
                </p>
              </div>
            </div>

            {/* Audio Recording Player Bar */}
            <div className="p-4 rounded-2xl bg-gradient-to-r from-slate-900 to-slate-900/80 border border-slate-800 shadow-xl flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-xl bg-blue-600/20 border border-blue-500/30 flex items-center justify-center text-blue-400 font-bold">
                  🎧
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-white">Call Recording Playback</h3>
                  <p className="text-xs text-slate-400">
                    Listen to the exact call audio synced with the second-by-second timeline below
                  </p>
                </div>
              </div>

              <div className="flex-1 max-w-md">
                <audio
                  ref={audioRef}
                  controls
                  className="w-full h-10 accent-blue-500"
                  src={`/api/heygen/logs/${selectedSessionId}/audio`}
                  onTimeUpdate={handleTimeUpdate}
                  onPlay={() => setIsPlaying(true)}
                  onPause={() => setIsPlaying(false)}
                />
              </div>

              <div className="text-right">
                <span className="text-xs font-mono text-blue-400 font-bold bg-blue-950/60 border border-blue-800 px-3 py-1.5 rounded-lg">
                  {formatMinSec(currentTimeSec)} / {formatMinSec(totalDuration)}
                </span>
              </div>
            </div>

            {/* Second-by-Second Visual Timeline Track */}
            <div className="p-6 rounded-2xl bg-slate-900 border border-slate-800 shadow-xl space-y-6">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-base font-bold text-white flex items-center gap-2">
                    ⏱️ Second-by-Second Interaction Timeline
                  </h2>
                  <p className="text-xs text-slate-400">
                    Click any dialogue block or time marker to scrub audio and inspect what happened at that exact second
                  </p>
                </div>

                <div className="flex items-center gap-4 text-xs">
                  <div className="flex items-center gap-1.5">
                    <span className="w-3 h-3 rounded bg-blue-500 inline-block" />
                    <span className="text-slate-300">Max Speaking</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="w-3 h-3 rounded bg-rose-500 inline-block" />
                    <span className="text-slate-300">Max Cut Off Mid-Sentence</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="w-3 h-3 rounded bg-emerald-500 inline-block" />
                    <span className="text-slate-300">User Speaking</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="w-3 h-3 rounded bg-purple-500 inline-block" />
                    <span className="text-slate-300">Speaker Echo (Mic Leak)</span>
                  </div>
                </div>
              </div>

              {/* Time Axis Ruler */}
              <div className="relative w-full h-6 border-b border-slate-800">
                {Array.from({ length: Math.ceil(totalDuration / 5) + 1 }).map((_, i) => {
                  const sec = i * 5;
                  const leftPct = (sec / totalDuration) * 100;
                  return (
                    <div
                      key={sec}
                      className="absolute transform -translate-x-1/2 flex flex-col items-center cursor-pointer group"
                      style={{ left: `${Math.min(100, leftPct)}%` }}
                      onClick={() => seekToSecond(sec)}
                    >
                      <div className="w-px h-2 bg-slate-700 group-hover:bg-blue-400" />
                      <span className="text-[10px] font-mono text-slate-500 group-hover:text-blue-400 mt-1">
                        {formatMinSec(sec)}
                      </span>
                    </div>
                  );
                })}

                {/* Scrubber Playhead Line */}
                <div
                  className="absolute top-0 bottom-0 w-0.5 bg-yellow-400 z-20 pointer-events-none transition-all duration-100"
                  style={{ left: `${(currentTimeSec / totalDuration) * 100}%` }}
                >
                  <div className="w-3 h-3 rounded-full bg-yellow-400 -ml-[5px] -mt-1 shadow-glow" />
                </div>
              </div>

              {/* Dual-Track Visual Timeline Bars */}
              <div className="space-y-4 pt-2">
                {/* Track 1: Max */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-xs font-semibold text-slate-400">
                    <span>TRACK 1: MAX (AVATAR SPEECH)</span>
                  </div>
                  <div className="relative w-full h-12 bg-slate-950/80 rounded-xl border border-slate-800/80 overflow-hidden">
                    {analysis.timelineBlocks
                      .filter((b) => b.speaker === "avatar")
                      .map((block) => {
                        const leftPct = (block.startSec / totalDuration) * 100;
                        const widthPct = Math.max(1.5, (block.durationSec / totalDuration) * 100);
                        const isCut = block.isInterrupted;
                        return (
                          <div
                            key={block.id}
                            className={`absolute top-1 bottom-1 rounded-lg px-2 flex items-center justify-between cursor-pointer transition border text-[11px] font-medium overflow-hidden ${
                              isCut
                                ? "bg-rose-950/70 border-rose-600/80 text-rose-200 hover:bg-rose-900/80"
                                : "bg-blue-950/70 border-blue-600/80 text-blue-200 hover:bg-blue-900/80"
                            } ${selectedBlock?.id === block.id ? "ring-2 ring-yellow-400 z-10" : ""}`}
                            style={{
                              left: `${leftPct}%`,
                              width: `${widthPct}%`,
                            }}
                            onClick={() => {
                              setSelectedBlock(block);
                              seekToSecond(block.startSec);
                            }}
                            title={block.text}
                          >
                            <span className="truncate pr-1">
                              {isCut && "⚠️ "}
                              {block.text}
                            </span>
                            {isCut && (
                              <span className="text-[9px] bg-rose-600/80 text-white px-1.5 py-0.5 rounded font-bold shrink-0">
                                Cut @ {block.spokeDurationSec?.toFixed(1)}s ({block.percentSpoken}%)
                              </span>
                            )}
                          </div>
                        );
                      })}
                  </div>
                </div>

                {/* Track 2: User */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-xs font-semibold text-slate-400">
                    <span>TRACK 2: USER (MICROPHONE INPUT &amp; ECHOES)</span>
                  </div>
                  <div className="relative w-full h-12 bg-slate-950/80 rounded-xl border border-slate-800/80 overflow-hidden">
                    {analysis.timelineBlocks
                      .filter((b) => b.speaker === "user")
                      .map((block) => {
                        const leftPct = (block.startSec / totalDuration) * 100;
                        const widthPct = Math.max(1.5, (block.durationSec / totalDuration) * 100);
                        const isEcho = block.isEcho;
                        return (
                          <div
                            key={block.id}
                            className={`absolute top-1 bottom-1 rounded-lg px-2 flex items-center justify-between cursor-pointer transition border text-[11px] font-medium overflow-hidden ${
                              isEcho
                                ? "bg-purple-950/70 border-purple-600/80 text-purple-200 hover:bg-purple-900/80"
                                : "bg-emerald-950/70 border-emerald-600/80 text-emerald-200 hover:bg-emerald-900/80"
                            } ${selectedBlock?.id === block.id ? "ring-2 ring-yellow-400 z-10" : ""}`}
                            style={{
                              left: `${leftPct}%`,
                              width: `${widthPct}%`,
                            }}
                            onClick={() => {
                              setSelectedBlock(block);
                              seekToSecond(block.startSec);
                            }}
                            title={block.text}
                          >
                            <span className="truncate pr-1">
                              {isEcho && "🔊 [ECHO] "}
                              {block.text}
                            </span>
                          </div>
                        );
                      })}
                  </div>
                </div>
              </div>

              {/* Selected Block Detail Inspector Card */}
              {selectedBlock && (
                <div className="p-4 rounded-xl bg-slate-950 border border-blue-500/40 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold uppercase tracking-wider text-blue-400">
                      Inspector: {selectedBlock.speaker.toUpperCase()} TURN @ {formatMinSec(selectedBlock.startSec)} - {formatMinSec(selectedBlock.endSec)}
                    </span>
                    <button
                      className="text-xs text-slate-400 hover:text-white"
                      onClick={() => setSelectedBlock(null)}
                    >
                      ✕ Close
                    </button>
                  </div>
                  <p className="text-sm font-medium text-white italic">&quot;{selectedBlock.text}&quot;</p>
                  <div className="flex flex-wrap gap-4 text-xs text-slate-400 pt-1">
                    <span>
                      Duration: <strong className="text-slate-200">{selectedBlock.durationSec.toFixed(2)}s</strong>
                    </span>
                    {selectedBlock.isInterrupted && (
                      <span className="text-rose-400 font-semibold">
                        ⚠️ Interrupted mid-sentence after {selectedBlock.spokeDurationSec?.toFixed(2)}s ({selectedBlock.percentSpoken}% completed)
                      </span>
                    )}
                    {selectedBlock.isEcho && (
                      <span className="text-purple-400 font-semibold">
                        🔊 Flagged as acoustic speaker echo (matched Max&apos;s previous line)
                      </span>
                    )}
                    {selectedBlock.latencyMs ? (
                      <span>
                        Latency gap: <strong className="text-slate-200">{selectedBlock.latencyMs} ms</strong>
                      </span>
                    ) : null}
                  </div>
                </div>
              )}
            </div>

            {/* Human Experience Friction Points / Diagnostic Explanations */}
            <div className="p-6 rounded-2xl bg-slate-900 border border-slate-800 shadow-xl space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-base font-bold text-white flex items-center gap-2">
                    🔍 Conversational Friction Diagnostics ({analysis.experienceFlaws.length} detected)
                  </h2>
                  <p className="text-xs text-slate-400">
                    Forensic breakdown explaining why Max felt unnatural, interrupted, or disjointed during this call
                  </p>
                </div>
              </div>

              {analysis.experienceFlaws.length === 0 ? (
                <div className="py-8 text-center text-emerald-400 text-sm font-medium">
                  ✅ Clean call! No premature cutoffs, dialogue mash-ups, or acoustic echo loops detected.
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {analysis.experienceFlaws.map((flaw) => (
                    <div
                      key={flaw.id}
                      className={`p-4 rounded-xl border flex flex-col justify-between space-y-3 cursor-pointer transition ${
                        flaw.severity === "critical"
                          ? "bg-rose-950/30 border-rose-800/60 hover:bg-rose-950/50"
                          : "bg-amber-950/30 border-amber-800/60 hover:bg-amber-950/50"
                      }`}
                      onClick={() => seekToSecond(flaw.second)}
                    >
                      <div className="space-y-1">
                        <div className="flex items-center justify-between">
                          <span className="font-mono text-xs px-2 py-0.5 rounded bg-slate-900 border border-slate-800 font-bold text-slate-300">
                            [{flaw.timeFormatted}]
                          </span>
                          <span
                            className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded ${
                              flaw.severity === "critical"
                                ? "bg-rose-600/20 text-rose-400 border border-rose-600/30"
                                : "bg-amber-600/20 text-amber-400 border border-amber-600/30"
                            }`}
                          >
                            {flaw.category.replace(/_/g, " ")}
                          </span>
                        </div>
                        <h4 className="text-sm font-bold text-white">{flaw.title}</h4>
                        <p className="text-xs text-slate-300 leading-relaxed">{flaw.description}</p>
                      </div>

                      <div className="pt-2 border-t border-slate-800/80 space-y-1 text-xs">
                        <p className="text-rose-300/90">
                          <strong>Human Impact:</strong> {flaw.humanImpact}
                        </p>
                        <p className="text-blue-300/90">
                          <strong>Fix Applied:</strong> {flaw.recommendation}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Per-turn latency breakdown */}
            <div className="p-6 rounded-2xl bg-slate-900 border border-slate-800 shadow-xl space-y-4">
              <div>
                <h2 className="text-base font-bold text-white flex items-center gap-2">
                  ⚡ Turn Latency Breakdown ({turnTimings.length} turns)
                </h2>
                <p className="text-xs text-slate-400">
                  Total = from the END of the customer&apos;s speech to Max&apos;s first audio. The timeline&apos;s &quot;User
                  spoke&quot; marker is the START of speech, so a long sentence there is not latency. Click a row to jump to it.
                </p>
                {selectedSessionId.startsWith("sim-") && (
                  <p className="text-xs text-amber-400 mt-1">
                    Simulated call: every Total includes a fixed ~700 ms audio allowance added by the simulator, not real
                    speech or HeyGen rendering. Compare the Controller column; real-world totals come only from live calls.
                  </p>
                )}
              </div>

              {turnTimings.length === 0 ? (
                <div className="py-6 text-center text-slate-500 text-sm">No per-turn timing recorded for this call.</div>
              ) : (
                <div className="overflow-x-auto max-h-96 overflow-y-auto rounded-xl border border-slate-800">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead className="bg-slate-950 text-slate-400 font-semibold sticky top-0 border-b border-slate-800">
                      <tr>
                        <th className="p-3">Turn</th>
                        <th className="p-3">Customer said</th>
                        <th className="p-3">Intent</th>
                        <th className="p-3">Beat</th>
                        <th className="p-3 text-right">Classifier</th>
                        <th className="p-3 text-right">Controller</th>
                        <th className="p-3">LLM</th>
                        <th className="p-3 text-right">
                          {selectedSessionId.startsWith("sim-") ? "Total (incl. simulated 700 ms audio allowance)" : "Total"}
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60 font-mono">
                      {turnTimings.map((t) => {
                        const c = t.controller;
                        const total = t.gaps?.total_latency_ms ?? 0;
                        const callStart = Date.parse(analysis.startTime);
                        const atSec = t.timestamps?.avatar_audio_start ? Math.max(0, Math.floor((t.timestamps.avatar_audio_start - callStart) / 1000)) : 0;
                        return (
                          <tr key={t.turnId} className="hover:bg-slate-800/40 cursor-pointer transition" onClick={() => seekToSecond(atSec)}>
                            <td className="p-3 font-bold text-blue-400">T{t.turnId}</td>
                            <td className="p-3 text-slate-300 font-sans max-w-xs truncate" title={t.userInput}>{t.userInput}</td>
                            <td className="p-3 text-slate-300">{c?.intent ?? "-"}</td>
                            <td className="p-3 text-slate-300">{c ? `${c.beatBefore} → ${c.beatAfter}` : "-"}</td>
                            <td className="p-3 text-right text-slate-300">{c ? `${c.classifierMs} ms` : "-"}</td>
                            <td className="p-3 text-right text-slate-300">{c ? `${c.controllerMs} ms` : `${t.gaps?.controller_gap_ms ?? 0} ms`}</td>
                            <td className="p-3">
                              {!c ? (
                                <span className="text-slate-500">-</span>
                              ) : c.classifierTimedOut ? (
                                <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-rose-500/20 text-rose-400 border border-rose-500/30">timeout</span>
                              ) : c.usedLLM ? (
                                <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-amber-500/20 text-amber-400 border border-amber-500/30">yes</span>
                              ) : (
                                <span className="text-slate-500">no</span>
                              )}
                            </td>
                            <td className={`p-3 text-right font-bold ${total > 1500 ? "text-rose-400" : total > 800 ? "text-amber-400" : "text-emerald-400"}`}>
                              {total} ms
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Second-by-Second Event Table */}
            <div className="p-6 rounded-2xl bg-slate-900 border border-slate-800 shadow-xl space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-base font-bold text-white flex items-center gap-2">
                    📋 Chronological Second-by-Second Event Stream
                  </h2>
                  <p className="text-xs text-slate-400">
                    Complete second-by-second breakdown of states, audio triggers, and transitions
                  </p>
                </div>
              </div>

              <div className="overflow-x-auto max-h-96 overflow-y-auto rounded-xl border border-slate-800">
                <table className="w-full text-left text-xs border-collapse">
                  <thead className="bg-slate-950 text-slate-400 font-semibold sticky top-0 border-b border-slate-800">
                    <tr>
                      <th className="p-3 w-16">Second</th>
                      <th className="p-3 w-48">Max State</th>
                      <th className="p-3 w-48">User / Mic State</th>
                      <th className="p-3">Events &amp; Dialogue Notes</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 font-mono">
                    {analysis.secondBySecond
                      .filter((pt) => pt.events.length > 0 || pt.avatarState !== "silent" || pt.userState !== "silent")
                      .map((pt) => (
                        <tr
                          key={pt.second}
                          className={`hover:bg-slate-800/40 cursor-pointer transition ${
                            Math.floor(currentTimeSec) === pt.second ? "bg-blue-950/40" : ""
                          }`}
                          onClick={() => seekToSecond(pt.second)}
                        >
                          <td className="p-3 font-bold text-blue-400">[{pt.timeFormatted}]</td>
                          <td className="p-3">
                            <span
                              className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                                pt.avatarState === "speaking"
                                  ? "bg-blue-500/20 text-blue-400 border border-blue-500/30"
                                  : pt.avatarState === "interrupted"
                                  ? "bg-rose-500/20 text-rose-400 border border-rose-500/30"
                                  : "text-slate-500"
                              }`}
                            >
                              {pt.avatarState}
                            </span>
                          </td>
                          <td className="p-3">
                            <span
                              className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                                pt.userState === "speaking"
                                  ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                                  : pt.userState === "echo"
                                  ? "bg-purple-500/20 text-purple-400 border border-purple-500/30"
                                  : "text-slate-500"
                              }`}
                            >
                              {pt.userState}
                            </span>
                          </td>
                          <td className="p-3 text-slate-300 font-sans">
                            {pt.events.map((ev, i) => (
                              <div key={i} className="leading-relaxed">
                                {ev}
                              </div>
                            ))}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
