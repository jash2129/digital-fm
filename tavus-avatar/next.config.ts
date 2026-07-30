import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Forwarded into both server and client bundles so event-scoped modules
  // (content-items.ts, persona-tools.ts) can branch on the active event
  // without needing a separate NEXT_PUBLIC_ variable.
  env: {
    EVENT_CONFIG: process.env.EVENT_CONFIG ?? "",
  },
};

export default nextConfig;
