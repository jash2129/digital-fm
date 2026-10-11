"use client";

import React from "react";

const TERMS = [
  {
    length: "3 Years / 36,000 Miles",
    name: "Base Limited Warranty",
    detail: "Bumper to Bumper Factory Cover",
    badge: "FACTORY COMPLEMENTARY",
    badgeColor: "sky",
    scope: "Covers factory defects on vehicle components as assembled at the plant.",
  },
  {
    length: "5 Years / 60,000 Miles",
    name: "Powertrain Limited Warranty",
    detail: "Engine & Transmission Only",
    badge: "POWERTRAIN ONLY",
    badgeColor: "indigo",
    scope: "Covers strictly engine block and internal transmission parts against manufacturer defects.",
  },
];

export default function WarrantyTermsPage() {
  return (
    <main className="relative min-h-screen bg-[radial-gradient(ellipse_at_top,_rgba(14,165,233,0.18)_0%,_rgba(2,6,23,0.95)_60%,_#020617_100%)] px-6 py-8 sm:px-8 sm:py-10 text-slate-100 font-sans select-none">
      {/* Ambient background glows */}
      <div className="pointer-events-none absolute -top-20 -left-20 h-80 w-80 rounded-full bg-cyan-500/10 blur-[100px]" />
      <div className="pointer-events-none absolute -bottom-20 -right-20 h-80 w-80 rounded-full bg-indigo-500/10 blur-[100px]" />

      <div
        className="mx-auto flex h-full max-w-4xl flex-col gap-5 sm:gap-6"
        style={{ animation: "panel-in 0.4s ease-out" }}
      >
        {/* Header - right padding ensures clearance for PiP video */}
        <div className="relative rounded-2xl border border-white/10 bg-slate-900/80 p-6 sm:p-8 shadow-2xl backdrop-blur-xl pr-36 sm:pr-44 md:pr-48">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-sky-400/30 bg-sky-500/10 px-3 py-0.5 text-[11px] font-bold uppercase tracking-wider text-sky-300">
              <span className="h-1.5 w-1.5 rounded-full bg-sky-400 animate-pulse" />
              2026 Mazda CX-5
            </span>
            <span className="rounded-full border border-slate-700/60 bg-slate-800/50 px-2.5 py-0.5 text-[10px] font-medium tracking-wide text-slate-400">
              Factory Coverage Overview
            </span>
          </div>

          <h1 className="mt-3 text-2xl sm:text-3xl md:text-4xl font-extrabold tracking-tight text-white">
            Two Manufacturer Warranties, Not One
          </h1>
          <p className="mt-2 text-sm sm:text-base text-slate-300 max-w-2xl leading-relaxed">
            Every new Mazda comes with standard manufacturer coverage from the factory.
            Here is the exact breakdown of what is provided:
          </p>
        </div>

        {/* 2 Terms Cards */}
        <div className="grid gap-4 sm:grid-cols-2">
          {TERMS.map((term) => (
            <div
              key={term.name}
              className="relative flex flex-col justify-between rounded-2xl border border-slate-700/60 bg-gradient-to-br from-slate-900/90 to-slate-950/80 p-5 sm:p-6 shadow-xl backdrop-blur-md"
            >
              <div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-cyan-400">
                    {term.detail}
                  </span>
                  <span className="rounded-full border border-slate-700 bg-slate-800/80 px-2.5 py-0.5 text-[10px] font-mono text-slate-300">
                    {term.badge}
                  </span>
                </div>
                <p className="mt-3 text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
                  {term.length}
                </p>
                <p className="mt-1 text-sm font-semibold text-slate-300">{term.name}</p>
                <p className="mt-2 text-xs text-slate-400 leading-relaxed">{term.scope}</p>
              </div>

              <div className="mt-4 pt-3 border-t border-white/5 flex items-center gap-1.5 text-[11px] text-emerald-400">
                <svg className="h-4 w-4 fill-current shrink-0" viewBox="0 0 20 20">
                  <path
                    fillRule="evenodd"
                    d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                    clipRule="evenodd"
                  />
                </svg>
                <span>Included complementary from Mazda factory</span>
              </div>
            </div>
          ))}
        </div>

        {/* The Catch: Glovebox Page 4 Alert */}
        <div className="rounded-2xl border border-amber-500/30 bg-gradient-to-r from-slate-900/90 via-slate-900/80 to-amber-950/20 p-5 sm:p-6 shadow-xl backdrop-blur-md">
          <div className="flex items-start gap-3.5">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-amber-400/40 bg-amber-500/10 text-xl shadow-inner text-amber-300">
              ⚠️
            </div>
            <div>
              <div className="flex items-center gap-2">
                <p className="text-[11px] font-bold uppercase tracking-wider text-amber-300">
                  The Catch: Stated in Glovebox Manual · Page 4
                </p>
                <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-amber-300">
                  Defect Only
                </span>
              </div>
              <h3 className="mt-1 text-base sm:text-lg font-bold text-white">
                Factory Warranty Does Not Cover Everyday Wear &amp; Tear
              </h3>
              <p className="mt-1.5 text-xs sm:text-sm leading-relaxed text-slate-300">
                The manufacturer manual explicitly stipulates that factory warranty only covers parts that were{" "}
                <span className="font-semibold text-amber-200">misdesigned, misbuilt, or misinstalled</span> at the factory.
                It does <span className="font-semibold text-rose-300 underline decoration-rose-500">not</span> cover damage caused by Texas climate, road hazards, potholes, or normal driving wear and tear — which account for <strong className="text-white">95% of real-world breakdowns</strong>.
              </p>
            </div>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes panel-in {
          0% { opacity: 0; transform: translateY(8px) scale(0.99); }
          100% { opacity: 1; transform: translateY(0) scale(1); }
        }
      `}</style>
    </main>
  );
}
