/**
 * Max DFM Tool-Call Dispatcher & Event Router
 * Based on CONTEXT_RULES.md Part 3.
 *
 * Maps LLM tool executions to the deterministic state anchor and the frontend display.
 */

import { NegotiationStateManager, type CanvasView, type PipelineStep } from "./state-manager";

export interface ToolExecutionResult {
  status: "approved" | "rejected" | "canvas_updated" | "step_advanced" | "error" | "unhandled_tool";
  view?: string;
  reason?: string;
  directive?: string;
  currentPriceDaily?: number;
  currentPriceMonthly?: number;
  activeStep?: string;
  message?: string;
}

export interface AppMessageSender {
  sendAppMessage?: (msg: any) => void;
}

export function handleToolExecution(
  toolName: string,
  args: any,
  stateManager: NegotiationStateManager,
  dailyCallRoom?: AppMessageSender,
): ToolExecutionResult {
  switch (toolName) {
    case "show_content": {
      // Directs the display canvas / content panels
      const targetView = (args.view || args.item || "four_square") as CanvasView;
      stateManager.setCanvasView(targetView);

      if (dailyCallRoom?.sendAppMessage) {
        dailyCallRoom.sendAppMessage({
          event: "ui_change",
          view: targetView,
          activePrice: stateManager.getState().financial_state.current_quote_daily,
        });
      }
      return { status: "canvas_updated", view: targetView };
    }

    case "propose_concession": {
      // Evaluates price negotiation against deterministic ladder
      const stage = Number(args.stage);
      const result = stateManager.executeConcession(stage);

      if (!result.success) {
        // Feed violation back into LLM so it executes the manager escalation line
        return {
          status: "rejected",
          reason: result.message,
          directive:
            result.directive ||
            'Refuse concession. Say: "I can\'t adjust the price myself past this point — let me get you connected with a team member who can look at that with you." and call escalate_to_human.',
        };
      }

      // Notify frontend canvas of price change
      if (dailyCallRoom?.sendAppMessage) {
        dailyCallRoom.sendAppMessage({
          event: "price_updated",
          dailyPrice: result.newPriceDaily,
          monthlyPrice: result.newPriceMonthly,
        });
      }

      return {
        status: "approved",
        currentPriceDaily: result.newPriceDaily,
        currentPriceMonthly: result.newPriceMonthly,
      };
    }

    case "advance_stage": {
      const targetStep = args.targetStep as PipelineStep;
      try {
        stateManager.setStep(targetStep);

        if (dailyCallRoom?.sendAppMessage) {
          dailyCallRoom.sendAppMessage({
            event: "stage_advanced",
            step: targetStep,
            verificationLocked: stateManager.getState().call_state.verification_locked,
          });
        }

        return { status: "step_advanced", activeStep: targetStep };
      } catch (err: any) {
        return { status: "error", message: err.message };
      }
    }

    case "show_payment_breakdown": {
      const rawDailyRate = Number(args.daily_rate);
      // Map daily rate to concession stage if valid
      let stage = 1;
      if (rawDailyRate === 3.5) stage = 2;
      else if (rawDailyRate === 3.25) stage = 3;
      else if (rawDailyRate === 3.0) stage = 4;
      else if (rawDailyRate < 3.0) stage = 5;

      const result = stateManager.executeConcession(stage);

      if (!result.success) {
        return {
          status: "rejected",
          reason: result.message,
          directive: result.directive,
        };
      }

      if (dailyCallRoom?.sendAppMessage) {
        dailyCallRoom.sendAppMessage({
          event: "price_updated",
          dailyPrice: result.newPriceDaily,
          monthlyPrice: result.newPriceMonthly,
        });
      }

      return {
        status: "approved",
        currentPriceDaily: result.newPriceDaily,
        currentPriceMonthly: result.newPriceMonthly,
      };
    }

    default:
      return { status: "unhandled_tool" };
  }
}
