import { NextResponse } from "next/server";
import { sendCallLog } from "@/lib/call-log-webhook";

// Called by the app once a call has ended and its log and recording are saved: sends the call to
// the call log sheet (docs/MAKE-CALL-LOG.md). The webhook URL and secret stay on the server.
export async function POST(request: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  if (!sessionId) return NextResponse.json({ error: "Missing session ID" }, { status: 400 });

  // The address testers actually used (ngrok / Render), so the sheet's Inspector link opens
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  const proto = request.headers.get("x-forwarded-proto") ?? new URL(request.url).protocol.replace(":", "");
  const origin = host ? `${proto}://${host}` : new URL(request.url).origin;

  const result = await sendCallLog(sessionId, origin);
  if (result.sent) console.log(`[call-log] ${sessionId} sent to the call log sheet`);
  else console.warn(`[call-log] ${sessionId} not sent: ${result.reason}`);
  return NextResponse.json(result);
}
