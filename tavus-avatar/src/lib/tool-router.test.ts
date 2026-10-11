import { describe, expect, it, vi } from "vitest";
import { handleToolExecution } from "./tool-router";
import { NegotiationStateManager } from "./state-manager";

describe("handleToolExecution", () => {
  it("processes propose_concession within allowable stages", () => {
    const manager = new NegotiationStateManager();
    const mockRoom = { sendAppMessage: vi.fn() };

    const result = handleToolExecution("propose_concession", { stage: 2 }, manager, mockRoom);

    expect(result.status).toBe("approved");
    expect(result.currentPriceDaily).toBe(3.5);
    expect(mockRoom.sendAppMessage).toHaveBeenCalledWith(
      expect.objectContaining({ event: "price_updated", dailyPrice: 3.5 })
    );
  });

  it("rejects propose_concession below $3.00/day floor with directive", () => {
    const manager = new NegotiationStateManager();
    const mockRoom = { sendAppMessage: vi.fn() };

    const result = handleToolExecution("propose_concession", { stage: 5 }, manager, mockRoom);

    expect(result.status).toBe("rejected");
    expect(result.reason).toContain("Floor breach");
    expect(result.directive).toContain("escalate_to_human");
    expect(mockRoom.sendAppMessage).not.toHaveBeenCalled();
  });

  it("handles advance_stage and throws protocol error if premature verification is attempted", () => {
    const manager = new NegotiationStateManager();
    const mockRoom = { sendAppMessage: vi.fn() };

    const invalidResult = handleToolExecution("advance_stage", { targetStep: "STEP_7_VERIFICATION" }, manager, mockRoom);
    expect(invalidResult.status).toBe("error");
    expect(invalidResult.message).toContain("Protocol Violation");

    // Advance to close first
    handleToolExecution("advance_stage", { targetStep: "STEP_6_CLOSE" }, manager, mockRoom);
    const validResult = handleToolExecution("advance_stage", { targetStep: "STEP_7_VERIFICATION" }, manager, mockRoom);
    expect(validResult.status).toBe("step_advanced");
    expect(validResult.activeStep).toBe("STEP_7_VERIFICATION");
  });

  it("handles show_content to direct canvas view", () => {
    const manager = new NegotiationStateManager();
    const mockRoom = { sendAppMessage: vi.fn() };

    const result = handleToolExecution("show_content", { view: "deal_summary" }, manager, mockRoom);
    expect(result.status).toBe("canvas_updated");
    expect(result.view).toBe("deal_summary");
    expect(mockRoom.sendAppMessage).toHaveBeenCalledWith(
      expect.objectContaining({ event: "ui_change", view: "deal_summary" })
    );
  });
});
