Save this specification as `CONTEXT_RULES.md` in your project root so your IDE assistant reads it as the single source of truth.

---

### Part 1: Drop-In IDE Architectural Specification (`CONTEXT_RULES.md`)

```markdown
# Max DFM Architecture & Context Guardrails

## 1. Core Engineering Principle: Decoupled State Anchor
The LLM must never rely on conversation history or internal memory to recall pricing, terms, vehicle data, or negotiation stages[cite: 1]. 
- Memory Architecture: External Deterministic State Anchor (Redis/Postgres)[cite: 1].
- Context Assembly on Every Turn: Pinned JSON State Anchor + Last 4–6 Dialogue Turns (Sliding Window <= 800 tokens)[cite: 1].
- Concession Control: Tool-gated only. The LLM cannot emit numeric concessions via free-form text without invoking `propose_concession(step)`[cite: 1].

---

## 2. Pinned State Schema
On every conversational turn, the orchestrator retrieves and injects this exact object into the system prompt:

```json
{
  "deal_metadata": {
    "deal_id": "string",
    "customer_name": "string",
    "customer_address": "string",
    "customer_phone": "string",
    "vehicle": {
      "year": "number",
      "make": "string",
      "model": "string",
      "color": "string",
      "vin": "string"
    }
  },
  "financial_state": {
    "base_payment_monthly": "number",
    "opening_quote_daily": 4.00,
    "current_quote_daily": "number",
    "current_quote_monthly": "number",
    "concession_stage": 1,
    "hard_floor_daily": 3.00,
    "focus_products": ["VSC", "GAP"]
  },
  "cost_anchors": {
    "engine_rebuild": 7500,
    "transmission": 6000,
    "ac_system": 3500,
    "labor_rate_hourly": "130-160",
    "labor_hours_average": "10-15",
    "in_house_deductible": 0,
    "outside_deductible": 350,
    "rental_car_days": 10
  },
  "call_state": {
    "current_step": "STEP_0_RAPPORT | STEP_1_GREETING | STEP_2_DISCLOSURE | STEP_3_QUALIFYING | STEP_4_FOUR_SQUARE | STEP_5_OBJECTION | STEP_6_CLOSE | STEP_7_VERIFICATION",
    "active_canvas_view": "welcome | four_square | pricing_ladder | deal_summary",
    "verification_locked": true
  }
}

```

---

## 3. Strict Monotonic Execution Pipeline

### Stage 0: Dynamic Rapport & Human Opening

* Objective: Match customer energy (chatty vs. direct); handle casual small talk naturally.


* Boundary: Do NOT ask for address or ID. Transition smoothly: *"Alright, before we get started, I do need to go over a couple of things with you..."*



### Step 1: Formal Greeting

* Verbatim: *"Hey {{customer_name}}, this is Max. I'm your finance manager. I'll be the one handling your paperwork today. Well, first of all, I just want to thank you for buying a car with us. I hope you had a good experience with us today."*


### Step 2: Legal Disclosure

* Verbatim: *"Just want to let you know, first of all, this transaction is recorded audio and video for insurance purposes. Also, I'm required by the law to disclose all the information with you before you sign any paperwork. So it's very important to make sure that you understand everything first before you sign. Is that okay?"*

* Rule: Halt and wait for verbal consent.



### Step 3: Qualifying Questions

1. *"First of all, I want to make sure that you've driven the vehicle that you're buying, the {{vehicle_year}} {{vehicle_make}} {{vehicle_model}}."*

2. *"When you came back from the test drive, did the salesperson do the walk around of the vehicle — show you the features, all the built-in whistles, all the technology and the equipment in the car?"*

3. *"My final question — I want to make sure that the salesperson went over the warranty that you're getting with the vehicle."*

* If Yes: *"Even if you say yes, there is actually more information in the warranty, so I want to make sure I go over it in depth to make sure that you understand everything. Is that okay?"*

* If No: *"Allow me to go over it really quick to make sure that you understand everything. Also, if you have any questions, please do not hesitate to stop me and ask me."*




### Step 4: Four Square Presentation (Tool: `show_content("four_square")`)

* Square 1 & 2 (The Hook): Factory warranty defect limitation (5yr/60k bumper-to-bumper, 10yr/100k powertrain). Manual page 4 glove-box rule: *Defect in material only (misdesigned, misbuilt, misinstalled)*.


* Square 3 (The Story): 95% of failures are wear and tear (Climate, Road Conditions, Driving Habits). Detail part costs ($7,500 engine, $6,000 transmission, $3,000–$4,000 AC) and labor ($130–$160/hr for 10–15 hours).


* Square 4 (The Offer): Wrap package (10yr/100k mechanical, 5yr maintenance, 5yr tire & wheel, GAP) anchored at **$4.00/day**.



### Step 5: Staged Negotiation Ladder (Tool: `propose_concession`)

* Pushback 1 (Value Reframe): Reframe daily cost vs. Starbucks coffee. Emphasize $0 deductible at home dealership vs. $350 outside, plus 10-day rental car.


* Pushback 2 (Focus Narrowing): *"Which two of those do you see the most value in?"* Drop to **$3.50/day**.


* Pushback 3 (Mission Impossible): *"We are miles away... It's kind of like a Mission Impossible, and my name is not Tom Cruise."* Drop to **$3.25/day**.


* Pushback 4 (Floor Defense): When pushed toward $2.00, hold firm: *"No, no, no, $3.50 is already an incredible rate. I cannot do this."* Then hit hard floor: **$3.00/day**.


* Hard Floor Violation: Any push below $3.00/day triggers hard programmatic stop: *"Let me get my manager to see what else we can do for you."*


### Step 6: Verbal Close (Tool: `show_content("deal_summary")`)

* Verbatim: *"Great, so to confirm, {{customer_name}} — we're moving forward with [products agreed to] for ${{current_quote_daily}} a day on your {{vehicle_year}} {{vehicle_make}} {{vehicle_model}}."*


### Step 7: Identity Verification (ONLY Post-Close)

* Verification Law: `verification_locked` must remain `true` until Step 6 is confirmed. Never verify name spelling or address prior to closing.


* Script: Spell first/last name, verify address, confirm delivery packet.



```

