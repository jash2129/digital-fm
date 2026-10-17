import { NextResponse } from "next/server";
import { readdirSync, statSync, existsSync } from "fs";
import { resolve } from "path";
import { getHeygenLogsDir, getHeygenTranscript } from "@/lib/heygen-logger";

export async function GET() {
  try {
    const logsDir = getHeygenLogsDir();
    if (!existsSync(logsDir)) {
      return NextResponse.json({ sessions: [] });
    }

    const files = readdirSync(logsDir);
    const jsonFiles = files.filter((f) => f.endsWith(".json"));

    const sessions = jsonFiles
      .map((fileName) => {
        const sessionId = fileName.replace(/\.json$/, "");
        const filePath = resolve(logsDir, fileName);
        const stats = statSync(filePath);
        const webmPath = resolve(logsDir, `${sessionId}.webm`);
        const hasAudio = existsSync(webmPath);
        const audioSize = hasAudio ? statSync(webmPath).size : 0;

        let log = null;
        try {
          log = getHeygenTranscript(sessionId);
        } catch {
          // ignore parsing error
        }

        return {
          sessionId,
          lastModified: stats.mtime.toISOString(),
          durationSeconds: log?.durationSeconds || 0,
          turnsCount: log?.transcript?.length || 0,
          bargeInsCount: log?.bargeIns?.length || 0,
          hasAudio,
          audioSizeBytes: audioSize,
          avatarName: log?.avatarName || "Max (Finance Manager)",
          status: log?.status || "completed",
        };
      })
      .sort((a, b) => new Date(b.lastModified).getTime() - new Date(a.lastModified).getTime());

    return NextResponse.json({ sessions });
  } catch (error: any) {
    console.error("[api/heygen/logs] Failed to list call logs:", error);
    return NextResponse.json({ error: error.message || "Failed to list logs" }, { status: 500 });
  }
}
