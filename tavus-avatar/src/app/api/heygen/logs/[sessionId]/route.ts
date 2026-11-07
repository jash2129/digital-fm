import { NextResponse } from "next/server";
import type { HeygenCallLog } from "@/lib/heygen-logger";
import { loadCallLog, saveCallLog } from "@/lib/call-log-store";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const { sessionId } = await params;
    if (!sessionId) {
      return NextResponse.json({ error: "Missing session ID" }, { status: 400 });
    }

    let body: any = {};
    try {
      const text = await request.text();
      if (text && text.trim()) {
        body = JSON.parse(text);
      }
    } catch {
      body = {};
    }
    // Merge with what is saved so far (shared via Upstash on Vercel, where each request is a new server)
    const existingLog = (await loadCallLog(sessionId)) || ({} as any);
    const logData: HeygenCallLog = {
      sessionId,
      engine: "heygen-grok",
      avatarId: body.avatarId || existingLog.avatarId || "liveavatar",
      avatarName: body.avatarName || existingLog.avatarName || "Max (Finance Manager)",
      startTime: body.startTime || existingLog.startTime || new Date().toISOString(),
      endTime: body.endTime || existingLog.endTime || new Date().toISOString(),
      durationSeconds: body.durationSeconds || existingLog.durationSeconds || null,
      status: body.status || existingLog.status || "completed",
      productsCovered: body.productsCovered || existingLog.productsCovered || [],
      finalDailyRate: body.finalDailyRate ?? existingLog.finalDailyRate ?? null,
      transcript: body.transcript || existingLog.transcript || [],
      timingLogs: body.timingLogs || existingLog.timingLogs || [],
      bargeIns: body.bargeIns || existingLog.bargeIns || [],
      turnLogs: body.turnLogs || existingLog.turnLogs || [],
      ...(existingLog.recordingUrl ? { recordingUrl: existingLog.recordingUrl } : {}),
    };

    await saveCallLog(logData);

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
    const log = await loadCallLog(sessionId);
    if (!log) {
      return NextResponse.json({ error: "Log not found in logs-heygen" }, { status: 404 });
    }
    return NextResponse.json(log);
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Internal server error" }, { status: 500 });
  }
}
