import { NextResponse } from "next/server";
import { storeStatus } from "@/lib/call-log-store";
import { storeBackend, upstashEnvNames } from "@/lib/upstash";
import { isAIFirstEnabled } from "@/lib/ai-understanding";

// What this deployment can reach, for setup checks: open /api/health in a signed-in browser, or
// /api/health?session=<call id> to check one call's log. Yes/no answers and variable NAMES only,
// never secret values. Behind the DEMO_API_TOKEN gate like every /api route.
export async function GET(request: Request) {
  const sessionId = new URL(request.url).searchParams.get("session") ?? undefined;
  const set = (name: string) => Boolean(process.env[name]?.trim());
  return NextResponse.json({
    host: process.env.VERCEL ? "vercel" : process.env.RENDER ? "render" : "local",
    deployment: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
    upstash: { ...(await storeStatus(sessionId)), ...storeBackend(), envNames: upstashEnvNames() },
    deepgramKey: set("DEEPGRAM_API_KEY"),
    sttDefault: process.env.NEXT_PUBLIC_STT_ENGINE || "webspeech",
    callLogWebhook: set("CALL_LOG_WEBHOOK_URL"),
    callLogSecret: set("CALL_LOG_SECRET"),
    heygenKey: set("HEYGEN_API_KEY"),
    aiKey: set("XAI_API_KEY") || set("OPENAI_API_KEY"),
    // "ai" only when MAX_UNDERSTANDING=ai AND an AI key is set; otherwise every turn uses the rules
    understanding: isAIFirstEnabled() ? (set("XAI_API_KEY") || set("OPENAI_API_KEY") ? "ai" : "ai (no key: rules only)") : "rules",
    eventConfig: process.env.EVENT_CONFIG || null,
  });
}
