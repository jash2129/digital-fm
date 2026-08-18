"use client";

import { useEffect, useState } from "react";

type CountdownScreenProps = {
  seconds?: number;
  label?: string;
  onComplete(): void;
};

/** Full-screen "get ready" beat shown before the call actually connects — gives whoever is
 * presenting (and their audience) a clean, deliberate moment before the avatar appears, instead
 * of an abrupt jump straight into permission prompts and loading states. */
export function CountdownScreen({
  seconds = 3,
  label = "Starting your consultation",
  onComplete,
}: CountdownScreenProps) {
  const [remaining, setRemaining] = useState(seconds);

  useEffect(() => {
    if (remaining <= 0) {
      onComplete();
      return;
    }

    const timer = setTimeout(() => setRemaining((prev) => prev - 1), 1000);
    return () => clearTimeout(timer);
  }, [remaining, onComplete]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-6 bg-[radial-gradient(circle_at_top,_rgba(41,80,200,0.35),_transparent_38%),linear-gradient(180deg,_#09101d_0%,_#060912_100%)] text-white">
      <p className="text-xs font-semibold uppercase tracking-[0.4em] text-sky-300/80">{label}</p>
      <p
        key={remaining}
        className="text-[7rem] font-semibold leading-none tabular-nums text-white md:text-[9rem]"
        style={{ animation: "countdown-tick 1s ease-out" }}
      >
        {remaining > 0 ? remaining : "Go"}
      </p>
      <style>{`
        @keyframes countdown-tick {
          0% { opacity: 0; transform: scale(0.7); }
          30% { opacity: 1; transform: scale(1.08); }
          100% { opacity: 1; transform: scale(1); }
        }
      `}</style>
    </div>
  );
}