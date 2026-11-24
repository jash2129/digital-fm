import { NextResponse } from "next/server";
import { sendCallLog } from "@/lib/call-log-webhook";
import type { HeygenCallLog } from "@/lib/heygen-logger";
import { loadSession } from "@/lib/session-store";

// The AI review and the upload to Make can take a while; Vercel's free plan allows up to 60 s
export const maxDuration = 60;

// Called by the app once a call has ended: sends the call to the call log sheet
// (docs/MAKE-CALL-LOG.md). The webhook URL and secret stay on the server.
// The app sends the log and recording as multipart form data ("log" JSON, "recording" file), so this
// works on serverless hosts with no lasting disk. With no body it reads the files the app saved.
export async function POST(request: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  if (!sessionId) return NextResponse.json({ error: "Missing session ID" }, { status: 400 });

  // The address testers actually used (ngrok / Vercel / Render), so the sheet's Inspector link opens
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  const proto = request.headers.get("x-forwarded-proto") ?? new URL(request.url).protocol.replace(":", "");
  const origin = host ? `${proto}://${host}` : new URL(request.url).origin;

  let log: HeygenCallLog | null = null;
  let recording: Buffer | null = null;
  if (request.headers.get("content-type")?.includes("multipart/form-data")) {
    try {
      const form = await request.formData();
      const rawLog = form.get("log");
      if (typeof rawLog === "string") log = { ...JSON.parse(rawLog), sessionId } as HeygenCallLog;
      const file = form.get("recording");
      if (file && typeof file !== "string" && file.size > 0) recording = Buffer.from(await file.arrayBuffer());
    } catch (err) {
      console.warn("[call-log] could not read the sent log/recording, falling back to saved files:", err);
    }
  }

  // How far the call got and how it ended live in the call state (shared store on serverless hosts)
  await loadSession(sessionId);
  const result = await sendCallLog(sessionId, origin, { log, recording });
  if (result.sent) console.log(`[call-log] ${sessionId} sent to the call log sheet`);
  else console.warn(`[call-log] ${sessionId} not sent: ${result.reason}`);
  return NextResponse.json(result);
}
