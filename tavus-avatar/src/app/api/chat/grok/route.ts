import { NextResponse } from "next/server";
import { processClientTurn, commitTurn, repromptText } from "@/lib/beat-controller";
import { DEFAULT_DEAL_CONFIG } from "@/lib/deal-config";
import { loadSession, saveSession } from "@/lib/session-store";

export async function POST(request: Request) {
  // Server-clock stage timing; the client measures network and HeyGen on its own clock
  const routeStart = Date.now();
  try {
    const body = await request.json();

    // Called once at session start so the first real turn does not pay for a cold route/module load
    if (body.action === "warmup") {
      return NextResponse.json({ ok: true, routeMs: Date.now() - routeStart });
    }
    const { messages = [], sessionId = "live_session", dealConfig = DEFAULT_DEAL_CONFIG, clientBeatId, turnId = 0 } = body;

    // Serverless hosts: this call's state comes from the shared store and goes back after the turn
    // (a no-op on one long-running server, see session-store.ts)
    await loadSession(sessionId);

    // Two-phase turns: the client reports whether Max's reply for turnId was actually heard
    if (body.action === "commit") {
      const result = commitTurn(sessionId, Number(body.turnId), Boolean(body.delivered), Number(body.spokenFraction) || 0);
      await saveSession(sessionId);
      return NextResponse.json(result);
    }

    // Dead-man switch / silence watchdog: something to say when the line has gone quiet
    if (body.action === "reprompt") {
      const kind = ["resume", "still_with_me", "clarify"].includes(body.kind) ? body.kind : "resume";
      const text = repromptText(sessionId, kind);
      await saveSession(sessionId);
      return NextResponse.json({ text, kind });
    }

    const latestUserMessage =
      [...messages].reverse().find((m: any) => m.role === "user")?.content || "";

    console.log(`[api/chat/grok] Processing turn for session "${sessionId}", user: "${latestUserMessage}", clientBeatId: ${clientBeatId}`);

    // Execute verbatim Beat Controller (LLM only classifies intent, words come strictly from script & max-lines)
    const decision = await processClientTurn(sessionId, latestUserMessage, Number(turnId), dealConfig);
    await saveSession(sessionId);

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
      timing: { routeStart, routeEnd: Date.now() },
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
