"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

function DealSummaryContent() {
  const searchParams = useSearchParams();
  const customerName = searchParams.get("customer") || "Valued Customer";
  const vehicle = searchParams.get("vehicle") || "2026 Mazda CX-5";
  const dailyRate = searchParams.get("rate") || "4.00";
  const monthlyRate = searchParams.get("monthly") || (Number(dailyRate) * 30).toFixed(0);

  const products = [
    {
      name: "7-Year / 100,000-Mile Bumper-to-Bumper Warranty",
      description: "True blanket cover warranty covering engine, transmission, AC, sensors, electronics, parts, and labor with zero deductible.",
      tag: "7-Year Bumper to Bumper",
      badgeColor: "emerald",
    },
    {
      name: "5-Year Tire and Wheel Cover",
      description: "Covers 8 replacement tires, $125 install/tire, road hazard punctures, blowouts, and cosmetic pothole rim repairs (~$4,000 value).",
      tag: "5-Year Tire & Wheel",
      badgeColor: "amber",
    },
    {
      name: "4-Year Maintenance Package",
      description: "Full synthetic oil changes ($125/ea), filter replacements ($29/ea), and tire rotations ($140/ea). The only thing you worry about is paying for gas!",
      tag: "4-Year Maintenance",
      badgeColor: "sky",
    },
    {
      name: "GAP Coverage",
      description: "Covers the gap between insurance payout and loan balance in the event of collision write-off, theft, hail, flood, or fire total loss.",
      tag: "GAP Coverage",
      badgeColor: "purple",
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
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/30 bg-emerald-500/10 px-3 py-0.5 text-[11px] font-bold uppercase tracking-wider text-emerald-300">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  Step 6 · Verbal Agreement Confirmed
                </span>
              </div>
              <h1 className="mt-3 text-2xl sm:text-3xl md:text-4xl font-extrabold tracking-tight text-white">
                Protection Package Summary
              </h1>
              <p className="mt-1.5 text-xs sm:text-sm text-slate-300">
                Prepared for <span className="font-semibold text-white">{customerName}</span> •{" "}
                <span className="text-cyan-300 font-semibold">{vehicle}</span>
              </p>
            </div>

            <div className="rounded-xl border border-cyan-400/40 bg-gradient-to-br from-slate-900 via-slate-900/90 to-cyan-950/40 px-5 py-3 text-right shadow-lg">
              <span className="text-[10px] font-bold uppercase tracking-wider text-cyan-300">
                Agreed Investment
              </span>
              <div className="text-2xl sm:text-3xl font-black text-white">
                ${dailyRate}
                <span className="text-xs font-normal text-slate-400">/day</span>
              </div>
              <div className="text-[11px] font-mono text-slate-400">approx. ${monthlyRate}/mo</div>
            </div>
          </div>
        </div>

        {/* Product Cards */}
        <div className="grid gap-3.5 sm:grid-cols-2">
          {products.map((product) => (
            <div
              key={product.name}
              className="flex flex-col justify-between rounded-2xl border border-slate-700/60 bg-gradient-to-br from-slate-900/90 to-slate-950/80 p-5 shadow-xl backdrop-blur-md"
            >
              <div>
                <span
                  className={`inline-block rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider border ${
                    product.badgeColor === "emerald"
                      ? "border-emerald-400/40 bg-emerald-500/15 text-emerald-300"
                      : product.badgeColor === "amber"
                      ? "border-amber-400/40 bg-amber-500/15 text-amber-300"
                      : product.badgeColor === "purple"
                      ? "border-purple-400/40 bg-purple-500/15 text-purple-300"
                      : "border-sky-400/40 bg-sky-500/15 text-sky-300"
                  }`}
                >
                  {product.tag}
                </span>
                <h3 className="mt-2 text-sm sm:text-base font-bold text-white leading-snug">
                  {product.name}
                </h3>
                <p className="mt-1 text-xs text-slate-300 leading-relaxed">
                  {product.description}
                </p>
              </div>
              <div className="mt-4 pt-2.5 border-t border-white/5 flex items-center gap-1.5 text-[11px] font-semibold text-emerald-400">
                <svg className="size-4 fill-current shrink-0" viewBox="0 0 20 20">
                  <path
                    fillRule="evenodd"
                    d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                    clipRule="evenodd"
                  />
                </svg>
                Included in Agreed Package
              </div>
            </div>
          ))}
        </div>

        {/* Verification Guardrail Notice */}
        <div className="rounded-2xl border border-emerald-500/30 bg-gradient-to-r from-slate-900/90 to-emerald-950/20 p-5 shadow-xl backdrop-blur-md">
          <div className="flex items-start gap-3.5">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-500/20 border border-emerald-400/40 text-emerald-300 text-lg shadow-inner">
              🔒
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-300">
                Next Step: Verbal Consent → Step 7 Customer Verification
              </p>
              <p className="mt-1 text-xs sm:text-sm leading-relaxed text-slate-300">
                Identity and delivery address verification unlocks immediately after verbal agreement on this package. Once confirmed, payment authorization (Step 8) and two-part e-sign paperwork (Step 9) will be issued.
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

export default function DealSummaryPage() {
  return (
    <Suspense fallback={<div className="p-8 text-slate-400">Loading deal summary...</div>}>
      <DealSummaryContent />
    </Suspense>
  );
}
