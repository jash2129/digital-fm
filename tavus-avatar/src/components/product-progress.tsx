type ProductProgressStep = {
  key: string;
  label: string;
};

type ProductProgressProps = {
  steps: ProductProgressStep[];
  completedKeys: string[];
  currentKey: string;
};

/** Horizontal stepper shown across the four product panels so the customer sees the bundle
 * building up as Max talks through it, instead of four disconnected screens. */
export function ProductProgress({ steps, completedKeys, currentKey }: ProductProgressProps) {
  return (
    <ol className="flex flex-wrap items-center gap-2 sm:gap-3">
      {steps.map((step) => {
        const isCompleted = completedKeys.includes(step.key);
        const isCurrent = step.key === currentKey;

        return (
          <li
            className={
              isCurrent
                ? "flex items-center gap-1.5 rounded-full border border-sky-400 bg-sky-50 px-3 py-1.5 text-xs font-semibold text-sky-800"
                : isCompleted
                  ? "flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700"
                  : "flex items-center gap-1.5 rounded-full border border-slate-200 bg-white/60 px-3 py-1.5 text-xs font-medium text-slate-400"
            }
            key={step.key}
          >
            {isCompleted ? (
              <svg fill="none" height="14" viewBox="0 0 24 24" width="14" xmlns="http://www.w3.org/2000/svg">
                <path d="M20 6 9 17l-5-5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" />
              </svg>
            ) : (
              <span
                className={
                  isCurrent
                    ? "size-1.5 rounded-full bg-sky-500"
                    : "size-1.5 rounded-full bg-slate-300"
                }
              />
            )}
            {step.label}
          </li>
        );
      })}
    </ol>
  );
}