"use client";

type CallSummaryScreenProps = {
  productLabels: string[];
  dailyRate: number | null;
  onStartNewCall(): void;
};

function formatDollars(amount: number): string {
  return amount % 1 === 0 ? `$${amount}` : `$${amount.toFixed(2)}`;
}

/** Shown after a call ends instead of snapping straight back to the plain start screen —
 * gives the customer a clean "here's what we covered" close instead of the call just vanishing. */
export function CallSummaryScreen({ productLabels, dailyRate, onStartNewCall }: CallSummaryScreenProps) {
  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-6 bg-[radial-gradient(circle_at_top,_rgba(41,80,200,0.35),_transparent_38%),linear-gradient(180deg,_#09101d_0%,_#060912_100%)] px-6 text-white">
      <div className="w-full max-w-lg rounded-[2rem] border border-white/10 bg-slate-950/70 p-8 text-center shadow-[0_30px_120px_rgba(0,0,0,0.4)] backdrop-blur">
        <p className="text-xs font-semibold uppercase tracking-[0.4em] text-sky-300/80">
          Consultation complete
        </p>
        <h1 className="mt-4 text-3xl font-semibold leading-tight">Thanks for your time</h1>

        {productLabels.length > 0 ? (
          <div className="mt-6 text-left">
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">
              What we covered
            </p>
            <ul className="mt-3 space-y-2">
              {productLabels.map((label) => (
                <li className="flex items-center gap-2 text-sm text-slate-200" key={label}>
                  <svg fill="none" height="14" viewBox="0 0 24 24" width="14" xmlns="http://www.w3.org/2000/svg">
                    <path d="M20 6 9 17l-5-5" stroke="#34d399" strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" />
                  </svg>
                  {label}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {dailyRate !== null ? (
          <p className="mt-6 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-300">
            Last price discussed: <span className="font-semibold text-white">{formatDollars(dailyRate)}/day</span>
          </p>
        ) : null}

        <button
          className="mt-8 inline-flex min-h-12 w-full items-center justify-center rounded-full bg-sky-400 px-6 py-3 text-base font-semibold text-slate-950 transition hover:bg-sky-300"
          onClick={onStartNewCall}
          type="button"
        >
          Start a new call
        </button>
      </div>
    </div>
  );
}