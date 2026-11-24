import { NextResponse } from "next/server";
import { latestReport, runLearning } from "@/lib/learning-report";
import { loadSettings, resetSettings } from "@/lib/learned-settings";
import { loadRephrasings } from "@/lib/learned-phrasing";

// What Max has learned (/learning page): the latest nightly report, the timing he tuned, and the
// rewordings TXM coached. POST {action:"run"} builds a report now from the calls since the last one;
// POST {action:"reset-settings"} puts the timing back to its defaults. Behind DEMO_API_TOKEN.
export async function GET() {
  const [report, settings, rephrasings] = await Promise.all([latestReport(), loadSettings(true), loadRephrasings(true)]);
  return NextResponse.json({ report, settings, rephrasings });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  if (body.action === "run") return NextResponse.json({ report: await runLearning() });
  if (body.action === "reset-settings") {
    await resetSettings();
    return NextResponse.json({ settings: await loadSettings(true) });
  }
  return NextResponse.json({ error: "action must be run or reset-settings" }, { status: 400 });
}
