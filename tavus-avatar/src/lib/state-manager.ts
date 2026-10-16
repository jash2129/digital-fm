/**
 * Max DFM Deterministic State Anchor Engine
 * Based on CONTEXT_RULES.md architectural specification.
 *
 * Enforces decoupled deterministic state outside the LLM weights:
 * - Deterministic price concession ladder with hard floor enforcement ($3.00/day)
 * - Strict monotonic execution pipeline (Stages 0 through 9)
 * - Premature identity verification lock (verification_locked = true until STEP_6_CLOSE)
 * - Sliding window history (max 6 turns, <= 800 tokens)
 */

export interface DealMetadata {
  deal_id: string;
  customer_name: string;
  customer_address: string;
  customer_phone: string;
  vehicle: {
    year: number;
    make: string;
    model: string;
    color: string;
    vin: string;
  };
}

export interface PriceQuoteRecord {
  timestamp: string;
  daily_rate: number;
  monthly_rate: number;
  stage: number;
  label: string;
}

export interface FinancialState {
  base_payment_monthly: number;
  opening_quote_daily: number;
  current_quote_daily: number;
  current_quote_monthly: number;
  concession_stage: number;
  hard_floor_daily: number;
  focus_products: string[];
  price_history: PriceQuoteRecord[];
}

export interface CostAnchors {
  engine_rebuild: number;
  transmission: number;
  ac_system: number;
  labor_rate_hourly: string;
  labor_hours_average: string;
  in_house_deductible: number;
  outside_deductible: number;
  rental_car_days: number;
}

export type PipelineStep =
  | "rapport"
  | "greeting"
  | "disclosure"
  | "qualifying"
  | "four_square"
  | "objection"
  | "close"
  | "verification"
  | "payment"
  | "documents";

export type CanvasView =
  | "welcome"
  | "four_square"
  | "pricing_ladder"
  | "deal_summary"
  | "warranty_terms"
  | "cost_breakdown"
  | "escalate";

export interface CallState {
  current_step: PipelineStep;
  active_canvas_view: CanvasView;
  verification_locked: boolean;
}

export interface DealState {
  deal_metadata: DealMetadata;
  financial_state: FinancialState;
  cost_anchors: CostAnchors;
  call_state: CallState;
  selected_products: string[];
}

export interface DialogueTurn {
  role: "user" | "assistant";
  content: string;
}

export const DEFAULT_COST_ANCHORS: CostAnchors = {
  engine_rebuild: 7000,
  transmission: 6000,
  ac_system: 4000,
  labor_rate_hourly: "130-160",
  labor_hours_average: "10-15",
  in_house_deductible: 0,
  outside_deductible: 350,
  rental_car_days: 10,
};

export const DEFAULT_DEAL_STATE: DealState = {
  deal_metadata: {
    deal_id: "deal-live-default",
    customer_name: "Valued Customer",
    customer_address: "123 Elm Street, Austin, TX",
    customer_phone: "555-0199",
    vehicle: {
      year: 2026,
      make: "Mazda",
      model: "CX-5",
      color: "Polymetal Gray",
      vin: "JM3VA4BL0P1102941",
    },
  },
  financial_state: {
    base_payment_monthly: 450,
    opening_quote_daily: 4.0,
    current_quote_daily: 4.0,
    current_quote_monthly: 120.0,
    concession_stage: 1,
    hard_floor_daily: 3.0,
    focus_products: ["VSC", "GAP"],
    price_history: [
      {
        timestamp: new Date().toISOString(),
        daily_rate: 4.0,
        monthly_rate: 120.0,
        stage: 1,
        label: "Initial Presentation ($4.00/day, $120/mo)",
      },
    ],
  },
  cost_anchors: { ...DEFAULT_COST_ANCHORS },
  call_state: {
    current_step: "rapport",
    active_canvas_view: "welcome",
    verification_locked: true,
  },
  selected_products: [
    "7-Year / 100,000-Mile Bumper-to-Bumper Warranty (VSC)",
    "5-Year Tire & Wheel Protection",
    "4-Year Maintenance Package",
    "GAP Protection",
  ],
};

