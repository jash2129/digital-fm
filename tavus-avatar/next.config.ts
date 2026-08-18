import { fileURLToPath } from "url";

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // A stray D:\package-lock.json outside this project confuses Next's
  // monorepo-root inference, which intermittently causes it to resolve
  // dependencies (e.g. tailwindcss) from the wrong directory and crash.
  // Pinning the root here to this project's own directory fixes it.
  turbopack: {
    root: fileURLToPath(new URL(".", import.meta.url)),
  },
  // Forwarded into both server and client bundles so event-scoped modules
  // (content-items.ts, persona-tools.ts) can branch on the active event
  // without needing a separate NEXT_PUBLIC_ variable.
  env: {
    EVENT_CONFIG: process.env.EVENT_CONFIG ?? "",
    // Optional dealership branding shown in the finance-event header. Falls back to a
    // generic label when unset — see .env.local for how to set it.
    DEALERSHIP_NAME: process.env.DEALERSHIP_NAME ?? "",
  },
};

export default nextConfig;
