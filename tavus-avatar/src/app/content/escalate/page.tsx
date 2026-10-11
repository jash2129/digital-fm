"use client";

import React from "react";

export default function EscalatePage() {
  return (
    <main className="relative flex min-h-screen items-center justify-center bg-[radial-gradient(ellipse_at_top,_rgba(14,165,233,0.18)_0%,_rgba(2,6,23,0.95)_60%,_#020617_100%)] px-8 py-10 text-center text-slate-100 font-sans select-none">
      {/* Ambient background glows */}
      <div className="pointer-events-none absolute -top-20 -left-20 h-80 w-80 rounded-full bg-cyan-500/10 blur-[110px]" />
      <div className="pointer-events-none absolute -bottom-20 -right-20 h-80 w-80 rounded-full bg-indigo-500/10 blur-[110px]" />

      <div className="relative mx-auto flex max-w-lg flex-col items-center gap-4 rounded-2xl border border-white/10 bg-slate-900/80 p-8 sm:p-10 shadow-2xl backdrop-blur-xl">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-500/15 border border-amber-400/40 text-amber-300 text-2xl shadow-inner">
          🤝
        </div>
        <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-cyan-400">
          Senior Finance Manager Escalation
        </p>
        <h1 className="text-2xl sm:text-3xl font-extrabold leading-tight tracking-tight text-white">
          Connecting You with Dealership Finance Director
        </h1>
        <p className="max-w-sm text-sm leading-relaxed text-slate-300">
          Our Senior Finance Manager has been paged to review specialized concessions and finalize your custom Mazda CX-5 paperwork.
        </p>
        <div className="mt-2 inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3.5 py-1 text-xs font-semibold text-emerald-300">
          <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
          Escalation Ticket Dispatched to Dealership Desk
        </div>
      </div>
    </main>
  );
}
