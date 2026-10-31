import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { processControllerTurn, resetCallState, getOrCreateCallState } from "./beat-controller";
import { DEFAULT_DEAL_CONFIG } from "./deal-config";
import { LEAD_IN_NO, DEFER_LINE, HANDOFF_LINE, OUT_OF_SCRIPT_LINE } from "./max-lines";
import { shouldCutMaxOff } from "../components/liveavatar-demo";
import { generateCustomerResponse, type CustomerPersona } from "./customer-simulator";

describe("Two-Agent Automated Call Testing (Agent 1 Max vs Agent 2 Customer Simulator)", () => {
  // Helper to run a multi-turn call simulation between Agent 1 and Agent 2
  async function runSimulatedCall(persona: CustomerPersona, maxTurns: number = 6) {
    const sessionId = `simulated_${persona}_${Date.now()}`;
    resetCallState(sessionId);

    const timingLogs: any[] = [];
    const bargeIns: any[] = [];
    const transcript: any[] = [];

    let lastMaxSpeech = "Can you hear and see me alright?";
    let isFinished = false;

    for (let turnIndex = 0; turnIndex < maxTurns; turnIndex++) {
      if (isFinished) break;

      const state = getOrCreateCallState(sessionId);
      const customerAgentReply = await generateCustomerResponse({
        persona,
        lastMaxSpeech,
        currentBeatId: state.current_beat,
        turnIndex,
      });

      const userSpeechEnd = Date.now();
      // Simulated VAD silence gap
      const finalTranscriptTime = userSpeechEnd + 65;

      // Agent 1 (Max) executes Controller
      const t0 = Date.now();
      const decision = await processControllerTurn(sessionId, customerAgentReply.spokenText, DEFAULT_DEAL_CONFIG);
      const controllerDecisionTime = Date.now();

      // Simulated WebRTC dispatch & synthesis buffer
      const speakSentTime = controllerDecisionTime + 15;
      const avatarAudioStartTime = speakSentTime + 120;

      lastMaxSpeech = decision.textToSpeak;
      if (decision.isScriptComplete || decision.beatType === "stop") {
        isFinished = true;
      }

      // Check barge-in if simulated
      let honored = false;
      if (customerAgentReply.isBargeIn && customerAgentReply.bargeInTrigger) {
        honored = shouldCutMaxOff(customerAgentReply.spokenText);
        bargeIns.push({
          timestamp: userSpeechEnd,
          spokenText: customerAgentReply.spokenText,
          avatarTextWhenInterrupted: decision.textToSpeak,
          honored,
          triggerWord: customerAgentReply.bargeInTrigger,
        });
      }

      timingLogs.push({
        turnId: turnIndex + 1,
        userInput: customerAgentReply.spokenText,
        avatarText: decision.textToSpeak,
        timestamps: {
          user_speech_end: userSpeechEnd,
          final_transcript: finalTranscriptTime,
          controller_decision: controllerDecisionTime,
          speak_sent: speakSentTime,
          avatar_audio_start: avatarAudioStartTime,
        },
        gaps: {
          transcription_gap_ms: finalTranscriptTime - userSpeechEnd,
          controller_gap_ms: controllerDecisionTime - finalTranscriptTime,
          speak_sent_gap_ms: speakSentTime - controllerDecisionTime,
          avatar_render_gap_ms: avatarAudioStartTime - speakSentTime,
          total_latency_ms: avatarAudioStartTime - userSpeechEnd,
        },
      });

      transcript.push(
        { role: "user", text: customerAgentReply.spokenText, timestamp: new Date(userSpeechEnd).toISOString() },
        { role: "assistant", text: decision.textToSpeak, timestamp: new Date(avatarAudioStartTime).toISOString() }
      );
    }

    // Save session log file to logs-heygen/
    const logData = {
      sessionId,
      engine: "heygen-automated-agent-sim",
      avatarId: "dexter-lawyer",
      avatarName: "Max (Finance Manager)",
      startTime: new Date().toISOString(),
      endTime: new Date().toISOString(),
      persona,
      durationSeconds: timingLogs.length * 4,
      status: "completed",
      transcript,
      timingLogs,
      bargeIns,
    };

    const outDir = path.resolve(process.cwd(), "logs-heygen");
    if (!fs.existsSync(outDir)) {
      fs.mkdirSync(outDir, { recursive: true });
    }
    const logFilePath = path.join(outDir, `${sessionId}.json`);
    fs.writeFileSync(logFilePath, JSON.stringify(logData, null, 2), "utf-8");

    return { sessionId, logFilePath, timingLogs, bargeIns, transcript };
  }

  it("Persona 1: Cooperative Buyer advances cleanly through script turns", async () => {
    const result = await runSimulatedCall("cooperative", 5);
    expect(result.timingLogs.length).toBe(5);

    // Turn 0: Stage 0 Rapport & Formal Greeting
    // Follow-up 7 D: the short opener asks the check-in; Max introduces himself on the way into Beat 1
    expect(result.timingLogs[0].avatarText).toContain("congratulations on your new vehicle");
    // Turn 1: Beat 1 Legal Disclosure
    expect(result.timingLogs[1].avatarText).toContain("this transaction is recorded audio and video");
    // Turn 2: Beat 2
    expect(result.timingLogs[2].avatarText).toContain("2026 Mazda CX five");
    // Median turn latency should be under 2.5s
    const medianLatency = result.timingLogs[Math.floor(result.timingLogs.length / 2)].gaps.total_latency_ms;
    expect(medianLatency).toBeLessThan(2500);
  });

  it("Persona 2: Price Skeptic triggers DEFER_LINE before Beat 22", async () => {
    const result = await runSimulatedCall("price_skeptic", 5);
    // After rapport & disclosure, asks price and triggers DEFER_LINE
    const priceTurn = result.timingLogs.find((t) => t.userInput.toLowerCase().includes("how much"));
    expect(priceTurn?.avatarText).toContain(DEFER_LINE);
  });

  it("Persona 3: Interrupter tests barge-in cutoffs and achieves 100% honor rate", async () => {
    const result = await runSimulatedCall("interrupter", 5);
    expect(result.bargeIns.length).toBeGreaterThan(0);
    const honoredAll = result.bargeIns.every((b) => b.honored === true);
    expect(honoredAll).toBe(true);
  });

  it("Persona 4: Objection Heavy executes LEAD_IN_NO on 1st No and never hands off", async () => {
    const result = await runSimulatedCall("objection_heavy", 5);
    // 1st No -> LEAD_IN_NO
    const firstNoTurn = result.timingLogs.find((t) => t.userInput.toLowerCase().includes("no"));
    expect(firstNoTurn?.avatarText).toContain(LEAD_IN_NO);
    // This persona's Nos land on Beat 1 (recording disclosure): a second No withholds consent and
    // ends the session. Human escalation was removed, so no turn may ever offer a handoff.
    const lastTurn = result.timingLogs[result.timingLogs.length - 1];
    expect(lastTurn.avatarText).toBe("I understand. I'll end this session now.");
    expect(result.timingLogs.some((t) => t.avatarText.includes(HANDOFF_LINE))).toBe(false);
  });

  it("Persona 5: Off-Script intercepts financial questions and defers without quoting rates", async () => {
    const result = await runSimulatedCall("off_script", 3);
    // When asked about interest rate, Max should not quote percentages or APR
    const turnWithRate = result.timingLogs.find((t) => t.userInput.includes("interest rate"));
    if (turnWithRate) {
      expect(turnWithRate.avatarText).toContain(OUT_OF_SCRIPT_LINE);
      expect(turnWithRate.avatarText).not.toContain("%");
      expect(turnWithRate.avatarText).not.toContain("APR");
    }
  });

  it("Conversational Robustness: Evaluates compound preset variations ('Yeah, yeah, okay, go on') as progression", async () => {
    const { classifyCustomerInputRuleBased } = await import("./beat-controller");
    const compoundAffirmations = [
      "Yeah, yeah, okay, go on",
      "yeah go on",
      "ok sure go ahead",
      "sounds good to me",
      "yep definitely carry on",
      "alright continue",
      "yes I did that",
    ];

    for (const phrase of compoundAffirmations) {
      const classification = classifyCustomerInputRuleBased(phrase, 2);
      expect(classification.intent).toBe("agree");
    }
  });
});
