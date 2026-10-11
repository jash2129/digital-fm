"use client";

import React, { useMemo } from "react";
import type { CanvasElementSkeleton } from "@/lib/canvas-elements";

export type DigitalFourSquareMenuProps = {
  elements?: CanvasElementSkeleton[];
  shownProducts?: string[];
  activeProduct?: string | null;
  dailyRate?: number | string | null;
};

type ProductConfig = {
  key: string;
  categoryTag: string;
  title: string;
  subtitle: string;
  badge: string;
  badgeColor: "emerald" | "amber" | "sky" | "purple";
  icon: string;
  statHighlight: string;
  statLabel: string;
  bullets: string[];
  quoteNote?: string;
};

const PRODUCTS: ProductConfig[] = [
  {
    key: "vsc",
    categoryTag: "7-Year Bumper to Bumper",
    title: "7-Year / 100,000-Mile Bumper-to-Bumper Warranty",
    subtitle: "True Blanket Cover Warranty — $0 Deductible",
    badge: "$0 ZERO DEDUCTIBLE",
    badgeColor: "emerald",
    icon: "🛡️",
    statHighlight: "$0 Out of Pocket",
    statLabel: "Comprehensive breakdown coverage",
    bullets: [
      "Engine ($7,000) & Transmission ($6,000) replacement",
      "Air Conditioning & Cooling climate systems ($4,000)",
      "Dashboard touchscreens, sensors & high-tech electronics ($6,500–$8,500)",
      "100% Certified Master Technician labor ($130–$160/hr)",
    ],
    quoteNote: "Covers 95% of breakdowns caused by Texas climate & driving wear",
  },
  {
    key: "tire_wheel",
    categoryTag: "5-Year Tire & Wheel",
    title: "5-Year Tire and Wheel Cover",
    subtitle: "Road Hazard Replacement & Pothole Rim Repairs",
    badge: "~$4,000 VALUE INCLUDED",
    badgeColor: "amber",
    icon: "🛞",
    statHighlight: "8 Tires + Install",
    statLabel: "Covered across next 5 years",
    bullets: [
      "Road hazard punctures & unexpected blowouts replaced free",
      "Cosmetic alloy rim curb rash & pothole bend repairs",
      "Covers 2 sets of tires ($350/tire + $125 install = ~$4,000 saved)",
      "Zero deductible on road hazard damage",
    ],
    quoteNote: "Texas construction & uneven roads taken care of with $0 out of pocket",
  },
  {
    key: "maintenance",
    categoryTag: "4-Year Maintenance",
    title: "4-Year Maintenance Package",
    subtitle: "Full Synthetic Oil Changes, Filters & Rotations",
    badge: "FACTORY CARE COVERED",
    badgeColor: "sky",
    icon: "⚡",
    statHighlight: "100% Scheduled Care",
    statLabel: "Say goodbye to service desk invoices",
    bullets: [
      "Full synthetic oil changes ($125/service included)",
      "Engine & cabin air filter replacements ($29/ea included)",
      "Multi-point inspections & tire rotations ($140/service included)",
      "Only thing you have to worry about is paying for GAS!",
    ],
    quoteNote: "Routine maintenance fully taken care of for the next 4 years",
  },
  {
    key: "gap",
    categoryTag: "GAP Coverage",
    title: "GAP Coverage",
    subtitle: "Covers Gap Between Insurance Payout & Loan Balance",
    badge: "100% LOAN DEFICIT COVER",
    badgeColor: "purple",
    icon: "⚖️",
    statHighlight: "Zero Loan Deficit",
    statLabel: "Protection in event of total write-off",
    bullets: [
      "Covers difference between insurance payout & remaining loan balance",
      "Protects against total loss from accident, theft, hail storm, or flood",
      "Leaves $0 remaining out-of-pocket debt on a vehicle you no longer have",
      "Protects personal savings and credit standing",
    ],
    quoteNote: "Complete safeguard against depreciation gap in insurance settlement",
  },
];