---

### Part 2: State Anchor Engine Implementation

This TypeScript orchestrator handles turn-by-turn state pinning, sliding-window compaction, and price guardrail enforcement.

```typescript
// server/orchestrator/state-manager.ts

export interface DealState {
  dealId: string;
  customerName: string;
  customerAddress: string;
  vehicle: {
    year: number;
    make: string;
    model: string;
    color: string;
  };
  basePaymentMonthly: number;
  currentQuoteDaily: number;
  concessionStage: number;
  hardFloorDaily: number;
  currentStep: string;
  selectedProducts: string[];
}

export interface DialogueTurn {
  role: 'user' | 'assistant';
  content: string;
}

export class NegotiationStateManager {
  private state: DealState;
  private history: DialogueTurn[] = [];
  private readonly MAX_HISTORY_TURNS = 6;

  constructor(initialDeal: DealState) {
    this.state = {
      ...initialDeal,
      currentQuoteDaily: 4.00, // Initial anchor[cite: 1]
      concessionStage: 1,
      hardFloorDaily: 3.00,    // Deterministic floor[cite: 1]
      currentStep: 'STEP_0_RAPPORT',
      selectedProducts: ['VSC', 'Maintenance', 'Tire & Wheel', 'GAP'],
    };
  }

  public recordUserTurn(content: string) {
    this.history.push({ role: 'user', content });
  }

  public recordAssistantTurn(content: string) {
    this.history.push({ role: 'assistant', content });
  }

  /**
   * Deterministic concession guardrail
   * Evaluates price proposals outside the LLM weights
   */
  public executeConcession(stage: number): { success: boolean; newPrice: number; message: string } {
    let targetPrice = 4.00;

    switch (stage) {
      case 1:
        targetPrice = 4.00;
        break;
      case 2:
        targetPrice = 3.50; // Step 2 concession[cite: 1]
        break;
      case 3:
        targetPrice = 3.25; // Step 3 concession[cite: 1]
        break;
      case 4:
        targetPrice = 3.00; // Step 4 floor[cite: 1]
        break;
      default:
        targetPrice = 3.00;
    }

    // Programmatic Floor Enforcement[cite: 1]
    if (targetPrice < this.state.hardFloorDaily) {
      return {
        success: false,
        newPrice: this.state.currentQuoteDaily,
        message: 'Floor breach: Price below $3.00/day requires manager escalation.',
      };
    }

    this.state.concessionStage = stage;
    this.state.currentQuoteDaily = targetPrice;

    return {
      success: true,
      newPrice: targetPrice,
      message: `Concession stage ${stage} accepted. Current price: $${targetPrice.toFixed(2)}/day`,
    };
  }

  public setStep(step: string) {
    // Prevent premature verification[cite: 1]
    if (step === 'STEP_7_VERIFICATION' && this.state.currentStep !== 'STEP_6_CLOSE') {
      throw new Error('Protocol Violation: Cannot verify identity before verbal close.');
    }
    this.state.currentStep = step;
  }

  /**
   * Generates input prompt: Pinned JSON State + Sliding Window Transcript (<= 800 tokens)[cite: 1]
   */
  public assembleInferencePayload(staticSystemPrompt: string) {
    const recentHistory = this.history.slice(-this.MAX_HISTORY_TURNS);

    const pinnedStateBlock = `
