"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

function PricingLadderContent() {
  const searchParams = useSearchParams();
  const currentRate = searchParams.get("rate") || "4.00";
  const activeRateNum = parseFloat(currentRate);
  const isConcessionApplied = activeRateNum < 4.0;
  const monthlyCost = Math.round(activeRateNum * 30);

  const coveredItems = [
    {
      title: "7-Year / 100,000-Mile Bumper-to-Bumper Warranty",
      icon: "🛡️",
      detail: "True blanket cover warranty covering engine, transmission, AC, electronics, parts, and labor with $0 deductible.",
      color: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
    },
    {
      title: "5-Year Tire and Wheel Cover",
      icon: "🛞",
      detail: "Covers 8 replacement tires, $125 install, road hazard punctures, blowouts, and pothole rim repairs.",
      color: "border-amber-500/30 bg-amber-500/10 text-amber-300",
    },
    {
      title: "4-Year Maintenance Package",
      icon: "⚡",
      detail: "Full synthetic oil changes, filter replacements, and tire rotations. The only thing you worry about is gas!",
      color: "border-sky-500/30 bg-sky-500/10 text-sky-300",
    },
    {
      title: "GAP Coverage",
      icon: "⚖️",
      detail: "Covers the gap between insurance payout and loan balance in the event of total write-off.",
      color: "border-purple-500/30 bg-purple-500/10 text-purple-300",
    },
  ];

  return (
    <main className="relative min-h-screen bg-[radial-gradient(ellipse_at_top,_rgba(14,165,233,0.18)_0%,_rgba(2,6,23,0.95)_60%,_#020617_100%)] px-6 py-8 sm:px-8 sm:py-10 text-slate-100 font-sans select-none">
      {/* Ambient background glows */}
      <div className="pointer-events-none absolute -top-20 -left-20 h-80 w-80 rounded-full bg-cyan-500/10 blur-[110px]" />
      <div className="pointer-events-none absolute -bottom-20 -right-20 h-80 w-80 rounded-full bg-indigo-500/10 blur-[110px]" />

      <div
        className="mx-auto flex h-full max-w-4xl flex-col gap-5 sm:gap-6"
        style={{ animation: "panel-in 0.4s ease-out" }}
      >
        {/* Header - right clearance for PiP video */}
        <div className="relative rounded-2xl border border-white/10 bg-slate-900/80 p-6 sm:p-8 shadow-2xl backdrop-blur-xl pr-36 sm:pr-44 md:pr-48">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-sky-400/30 bg-sky-500/10 px-3 py-0.5 text-[11px] font-bold uppercase tracking-wider text-sky-300">
              <span className="h-1.5 w-1.5 rounded-full bg-sky-400 animate-pulse" />
              2026 Mazda CX-5
            </span>
            <span className="rounded-full border border-slate-700/60 bg-slate-800/50 px-2.5 py-0.5 text-[10px] font-medium tracking-wide text-slate-400">
              Protection Investment Summary
            </span>
            {isConcessionApplied && (
              <span className="rounded-full border border-emerald-500/30 bg-emerald-500/15 px-2.5 py-0.5 text-[10px] font-semibold text-emerald-300">
                Special Courtesy Rate Applied
              </span>
            )}
          </div>
          <h1 className="mt-3 text-2xl sm:text-3xl md:text-4xl font-extrabold tracking-tight text-white">
            Vehicle Protection Investment
          </h1>
          <p className="mt-2 text-sm sm:text-base text-slate-300 max-w-2xl leading-relaxed">
            All 4 comprehensive protections bundled with zero deductible at any certified dealership center and 10 days of rental vehicle coverage.
          </p>
        </div>

        {/* Investment Highlight Card */}
        <div className="rounded-2xl border border-amber-400/30 bg-gradient-to-r from-slate-900/90 via-slate-900/80 to-amber-950/30 p-6 shadow-2xl backdrop-blur-md">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl border border-amber-400/40 bg-gradient-to-br from-amber-500/20 to-amber-600/10 text-3xl shadow-inner">
                ☕
              </div>
              <div>
                <div className="flex items-baseline gap-2">
                  <span className="text-4xl font-extrabold tracking-tight text-white">
                    ${activeRateNum.toFixed(2)}
                  </span>
                  <span className="text-base font-semibold text-amber-300 uppercase tracking-wider">
                    / day
                  </span>
                  <span className="text-sm text-slate-400 font-mono ml-1">
                    (~${monthlyCost} / mo)
                  </span>
                </div>
                <p className="text-xs sm:text-sm text-slate-300 mt-1">
                  <strong className="text-amber-200">Starbucks Value Comparison:</strong> Less than half the price of a daily Starbucks beverage ($8.60).
                </p>
              </div>
            </div>

            <div className="rounded-xl border border-sky-400/30 bg-sky-500/10 px-4 py-2 text-right">
              <div className="text-[10px] font-bold uppercase tracking-wider text-sky-300">
                Comprehensive Protection
              </div>
              <div className="text-xs font-semibold text-white mt-0.5">
                4-in-1 Complete Bundle
              </div>
            </div>
          </div>
        </div>

        {/* 4 Included Products Grid */}
        <div className="grid gap-3.5 sm:grid-cols-2">
          {coveredItems.map((item) => (
            <div
              key={item.title}
              className="flex items-start gap-3 rounded-2xl border border-slate-700/60 bg-gradient-to-br from-slate-900/90 to-slate-950/80 p-4 shadow-xl backdrop-blur-md"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-800/80 border border-white/10 text-lg shadow-inner">
                {item.icon}
              </span>
              <div>
                <h3 className="text-sm font-bold text-white tracking-tight">{item.title}</h3>
                <p className="mt-1 text-xs text-slate-300 leading-snug">{item.detail}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Benefits Banner */}
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-2xl border border-emerald-500/30 bg-gradient-to-br from-slate-900/90 to-emerald-950/20 p-5 backdrop-blur-md">
            <h4 className="text-[10px] font-bold uppercase tracking-wider text-emerald-400">
              Certified Dealership Service Center
            </h4>
            <p className="mt-1 text-2xl font-black text-white">$0 Deductible</p>
            <p className="mt-1 text-xs text-slate-300">
              Zero out-of-pocket costs when servicing at any certified center across the metroplex.
            </p>
          </div>
          <div className="rounded-2xl border border-amber-500/30 bg-gradient-to-br from-slate-900/90 to-amber-950/20 p-5 backdrop-blur-md">
            <h4 className="text-[10px] font-bold uppercase tracking-wider text-amber-400">
              Out-of-Area Emergency Service
            </h4>
            <p className="mt-1 text-2xl font-black text-white">$350 Deductible</p>
            <p className="mt-1 text-xs text-slate-300">
              10 days of rental car fully covered if travel repairs must occur outside the home metroplex.
            </p>
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

export default function PricingLadderPage() {
  return (
    <Suspense fallback={<div className="p-8 text-slate-400">Loading pricing...</div>}>
      <PricingLadderContent />
    </Suspense>
  );
}
