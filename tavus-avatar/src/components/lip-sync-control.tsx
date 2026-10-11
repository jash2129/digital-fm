"use client";

import { useState } from "react";

interface LipSyncControlProps {
  currentDelayMs: number;
  onDelayChange: (delayMs: number) => void;
}

const PRESETS = [
  { label: "Raw (0ms)", value: 0 },
  { label: "Fast (60ms)", value: 60 },
  { label: "Balanced (100ms)", value: 100 },
  { label: "Recommended (120ms)", value: 120 },
  { label: "High Buffer (160ms)", value: 160 },
  { label: "Maximum (200ms)", value: 200 },
];

export function LipSyncControl({ currentDelayMs, onDelayChange }: LipSyncControlProps) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="relative inline-block text-left">
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className="flex items-center gap-1.5 rounded-full border border-sky-400/30 bg-sky-950/70 px-2.5 py-1 text-[0.6rem] font-semibold uppercase tracking-[0.16em] text-sky-200 shadow-lg backdrop-blur-md transition hover:border-sky-400/60 hover:bg-sky-900/80"
        title="Fine-tune Lip-Sync Audio/Video synchronization"
      >
        <span className="size-1.5 rounded-full bg-sky-400 animate-pulse" />
        <span>Lip-Sync: {currentDelayMs}ms</span>
        <svg
          className={`size-2.5 transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isOpen && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} />
          <div className="absolute right-0 top-full mt-1.5 z-50 w-48 overflow-hidden rounded-xl border border-white/10 bg-slate-950/95 p-1.5 shadow-2xl backdrop-blur-xl">
            <div className="px-2 py-1 border-b border-white/10 mb-1">
              <p className="text-[0.55rem] font-semibold uppercase tracking-wider text-slate-400">
                Lip-Sync Audio Delay
              </p>
              <p className="text-[0.5rem] text-slate-500">
                Compensates for GPU video rendering
              </p>
            </div>
            <div className="space-y-0.5">
              {PRESETS.map((preset) => {
                const isSelected = preset.value === currentDelayMs;
                return (
                  <button
                    key={preset.value}
                    type="button"
                    onClick={() => {
                      onDelayChange(preset.value);
                      setIsOpen(false);
                    }}
                    className={`flex w-full items-center justify-between rounded-lg px-2 py-1 text-left text-[0.62rem] transition ${
                      isSelected
                        ? "bg-sky-500/20 font-semibold text-sky-300"
                        : "text-slate-300 hover:bg-white/5 hover:text-white"
                    }`}
                  >
                    <span>{preset.label}</span>
                    {isSelected && (
                      <span className="size-1.5 rounded-full bg-sky-400" />
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