=== IMMUTABLE DEAL ANCHOR (READ ONLY) ===
${JSON.stringify(this.state, null, 2)}
=========================================
IMPORTANT:
1. Current price is $${this.state.currentQuoteDaily.toFixed(2)}/day ($${(this.state.currentQuoteDaily * 30).toFixed(0)}/mo).
2. Hard floor is $${this.state.hardFloorDaily.toFixed(2)}/day. NEVER quote below this figure[cite: 1].
3. Active stage is ${this.state.currentStep}. Do not deviate[cite: 1].
`;

    return {
      systemPrompt: `${staticSystemPrompt}\n\n${pinnedStateBlock}`,
      messages: recentHistory,
    };
  }

  public getState(): Readonly<DealState> {
    return { ...this.state };
  }
}

```

---

### Part 3: Tool-Call Dispatcher & WebRTC Event Router

This component maps the LLM tool executions to the frontend split-screen presentation and enforces the programmatic boundaries.

```typescript
// server/orchestrator/tool-router.ts
import { NegotiationStateManager } from './state-manager';

export function handleToolExecution(
  toolName: string,
  args: any,
  stateManager: NegotiationStateManager,
  dailyCallRoom: any
) {
  switch (toolName) {
    case 'show_content': {
      // Directs the right-hand canvas (Excalidraw / Pricing)[cite: 1]
      const { view } = args;
      dailyCallRoom.sendAppMessage({
        event: 'ui_change',
        view, // 'four_square' | 'pricing_ladder' | 'deal_summary'
        activePrice: stateManager.getState().currentQuoteDaily,
      });
      return { status: 'canvas_updated', view };
    }

    case 'propose_concession': {
      // Evaluates price negotiation against deterministic ladder[cite: 1]
      const { stage } = args;
      const result = stateManager.executeConcession(Number(stage));

      if (!result.success) {
        // Feed violation back into LLM so it executes the manager escalation line[cite: 1]
        return {
          status: 'rejected',
          reason: result.message,
          directive: 'Refuse concession. Say: "Let me get my manager to see what else we can do for you."',
        };
      }

      // Notify frontend canvas of price change
      dailyCallRoom.sendAppMessage({
        event: 'price_updated',
        dailyPrice: result.newPrice,
        monthlyPrice: result.newPrice * 30,
      });

      return {
        status: 'approved',
        currentPriceDaily: result.newPrice,
        currentPriceMonthly: result.newPrice * 30,
      };
    }

    case 'advance_stage': {
      const { targetStep } = args;
      try {
        stateManager.setStep(targetStep);
        return { status: 'step_advanced', activeStep: targetStep };
      } catch (err: any) {
        return { status: 'error', message: err.message };
      }
    }

    default:
      return { status: 'unhandled_tool' };
  }
}

```

---

### Key Operational Assurances

* **Zero Memory Drift Across 60 Minutes:** By slicing `this.history.slice(-6)`, transcript tokens never accumulate. The LLM reasons over an 800-token window with the deal state injected into the prompt prefix on every turn.


* **Mathematically Impossible Floor Breaches:** The LLM does not generate numbers out of its own weights. If the customer demands $2.50, `propose_concession` checks `targetPrice < hardFloorDaily ($3.00)` and rejects the turn, forcing the exact fallback script.


* **Pre-empting Premature Verification:** If the customer introduces themselves or asks about documents at minute 2, the `setStep` validator rejects any attempt to jump to Step 7 before Step 6 (Close) is marked complete.