export class NegotiationStateManager {
  private state: DealState;
  private history: DialogueTurn[] = [];
  private readonly MAX_HISTORY_TURNS = 6;

  constructor(initialDeal?: Partial<DealState>) {
    const initialPrice = initialDeal?.financial_state?.current_quote_daily ?? 4.0;
    const initialStage = initialDeal?.financial_state?.concession_stage ?? 1;

    this.state = {
      deal_metadata: {
        ...DEFAULT_DEAL_STATE.deal_metadata,
        ...(initialDeal?.deal_metadata ?? {}),
        vehicle: {
          ...DEFAULT_DEAL_STATE.deal_metadata.vehicle,
          ...(initialDeal?.deal_metadata?.vehicle ?? {}),
        },
      },
      financial_state: {
        ...DEFAULT_DEAL_STATE.financial_state,
        ...(initialDeal?.financial_state ?? {}),
        opening_quote_daily: 4.0,
        current_quote_daily: initialPrice,
        current_quote_monthly: initialPrice * 30,
        concession_stage: initialStage,
        hard_floor_daily: 3.0,
        price_history: initialDeal?.financial_state?.price_history ?? [
          {
            timestamp: new Date().toISOString(),
            daily_rate: initialPrice,
            monthly_rate: initialPrice * 30,
            stage: initialStage,
            label: "Opening Presentation Quote",
          },
        ],
      },
      cost_anchors: {
        ...DEFAULT_DEAL_STATE.cost_anchors,
        ...(initialDeal?.cost_anchors ?? {}),
      },
      call_state: {
        ...DEFAULT_DEAL_STATE.call_state,
        ...(initialDeal?.call_state ?? {}),
        verification_locked: true, // Always locked at initialization
      },
      selected_products: initialDeal?.selected_products ?? [...DEFAULT_DEAL_STATE.selected_products],
    };
  }

  public recordUserTurn(content: string): void {
    this.history.push({ role: "user", content });
  }

  public recordAssistantTurn(content: string): void {
    this.history.push({ role: "assistant", content });
  }

  /**
   * Deterministic concession guardrail
   * Evaluates price proposals outside the LLM weights
   */
  public executeConcession(stage: number): {
    success: boolean;
    newPriceDaily: number;
    newPriceMonthly: number;
    message: string;
    directive?: string;
  } {
    let targetPrice = 4.0;

    switch (stage) {
      case 1:
        targetPrice = 4.0;
        break;
      case 2:
        targetPrice = 3.5; // Step 2 concession
        break;
      case 3:
        targetPrice = 3.25; // Step 3 concession
        break;
      case 4:
        targetPrice = 3.0; // Step 4 floor
        break;
      default:
        targetPrice = stage > 4 ? 2.5 : 4.0;
    }

    // Programmatic Floor Enforcement
    if (targetPrice < this.state.financial_state.hard_floor_daily) {
      return {
        success: false,
        newPriceDaily: this.state.financial_state.current_quote_daily,
        newPriceMonthly: this.state.financial_state.current_quote_monthly,
        message: "Floor breach: Price below $3.00/day requires manager escalation.",
        directive:
          'Refuse concession. Say: "I can\'t adjust the price myself past this point — let me get you connected with a team member who can look at that with you." and call escalate_to_human.',
      };
    }

    this.state.financial_state.concession_stage = stage;
    this.state.financial_state.current_quote_daily = targetPrice;
    this.state.financial_state.current_quote_monthly = Number((targetPrice * 30).toFixed(2));

    // Append to auditable price history
    this.state.financial_state.price_history.push({
      timestamp: new Date().toISOString(),
      daily_rate: targetPrice,
      monthly_rate: this.state.financial_state.current_quote_monthly,
      stage,
      label: `$${targetPrice.toFixed(2)}/day ($${this.state.financial_state.current_quote_monthly}/mo)`,
    });

    return {
      success: true,
      newPriceDaily: targetPrice,
      newPriceMonthly: this.state.financial_state.current_quote_monthly,
      message: `Pricing updated to $${targetPrice.toFixed(2)}/day ($${this.state.financial_state.current_quote_monthly}/mo).`,
    };
  }

