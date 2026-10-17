"use client";

import React, { useState, useEffect } from "react";
import dynamic from "next/dynamic";

const TavusDemo = dynamic(
  () => import("@/components/tavus-demo").then((mod) => mod.TavusDemo),
  { ssr: false }
);

const LiveAvatarDemo = dynamic(
  () => import("@/components/liveavatar-demo").then((mod) => mod.LiveAvatarDemo),
  { ssr: false }
);

export default function Home() {
  const [engine, setEngine] = useState<"heygen" | "tavus">("heygen");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      if (params.get("engine") === "tavus") {
        setEngine("tavus");
      }
    }
  }, []);

  return (
    <div className="relative h-screen w-full bg-slate-950 overflow-hidden flex flex-col" suppressHydrationWarning>
      {/* Engine Selector Badge - positioned at bottom left so it never overlaps header controls */}
      <div
        className="fixed bottom-3 left-4 z-50 flex items-center gap-1 rounded-full border border-white/20 bg-slate-900/95 p-1 backdrop-blur-2xl shadow-2xl"
        suppressHydrationWarning
      >
        <button
          onClick={() => setEngine("heygen")}
          type="button"
          className={`rounded-full px-3 py-1 text-xs font-bold transition ${
            engine === "heygen"
              ? "bg-sky-500 text-white shadow-md"
              : "text-slate-400 hover:text-white"
          }`}
        >
          ⚡ HeyGen + Grok
        </button>
        <button
          onClick={() => setEngine("tavus")}
          type="button"
          className={`rounded-full px-3 py-1 text-xs font-bold transition ${
            engine === "tavus"
              ? "bg-purple-600 text-white shadow-md"
              : "text-slate-400 hover:text-white"
          }`}
        >
          Tavus
        </button>
      </div>

      <div className="flex-1 w-full min-h-0 overflow-hidden relative" suppressHydrationWarning>
        {mounted && (engine === "heygen" ? <LiveAvatarDemo /> : <TavusDemo />)}
      </div>
    </div>
  );
}
