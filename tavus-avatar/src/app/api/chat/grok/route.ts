import { NextResponse } from "next/server";
import { processClientTurn, commitTurn, repromptText } from "@/lib/beat-controller";
import { DEFAULT_DEAL_CONFIG } from "@/lib/deal-config";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { messages = [], sessionId = "live_session", dealConfig = DEFAULT_DEAL_CONFIG, clientBeatId, turnId = 0 } = body;

    // Two-phase turns: the client reports whether Max's reply for turnId was actually heard
    if (body.action === "commit") {
      const result = commitTurn(sessionId, Number(body.turnId), Boolean(body.delivered), Number(body.spokenFraction) || 0);
      return NextResponse.json(result);
    }

    // Dead-man switch / silence watchdog: something to say when the line has gone quiet
    if (body.action === "reprompt") {
      const kind = ["resume", "still_with_me", "clarify"].includes(body.kind) ? body.kind : "resume";
      return NextResponse.json({ text: repromptText(sessionId, kind), kind });
    }

    const latestUserMessage =
      [...messages].reverse().find((m: any) => m.role === "user")?.content || "";

    console.log(`[api/chat/grok] Processing turn for session "${sessionId}", user: "${latestUserMessage}", clientBeatId: ${clientBeatId}`);

    // Execute verbatim Beat Controller (LLM only classifies intent, words come strictly from script & max-lines)
    const decision = await processClientTurn(sessionId, latestUserMessage, Number(turnId), dealConfig);

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
      clientBeatId,
      // classifierMs, controllerMs, usedLLM, classifierTimedOut, intent, beatBefore, beatAfter
      metrics: decision.metrics,
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
