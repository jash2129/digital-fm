import { NextResponse } from "next/server";
import { getHeygenTranscript } from "@/lib/heygen-logger";
import { analyzeCallExperience } from "@/lib/call-experience-analyzer";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const { sessionId } = await params;
    const log = getHeygenTranscript(sessionId);
    if (!log) {
      return NextResponse.json({ error: "Session log not found" }, { status: 404 });
    }

    const analysis = analyzeCallExperience(log);
    return NextResponse.json(analysis);
  } catch (error: any) {
    console.error("[api/heygen/logs/analysis] Analysis error:", error);
    return NextResponse.json({ error: error.message || "Failed to analyze call" }, { status: 500 });
  }
}
