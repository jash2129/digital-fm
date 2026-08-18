import { CoverageIcon } from "@/components/coverage-icon";
import { ProductProgress } from "@/components/product-progress";

type PricingPanelProps = {
  eyebrow: string;
  title: string;
  description: string;
  bullets: string[];
  progress?: {
    steps: { key: string; label: string }[];
    completedKeys: string[];
    currentKey: string;
  };
};

export function PricingPanel({ eyebrow, title, description, bullets, progress }: PricingPanelProps) {
  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(56,189,248,0.18),_transparent_34%),linear-gradient(180deg,_#f6fbff_0%,_#e7f1fb_100%)] px-8 py-10 text-slate-950">
      <div
        className="mx-auto flex h-full max-w-4xl flex-col gap-6"
        style={{ animation: "panel-in 0.45s ease-out" }}
      >
        {progress ? <ProductProgress {...progress} /> : null}

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
          <ul className="mt-4 grid gap-3 sm:grid-cols-2">
            {bullets.map((bullet) => (
              <li className="flex items-start gap-3 text-base leading-6 text-slate-700" key={bullet}>
                <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
                  <CoverageIcon bulletText={bullet} />
                </span>
                <span className="pt-0.5">{bullet}</span>
              </li>
            ))}
          </ul>
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