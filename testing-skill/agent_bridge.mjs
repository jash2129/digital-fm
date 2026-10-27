/**
 * Agent Bridge (Node/TSX)
 * Persistent line-delimited worker connecting the Python testing framework
 * directly to the actual Max BeatController in src/lib/beat-controller.ts.
 */

import readline from "readline";
import { processControllerTurn, resetCallState } from "../tavus-avatar/src/lib/beat-controller.js";
import { DEFAULT_DEAL_CONFIG } from "../tavus-avatar/src/lib/deal-config.js";

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false
});

rl.on("line", async (line) => {
  line = line.trim();
  if (!line) return;
  try {
    const payload = JSON.parse(line);
    const { action, sessionId = "test_bridge_session", userTranscript = "", reset = false } = payload;

    if (reset) {
      resetCallState(sessionId);
    }

    if (action === "turn") {
      const startMs = Date.now();
      const decision = await processControllerTurn(sessionId, userTranscript, DEFAULT_DEAL_CONFIG);
      const latencyMs = Date.now() - startMs;

      // Map beat number to approved script stage
      let stageId = "GREETING";
      const b = decision.beatId;
      if (b === 0) stageId = "GREETING";
      else if (b === 1) stageId = "DISCLOSURE";
      else if (b >= 2 && b <= 5) stageId = "QUALIFYING";
      else if (b >= 6 && b <= 7) stageId = "PRESENTATION_WARRANTY";
      else if (b >= 8 && b <= 15) stageId = "PRESENTATION_WEAR_TEAR";
      else if (b >= 16 && b <= 22) stageId = "PRODUCT_OFFER";
      else if (b === 23) stageId = "NEGOTIATION";
      else if (b === 24) stageId = "CLOSE";
      else if (b >= 25) stageId = "VERIFICATION";
      if (decision.intent === "no" || decision.intent === "price_ask" || decision.intent === "pause_request") {
        if (b >= 16 && b < 24) stageId = "NEGOTIATION";
      }

      console.log(JSON.stringify({
        success: true,
        textToSpeak: decision.textToSpeak,
        beatId: decision.beatId,
        beatType: decision.beatType,
        intent: decision.intent,
        stageId,
        toolCalls: decision.toolCalls,
        isScriptComplete: decision.isScriptComplete,
        latencyMs
      }));
    } else {
      console.log(JSON.stringify({ success: true, message: "ready" }));
    }
  } catch (err) {
    console.log(JSON.stringify({ success: false, error: String(err) }));
  }
});
