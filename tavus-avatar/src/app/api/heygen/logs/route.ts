import { NextResponse } from "next/server";
import { listCallLogs } from "@/lib/call-log-store";

// Every call the Inspector can open: log files, plus Upstash when it is set up (Vercel)
export async function GET() {
  try {
    return NextResponse.json({ sessions: await listCallLogs() });
  } catch (error: unknown) {
    console.error("[api/heygen/logs] Failed to list call logs:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to list logs" }, { status: 500 });
  }
}
