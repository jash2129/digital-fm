import { describe, it, expect, beforeEach } from "vitest";
import {
  processControllerTurn,
  getOrCreateCallState,
  resetCallState,
  BEATS,
  renderBeatText,
  getFullBeatUtterance,
} from "./beat-controller";
import { DEFAULT_DEAL_CONFIG } from "./deal-config";
import {
  LEAD_IN_NO,
  GARBLED_LINE,
  DEFER_LINE,
  OUT_OF_SCRIPT_LINE,
  HANDOFF_LINE,
  AI_DISCLOSURE_LINE,
  STEP_0_GREETING,
} from "./max-lines";

describe("Part 3 — Beat Controller Unit & Simulation Tests", () => {
  const sessionId = "test_controller_session";

  beforeEach(() => {
    resetCallState(sessionId);
  });

  describe("Unit Constraints", () => {
    it("Step 0 begins with greeting and transitions to Beat 1", async () => {
      const decision1 = await processControllerTurn(sessionId, "Yes, I can hear and see you fine");
      expect(decision1.beatId).toBe(1);
      expect(decision1.state.step0_completed).toBe(true);
      expect(decision1.textToSpeak).toContain("Before I start I just want to let you know this transaction is recorded audio and video");
    });

    it("pointer never moves backward", async () => {
      await processControllerTurn(sessionId, "Yes, I can hear you"); // Beat 1
      let previousBeat = 1;

      const userInputs = ["sounds good", "yes", "okay", "tell me more", "yeah"];
      for (const input of userInputs) {
        const decision = await processControllerTurn(sessionId, input, DEFAULT_DEAL_CONFIG, {
          intent: "agree",
          topic_beat_ids: [],
        });
        expect(decision.beatId).toBeGreaterThanOrEqual(previousBeat);
        previousBeat = decision.beatId;
      }
    });

    it("delivered_beats never repeats except via rules in 3.5 (no rule or repeat request)", async () => {
      await processControllerTurn(sessionId, "Yes"); // Beat 1
      const state = getOrCreateCallState(sessionId);
      expect(state.delivered_beats).toEqual([1]);

      // Turn: Agree -> Beat 2
      await processControllerTurn(sessionId, "yes", DEFAULT_DEAL_CONFIG, {
        intent: "agree",
        topic_beat_ids: [],
      });
      expect(state.delivered_beats).toEqual([1, 2]);

      // Turn: Repeat request -> Re-speaks Beat 2 without adding duplicate 2 to delivered_beats
      const repeatDecision = await processControllerTurn(sessionId, "can you repeat that?", DEFAULT_DEAL_CONFIG, {
        intent: "repeat_request",
        topic_beat_ids: [],
      });
      expect(repeatDecision.beatId).toBe(2);
      expect(state.delivered_beats).toEqual([1, 2]); // Not duplicated

      // Turn: No -> Re-speaks Beat 2 with LEAD_IN_NO without adding duplicate 2 to delivered_beats
      const noDecision = await processControllerTurn(sessionId, "no", DEFAULT_DEAL_CONFIG, {
        intent: "no",
        topic_beat_ids: [],
      });
      expect(noDecision.textToSpeak).toContain(LEAD_IN_NO);
      expect(state.delivered_beats).toEqual([1, 2]); // Still strictly [1, 2]
    });

    it("two beats are never sent in one speak call", async () => {
      await processControllerTurn(sessionId, "Yes"); // Beat 1
      for (let i = 2; i <= 22; i++) {
        const decision = await processControllerTurn(sessionId, "yes", DEFAULT_DEAL_CONFIG, {
          intent: "agree",
          topic_beat_ids: [],
        });

        // Verify that the text corresponds only to beat i (plus its check_in), not containing beat i+1
        const currentBeatText = getFullBeatUtterance(BEATS.find((b) => b.id === i)!, DEFAULT_DEAL_CONFIG);
        expect(decision.textToSpeak).toBe(currentBeatText);

        if (i < 22) {
          const nextBeat = BEATS.find((b) => b.id === i + 1)!;
          const nextBeatSample = nextBeat.text.substring(1, 30);
          expect(decision.textToSpeak).not.toContain(nextBeatSample);
        }
      }
    });
  });

  describe("Simulated Call Tests Covering Every Intent Row (3.5 Matrix)", () => {
    it("simulates full intent coverage and prints dialogue sequence", async () => {
      console.log("\n========================================================");
      console.log("SIMULATED CALL: TESTING ALL 11 INTENT ROWS IN CONTROLLER");
      console.log("========================================================");

      const simulationScript: Array<{
        stepName: string;
        userInput: string;
        intent: any;
        topic_beat_ids: number[];
        expectedKeyword: string;
      }> = [
        {
          stepName: "Step 0 Tech Check",
          userInput: "Yes, loud and clear!",
          intent: "agree",
          topic_beat_ids: [],
          expectedKeyword: "Before I start",
        },
        {
          stepName: "1. agree -> advances to Beat 2",
          userInput: "Sounds good, go ahead",
          intent: "agree",
          topic_beat_ids: [],
          expectedKeyword: "2026 Mazda CX five",
        },
        {
          stepName: "2. repeat_request -> repeats Beat 2 verbatim",
          userInput: "Sorry, could you repeat that?",
          intent: "repeat_request",
          topic_beat_ids: [],
          expectedKeyword: "have you got the chance to drive",
        },
        {
          stepName: "3. no (1st time) -> LEAD_IN_NO + Beat 2",
          userInput: "No, not really",
          intent: "no",
          topic_beat_ids: [],
          expectedKeyword: LEAD_IN_NO,
        },
        {
          stepName: "4. agree -> advances to Beat 3",
          userInput: "Okay, yes, I get it now",
          intent: "agree",
          topic_beat_ids: [],
          expectedKeyword: "futures and builts and whistles",
        },
        {
          stepName: "5. garbled -> GARBLED_LINE once, listens again",
          userInput: "*inaudible mumble*",
          intent: "garbled",
          topic_beat_ids: [],
          expectedKeyword: GARBLED_LINE,
        },
        {
          stepName: "6. price_ask (before Beat 22) -> DEFER_LINE + next beat",
          userInput: "How much is this going to cost me?",
          intent: "price_ask",
          topic_beat_ids: [],
          expectedKeyword: DEFER_LINE,
        },
        {
          stepName: "7. question_out_of_script -> OUT_OF_SCRIPT_LINE + next beat",
          userInput: "What's my interest rate on the loan?",
          intent: "question_out_of_script",
          topic_beat_ids: [],
          expectedKeyword: OUT_OF_SCRIPT_LINE,
        },
        {
          stepName: "8. question_in_script -> speaks topic beat verbatim + current check-in",
          userInput: "What does the warranty actually cover?",
          intent: "question_in_script",
          topic_beat_ids: [6],
          expectedKeyword: "Base limited warranty",
        },
        {
          stepName: "9. ai_question -> AI_DISCLOSURE_LINE + next beat",
          userInput: "Wait, are you an AI or a real human?",
          intent: "ai_question",
          topic_beat_ids: [],
          expectedKeyword: AI_DISCLOSURE_LINE,
        },
        {
          stepName: "10. restart_request -> does not reset pointer; repeats last beat",
          userInput: "Can we restart from the beginning?",
          intent: "restart_request",
          topic_beat_ids: [],
          expectedKeyword: "Mazda is like any other manufacturer",
        },
        {
          stepName: "11. other -> resumes with next beat",
          userInput: "The weather in Texas is crazy today",
          intent: "other",
          topic_beat_ids: [],
          expectedKeyword: "defect only",
        },
        {
          stepName: "12. human_request -> HANDOFF_LINE and stops",
          userInput: "I need to talk to a human manager right now",
          intent: "human_request",
          topic_beat_ids: [],
          expectedKeyword: HANDOFF_LINE,
        },
      ];

      for (const turn of simulationScript) {
        const decision = await processControllerTurn(
          sessionId,
          turn.userInput,
          DEFAULT_DEAL_CONFIG,
          {
            intent: turn.intent,
            topic_beat_ids: turn.topic_beat_ids,
          }
        );

        console.log(`\n[${turn.stepName}]`);
        console.log(`Customer: "${turn.userInput}"`);
        console.log(`Intent:   ${decision.intent}`);
        console.log(`Beat ID:  ${decision.beatId} (Type: ${decision.beatType})`);
        console.log(`Max Spoke: "${decision.textToSpeak.substring(0, 100)}..."`);

        expect(decision.textToSpeak).toContain(turn.expectedKeyword);
      }
    });

    it("two 'No's in a row triggers handoff", async () => {
      await processControllerTurn(sessionId, "Yes"); // Beat 1
      await processControllerTurn(sessionId, "Yes", DEFAULT_DEAL_CONFIG, { intent: "agree", topic_beat_ids: [] }); // Beat 2

      // First No
      const dec1 = await processControllerTurn(sessionId, "No", DEFAULT_DEAL_CONFIG, { intent: "no", topic_beat_ids: [] });
      expect(dec1.textToSpeak).toContain(LEAD_IN_NO);
      expect(dec1.state.no_count_in_a_row).toBe(1);
      expect(dec1.state.is_stopped).toBe(false);

      // Second No in a row
      const dec2 = await processControllerTurn(sessionId, "Still no", DEFAULT_DEAL_CONFIG, { intent: "no", topic_beat_ids: [] });
      expect(dec2.textToSpeak).toBe(HANDOFF_LINE);
      expect(dec2.state.no_count_in_a_row).toBe(2);
      expect(dec2.state.is_stopped).toBe(true);
      expect(dec2.beatType).toBe("stop");
    });

    it("completes script after Beat 22 with HANDOFF_LINE and onScriptComplete", async () => {
      await processControllerTurn(sessionId, "Yes"); // Beat 1

      // Fast forward to Beat 22
      const state = getOrCreateCallState(sessionId);
      state.current_beat = 21;
      state.delivered_beats = Array.from({ length: 21 }, (_, i) => i + 1);

      // Turn advancing to Beat 22
      const dec22 = await processControllerTurn(sessionId, "go ahead", DEFAULT_DEAL_CONFIG, {
        intent: "agree",
        topic_beat_ids: [],
      });
      expect(dec22.beatId).toBe(22);
      expect(dec22.textToSpeak).toContain("four dollars a day");

      // After Beat 22: agree
      const finalTurn = await processControllerTurn(sessionId, "makes sense", DEFAULT_DEAL_CONFIG, {
        intent: "agree",
        topic_beat_ids: [],
      });
      expect(finalTurn.textToSpeak).toBe(HANDOFF_LINE);
      expect(finalTurn.beatType).toBe("stop");
      expect(finalTurn.isScriptComplete).toBe(true);
      expect(finalTurn.state.is_stopped).toBe(true);
    });
  });
});
