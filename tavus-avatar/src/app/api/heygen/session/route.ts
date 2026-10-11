import { NextResponse } from "next/server";
import { createLiveAvatarSession, stopLiveAvatarSession } from "@/lib/liveavatar-api";

export async function POST() {
  try {
    const session = await createLiveAvatarSession();
    return NextResponse.json(session, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error: any) {
    console.error("[api/heygen/session] Error creating session:", error);
    return NextResponse.json(
      { error: error.message || "Failed to create HeyGen LiveAvatar session." },
      { status: 500 }
    );
  }
}

export async function DELETE(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const { sessionToken } = body;
    if (sessionToken) {
      await stopLiveAvatarSession(sessionToken);
    }
    return NextResponse.json({ ok: true });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Failed to stop session." },
      { status: 500 }
    );
  }
}
