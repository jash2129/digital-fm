import { NextResponse } from "next/server";
import { saveHeygenAudio, getHeygenAudio } from "@/lib/heygen-logger";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const { sessionId } = await params;
    if (!sessionId) {
      return NextResponse.json({ error: "Missing session ID" }, { status: 400 });
    }

    const arrayBuffer = await request.arrayBuffer();
    if (!arrayBuffer || arrayBuffer.byteLength === 0) {
      return NextResponse.json({ error: "Empty audio payload" }, { status: 400 });
    }

    const buffer = Buffer.from(arrayBuffer);
    saveHeygenAudio(sessionId, buffer);
    console.log(`[heygen-audio-route] Saved ${buffer.byteLength} bytes of call audio for ${sessionId}`);

    // Asynchronously or synchronously transcribe audio using OpenAI Whisper + Grok diarization
    let transcriptionResult: any = null;
    try {
      const { processAndSaveCallTranscription } = await import("@/lib/transcription-service");
      transcriptionResult = await processAndSaveCallTranscription(sessionId, buffer);
    } catch (transcribeErr: any) {
      console.error("[heygen-audio-route] Background transcription failed:", transcribeErr);
    }

    return NextResponse.json({
      success: true,
      sessionId,
      size: buffer.byteLength,
      savedTo: `logs-heygen/${sessionId}.webm`,
      transcribed: transcriptionResult?.success || false,
      turnsCount: transcriptionResult?.turnsCount || 0,
    });
  } catch (error: any) {
    console.error("[heygen-audio-route] Error saving call audio:", error);
    return NextResponse.json({ error: error.message || "Failed to save call audio" }, { status: 500 });
  }
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const { sessionId } = await params;
    const buffer = getHeygenAudio(sessionId);

    if (!buffer) {
      return NextResponse.json({ error: "Audio recording not found in logs-heygen" }, { status: 404 });
    }

    return new NextResponse(buffer as any, {
      status: 200,
      headers: {
        "Content-Type": "audio/webm",
        "Content-Length": buffer.length.toString(),
        "Content-Disposition": `inline; filename="heygen-${sessionId}.webm"`,
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Internal server error" }, { status: 500 });
  }
}
