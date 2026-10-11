import { NextResponse } from "next/server";
import { processControllerTurn } from "@/lib/beat-controller";
import { DEFAULT_DEAL_CONFIG } from "@/lib/deal-config";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { messages = [], sessionId = "live_session", dealConfig = DEFAULT_DEAL_CONFIG } = body;

    const latestUserMessage =
      [...messages].reverse().find((m: any) => m.role === "user")?.content || "";

    console.log(`[api/chat/grok] Processing turn for session "${sessionId}", user: "${latestUserMessage}"`);

    // Execute verbatim Beat Controller (LLM only classifies intent, words come strictly from script & max-lines)
    const decision = await processControllerTurn(sessionId, latestUserMessage, dealConfig);

    console.log(
      `[api/chat/grok] Decision -> Beat ${decision.beatId} (${decision.beatType}), Intent: ${decision.intent}`
    );

    return NextResponse.json({
      text: decision.textToSpeak,
      toolCalls: decision.toolCalls,
      role: "assistant",
      currentBeatId: decision.beatId,
      beatType: decision.beatType,
      intent: decision.intent,
      isScriptComplete: decision.isScriptComplete,
    });
  } catch (error: any) {
    console.error("[api/chat/grok error, returning safe fallback]:", error);
    return NextResponse.json({
      text: "Sorry, I didn't catch that.",
      toolCalls: [],
      role: "assistant",
      currentBeatId: 1,
      beatType: "wait",
      intent: "garbled",
      isScriptComplete: false,
    });
  }
}
