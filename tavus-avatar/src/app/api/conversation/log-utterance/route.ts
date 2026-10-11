import { NextResponse } from "next/server";
import { appendUtterance } from "@/lib/call-logger";

export async function POST(request: Request) {
  try {
    const { conversationId, role, text } = await request.json();
    if (!conversationId || !role || !text) {
      return NextResponse.json({ error: "Missing required fields." }, { status: 400 });
    }

    appendUtterance(conversationId, role, text);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      { status: 500 },
    );
  }
}
