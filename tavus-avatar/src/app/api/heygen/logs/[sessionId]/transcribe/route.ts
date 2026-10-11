import { NextResponse } from "next/server";
import { getHeygenAudio } from "@/lib/heygen-logger";
import { processAndSaveCallTranscription } from "@/lib/transcription-service";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const { sessionId } = await params;
    if (!sessionId) {
      return NextResponse.json({ error: "Missing sessionId" }, { status: 400 });
    }

    const audioBuffer = getHeygenAudio(sessionId);
    if (!audioBuffer) {
      return NextResponse.json(
        { error: `No audio recording found for session ${sessionId} in logs-heygen/` },
        { status: 404 }
      );
    }

    const result = await processAndSaveCallTranscription(sessionId, audioBuffer);

    return NextResponse.json({
      success: true,
      sessionId,
      turnsCount: result.turnsCount,
      transcript: result.transcript,
    });
  } catch (error: any) {
    console.error("[api/heygen/logs/transcribe] Error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to transcribe audio" },
      { status: 500 }
    );
  }
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  return POST(request, { params });
}
