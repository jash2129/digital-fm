import { NextResponse } from "next/server";
import { saveHeygenTranscript, getHeygenTranscript, type HeygenCallLog } from "@/lib/heygen-logger";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const { sessionId } = await params;
    if (!sessionId) {
      return NextResponse.json({ error: "Missing session ID" }, { status: 400 });
    }

    const body = await request.json();
    const logData: HeygenCallLog = {
      sessionId,
      engine: "heygen-grok",
      avatarId: body.avatarId || "liveavatar",
      avatarName: body.avatarName || "Max (Finance Manager)",
      startTime: body.startTime || new Date().toISOString(),
      endTime: body.endTime || new Date().toISOString(),
      durationSeconds: body.durationSeconds || null,
      status: body.status || "completed",
      productsCovered: body.productsCovered || [],
      finalDailyRate: body.finalDailyRate ?? null,
      transcript: body.transcript || [],
    };

    saveHeygenTranscript(logData);

    return NextResponse.json({ success: true, sessionId, savedTo: `logs-heygen/${sessionId}.json` });
  } catch (error: any) {
    console.error("[api/heygen/logs] Error saving transcript:", error);
    return NextResponse.json({ error: error.message || "Failed to save transcript" }, { status: 500 });
  }
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const { sessionId } = await params;
    const log = getHeygenTranscript(sessionId);
    if (!log) {
      return NextResponse.json({ error: "Log not found in logs-heygen" }, { status: 404 });
    }
    return NextResponse.json(log);
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Internal server error" }, { status: 500 });
  }
}
