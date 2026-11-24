import { NextResponse } from "next/server";
import { runLearning } from "@/lib/learning-report";

// Vercel cron (vercel.json, once a day): learns from the calls since the last run. Reached with
// "Authorization: Bearer <CRON_SECRET>" (src/proxy.ts) or the usual DEMO_API_TOKEN login.
export const maxDuration = 60;

export async function GET() {
  const report = await runLearning();
  return NextResponse.json({ ok: true, calls: report.newCalls, actions: report.actions, findings: report.findings });
}
