type PricingPanelProps = {
  eyebrow: string;
  title: string;
  description: string;
  bullets: string[];
};

export function PricingPanel({ eyebrow, title, description, bullets }: PricingPanelProps) {
  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(56,189,248,0.18),_transparent_34%),linear-gradient(180deg,_#f6fbff_0%,_#e7f1fb_100%)] px-8 py-10 text-slate-950">
      <div className="mx-auto flex h-full max-w-4xl flex-col gap-6">
        <div className="rounded-[2rem] border border-sky-200/80 bg-white/80 p-8 shadow-[0_24px_90px_rgba(7,15,43,0.12)] backdrop-blur">
          <p className="text-xs font-semibold uppercase tracking-[0.35em] text-sky-700">
            {eyebrow}
          </p>
          <h1 className="mt-4 text-4xl font-semibold leading-tight tracking-tight text-slate-950">
            {title}
          </h1>
          <p className="mt-3 max-w-2xl text-lg leading-8 text-slate-600">{description}</p>
        </div>

        <div className="rounded-[1.5rem] border border-slate-200 bg-white/85 p-6 shadow-[0_12px_48px_rgba(7,15,43,0.08)]">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-emerald-700">
            What&apos;s covered
          </p>
          <ul className="mt-4 space-y-2 text-base leading-7 text-slate-600">
            {bullets.map((bullet) => (
              <li className="flex gap-2" key={bullet}>
                <span className="mt-2.5 size-1.5 shrink-0 rounded-full bg-emerald-400" />
                <span>{bullet}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </main>
  );
}
