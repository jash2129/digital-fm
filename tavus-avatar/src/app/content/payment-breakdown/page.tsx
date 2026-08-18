import { getOrderedProductKeys, getPricingConfig } from "@/lib/pricing-config";

function parseDailyRate(
  rawRate: string | string[] | undefined,
  approvedRates: number[],
  defaultRate: number,
): number {
  const value = Array.isArray(rawRate) ? rawRate[0] : rawRate;
  const parsed = value ? Number.parseFloat(value) : NaN;
  return approvedRates.includes(parsed) ? parsed : defaultRate;
}

function formatDollars(amount: number): string {
  return amount % 1 === 0 ? `$${amount}` : `$${amount.toFixed(2)}`;
}

type PaymentBreakdownPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function PaymentBreakdownPage({ searchParams }: PaymentBreakdownPageProps) {
  const params = await searchParams;
  const config = getPricingConfig();
  const dailyRate = parseDailyRate(
    params.rate,
    config.negotiation.tiersUsd,
    config.negotiation.openingRateUsd,
  );
  const monthlyRate = dailyRate * 30.44;
  const productLabels = getOrderedProductKeys(config).map((key) => config.products[key].label);

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(56,189,248,0.18),_transparent_34%),linear-gradient(180deg,_#f6fbff_0%,_#e7f1fb_100%)] px-8 py-10 text-slate-950">
      <div
        className="mx-auto flex h-full max-w-3xl flex-col gap-6"
        style={{ animation: "panel-in 0.45s ease-out" }}
      >
        <div className="rounded-[2rem] border border-sky-200/80 bg-white/80 p-8 shadow-[0_24px_90px_rgba(7,15,43,0.12)] backdrop-blur">
          <p className="text-xs font-semibold uppercase tracking-[0.35em] text-sky-700">
            Full Protection Package
          </p>
          <h1 className="mt-4 text-4xl font-semibold leading-tight tracking-tight text-slate-950">
            Everything, for one price
          </h1>

          <ul className="mt-5 flex flex-wrap gap-2">
            {productLabels.map((label) => (
              <li
                className="flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700"
                key={label}
              >
                <svg fill="none" height="14" viewBox="0 0 24 24" width="14" xmlns="http://www.w3.org/2000/svg">
                  <path d="M20 6 9 17l-5-5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" />
                </svg>
                {label}
              </li>
            ))}
          </ul>
        </div>

        <div className="rounded-[1.5rem] border border-slate-200 bg-white/85 p-10 text-center shadow-[0_12px_48px_rgba(7,15,43,0.08)]">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-sky-700">
            Your price
          </p>
          <p className="mt-4 text-7xl font-semibold text-slate-950">
            {formatDollars(dailyRate)}
            <span className="text-2xl font-medium text-slate-500"> / day</span>
          </p>
          <p className="mt-3 text-lg text-slate-500">
            about {formatDollars(monthlyRate)} a month
          </p>
        </div>
      </div>

      <style>{`
        @keyframes panel-in {
          0% { opacity: 0; transform: translateY(10px) scale(0.98); }
          100% { opacity: 1; transform: translateY(0) scale(1); }
        }
      `}</style>
    </main>
  );
}