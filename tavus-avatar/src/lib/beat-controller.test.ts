import { describe, it, expect, beforeEach } from "vitest";
import {
  processControllerTurn,
  getOrCreateCallState,
  resetCallState,
  BEATS,
  renderBeatText,
  getFullBeatUtterance,
  generateConstrainedOffScriptResponse,
} from "./beat-controller";
import { DEFAULT_DEAL_CONFIG } from "./deal-config";
import {
  LEAD_IN_NO,
  GARBLED_LINE,
  DEFER_LINE,
  OUT_OF_SCRIPT_LINE,
  HANDOFF_LINE,
  REPEATED_NO_LINE,
  SCRIPT_COMPLETE_LINE,
  AI_DISCLOSURE_LINE,
  STEP_0_GREETING,
  PAUSE_LINE,
  LISTENING_LINE,
  SLOW_DOWN_LINE,
  COMPLIMENT_LINE,
  IDENTITY_LINE,
  VEHICLE_DISCREPANCY_LINE,
  MANUFACTURER_VS_DEALER_LINE,
} from "./max-lines";
import { shouldCutMaxOff, isIncompleteUtterance } from "../components/liveavatar-demo";

describe("Part 3 — Beat Controller Unit & Simulation Tests", () => {
  const sessionId = "test_controller_session";

  beforeEach(() => {
    resetCallState(sessionId);
  });

  describe("Unit Constraints", () => {
    it("Step 0 begins with greeting, builds rapport, and transitions to Beat 1", async () => {
      // Turn 1: Tech check response -> builds human rapport
      const decision1 = await processControllerTurn(sessionId, "Yes, I can hear and see you fine");
      expect(decision1.beatId).toBe(0);
      expect(decision1.textToSpeak).toContain("great to connect with you");

      // Turn 2: Customer asks who Max is -> answers identity and continues rapport without prematurely rushing to Beat 1
      const qSessionId = `step0_q_${Date.now()}`;
      await processControllerTurn(qSessionId, "Yes");
      const idDecision = await processControllerTurn(qSessionId, "Wait, who are you?");
      expect(idDecision.beatId).toBe(0);
      expect(idDecision.state.step0_completed).toBe(false);
      expect(idDecision.textToSpeak).toContain("digital finance manager");

      // Customer asks if it's a sales call -> reassures directly without rushing to Beat 1
      const salesDecision = await processControllerTurn(qSessionId, "Is this a sales call?");
      expect(salesDecision.beatId).toBe(0);
      expect(salesDecision.state.step0_completed).toBe(false);
      expect(salesDecision.textToSpeak).toContain("coverage options with you before you sign");

      // Turn 3: Customer answers rapport question -> transitions to Beat 1 with disclosure
      const decision2 = await processControllerTurn(sessionId, "The team was great today");
      expect(decision2.beatId).toBe(1);
      expect(decision2.state.step0_completed).toBe(true);
      expect(decision2.textToSpeak).toContain("this transaction is recorded audio and video");
    });

    it("pointer never moves backward", async () => {
      await processControllerTurn(sessionId, "Yes, I can hear you");
      await processControllerTurn(sessionId, "Team was great"); // Beat 1
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
      await processControllerTurn(sessionId, "Yes");
      await processControllerTurn(sessionId, "Great"); // Beat 1
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
      await processControllerTurn(sessionId, "Yes");
      await processControllerTurn(sessionId, "Great"); // Beat 1
      for (let i = 2; i <= 22; i++) {
        const decision = await processControllerTurn(sessionId, "yes", DEFAULT_DEAL_CONFIG, {
          intent: "agree",
          topic_beat_ids: [],
        });

        // Verify that the text corresponds only to beat i (plus its check_in & optional bridge), not containing beat i+1
        const currentBeatText = getFullBeatUtterance(BEATS.find((b) => b.id === i)!, DEFAULT_DEAL_CONFIG);
        expect(decision.textToSpeak).toContain(currentBeatText);

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
          expectedKeyword: "great to connect with you",
        },
        {
          stepName: "Step 0 Rapport Response -> Beat 1",
          userInput: "Everything went smoothly today!",
          intent: "agree",
          topic_beat_ids: [],
          expectedKeyword: "recorded audio and video",
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
          expectedKeyword: "features, bells, and whistles",
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
          // Off-script and AI disclosure turns now hold the beat instead of skipping, so the pointer is still on Beat 4
          expectedKeyword: "understanding of the warranty",
        },
        {
          stepName: "11. other -> answers from the approved knowledge base, holds the beat",
          userInput: "Does the Texas heat really damage the car?",
          intent: "other",
          topic_beat_ids: [],
          expectedKeyword: "110 degrees",
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

    // Human escalation was removed by the client: a second No moves on instead of handing off
    it("two 'No's in a row moves on with REPEATED_NO_LINE, never a handoff", async () => {
      await processControllerTurn(sessionId, "Yes");
      await processControllerTurn(sessionId, "Great"); // Beat 1
      await processControllerTurn(sessionId, "Yes", DEFAULT_DEAL_CONFIG, { intent: "agree", topic_beat_ids: [] }); // Beat 2

      // First No
      const dec1 = await processControllerTurn(sessionId, "No", DEFAULT_DEAL_CONFIG, { intent: "no", topic_beat_ids: [] });
      expect(dec1.textToSpeak).toContain(LEAD_IN_NO);
      expect(dec1.state.no_count_in_a_row).toBe(1);
      expect(dec1.state.is_stopped).toBe(false);

      // Second No in a row
      const dec2 = await processControllerTurn(sessionId, "Still no", DEFAULT_DEAL_CONFIG, { intent: "no", topic_beat_ids: [] });
      expect(dec2.textToSpeak.startsWith(REPEATED_NO_LINE)).toBe(true);
      expect(dec2.textToSpeak).not.toContain(HANDOFF_LINE);
      expect(dec2.beatId).toBe(3);
      expect(dec2.state.no_count_in_a_row).toBe(0);
      expect(dec2.state.is_stopped).toBe(false);
      expect(dec2.toolCalls.some((t) => t.args.item === "escalate")).toBe(false);
    });

    it("completes script after Beat 25 with HANDOFF_LINE and onScriptComplete", async () => {
      await processControllerTurn(sessionId, "Yes");
      await processControllerTurn(sessionId, "Great"); // Beat 1

      // Fast forward to Beat 22
      const state = getOrCreateCallState(sessionId);
      state.step0_completed = true;
      state.current_beat = 21;
      state.delivered_beats = Array.from({ length: 21 }, (_, i) => i + 1);

      // Turn advancing to Beat 22
      const dec22 = await processControllerTurn(sessionId, "go ahead", DEFAULT_DEAL_CONFIG, {
        intent: "agree",
        topic_beat_ids: [],
      });
      expect(dec22.beatId).toBe(22);
      expect(dec22.textToSpeak).toContain("four dollars a day");

      // Beat 23 (Negotiation)
      const dec23 = await processControllerTurn(sessionId, "sounds good", DEFAULT_DEAL_CONFIG, {
        intent: "agree",
        topic_beat_ids: [],
      });
      expect(dec23.beatId).toBe(23);
      expect(dec23.textToSpeak).toContain("most value in");

      // Beat 24 (Close)
      const dec24 = await processControllerTurn(sessionId, "agree", DEFAULT_DEAL_CONFIG, {
        intent: "agree",
        topic_beat_ids: [],
      });
      expect(dec24.beatId).toBe(24);
      expect(dec24.textToSpeak).toContain("to confirm");

      // Beat 25 (Verification)
      const dec25 = await processControllerTurn(sessionId, "yes let's move forward", DEFAULT_DEAL_CONFIG, {
        intent: "agree",
        topic_beat_ids: [],
      });
      expect(dec25.beatId).toBe(25);
      expect(dec25.textToSpeak).toContain("verify your full legal name");

      // After Beat 25: Terminal Handoff
      const finalTurn = await processControllerTurn(sessionId, "Alex Smith 742 Evergreen Terrace", DEFAULT_DEAL_CONFIG, {
        intent: "agree",
        topic_beat_ids: [],
      });
      expect(finalTurn.textToSpeak).toBe(SCRIPT_COMPLETE_LINE);
      expect(finalTurn.beatType).toBe("stop");
      expect(finalTurn.isScriptComplete).toBe(true);
      expect(finalTurn.state.is_stopped).toBe(true);
    });

    it("enforces strict negative constraints on off-script responses (never quotes rates or pricing)", async () => {
      const state = getOrCreateCallState(sessionId);

      // Financial / rate question MUST trigger hard safety filter returning OUT_OF_SCRIPT_LINE
      const rateResponse = await generateConstrainedOffScriptResponse("What is the exact APR and interest rate on my car loan?", state);
      expect(rateResponse).toBe(OUT_OF_SCRIPT_LINE);

      const paymentResponse = await generateConstrainedOffScriptResponse("Can you lower my monthly payment by 50 dollars?", state);
      expect(paymentResponse).toBe(OUT_OF_SCRIPT_LINE);

      const tradeInResponse = await generateConstrainedOffScriptResponse("What is my trade in appraisal value?", state);
      expect(tradeInResponse).toBe(OUT_OF_SCRIPT_LINE);

      // General question should never contain dollar signs, interest rates, or percentages
      const coffeeResponse = await generateConstrainedOffScriptResponse("Can I grab a cup of coffee while we do this?", state);
      expect(coffeeResponse).not.toContain("$");
      expect(coffeeResponse).not.toContain("%");
      expect(coffeeResponse).not.toContain("apr");
      expect(coffeeResponse).not.toContain("interest");
    });

    it("Phase 4: pause_request holds state gracefully without advancing beat pointer", async () => {
      await processControllerTurn(sessionId, "Yes");
      await processControllerTurn(sessionId, "Great"); // Beat 1
      await processControllerTurn(sessionId, "Yes", DEFAULT_DEAL_CONFIG, { intent: "agree", topic_beat_ids: [] }); // Beat 2

      const stateBefore = getOrCreateCallState(sessionId);
      expect(stateBefore.current_beat).toBe(2);

      // Customer asks to pause
      const pauseDecision = await processControllerTurn(sessionId, "Hold on a second let me check something");
      expect(pauseDecision.intent).toBe("pause_request");
      expect(pauseDecision.textToSpeak).toBe(PAUSE_LINE);
      expect(pauseDecision.beatId).toBe(2);
      expect(pauseDecision.state.current_beat).toBe(2); // Did NOT skip
    });

    it("Phase 4: overwhelmed requests slow down and re-prompts current beat check-in", async () => {
      await processControllerTurn(sessionId, "Yes");
      await processControllerTurn(sessionId, "Great"); // Beat 1

      const slowDecision = await processControllerTurn(sessionId, "You're moving too fast, that's a lot of information");
      expect(slowDecision.intent).toBe("overwhelmed");
      expect(slowDecision.textToSpeak).toContain(SLOW_DOWN_LINE);
      expect(slowDecision.state.current_beat).toBe(1);
    });

    it("Phase 4: vehicle compliments share customer excitement and hold the beat", async () => {
      await processControllerTurn(sessionId, "Yes");
      await processControllerTurn(sessionId, "Great"); // Beat 1

      const complimentDecision = await processControllerTurn(sessionId, "I really love this car, it drove like a dream");
      expect(complimentDecision.intent).toBe("compliment");
      expect(complimentDecision.textToSpeak).toContain(COMPLIMENT_LINE);
      // A compliment is not consent to recording: hold Beat 1 and re-ask its check-in
      expect(complimentDecision.textToSpeak).toContain("Is that okay with you?");
      expect(complimentDecision.beatId).toBe(1);
    });

    it("Phase 4: human requests stay in character and hold the beat (no escalation exists)", async () => {
      await processControllerTurn(sessionId, "Yes");
      await processControllerTurn(sessionId, "Great"); // Beat 1

      const humanDecision = await processControllerTurn(sessionId, "I need to speak to a human manager");
      expect(humanDecision.intent).toBe("human_request");
      expect(humanDecision.textToSpeak).toBe(HANDOFF_LINE);
      expect(humanDecision.toolCalls).toEqual([]);
      expect(humanDecision.beatId).toBe(1);
      expect(humanDecision.state.is_stopped).toBe(false);
    });

    it("Identity questions ('who is this') identify Max and re-prompt current beat without advancing", async () => {
      await processControllerTurn(sessionId, "Yes");
      await processControllerTurn(sessionId, "Great"); // Beat 1

      // Customer asks "who's this" on Beat 1
      const idDecision1 = await processControllerTurn(sessionId, "Who's this");
      expect(idDecision1.intent).toBe("identity_question");
      expect(idDecision1.textToSpeak).toContain(IDENTITY_LINE);
      expect(idDecision1.beatId).toBe(1); // Stays on Beat 1!

      // Customer agrees on disclosure -> advances to Beat 2
      const decBeat2 = await processControllerTurn(sessionId, "Okay", DEFAULT_DEAL_CONFIG, { intent: "agree", topic_beat_ids: [] });
      expect(decBeat2.beatId).toBe(2);

      // Customer interrupts on Beat 2 with "who are you"
      const idDecision2 = await processControllerTurn(sessionId, "Who are you again");
      expect(idDecision2.intent).toBe("identity_question");
      expect(idDecision2.textToSpeak).toContain(IDENTITY_LINE);
      expect(idDecision2.beatId).toBe(2); // Stays on Beat 2, does NOT skip to Beat 3!
    });

    it("Acoustic Echo Protection: Rejects laptop speaker echo and prevents skipping questions", async () => {
      // Step 0 Turn 1: Tech check
      const t1 = await processControllerTurn(sessionId, "Hey.");
      expect(t1.intent).toBe("step0");
      expect(t1.beatId).toBe(0);

      // Acoustic echo of Max's rapport line from call 999f4cf1-48d7-497f-bfff-755d7df3990a
      const echo1 = "awesome great to connect with you first of all";
      const echoDecision = await processControllerTurn(sessionId, echo1);
      // Must NOT advance to Beat 1 or 2!
      expect(echoDecision.beatId).toBe(0);

      // Customer actually responds to rapport
      const realT2 = await processControllerTurn(sessionId, "It was great, everyone was super helpful");
      expect(realT2.beatId).toBe(1); // Enters Beat 1 legal disclosure

      // Laptop mic hears Max's Beat 1 text leaked from speakers
      const echo2 = "awesome great to connect with you first of all congratulate";
      const echoOnBeat1 = await processControllerTurn(sessionId, echo2);
      expect(echoOnBeat1.intent).toBe("avatar_echo");
      expect(echoOnBeat1.beatId).toBe(1); // MUST NOT SKIP TO BEAT 2!

      // Max says "Sorry, I didn't catch that." and mic echoes it back
      const echoGarbled = "sorry i didn't catch that";
      const echoOnGarbled = await processControllerTurn(sessionId, echoGarbled);
      expect(echoOnGarbled.intent).toBe("avatar_echo");
      expect(echoOnGarbled.beatId).toBe(1); // MUST NOT SKIP BEAT!
      expect(echoOnGarbled.textToSpeak).not.toBe(GARBLED_LINE); // Prevents infinite echo loop!

      // Actual customer agrees to Beat 1 disclosure
      const realAgreeBeat1 = await processControllerTurn(sessionId, "Yes, I understand", DEFAULT_DEAL_CONFIG, { intent: "agree", topic_beat_ids: [] });
      expect(realAgreeBeat1.beatId).toBe(2); // Safely advances to Beat 2!
    });

    it("Mid-Call Presence Check: 'Hey' does NOT generate 'How can I assist you today?' or advance beats", async () => {
      await processControllerTurn(sessionId, "Yes");
      await processControllerTurn(sessionId, "It was great"); // Beat 1
      await processControllerTurn(sessionId, "Yes", DEFAULT_DEAL_CONFIG, { intent: "agree", topic_beat_ids: [] }); // Beat 2

      // Customer says "Hey" on Beat 2
      const heyTurn = await processControllerTurn(sessionId, "Hey.");
      expect(heyTurn.intent).toBe("greeting_check");
      expect(heyTurn.textToSpeak).toContain("I'm right here with you!");
      expect(heyTurn.textToSpeak).not.toContain("How can I assist you today?"); // Never stitch generic bot greeting!
      expect(heyTurn.beatId).toBe(2); // Stays on Beat 2!
    });

    it("Interjections: 'Let me tell you something' responds with LISTENING_LINE and holds current beat", async () => {
      await processControllerTurn(sessionId, "Yes");
      await processControllerTurn(sessionId, "It was great"); // Beat 1
      await processControllerTurn(sessionId, "Yes", DEFAULT_DEAL_CONFIG, { intent: "agree", topic_beat_ids: [] }); // Beat 2

      const interjectionTurn = await processControllerTurn(sessionId, "Let me tell you something.");
      expect(interjectionTurn.intent).toBe("pause_request");
      expect(interjectionTurn.textToSpeak).toBe(LISTENING_LINE);
      expect(interjectionTurn.beatId).toBe(2); // Stays on current beat, listening to caller!
    });

    it("Beat 4 Qualifying Answer: 'he explained about some of the warranties' advances cleanly to Beat 5", async () => {
      const state = getOrCreateCallState(sessionId);
      state.step0_completed = true;
      state.current_beat = 4;

      const warrantyAnswerTurn = await processControllerTurn(sessionId, "he explained about some of the warranties");
      expect(warrantyAnswerTurn.intent).toBe("agree");
      expect(warrantyAnswerTurn.beatId).toBe(5); // Cleanly advances to Beat 5!
    });

    it("Beat 4 Qualifying Answer 'No' / 'No he did not tell me anything' transitions directly into Beat 6 warranty presentation without escalation", async () => {
      const state = getOrCreateCallState(sessionId);
      state.step0_completed = true;
      state.current_beat = 4;

      // Customer says "No he did not tell me anything" or "I'm not really"
      const noWarrantyTurn = await processControllerTurn(sessionId, "No he did not tell me anything");
      expect(noWarrantyTurn.intent).toBe("no");
      expect(noWarrantyTurn.beatId).toBe(6);
      expect(noWarrantyTurn.textToSpeak).toContain("Allow me to go over it really quick to make sure that you understand everything");
      expect(noWarrantyTurn.textToSpeak).toContain("Also, if you have any questions, please do not hesitate to stop me and ask me");
      expect(noWarrantyTurn.textToSpeak).toContain("Mazda is like any other manufacturer");
      expect(noWarrantyTurn.textToSpeak).not.toContain("bring in my colleague");
      expect(noWarrantyTurn.toolCalls).toEqual([{ name: "show_content", args: { item: "warranty_terms" } }]);
      expect(noWarrantyTurn.state.is_stopped).toBe(false);
    });

    it("Beat 3 Qualifying Answer 'No' / 'he didn't show me anything' advances cleanly to Beat 4 without repeating", async () => {
      const state = getOrCreateCallState(sessionId);
      state.step0_completed = true;
      state.current_beat = 3;

      const noWalkaroundTurn = await processControllerTurn(sessionId, "No, he didn't show me anything");
      expect(noWalkaroundTurn.intent).toBe("no");
      expect(noWalkaroundTurn.beatId).toBe(4);
      expect(noWalkaroundTurn.textToSpeak).toContain("No problem, thanks for letting me know.");
      expect(noWalkaroundTurn.textToSpeak).toContain("What's your understanding of the warranty that comes with the vehicle?");
      expect(noWalkaroundTurn.state.is_stopped).toBe(false);
    });

    it("Beat 2 Qualifying Answer 'No' / 'I didn't get a chance to drive the vehicle' advances cleanly to Beat 4 without reciting walkaround", async () => {
      const state = getOrCreateCallState(sessionId);
      state.step0_completed = true;
      state.current_beat = 2;

      const noDriveTurn = await processControllerTurn(sessionId, "I didn't get a chance to drive the vehicle");
      expect(noDriveTurn.intent).toBe("no");
      expect(noDriveTurn.beatId).toBe(4);
      expect(noDriveTurn.textToSpeak).toContain("No problem, thanks for letting me know.");
      expect(noDriveTurn.textToSpeak).toContain("What's your understanding of the warranty that comes with the vehicle?");
      expect(noDriveTurn.textToSpeak).not.toContain("When you came back from the test drive");
      expect(noDriveTurn.state.is_stopped).toBe(false);
    });

    it("Beat 2 customer merely saying 'OK' asks for test-drive confirmation instead of jumping to Beat 3 walkaround", async () => {
      const state = getOrCreateCallState(sessionId);
      state.step0_completed = true;
      state.current_beat = 2;

      const okTurn = await processControllerTurn(sessionId, "OK");
      expect(okTurn.beatId).toBe(2);
      expect(okTurn.textToSpeak).toContain("Just to confirm, did you get a chance to take it for a test drive");
      expect(okTurn.textToSpeak).not.toContain("When you came back from the test drive");
    });

    it("Beat 1 trailing Step 0 rapport 'Yeah, it was good. Uh.' does not jump to Beat 2", async () => {
      const state = getOrCreateCallState(sessionId);
      state.step0_completed = true;
      state.current_beat = 1;

      const rapportTurn = await processControllerTurn(sessionId, "Yeah, it was good. Uh.");
      expect(rapportTurn.beatId).toBe(1);
      expect(rapportTurn.textToSpeak).not.toContain("chance to drive the vehicle");
    });

    it("Stage 0 handles 'sales score' STT typo without reciting positive transition prematurely", async () => {
      const freshSession = "test-sales-score-" + Date.now();
      await processControllerTurn(freshSession, "Yes, I can hear you");
      const salesAskTurn = await processControllerTurn(freshSession, "Let me make you clear, is this a sales score or not? Just let me know.");
      expect(salesAskTurn.textToSpeak).toContain("coverage options with you before you sign");
      expect(salesAskTurn.textToSpeak).not.toContain("Awesome, so glad to hear that!");
    });

    it("Barge-in detector shouldCutMaxOff honors conversational phrases like 'let me tell you' and multi-word replies", () => {
      expect(shouldCutMaxOff("let me tell you something")).toBe(true);
      expect(shouldCutMaxOff("let me finish")).toBe(true);
      expect(shouldCutMaxOff("listen to me")).toBe(true);
      expect(shouldCutMaxOff("wait a second")).toBe(true);
      expect(shouldCutMaxOff("what are you saying")).toBe(true);
      expect(shouldCutMaxOff("actually that is not what happened")).toBe(true);
      expect(shouldCutMaxOff("when I speak something")).toBe(true);
      expect(shouldCutMaxOff("I have a question")).toBe(true);
      expect(shouldCutMaxOff("wait")).toBe(true);
      expect(shouldCutMaxOff("stop")).toBe(true);
      expect(shouldCutMaxOff("no")).toBe(true);
      expect(shouldCutMaxOff("can you hear me")).toBe(true);
      // Pure backchannel should NOT cut off
      expect(shouldCutMaxOff("yeah")).toBe(false);
      expect(shouldCutMaxOff("uh huh")).toBe(false);
      expect(shouldCutMaxOff("okay")).toBe(false);
      expect(shouldCutMaxOff("mhm")).toBe(false);
    });

    it("EQ Adaptation: Frustrated customer triggers EQ_DEESCALATION_LINE without advancing beat", async () => {
      await processControllerTurn(sessionId, "Yes");
      await processControllerTurn(sessionId, "It was great"); // Beat 1
      await processControllerTurn(sessionId, "Yes", DEFAULT_DEAL_CONFIG, { intent: "agree", topic_beat_ids: [] }); // Beat 2

      const frustratedTurn = await processControllerTurn(sessionId, "I have been waiting for hours, hurry up and don't waste my time!");
      expect(frustratedTurn.intent).toBe("customer_frustrated");
      expect(frustratedTurn.textToSpeak).toContain("I hear you 100 percent. You've had a long day at the dealership");
      expect(frustratedTurn.beatId).toBe(2); // Validates and holds beat with empathy
    });

    it("EQ Adaptation: Anxious/doubtful customer triggers EQ_REASSURANCE_LINE with psychological safety", async () => {
      await processControllerTurn(sessionId, "Yes");
      await processControllerTurn(sessionId, "It was great"); // Beat 1
      await processControllerTurn(sessionId, "Yes", DEFAULT_DEAL_CONFIG, { intent: "agree", topic_beat_ids: [] }); // Beat 2

      const anxiousTurn = await processControllerTurn(sessionId, "I'm really nervous and scared of hidden costs, this is my first car.");
      expect(anxiousTurn.intent).toBe("customer_anxious");
      expect(anxiousTurn.textToSpeak).toContain("Take a deep breath—buying a car is a huge milestone");
      expect(anxiousTurn.beatId).toBe(2); // Provides psychological safety without pressure
    });

    it("EQ Adaptation: Excited/humor customer triggers EQ_EXCITEMENT_LINE and holds the beat", async () => {
      await processControllerTurn(sessionId, "Yes");
      await processControllerTurn(sessionId, "It was great"); // Beat 1

      const excitedTurn = await processControllerTurn(sessionId, "Haha that's hilarious Max, you're funny!");
      expect(excitedTurn.intent).toBe("compliment");
      expect(excitedTurn.textToSpeak).toContain("I love that energy! That new car is an absolute head-turner");
      expect(excitedTurn.beatId).toBe(1); // Shares the excitement, still needs the Beat 1 answer
    });

    it("isIncompleteUtterance detects trailing hesitation and incomplete dangling clauses", () => {
      expect(isIncompleteUtterance("uh does this provided by")).toBe(true);
      expect(isIncompleteUtterance("Let me please confirm that should I buy this from the")).toBe(true);
      expect(isIncompleteUtterance("new warranty or should i")).toBe(true);
      expect(isIncompleteUtterance("Wait, I wanted to ask about")).toBe(true);
      expect(isIncompleteUtterance("Yes, I drove it and it was great")).toBe(false);
      expect(isIncompleteUtterance("That sounds fair to me")).toBe(false);
    });

    it("Vehicle Discrepancy: Customer correcting vehicle model triggers vehicle_discrepancy without reciting default car", async () => {
      await processControllerTurn(sessionId, "Yes");
      await processControllerTurn(sessionId, "It was great"); // Beat 1

      // Customer interrupts with car correction ("No, uh, I was buying, uh, Maybach.")
      const turn = await processControllerTurn(sessionId, "No, uh, I was buying, uh, Maybach.");
      expect(turn.intent).toBe("vehicle_discrepancy");
      // Follow-up 7 B: acknowledge once, never argue or echo a make; later lines say "your new vehicle"
      expect(turn.textToSpeak).toContain("Thanks for catching that");
      expect(turn.textToSpeak).not.toContain("Mazda");
      expect(turn.state.vehicle_disputed).toBe(true);
      expect(turn.beatId).toBe(1); // Holds the beat it was raised on (Beat 1 consent still pending)
      expect(turn.beatType).toBe("wait");
    });

    it("Manufacturer vs Dealer: Customer asking about manufacturer coverage receives clear direct explanation", async () => {
      await processControllerTurn(sessionId, "Yes");
      await processControllerTurn(sessionId, "It was great"); // Beat 1
      await processControllerTurn(sessionId, "Yes", DEFAULT_DEAL_CONFIG, { intent: "agree", topic_beat_ids: [] }); // Beat 2

      // Customer asks if coverage is provided by manufacturer or if they should buy new one
      const turn = await processControllerTurn(
        sessionId,
        "Uh, does this provided by the manufacturer or uh, should I buy the new one?"
      );
      expect(turn.intent).toBe("manufacturer_vs_dealer");
      expect(turn.textToSpeak).toContain("The factory warranty comes directly from the manufacturer");
      expect(turn.textToSpeak).toContain("dealership's comprehensive coverage");
      // Must NOT dump 3 wear-and-tear recaps
      expect(turn.textToSpeak).not.toContain("As a quick recap, wear and tear from climate, roads, and driving causes ninety-five percent of breakdowns. As a recap, potholes");
      expect(turn.beatType).toBe("wait");
    });
  });
});




