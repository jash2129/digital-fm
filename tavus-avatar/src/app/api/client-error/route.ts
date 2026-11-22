import { NextResponse } from "next/server";
import { reportError } from "@/lib/error-report";

// The call screen reports its own errors here (window error / unhandled rejection), so they reach the
// same reporter as server errors. Behind the DEMO_API_TOKEN gate like every /api route.
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    message?: unknown;
    stack?: unknown;
    where?: unknown;
    sessionId?: unknown;
    kind?: unknown;
  };
  const str = (v: unknown, n: number) => (typeof v === "string" ? v.slice(0, n) : undefined);
  const error = new Error(str(body.message, 1000) || "client error (no message)");
  error.name = "ClientError";
  const stack = str(body.stack, 4000);
  if (stack) error.stack = stack;
  await reportError(error, {
    source: "client",
    where: str(body.where, 200) || "call screen",
    sessionId: str(body.sessionId, 100),
    extra: { kind: str(body.kind, 40) },
  });
  return NextResponse.json({ ok: true });
}
