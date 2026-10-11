"use client";

import React from "react";

const REPAIR_ITEMS = [
  {
    part: "Engine Assembly",
    cost: "$7,000",
    category: "Mechanical Core",
    note: "Block, cylinders, internal valves & timing components",
  },
  {
    part: "Transmission",
    cost: "$6,000",
    category: "Powertrain Core",
    note: "Gearbox, torque converter, mechatronics & drive units",
  },
  {
    part: "AC & Cooling System",
    cost: "$4,000",
    category: "Climate System",
    note: "Compressor, evaporator, condenser & Texas heat exchangers",
  },
  {
    part: "Dashboard Screens & Sensors",
    cost: "$6,500 – $8,500",
    category: "Cockpit Electronics",
    note: "Integrated digital display cluster & sensor assembly",
  },
  {
    part: "High-Tech Electronics",
    cost: "Up to $12,000",
    category: "Advanced Driver Tech",
    note: "Radar sensors, cameras, radar cruise & control modules",
  },
  {
    part: "Certified Technician Labor",
    cost: "$130 – $160 / hr",
    category: "Labor Rate (10–15 Hours)",
    note: "Typical major repair labor: $1,300 – $2,400+ on top of parts",
  },
];

const ROOT_CAUSES = [
  {
    title: "Texas Climate",
    icon: "☀️",
    desc: "110°F+ extreme summer heat to freezing winter cycles cause premature wear on sensors, electronics, cooling, & engine gaskets.",
  },
  {
    title: "Road Conditions",
    icon: "🚧",
    desc: "Active highway construction, uneven road surfaces, and potholes impact tires, alloy rims, suspension, and chassis alignment.",
  },
  {
    title: "Driving Habits",
    icon: "⏱️",
    desc: "Daily stop-and-go commuting, hard braking, and highway acceleration naturally wear components regardless of manufacturing quality.",
  },
];

export default function CostBreakdownPage() {
  return (
    <main className="relative min-h-screen bg-[radial-gradient(ellipse_at_top,_rgba(245,158,11,0.12)_0%,_rgba(2,6,23,0.95)_60%,_#020617_100%)] px-6 py-8 sm:px-8 sm:py-10 text-slate-100 font-sans select-none">
      {/* Ambient background glows */}
      <div className="pointer-events-none absolute -top-20 -left-20 h-80 w-80 rounded-full bg-amber-500/10 blur-[110px]" />
      <div className="pointer-events-none absolute -bottom-20 -right-20 h-80 w-80 rounded-full bg-rose-500/10 blur-[120px]" />

      <div
        className="mx-auto flex h-full max-w-4xl flex-col gap-5 sm:gap-6"
        style={{ animation: "panel-in 0.4s ease-out" }}
      >
        {/* Header - right padding ensures clearance for PiP video */}
        <div className="relative rounded-2xl border border-white/10 bg-slate-900/80 p-6 sm:p-8 shadow-2xl backdrop-blur-xl pr-36 sm:pr-44 md:pr-48">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-400/30 bg-amber-500/10 px-3 py-0.5 text-[11px] font-bold uppercase tracking-wider text-amber-300">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse" />
              95% of Breakdowns
            </span>
            <span className="rounded-full border border-slate-700/60 bg-slate-800/50 px-2.5 py-0.5 text-[10px] font-medium tracking-wide text-slate-400">
              Real-World Ownership Analysis
            </span>
          </div>

          <h1 className="mt-3 text-2xl sm:text-3xl md:text-4xl font-extrabold tracking-tight text-white">
            What Out-of-Pocket Repairs Actually Cost
          </h1>
          <p className="mt-2 text-sm sm:text-base text-slate-300 max-w-2xl leading-relaxed">
            95% of breakdowns occur from wear and tear — not factory defects. The manufacturer warranty pays $0 for these.
          </p>
        </div>

        {/* 3 Texas Root Causes */}
        <div className="grid gap-3 sm:grid-cols-3">
          {ROOT_CAUSES.map((cause) => (
            <div
              key={cause.title}
              className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 backdrop-blur-md"
            >
              <div className="flex items-center gap-2">
                <span className="text-xl">{cause.icon}</span>
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-200">
                  {cause.title}
                </h3>
              </div>
              <p className="mt-2 text-[11px] leading-relaxed text-slate-400">
                {cause.desc}
              </p>
            </div>
          ))}
        </div>

        {/* Real Parts & Labor Breakdown Grid */}
        <div className="rounded-2xl border border-slate-700/60 bg-gradient-to-br from-slate-900/90 to-slate-950/80 p-5 sm:p-6 shadow-xl backdrop-blur-md">
          <div className="flex items-center justify-between gap-2 border-b border-white/10 pb-3">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-amber-400">
                Mazda Parts &amp; Service Rates
              </p>
              <h2 className="text-base sm:text-lg font-bold text-white">
                Standard Dealership Replacement Costs
              </h2>
            </div>
            <span className="rounded-full border border-rose-500/30 bg-rose-500/10 px-3 py-1 text-[10px] font-bold uppercase text-rose-300">
              Paid 100% Out of Pocket Without Wrap
            </span>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {REPAIR_ITEMS.map((item) => (
              <div
                key={item.part}
                className="flex flex-col justify-between rounded-xl border border-slate-800 bg-slate-900/80 p-4 transition-all hover:border-slate-700"
              >
                <div>
                  <span className="text-[10px] font-medium uppercase tracking-wider text-slate-400">
                    {item.category}
                  </span>
                  <p className="mt-1 text-sm font-bold text-white leading-snug">{item.part}</p>
                </div>
                <div className="mt-3 pt-2 border-t border-white/5">
                  <p className="text-xl font-extrabold text-amber-300 tracking-tight">{item.cost}</p>
                  <p className="mt-1 text-[10px] text-slate-400 line-clamp-2 leading-relaxed">
                    {item.note}
                  </p>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-4 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3.5 text-xs text-rose-200 flex items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <span className="font-bold text-sm">⚠️</span>
              <span>
                <strong>Integrated Assemblies:</strong> Modern dashboard sensors cannot be replaced individually. A single faulty sensor requires replacing the entire $6,500 – $8,500 cluster plus labor.
              </span>
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