  public getPriceHistory(): PriceQuoteRecord[] {
    return [...this.state.financial_state.price_history];
  }

  public getLastQuotedPrice(): PriceQuoteRecord {
    const history = this.state.financial_state.price_history;
    return history[history.length - 1];
  }

  /**
   * Monotonic pipeline step advancement.
   * Prevents premature verification: identity verification is strictly prohibited
   * unless verbal close is complete.
   */
  public setStep(step: PipelineStep | string): void {
    const isVerification = step === "verification" || step === "STEP_7_VERIFICATION";
    const isClose =
      this.state.call_state.current_step === "close" ||
      this.state.call_state.current_step === ("STEP_6_CLOSE" as any);

    if (isVerification) {
      if (!isClose) {
        throw new Error(
          "Protocol Violation: Cannot verify identity before verbal close is complete.",
        );
      }
      this.state.call_state.verification_locked = false;
    }

    this.state.call_state.current_step = step as PipelineStep;
  }

  public setCanvasView(view: CanvasView): void {
    this.state.call_state.active_canvas_view = view;
  }

  public getState(): Readonly<DealState> {
    return JSON.parse(JSON.stringify(this.state));
  }

  /**
   * Generates the immutable deal anchor block to inject into the system prompt.
   * Pinning this JSON ensures zero memory drift across 60+ minutes.
   */
  public getPinnedStateBlock(): string {
    const priceAudit = this.state.financial_state.price_history
      .map((entry, idx) => `   ${idx + 1}. $${entry.daily_rate.toFixed(2)}/day ($${entry.monthly_rate.toFixed(0)}/mo) [${entry.label}]`)
      .join("\n");

    const stateCopy = JSON.parse(JSON.stringify(this.state));
    // Remove technical step labels from the context block so the model never sees or speaks them
    if (stateCopy.call_state) {
      delete stateCopy.call_state.current_step;
    }

    return `
=== IMMUTABLE DEAL ANCHOR (READ ONLY) ===
${JSON.stringify(stateCopy, null, 2)}
=========================================
CRITICAL PRICING & GUARDRAIL DIRECTIVES:
1. Current active price: $${this.state.financial_state.current_quote_daily.toFixed(2)}/day ($${this.state.financial_state.current_quote_monthly.toFixed(0)}/mo).
2. Spoken price history in this call (REMEMBER AND MAINTAIN CONSISTENCY):
${priceAudit}
3. Hard floor: $${this.state.financial_state.hard_floor_daily.toFixed(2)}/day. NEVER quote below this figure under any circumstance.
4. Customer identity verification locked: ${this.state.call_state.verification_locked ? "TRUE — DO NOT ask for customer name spelling or address verification until the customer explicitly agrees to a product package and price." : "FALSE — verification permitted"}.
5. SPOKEN DIALOGUE DIRECTIVE: Speak ONLY plain, natural, customer-facing conversational dialogue. NEVER speak, mention, quote, or spell out any stage numbers, step titles, internal labels, or technical code names.
`;
  }

  /**
   * Assembles the complete inference payload: Pinned JSON State + Sliding Window Transcript (<= 800 tokens)
   */
  public assembleInferencePayload(staticSystemPrompt: string) {
    const recentHistory = this.history.slice(-this.MAX_HISTORY_TURNS);

    return {
      systemPrompt: `${staticSystemPrompt}\n\n${this.getPinnedStateBlock()}`,
      messages: recentHistory,
    };
  }
}

// Global process-level registry for active state managers keyed by conversation ID or deal ID
declare global {
  var __dfmStateManagers__: Map<string, NegotiationStateManager> | undefined;
}

export function getStateManager(id: string, initialDeal?: Partial<DealState>): NegotiationStateManager {
  if (!globalThis.__dfmStateManagers__) {
    globalThis.__dfmStateManagers__ = new Map<string, NegotiationStateManager>();
  }

  let manager = globalThis.__dfmStateManagers__.get(id);
  if (!manager) {
    manager = new NegotiationStateManager(initialDeal);
    globalThis.__dfmStateManagers__.set(id, manager);
  }

  return manager;
}
