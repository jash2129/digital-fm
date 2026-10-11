import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { resolve } from "path";
import { NextResponse } from "next/server";

function getLogsDir() {
  const logsDir = resolve(process.cwd(), "logs");
  if (!existsSync(logsDir)) {
    mkdirSync(logsDir, { recursive: true });
  }
  return logsDir;
}

function getAudioFilePath(conversationId: string) {
  return resolve(getLogsDir(), `${conversationId}.webm`);
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ conversationId: string }> }
) {
  try {
    const { conversationId } = await params;
    if (!conversationId) {
      return NextResponse.json({ error: "Missing conversation ID" }, { status: 400 });
    }

    const arrayBuffer = await request.arrayBuffer();
    if (!arrayBuffer || arrayBuffer.byteLength === 0) {
      return NextResponse.json({ error: "Empty audio payload" }, { status: 400 });
    }

    const buffer = Buffer.from(arrayBuffer);
    const audioPath = getAudioFilePath(conversationId);
    writeFileSync(audioPath, buffer);

    console.log(`[audio-route] Saved ${buffer.byteLength} bytes of call audio for ${conversationId}`);
    return NextResponse.json({ success: true, conversationId, size: buffer.byteLength });
  } catch (error) {
    console.error("[audio-route] Error saving call audio:", error);
    return NextResponse.json({ error: "Failed to save call audio" }, { status: 500 });
  }
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ conversationId: string }> }
) {
  try {
    const { conversationId } = await params;
    const audioPath = getAudioFilePath(conversationId);

    if (!existsSync(audioPath)) {
      return NextResponse.json({ error: "Audio recording not found for this call" }, { status: 404 });
    }

    const fileBuffer = readFileSync(audioPath);
    return new NextResponse(fileBuffer, {
      status: 200,
      headers: {
        "Content-Type": "audio/webm",
        "Content-Disposition": `inline; filename="${conversationId}.webm"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("[audio-route] Error reading call audio:", error);
    return NextResponse.json({ error: "Failed to retrieve call audio" }, { status: 500 });
  }
}
