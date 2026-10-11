import { describe, expect, it } from "vitest";
import { NegotiationStateManager, DEFAULT_DEAL_STATE } from "./state-manager";

describe("NegotiationStateManager", () => {
  it("initializes with default pinned state and locked verification", () => {
    const manager = new NegotiationStateManager();
    const state = manager.getState();

    expect(state.financial_state.current_quote_daily).toBe(4.0);
    expect(state.financial_state.hard_floor_daily).toBe(3.0);
    expect(state.call_state.current_step).toBe("rapport");
    expect(state.call_state.verification_locked).toBe(true);
  });

  describe("Deterministic Concession Ladder", () => {
    it("concedes in approved steps: 1 ($4.00) -> 2 ($3.50) -> 3 ($3.25) -> 4 ($3.00)", () => {
      const manager = new NegotiationStateManager();

      const r2 = manager.executeConcession(2);
      expect(r2.success).toBe(true);
      expect(r2.newPriceDaily).toBe(3.5);
      expect(manager.getState().financial_state.current_quote_daily).toBe(3.5);

      const r3 = manager.executeConcession(3);
      expect(r3.success).toBe(true);
      expect(r3.newPriceDaily).toBe(3.25);
      expect(manager.getState().financial_state.current_quote_daily).toBe(3.25);

      const r4 = manager.executeConcession(4);
      expect(r4.success).toBe(true);
      expect(r4.newPriceDaily).toBe(3.0);
      expect(manager.getState().financial_state.current_quote_daily).toBe(3.0);
    });

    it("records full audit history of all spoken price points across negotiations", () => {
      const manager = new NegotiationStateManager();

      expect(manager.getPriceHistory().length).toBe(1);
      expect(manager.getLastQuotedPrice().daily_rate).toBe(4.0);

      manager.executeConcession(2); // $3.50
      manager.executeConcession(3); // $3.25

      const history = manager.getPriceHistory();
      expect(history.length).toBe(3);
      expect(history[0].daily_rate).toBe(4.0);
      expect(history[1].daily_rate).toBe(3.5);
      expect(history[2].daily_rate).toBe(3.25);
      expect(manager.getLastQuotedPrice().daily_rate).toBe(3.25);

      const payload = manager.assembleInferencePayload("Test prompt");
      expect(payload.systemPrompt).toContain("$4.00/day");
      expect(payload.systemPrompt).toContain("$3.50/day");
      expect(payload.systemPrompt).toContain("$3.25/day");
    });

    it("rejects concessions below the $3.00 hard floor and issues escalation directive", () => {
      const manager = new NegotiationStateManager();

      const r5 = manager.executeConcession(5); // Attempt below floor
      expect(r5.success).toBe(false);
      expect(r5.message).toContain("Floor breach");
      expect(r5.directive).toBeDefined();
      expect(manager.getState().financial_state.current_quote_daily).toBe(4.0);
    });
  });

  describe("Monotonic Pipeline & Verification Lock", () => {
    it("throws Protocol Violation if verification is requested before close", () => {
      const manager = new NegotiationStateManager();

      // Currently at rapport
      expect(() => {
        manager.setStep("verification");
      }).toThrow(/Protocol Violation/);

      // Advance through steps
      manager.setStep("greeting");
      manager.setStep("disclosure");
      manager.setStep("qualifying");
      manager.setStep("four_square");
      manager.setStep("objection");

      expect(() => {
        manager.setStep("verification");
      }).toThrow(/Protocol Violation/);
    });

    it("allows verification and unlocks verification when coming from close", () => {
      const manager = new NegotiationStateManager();
      manager.setStep("close");

      expect(manager.getState().call_state.verification_locked).toBe(true);
      manager.setStep("verification");

      expect(manager.getState().call_state.current_step).toBe("verification");
      expect(manager.getState().call_state.verification_locked).toBe(false);
    });
  });

  describe("Context Assembly & Memory Drift Prevention", () => {
    it("pins immutable deal state and bounds dialogue history to 6 turns", () => {
      const manager = new NegotiationStateManager();

      for (let i = 1; i <= 10; i++) {
        manager.recordUserTurn(`User question ${i}`);
        manager.recordAssistantTurn(`Assistant reply ${i}`);
      }

      const payload = manager.assembleInferencePayload("Static System Prompt");
      expect(payload.systemPrompt).toContain("=== IMMUTABLE DEAL ANCHOR (READ ONLY) ===");
      expect(payload.systemPrompt).toContain("Current active price: $4.00/day");
      expect(payload.messages.length).toBe(6);
      expect(payload.messages[0].content).toBe("User question 8");
      expect(payload.messages[5].content).toBe("Assistant reply 10");
    });
  });
});
