/**
 * Customer Simulator Persona Engine (Agent 2)
 * Simulates realistic car dealership customers to test Max (Agent 1) in automated calls.
 */

export type CustomerPersona =
  | "cooperative"
  | "price_skeptic"
  | "objection_heavy"
  | "interrupter"
  | "off_script";

export interface SimulatorResponse {
  spokenText: string;
  isBargeIn?: boolean;
  bargeInTrigger?: string;
  personaNotes?: string;
}

export async function generateCustomerResponse(params: {
  persona: CustomerPersona;
  lastMaxSpeech: string;
  currentBeatId: number;
  turnIndex: number;
}): Promise<SimulatorResponse> {
  const { persona, lastMaxSpeech, currentBeatId, turnIndex } = params;

  // Step 0 Tech Check / Greeting handling
  if (currentBeatId === 0 || lastMaxSpeech.toLowerCase().includes("hear and see me alright")) {
    return {
      spokenText: "Yes, I can hear and see you alright Max.",
      isBargeIn: false,
    };
  }

  // 1. Interrupter Persona (tests barge-in cutoff detection)
  if (persona === "interrupter") {
    const interrupterTurns = [
      { trigger: "wait", text: "Wait, hold on a second Max." },
      { trigger: "stop", text: "Stop, what did you just say?" },
      { trigger: "hold on", text: "Hold on, can you explain that?" },
      { trigger: "sorry", text: "Sorry, I missed the last part." },
      { trigger: "what", text: "What does that warranty actually cover?" },
    ];
    const pick = interrupterTurns[turnIndex % interrupterTurns.length];
    return {
      spokenText: pick.text,
      isBargeIn: true,
      bargeInTrigger: pick.trigger,
      personaNotes: `Testing barge-in cutoff on trigger word "${pick.trigger}"`,
    };
  }

  // 2. Price Skeptic Persona (tests early price asking and deferral)
  if (persona === "price_skeptic") {
    if (currentBeatId < 22 && turnIndex % 2 === 1) {
      return {
        spokenText: "Before we go further, how much is this going to cost me per month?",
        isBargeIn: false,
        personaNotes: "Asking for price before Beat 22 (testing DEFER_LINE)",
      };
    }
    if (currentBeatId === 22) {
      return {
        spokenText: "Four dollars a day makes sense. Let's do it.",
        isBargeIn: false,
        personaNotes: "Accepting price at Beat 22",
      };
    }
    return {
      spokenText: "Okay, go on.",
      isBargeIn: false,
    };
  }

  // 3. Objection Heavy Persona (tests 'No' lead-in and 2-in-a-row handoff)
  if (persona === "objection_heavy") {
    if (turnIndex === 1) {
      return {
        spokenText: "No, I don't really understand that part.",
        isBargeIn: false,
        personaNotes: "First 'No' (tests LEAD_IN_NO + repeat beat)",
      };
    }
    if (turnIndex === 2) {
      return {
        spokenText: "Still no, I don't want any extra packages.",
        isBargeIn: false,
        personaNotes: "Second consecutive 'No' (tests HANDOFF_LINE handoff)",
      };
    }
    return {
      spokenText: "No thanks.",
      isBargeIn: false,
    };
  }

  // 4. Off-Script Persona (tests non-financial off-script and financial safety)
  if (persona === "off_script") {
    const offScriptQuestions = [
      "Where is the coffee machine in the waiting lounge?",
      "What is my interest rate on this auto loan?",
      "Can I get a bottle of water while we review?",
      "How much will I get for my trade-in vehicle?",
    ];
    const q = offScriptQuestions[turnIndex % offScriptQuestions.length];
    return {
      spokenText: q,
      isBargeIn: false,
      personaNotes: `Testing off-script handling: "${q}"`,
    };
  }

  // 5. Cooperative Persona (Default, moves smoothly through beats)
  const cooperativeReplies = [
    "Yes, I drove the Mazda and loved it.",
    "Yes, the salesperson showed me the features and the touchscreen.",
    "My understanding is that Mazda gives a standard factory warranty.",
    "Sounds good Max, please explain the details.",
    "Yes, that seems like a good manufacturer warranty.",
    "Understood, defect only stated in the owner manual.",
    "Makes sense, wear and tear is on the driver.",
    "Yeah, normal brake pads and tires wear out.",
    "Right, with today's electronics that can get expensive.",
    "Yes, I see the labor rate is high.",
    "Yeah, that average repair cost is significant.",
    "I understand the bumper to bumper protection.",
    "Yes, tire and wheel road hazard coverage makes sense.",
    "Understood, scheduled maintenance saves money.",
    "Four dollars a day sounds reasonable.",
  ];

  return {
    spokenText: cooperativeReplies[turnIndex % cooperativeReplies.length] || "Yes, sounds good.",
    isBargeIn: false,
    personaNotes: "Cooperative agreement to advance to next beat",
  };
}
