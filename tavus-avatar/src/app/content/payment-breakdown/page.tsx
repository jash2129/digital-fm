const APPROVED_DAILY_RATES = [4, 3.5, 3.25, 3] as const;
const DEFAULT_DAILY_RATE = 4;

function parseDailyRate(rawRate: string | string[] | undefined): number {
  const value = Array.isArray(rawRate) ? rawRate[0] : rawRate;
  const parsed = value ? Number.parseFloat(value) : NaN;
  return (APPROVED_DAILY_RATES as readonly number[]).includes(parsed) ? parsed : DEFAULT_DAILY_RATE;
}

function formatDollars(amount: number): string {
  return amount % 1 === 0 ? `$${amount}` : `$${amount.toFixed(2)}`;
}

type PaymentBreakdownPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function PaymentBreakdownPage({ searchParams }: PaymentBreakdownPageProps) {
  const params = await searchParams;
  const dailyRate = parseDailyRate(params.rate);
  const monthlyRate = dailyRate * 30.44;

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(56,189,248,0.18),_transparent_34%),linear-gradient(180deg,_#f6fbff_0%,_#e7f1fb_100%)] px-8 py-10 text-slate-950">
      <div className="mx-auto flex h-full max-w-3xl flex-col gap-6">
        <div className="rounded-[2rem] border border-sky-200/80 bg-white/80 p-8 shadow-[0_24px_90px_rgba(7,15,43,0.12)] backdrop-blur">
          <p className="text-xs font-semibold uppercase tracking-[0.35em] text-sky-700">
            Full Protection Package
          </p>
          <h1 className="mt-4 text-4xl font-semibold leading-tight tracking-tight text-slate-950">
            Everything, for one price
          </h1>
          <p className="mt-3 max-w-2xl text-lg leading-8 text-slate-600">
            10-year bumper-to-bumper, 5-year maintenance, 5-year tire &amp; wheel, and GAP — all
            bundled together.
          </p>
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
    </main>
  );
}