export function DigitalFourSquareMenu({
  elements = [],
  shownProducts,
  activeProduct,
  dailyRate,
}: DigitalFourSquareMenuProps) {
  // Infer shown products either from explicit prop or by scanning skeleton elements
  const activeShownKeys = useMemo(() => {
    if (shownProducts && shownProducts.length > 0) {
      return new Set(shownProducts);
    }
    const set = new Set<string>();
    for (const el of elements) {
      if (el.type === "text" && el.id.startsWith("box-text-")) {
        set.add(el.id.replace("box-text-", ""));
      }
    }
    return set;
  }, [shownProducts, elements]);

  // Infer daily rate either from explicit prop or skeleton price-banner element
  const resolvedDailyRate = useMemo(() => {
    if (dailyRate !== undefined && dailyRate !== null) {
      const num = typeof dailyRate === "number" ? dailyRate : parseFloat(String(dailyRate).replace(/[^0-9.]/g, ""));
      return isNaN(num) ? null : num;
    }
    const priceBanner = elements.find((el) => el.id === "price-banner");
    if (priceBanner && priceBanner.type === "text" && priceBanner.text) {
      const match = priceBanner.text.match(/\$([0-9]+(?:\.[0-9]{1,2})?)/);
      if (match) {
        return parseFloat(match[1]);
      }
    }
    return null;
  }, [dailyRate, elements]);

  const monthlyCost = resolvedDailyRate ? Math.round(resolvedDailyRate * 30) : null;
  const isAllRevealed = activeShownKeys.size >= 4;

  return (
    <div className="relative flex h-full w-full flex-col justify-between overflow-y-auto bg-[radial-gradient(ellipse_at_top,_rgba(14,165,233,0.15)_0%,_rgba(2,6,23,0.95)_60%,_#020617_100%)] p-4 sm:p-6 md:p-8 text-slate-100 font-sans select-none">
      {/* Ambient background glow elements */}
      <div className="pointer-events-none absolute -top-24 -left-24 h-96 w-96 rounded-full bg-cyan-500/10 blur-[120px]" />
      <div className="pointer-events-none absolute top-1/2 -right-24 h-96 w-96 rounded-full bg-indigo-500/10 blur-[130px]" />
      <div className="pointer-events-none absolute -bottom-24 left-1/3 h-80 w-80 rounded-full bg-emerald-500/10 blur-[110px]" />

      {/* Header bar - with right padding to clear PiP avatar video */}
      <div className="relative z-10 mb-4 flex flex-col justify-between gap-2 border-b border-white/10 pb-4 pr-36 sm:pr-44 md:pr-48">
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-sky-400/30 bg-sky-500/10 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-sky-300 backdrop-blur-md">
            <span className="h-1.5 w-1.5 rounded-full bg-sky-400 animate-pulse" />
            2026 Mazda CX-5
          </span>
          <span className="rounded-full border border-slate-700/60 bg-slate-800/50 px-2.5 py-0.5 text-[10px] font-medium tracking-wide text-slate-400">
            Mazda Protection Plan · Step 3
          </span>
          {activeShownKeys.size > 0 && (
            <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-0.5 text-[10px] font-semibold text-emerald-300">
              {activeShownKeys.size} of 4 Covered
            </span>
          )}
        </div>

        <div>
          <h1 className="text-xl sm:text-2xl md:text-3xl font-bold tracking-tight text-white flex items-center gap-2">
            Mazda Premier Vehicle Protection Plan
          </h1>
          <p className="text-xs sm:text-sm text-slate-400 max-w-xl line-clamp-1">
            Zero-deductible wrap protection covering Texas climate, road conditions &amp; driving habits.
          </p>
        </div>
      </div>

      {/* 2x2 Product Grid */}
      <div className="relative z-10 grid flex-1 grid-cols-1 gap-3.5 sm:grid-cols-2 md:gap-4 my-auto">
        {PRODUCTS.map((prod) => {
          const isShown = activeShownKeys.has(prod.key) || activeShownKeys.size === 0;
          // If none are specifically shown yet (initial grid outline), cards show in sleek standby state
          const isInitiallyEmptyGrid = activeShownKeys.size === 0;
          const isHighlighted = activeProduct === prod.key;

          return (
            <div
              key={prod.key}
              className={`group relative flex flex-col justify-between rounded-2xl border transition-all duration-500 overflow-hidden ${
                isInitiallyEmptyGrid
                  ? "border-slate-800/80 bg-slate-900/40 p-4 opacity-75 backdrop-blur-md"
                  : isShown
                  ? isHighlighted
                    ? "border-cyan-400/80 bg-gradient-to-br from-slate-900/95 via-slate-900/80 to-cyan-950/40 p-4 shadow-[0_0_35px_rgba(14,165,233,0.3)] ring-1 ring-cyan-400/50 scale-[1.01]"
                    : "border-slate-700/60 bg-gradient-to-br from-slate-900/90 via-slate-900/75 to-slate-950/60 p-4 shadow-xl backdrop-blur-md hover:border-slate-600/80"
                  : "border-slate-800/40 bg-slate-950/30 p-4 opacity-35 grayscale backdrop-blur-sm"
              }`}
            >
              {/* Corner accent glow on active item */}
              {isShown && (
                <div
                  className={`pointer-events-none absolute -top-12 -right-12 h-24 w-24 rounded-full blur-2xl transition-opacity ${
                    prod.badgeColor === "emerald"
                      ? "bg-emerald-500/20"
                      : prod.badgeColor === "amber"
                      ? "bg-amber-500/20"
                      : prod.badgeColor === "purple"
                      ? "bg-purple-500/20"
                      : "bg-sky-500/20"
                  }`}
                />
              )}

              {/* Card Header */}
              <div>
                <div className="flex items-center justify-between gap-2 mb-2">
                  <div className="flex items-center gap-2">
                    <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-slate-800/80 border border-white/10 text-sm shadow-inner">
                      {prod.icon}
                    </span>
                    <span className="text-[10px] font-bold uppercase tracking-wider text-sky-400">
                      {prod.categoryTag}
                    </span>
                  </div>

                  {isShown ? (
                    <span
                      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-extrabold uppercase tracking-wide border shadow-sm ${
                        prod.badgeColor === "emerald"
                          ? "border-emerald-400/40 bg-emerald-500/15 text-emerald-300"
                          : prod.badgeColor === "amber"
                          ? "border-amber-400/40 bg-amber-500/15 text-amber-300"
                          : prod.badgeColor === "purple"
                          ? "border-purple-400/40 bg-purple-500/15 text-purple-300"
                          : "border-sky-400/40 bg-sky-500/15 text-sky-300"
                      }`}
                    >
                      <svg className="h-3 w-3 fill-current" viewBox="0 0 20 20">
                        <path
                          fillRule="evenodd"
                          d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                          clipRule="evenodd"
                        />
                      </svg>
                      {prod.badge}
                    </span>
                  ) : (
                    <span className="rounded-full border border-slate-800 bg-slate-900 px-2 py-0.5 text-[9px] font-mono text-slate-500">
                      STANDBY
                    </span>
                  )}
                </div>

                <h2 className="text-sm sm:text-base font-bold text-white tracking-tight leading-snug">
                  {prod.title}
                </h2>
                <p className="text-[11px] text-slate-400 mt-0.5">{prod.subtitle}</p>

                {/* Bullets List */}
                <ul className="mt-3 space-y-1.5">
                  {prod.bullets.map((bullet, idx) => (
                    <li key={idx} className="flex items-start gap-1.5 text-[11px] text-slate-300 leading-snug">
                      <span className="mt-0.5 text-cyan-400 shrink-0 font-bold">•</span>
                      <span>{bullet}</span>
                    </li>
                  ))}
                </ul>
              </div>

              {/* Card Footer Stat */}
              <div className="mt-3 pt-2 border-t border-white/5 flex items-center justify-between text-[11px]">
                <span className="text-slate-400 text-[10px]">{prod.statLabel}</span>
                <span className="font-semibold text-white tracking-wide">{prod.statHighlight}</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Bottom Pricing & Coffee Comparison Banner */}
      <div className="relative z-10 mt-4 pt-3 border-t border-white/10">
        {resolvedDailyRate !== null ? (
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 rounded-2xl border border-amber-400/30 bg-gradient-to-r from-slate-900/90 via-slate-900/80 to-amber-950/30 p-3.5 sm:p-4 shadow-[0_0_30px_rgba(245,158,11,0.15)] backdrop-blur-md">
            <div className="flex items-center gap-3 sm:gap-4">
              <div className="flex h-12 w-12 sm:h-14 sm:w-14 shrink-0 items-center justify-center rounded-xl border border-amber-400/40 bg-gradient-to-br from-amber-500/20 to-amber-600/10 text-2xl shadow-inner">
                ☕
              </div>
              <div>
                <div className="flex items-baseline gap-2">
                  <span className="text-2xl sm:text-3xl font-extrabold tracking-tight text-white">
                    ${resolvedDailyRate.toFixed(2)}
                  </span>
                  <span className="text-xs sm:text-sm font-semibold text-amber-300 uppercase tracking-wider">
                    / day
                  </span>
                  {monthlyCost && (
                    <span className="text-xs text-slate-400 font-mono">
                      (~${monthlyCost} / mo)
                    </span>
                  )}
                </div>
                <p className="text-[11px] sm:text-xs text-slate-300 mt-0.5">
                  <strong className="text-amber-200">Starbucks Value Comparison:</strong> A daily Starbucks coffee is{" "}
                  <span className="line-through text-slate-400">$8.60</span>. For{" "}
                  <span className="font-bold text-emerald-300">less than half a cup of coffee</span>, your entire Mazda CX-5 is 100% protected.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 sm:shrink-0">
              <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-center">
                <div className="text-[10px] font-bold uppercase tracking-wider text-emerald-400">
                  Certified Dealership
                </div>
                <div className="text-xs font-bold text-white">$0 Out of Pocket</div>
              </div>
              <div className="rounded-xl border border-slate-700 bg-slate-800/60 px-3 py-2 text-center">
                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  Rental Car
                </div>
                <div className="text-xs font-bold text-slate-200">10 Days Covered</div>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between rounded-xl border border-white/5 bg-slate-900/40 px-4 py-2.5 text-xs text-slate-400">
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-cyan-400 animate-pulse" />
              <span>
                {isAllRevealed
                  ? "All 4 protection coverages outlined · Calculating package investment..."
                  : "Reviewing comprehensive coverage specifications with Max..."}
              </span>
            </div>
            <span className="text-[10px] font-mono text-slate-500">
              Mazda Certified Protection Blueprint
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
