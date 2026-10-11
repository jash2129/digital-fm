"use client";

import React from "react";
import type { CanvasElementSkeleton } from "@/lib/canvas-elements";
import { DigitalFourSquareMenu } from "./digital-four-square-menu";

export type PresentationCanvasProps = {
  elements?: CanvasElementSkeleton[];
  shownProducts?: string[];
  activeProduct?: string | null;
  dailyRate?: number | string | null;
};

/**
 * Luxury F&I Digital Four Square Presentation Canvas.
 * Upgraded from legacy Excalidraw sketch canvas to a sleek automotive showroom
 * glassmorphic digital menu with progressive card illumination and real-time
 * Starbucks coffee value comparison.
 */
export function PresentationCanvas({
  elements = [],
  shownProducts,
  activeProduct,
  dailyRate,
}: PresentationCanvasProps) {
  return (
    <div className="absolute inset-0 h-full w-full bg-slate-950">
      <DigitalFourSquareMenu
        elements={elements}
        shownProducts={shownProducts}
        activeProduct={activeProduct}
        dailyRate={dailyRate}
      />
    </div>
  );
}
