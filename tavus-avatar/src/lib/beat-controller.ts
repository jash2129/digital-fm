import beatsData from "./beats.json" with { type: "json" };
import { DEFAULT_DEAL_CONFIG, type DealConfig } from "./deal-config";
import {
  LEAD_IN_NO,
  GARBLED_LINE,
  DEFER_LINE,
  OUT_OF_SCRIPT_LINE,
  HANDOFF_LINE,
  AI_DISCLOSURE_LINE,
  STEP_0_GREETING,
  STEP_0_RAPPORT_LINE,
  STEP_0_TRANSITION_LINE,
  BEAT_TRANSITION_BRIDGES,
  PAUSE_LINE,
  LISTENING_LINE,
  SLOW_DOWN_LINE,
  COMPLIMENT_LINE,
  IDENTITY_LINE,
  EQ_DEESCALATION_LINE,
  EQ_REASSURANCE_LINE,
  EQ_EXCITEMENT_LINE,
  EQ_HUMOR_BRIDGES,
  INSURANCE_LINE,
  SPOUSE_LINE,
  CANCELLATION_LINE,
  VEHICLE_DISCREPANCY_LINE,
  MANUFACTURER_VS_DEALER_LINE,
  SALES_CALL_LINE,
  CALL_PURPOSE_LINE,
  FLOOR_PRICE_LINE,
  SCRIPT_COMPLETE_LINE,
  REPEATED_NO_LINE,
} from "./max-lines";

export interface Beat {
  id: number;
  type: "wait" | "continue";
  text: string;
  check_in: string | null;
}

export const BEATS: Beat[] = beatsData as Beat[];

export interface CallState {
  current_beat: number;
  delivered_beats: number[];
  last_spoken_text: string;
  no_count_in_a_row: number;
  negotiated_price_so_far: number | null;
  concession_stage?: number;
  step0_turns: number;
  step0_completed: boolean;
  dealConfig: DealConfig;
  is_stopped: boolean;
}

export const BEAT_RECAPS: Record<number, string> = {
  6: "As a quick recap, your Mazda comes with the five-year sixty thousand mile base warranty and ten-year one hundred thousand mile powertrain coverage.",
  7: "Just to recap, the factory warranty covers factory defects only.",
  8: "As a quick recap, wear and tear from climate, roads, and driving causes ninety-five percent of breakdowns.",
  9: "As a recap, potholes and road hazards cause severe wear on tires, rims, and sensors.",
  10: "As a recap, wear and tear causes ninety-five percent of all mechanical breakdowns.",
  11: "To recap, diagnosis is always the mandatory first step before manufacturer warranty steps in.",
  12: "To recap, the manufacturer only covers factory defects, while wear and tear is out-of-pocket.",
  13: "To recap, major parts like an engine or transmission can cost seven to eight thousand dollars.",
  14: "To recap, dashboard sensors and electronics can cost thousands of dollars to replace.",
  15: "To recap, service labor can add ten to fifteen hours of expense to any major repair.",
  16: "As a quick recap, the wrap gives you ten years and one hundred thousand miles of bumper-to-bumper protection with zero deductible.",
  17: "As a quick recap, the tire and wheel package covers your tires and wheels for five full years with zero out-of-pocket costs.",
  18: "To recap, the five-year maintenance package covers your synthetic oil changes, filters, and tire rotations.",
  19: "To recap, with full protection, fuel is your only ongoing out-of-pocket expense.",
  20: "To recap, you get ten-year one hundred thousand mile bumper-to-bumper coverage with zero deductible.",
  21: "To recap, you get the five-year tire and wheel protection and five-year maintenance package.",
  22: "That full vehicle protection package is just four dollars a day.",
};

export type ClassifierIntent =
  | "agree"
  | "no"
  | "question_in_script"
  | "question_out_of_script"
  | "price_ask"
  | "negotiate_price"
  | "garbled"
  | "avatar_echo"
  | "repeat_request"
  | "restart_request"
  | "human_request"
  | "ai_question"
  | "tech_check_ack"
  | "pause_request"
  | "overwhelmed"
  | "compliment"
  | "identity_question"
  | "greeting_check"
  | "customer_frustrated"
  | "customer_anxious"
  | "spouse_objection"
  | "insurance_question"
  | "cancellation_question"
  | "vehicle_discrepancy"
  | "manufacturer_vs_dealer"
  | "sales_question"
  | "call_purpose"
  | "other";

export interface ClassificationResult {
  intent: ClassifierIntent;
  topic_beat_ids: number[];
}

export interface ControllerDecision {
  textToSpeak: string;
  beatId: number;
  beatType: "wait" | "continue" | "stop";
  toolCalls: Array<{ name: string; args: Record<string, any> }>;
  state: CallState;
  intent: ClassifierIntent | "step0" | "greeting";
  isScriptComplete?: boolean;
}

// In-memory session state store for controller turns persisted across Next.js dev reloads
const globalForBeatController = globalThis as unknown as {
  activeStates?: Map<string, CallState>;
};
export const activeStates =
  globalForBeatController.activeStates ?? new Map<string, CallState>();
if (process.env.NODE_ENV !== "production") {
  globalForBeatController.activeStates = activeStates;
}

export function getOrCreateCallState(sessionId: string, dealConfig = DEFAULT_DEAL_CONFIG): CallState {
  if (!activeStates.has(sessionId)) {
    activeStates.set(sessionId, {
      current_beat: 0,
      delivered_beats: [],
      last_spoken_text: STEP_0_GREETING,
      no_count_in_a_row: 0,
      negotiated_price_so_far: null,
      concession_stage: 1,
      step0_turns: 0,
      step0_completed: false,
      dealConfig,
      is_stopped: false,
    });
  }
  return activeStates.get(sessionId)!;
}

export function resetCallState(sessionId: string): void {
  activeStates.delete(sessionId);
}

// Render raw beat text with placeholders replaced by deal variables
export function renderBeatText(beat: Beat, dealConfig: DealConfig): string {
  let rendered = beat.text;
  rendered = rendered.replace(/\{\{vehicle_year\}\}/g, dealConfig.vehicle_year);
  rendered = rendered.replace(/\{\{vehicle_make\}\}/g, dealConfig.vehicle_make);
  rendered = rendered.replace(/\{\{vehicle_model\}\}/g, dealConfig.vehicle_model);
  rendered = rendered.replace(/\{\{per_day_price\}\}/g, dealConfig.per_day_price);
  return rendered;
}

// Polish speech text with natural sentence boundaries, prosody pauses, and clean phonetic cadence
export function formatSpeechText(text: string): string {
  // Convert adjacent quotes into clean sentence boundaries with breathing room
  let clean = text.replace(/([.?!])\s*"\s*"([A-Za-z])/g, "$1 $2");
  clean = clean.replace(/([^.?!])\s*"\s*"([A-Za-z])/g, "$1. $2");
  clean = clean.replace(/^["'\s]+|["'\s]+$/g, "");
  clean = clean.replace(/"\s*"/g, ". ");

  // Spacing around punctuation
  clean = clean.replace(/\s+,\s*/g, ", ");
  clean = clean.replace(/\s+\.\s*/g, ". ");
  clean = clean.replace(/\s+/g, " ");

  // Prosody & Phonetic Polish:
  // Convert all-caps shouting words into natural executive speech
  clean = clean.replace(/\bWARE AND TEAR\b/g, "wear and tear");
  clean = clean.replace(/\bCLIMATE, ROAD CONDITION AND DRIVING HABIT specially here in texas\b/g, "climate, road conditions, and driving habits... especially here in Texas.");
  clean = clean.replace(/\bCLIMATE:\s*/g, "Climate... ");
  clean = clean.replace(/\bROAD CONDITION\b/g, "Road conditions");
  clean = clean.replace(/\bDRIVING HABITS\b/g, "Driving habits");
  clean = clean.replace(/\bDRIVING HABIT\b/g, "driving habits");

  // Fix awkward script typos so HeyGen TTS speaks fluent, confident English
  clean = clean.replace(/\bfutures and builts and whistles\b/gi, "features, bells, and whistles");
  clean = clean.replace(/\busuilaly\b/gi, "usually");
  clean = clean.replace(/\bware an tear\b/gi, "wear and tear");
  clean = clean.replace(/\bmis design or mis built or mis installed\b/gi, "misdesigned, misbuilt, or misinstalled");
  clean = clean.replace(/\bsecond of is\b/gi, "second warranty is");

  // Spoken Numbers & Pronunciation Formatting (STRICT TTS RULE from wordtoword.md)
  clean = clean.replace(/\b95\s*%/g, "ninety-five percent");
  clean = clean.replace(/\b110\s*degrees?\b/gi, "one hundred ten degrees");
  clean = clean.replace(/\b110\b/g, "one hundred ten");
  clean = clean.replace(/\b3\s*years\b/gi, "three years");
  clean = clean.replace(/\b4\s*years\b/gi, "four years");
  clean = clean.replace(/\b5-years?\b|\b5\s*years?\b/gi, "five years");
  clean = clean.replace(/\b7\s*years\b/gi, "seven years");
  clean = clean.replace(/\b10-years?\b|\b10\s*years?\b/gi, "ten years");
  clean = clean.replace(/\b36,000\b/g, "thirty-six thousand");
  clean = clean.replace(/\b60,000\b/g, "sixty thousand");
  clean = clean.replace(/\b100\s*percent\b/gi, "one hundred percent");
  clean = clean.replace(/\b100,000\b/g, "one hundred thousand");
  clean = clean.replace(/\b100\b/g, "one hundred");
  clean = clean.replace(/\b2\s*different\s*warrant(?:y|ies)\b/gi, "two different warranties");
  clean = clean.replace(/\b3\s*reasons?\b/gi, "three reasons");
  clean = clean.replace(/\b2\s*sets\b/gi, "two sets");
  clean = clean.replace(/\b8\s*tiers\b/gi, "eight tires");
  clean = clean.replace(/\b8\s*of\s*those\b/gi, "eight of those");
  clean = clean.replace(/\b10\s*hours\s*(and\s*15\s*hours)?\b/gi, "ten hours and fifteen hours");
  clean = clean.replace(/\b15\s*hours\b/gi, "fifteen hours");
  clean = clean.replace(/\b4\s*thousand\b/gi, "four thousand");
  clean = clean.replace(/\b7\s*thousand\b/gi, "seven thousand");
  clean = clean.replace(/\b6\s*thousand\b/gi, "six thousand");
  clean = clean.replace(/\b29\s*dollar\b/gi, "twenty-nine dollars");
  clean = clean.replace(/\b8\s*dollars\b/gi, "eight dollars");
  clean = clean.replace(/\b4\s*dollars\b/gi, "four dollars");
  clean = clean.replace(/\$4\.00|\$4\b/gi, "four dollars");
  clean = clean.replace(/\$3\.50\b/gi, "three dollars and fifty cents");
  clean = clean.replace(/\$3\.25\b/gi, "three dollars and twenty-five cents");
  clean = clean.replace(/\$3\.00|\$3\b/gi, "three dollars");
  clean = clean.replace(/\bhundred thirty dollar per hour up to hundred sixty dollar per hour\b/gi, "one hundred thirty to one hundred sixty dollars per hour");
  clean = clean.replace(/\bpage number 4\b/gi, "page number four");

  return clean.trim();
}

// Formats full utterance for a beat: beat text + check-in line with natural conversational pause
export function getFullBeatUtterance(beat: Beat, dealConfig: DealConfig): string {
  const rendered = renderBeatText(beat, dealConfig);
  const cleanBody = formatSpeechText(rendered);
  if (beat.check_in) {
    const cleanCheckIn = formatSpeechText(beat.check_in);
    // Ellipsis introduces a human 250ms conversational pause before the check-in question
    return `${cleanBody}... ${cleanCheckIn}`;
  }
  return cleanBody;
}

// Map beat numbers to their UI canvas tools
export function getBeatToolCalls(beatId: number): Array<{ name: string; args: Record<string, any> }> {
  switch (beatId) {
    case 6:
      return [{ name: "show_content", args: { item: "warranty_terms" } }];
    case 11:
      return [{ name: "show_content", args: { item: "cost_breakdown" } }];
    case 16:
      return [
        { name: "draw_grid_outline", args: {} },
        { name: "show_pricing", args: { product: "vsc" } },
      ];
    case 17:
      return [{ name: "show_pricing", args: { product: "tire_wheel" } }];
    case 18:
      return [{ name: "show_pricing", args: { product: "maintenance" } }];
    case 20:
      return [{ name: "show_pricing", args: { product: "gap" } }];
    case 22:
    case 23:
      return [{ name: "show_payment_breakdown", args: { daily_rate: 4 } }];
    case 24:
      return [{ name: "show_content", args: { item: "deal_summary" } }];
    default:
      return [];
  }
}

// Hook called when script reaches end of all beats
export function onScriptComplete(state: CallState): void {
  console.log(`[beat-controller] onScriptComplete() reached for session. Handoff line spoken.`);
  state.is_stopped = true;
}

/**
 * Detects whether an incoming customer transcript is actually an acoustic echo
 * of Max's voice leaking through laptop speakers into the microphone.
 */
export function isAvatarScriptEcho(transcript: string): boolean {
  const norm = transcript.toLowerCase().replace(/[^a-z0-9 ]/g, " ").trim();
  if (!norm) return false;

  const echoPhrases = [
    "great to connect with you",
    "congratulations on your",
    "thank you for buying with us",
    "handling your paperwork",
    "how has your experience been",
    "recorded audio and video",
    "required by the law",
    "before you sign any paperwork",
    "make sure you understand first",
    "agreed to buy a new",
    "chance to drive the vehicle",
    "walkaround and showed you",
    "bells and whistles",
    "builts and whistles",
    "understanding of the warranty",
    "what s your understanding",
    "whats your understanding",
    "warranty that comes with the vehicle",
    "did the sales person go over",
    "more information about the warranty",
    "base limited warranty",
    "power train which is referring",
    "defect only stated in the manual",
    "page number 4",
    "mis design or mis built",
    "ware and tear",
    "wear and tear",
    "climate road condition",
    "climate can go over 110",
    "potholes everywhere",
    "driving habits the way i drive",
    "service place and the first thing",
    "diagnose the vehicle",
    "reserve the right to determine",
    "engine by itself can cost",
    "luck of the draw",
    "sorry i didn t catch",
    "sorry i didn't catch",
    "allow me to go over it really quick",
    "cover that in just a moment",
    "colleague to cover right after",
    "bring in my colleague",
    "make a note of that for my colleague",
    "those purchase terms are locked in",
    "i have full authority to handle",
    "everything on your paperwork is all set",
    "three dollars a day is our absolute hard floor",
    "i'm an ai finance assistant",
    "take all the time you need",
    "let's slow down a bit",
    "i'm max your digital finance manager",
    "i'm listening please go ahead",
    "im listening please go ahead",
    "listening please go ahead",
    "please go ahead",
    "i'm listening please",
    "im listening please",
    "only the defect",
    "only defect",
    "as a quick reminder",
    "as a quick",
    "glovebox page number four",
    "glovebox page number 4",
    "misdesigned misbuilt or misinstalled",
    "misdesigned",
    "three reasons usually cause",
    "uneven service roads",
    "potholes everywhere",
    "true blanket cover warranty",
    "bumper to bumper"
  ];

  return echoPhrases.some((phrase) => norm.includes(phrase));
}

// Deterministic rule-based classification fallback (also used for unit/simulation tests)
export function classifyCustomerInputRuleBased(
  transcript: string,
  currentBeatId: number
): ClassificationResult {
  const norm = transcript.toLowerCase().replace(/[^a-z0-9 ]/g, " ").trim();
  const words = norm.split(/\s+/).filter(Boolean);

  if (words.length === 0) {
    return { intent: "garbled", topic_beat_ids: [] };
  }

  // 0. Avatar Script Echo Protection: Never treat Max's own script echoed from laptop speakers as user progression
  if (isAvatarScriptEcho(transcript)) {
    return { intent: "avatar_echo", topic_beat_ids: [] };
  }

  // 1. AI Question (check before human request so questions like "are you an AI avatar or a real person?" are handled as AI disclosure)
  if (
    norm.includes("are you an ai") ||
    norm.includes("are you a robot") ||
    norm.includes("are you real") ||
    norm.includes("are you a real person") ||
    norm.includes("real person or") ||
    norm.includes("or a real person") ||
    norm.includes("are you an avatar") ||
    norm.includes("is this ai") ||
    norm.includes("is this a real person") ||
    norm.includes("am i talking to an ai") ||
    norm.includes("am i talking to a real person") ||
    norm.includes("ai avatar")
  ) {
    return { intent: "ai_question", topic_beat_ids: [] };
  }

  // 1.2. Human request (explicit request to speak with / transfer to a human)
  if (
    norm.includes("speak to a human") ||
    norm.includes("talk to a human") ||
    norm.includes("speak with a human") ||
    norm.includes("talk with a human") ||
    norm.includes("talk to a person") ||
    norm.includes("speak to a person") ||
    norm.includes("talk to a real person") ||
    norm.includes("speak to a real person") ||
    norm.includes("get me a real person") ||
    norm.includes("give me a real person") ||
    norm.includes("connect me to a human") ||
    norm.includes("connect me with a human") ||
    norm.includes("human manager") ||
    norm.includes("speak to someone else") ||
    norm.includes("talk to someone else") ||
    norm.includes("transfer me") ||
    norm.includes("get me a manager") ||
    norm.includes("speak to your manager")
  ) {
    return { intent: "human_request", topic_beat_ids: [] };
  }

  // 1.3. Vehicle Mismatch / Car Discrepancy (e.g. "buying a Maybach", "I was buying Maybach", "that's not my car", "confirm which car", "how can you ask me that")
  // MUST be checked before generic negation 'no' or generic greetings!
  const isVehicleDiscrepancy =
    norm.includes("maybach") ||
    norm.includes("mercedes") ||
    norm.includes("bmw") ||
    norm.includes("audi") ||
    norm.includes("porsche") ||
    norm.includes("lexus") ||
    norm.includes("buying a ") ||
    norm.includes("was buying") ||
    norm.includes("am buying") ||
    norm.includes("bought a ") ||
    norm.includes("not buying a mazda") ||
    norm.includes("not a mazda") ||
    norm.includes("not my car") ||
    norm.includes("wrong car") ||
    norm.includes("wrong vehicle") ||
    norm.includes("different car") ||
    norm.includes("different vehicle") ||
    norm.includes("which car") ||
    norm.includes("confirm which car") ||
    norm.includes("what car") ||
    norm.includes("which vehicle") ||
    norm.includes("how can you ask me that");

  if (isVehicleDiscrepancy) {
    return { intent: "vehicle_discrepancy", topic_beat_ids: [] };
  }

  // 1.4. Manufacturer Warranty vs Dealership Vehicle Protection (e.g. "is this provided by the manufacturer", "should I buy the new one")
  const isManufacturerVsDealer =
    norm.includes("provided by the manufacturer") ||
    norm.includes("provided by manufacturer") ||
    norm.includes("by the manufacturer") ||
    norm.includes("from the manufacturer") ||
    norm.includes("does this provided") ||
    norm.includes("is this provided") ||
    norm.includes("comes from the manufacturer") ||
    norm.includes("should i buy the new one") ||
    norm.includes("should i buy a new one") ||
    norm.includes("buy the new one") ||
    norm.includes("buy a new one") ||
    norm.includes("buy the new warranty") ||
    norm.includes("buy a new warranty") ||
    norm.includes("new warranty or") ||
    norm.includes("is this from mazda") ||
    norm.includes("is this third party") ||
    norm.includes("who provides this") ||
    norm.includes("who provides the warranty");

  if (isManufacturerVsDealer) {
    return { intent: "manufacturer_vs_dealer", topic_beat_ids: [] };
  }

  // 1.5. Identity questions (e.g. "who's this", "who are you", "what's your name", "who am i talking to", "yeah who's this")
  if (
    norm.includes("who is this") ||
    norm.includes("whos this") ||
    norm.includes("who s this") ||
    norm.includes("who is speaking") ||
    norm.includes("who are you") ||
    norm.includes("who am i talking") ||
    norm.includes("who am i speaking") ||
    norm.includes("what is your name") ||
    norm.includes("whats your name") ||
    norm.includes("what s your name") ||
    norm.includes("who is that") ||
    norm.includes("who s that") ||
    norm.includes("who that") ||
    norm.includes("who this") ||
    norm === "who"
  ) {
    return { intent: "identity_question", topic_beat_ids: [] };
  }

  // 1.6. Sales call inquiry (e.g. "is this a sales call", "are you selling me something", "trying to sell")
  if (
    norm.includes("sales call") ||
    norm.includes("sell me") ||
    norm.includes("trying to sell") ||
    norm.includes("selling something") ||
    norm.includes("selling me")
  ) {
    return { intent: "sales_question", topic_beat_ids: [] };
  }

  // 1.7. Call purpose inquiry (e.g. "what is this about", "why are we doing this", "what is this call for")
  if (
    norm.includes("what is this about") ||
    norm.includes("whats this about") ||
    norm.includes("why are we doing this") ||
    norm.includes("what is this for") ||
    norm.includes("whats this for") ||
    norm.includes("what are we doing") ||
    norm.includes("why am i here")
  ) {
    return { intent: "call_purpose", topic_beat_ids: [] };
  }

  // 1.8. Mid-call presence checks / greetings (e.g. "hey", "hello", "hi", "hey max", "are you there")
  if (
    norm === "hey" ||
    norm === "hi" ||
    norm === "hello" ||
    norm === "hey max" ||
    norm === "hello max" ||
    norm === "hi max" ||
    norm.includes("are you there") ||
    norm.includes("you there")
  ) {
    return { intent: "greeting_check", topic_beat_ids: [] };
  }

  // 3. Restart request
  if (
    norm.includes("start over") ||
    norm.includes("from the beginning") ||
    norm.includes("restart")
  ) {
    return { intent: "restart_request", topic_beat_ids: [] };
  }

  // 4. Repeat request
  if (
    norm.includes("repeat that") ||
    norm.includes("say that again") ||
    norm.includes("say again") ||
    norm.includes("what did you say") ||
    norm.includes("one more time") ||
    norm.includes("come again")
  ) {
    return { intent: "repeat_request", topic_beat_ids: [] };
  }

  // 5. Price ask (before beat 22)
  if (
    norm.includes("how much") ||
    norm.includes("what is the price") ||
    norm.includes("what does it cost") ||
    norm.includes("how much is this") ||
    norm.includes("what is the monthly")
  ) {
    return { intent: "price_ask", topic_beat_ids: [] };
  }

  // 5.5. Contextual Progression & Negotiation at Beats 22-25 (Evaluate BEFORE generic topic keywords!)
  if (currentBeatId >= 22) {
    const isCloseConfirmation =
      norm.includes("confirm") ||
      norm.includes("forward") ||
      norm.includes("finish the paperwork") ||
      norm.includes("finalize") ||
      norm.includes("let's do it") ||
      norm.includes("lets do it") ||
      norm.includes("we have a deal") ||
      (norm.includes("deal") && !norm.includes("no deal"));

    if (isCloseConfirmation) {
      return { intent: "agree", topic_beat_ids: [] };
    }

    const isCounterOfferOrFloorPush =
      norm.includes("three dollar") ||
      norm.includes("three dollars") ||
      norm.includes("3 dollar") ||
      norm.includes("3.00") ||
      norm.includes("two dollar") ||
      norm.includes("two fifty") ||
      norm.includes("cheaper") ||
      norm.includes("can you do") ||
      norm.includes("better on the price") ||
      norm.includes("too expensive") ||
      norm.includes("too much") ||
      norm.includes("lower the price") ||
      norm.includes("lower") ||
      norm.includes("discount") ||
      norm.includes("dollar fifty") ||
      norm.includes("1.50") ||
      norm.includes("no deal") ||
      norm.includes("come down");

    if (isCounterOfferOrFloorPush) {
      return { intent: "negotiate_price", topic_beat_ids: [] };
    }

    if (currentBeatId === 22) {
      if (
        norm.includes("sounds good") ||
        norm.includes("sounds great") ||
        norm.includes("great protection") ||
        norm.includes("reasonable") ||
        norm.includes("four dollars") ||
        norm.includes("agree") ||
        norm.includes("yes") ||
        norm.includes("focus on") ||
        norm.includes("options")
      ) {
        return { intent: "agree", topic_beat_ids: [] };
      }
    }

    if (currentBeatId === 23) {
      if (
        norm.includes("value") ||
        norm.includes("warranty") ||
        norm.includes("tire") ||
        norm.includes("maintenance") ||
        norm.includes("four dollars") ||
        norm.includes("three dollars and fifty") ||
        norm.includes("three twenty-five") ||
        norm.includes("fair") ||
        norm.includes("agree") ||
        norm.includes("yes") ||
        norm.includes("sounds good") ||
        norm.includes("works for me") ||
        norm.includes("both")
      ) {
        return { intent: "agree", topic_beat_ids: [] };
      }
    }

    if (currentBeatId === 24) {
      if (
        norm.includes("confirm") ||
        norm.includes("forward") ||
        norm.includes("yes") ||
        norm.includes("ready") ||
        norm.includes("sounds good") ||
        norm.includes("finalize") ||
        norm.includes("absolutely")
      ) {
        return { intent: "agree", topic_beat_ids: [] };
      }
    }

    if (currentBeatId === 25) {
      return { intent: "agree", topic_beat_ids: [] };
    }
  }

  // 5.75. Customer answers Beat 1 (Legal Disclosure & Agreement to proceed)
  if (currentBeatId === 1) {
    const isExplicitNegation =
      norm === "no" || norm === "nope" || norm.startsWith("no ") || norm.includes("don't agree") || norm.includes("dont agree");
    const isCompliment =
      norm.includes("love") ||
      norm.includes("beautiful") ||
      norm.includes("dream") ||
      norm.includes("gorgeous") ||
      norm.includes("amazing");
    if (!isExplicitNegation && !isVehicleDiscrepancy && !isManufacturerVsDealer && !isCompliment) {
      if (
        isAffirmativeOrProgression(norm) ||
        norm.includes("okay") ||
        norm.includes("ok") ||
        norm.includes("yes") ||
        norm.includes("sure") ||
        norm.includes("fine") ||
        norm.includes("understand") ||
        norm.includes("understanding") ||
        norm.includes("sound") ||
        norm.includes("good") ||
        norm.includes("drove") ||
        norm.includes("drive") ||
        norm.includes("ready") ||
        norm.includes("sales") ||
        norm.includes("warranty")
      ) {
        return { intent: "agree", topic_beat_ids: [] };
      }
    }
  }

  // 5.8. Customer answers Beat 4 (Warranty Understanding inquiry)
  if (currentBeatId === 4) {
    const isWarrantyExplanation =
      norm.includes("salesperson") ||
      norm.includes("sales person") ||
      norm.includes("salesman") ||
      norm.includes("he told") ||
      norm.includes("he said") ||
      norm.includes("they said") ||
      norm.includes("defect") ||
      norm.includes("benefited") ||
      norm.includes("benefit") ||
      norm.includes("factory warranty") ||
      norm.includes("warranty") ||
      norm.includes("only when") ||
      norm.includes("only applicable") ||
      norm.includes("only applied") ||
      norm.includes("only apply") ||
      norm.includes("did go over") ||
      norm.includes("went over") ||
      norm.includes("yes he did") ||
      norm.includes("yeah he did");

    if (isWarrantyExplanation) {
      return { intent: "agree", topic_beat_ids: [] };
    }
  }

  // 6. In-script question matching
  if (
    norm.includes("what does it cover") ||
    norm.includes("what is covered") ||
    norm.includes("tell me about the warranty")
  ) {
    return { intent: "question_in_script", topic_beat_ids: [6] };
  }
  if (
    norm.includes("wear and tear") ||
    norm.includes("what causes breakdowns")
  ) {
    return { intent: "question_in_script", topic_beat_ids: [8, 9, 10] };
  }
  if (
    norm.includes("how much are parts") ||
    norm.includes("repair costs") ||
    norm.includes("cost of repair")
  ) {
    return { intent: "question_in_script", topic_beat_ids: [13, 14, 15] };
  }
  if (
    norm.includes("tire") ||
    norm.includes("wheel")
  ) {
    return { intent: "question_in_script", topic_beat_ids: [17] };
  }
  if (
    norm.includes("oil change") ||
    norm.includes("maintenance")
  ) {
    return { intent: "question_in_script", topic_beat_ids: [18] };
  }

  // 7. Out-of-script question
  if (
    norm.includes("interest rate") ||
    norm.includes("apr") ||
    norm.includes("trade in") ||
    norm.includes("dealer fee") ||
    norm.includes("down payment")
  ) {
    return { intent: "question_out_of_script", topic_beat_ids: [] };
  }

  // 7.1. Spouse / Wife decision-maker objection
  if (
    norm.includes("my wife") ||
    norm.includes("ask my wife") ||
    norm.includes("wife handles") ||
    norm.includes("wife makes") ||
    norm.includes("check with my wife") ||
    norm.includes("my husband")
  ) {
    return { intent: "spouse_objection", topic_beat_ids: [] };
  }

  // 7.2. Auto Insurance vs Mechanical Protection question
  if (
    norm.includes("car insurance") ||
    norm.includes("auto insurance") ||
    (norm.includes("insurance") && norm.includes("cover"))
  ) {
    return { intent: "insurance_question", topic_beat_ids: [] };
  }

  // 7.3. Cancellation / Transferability question
  if (
    norm.includes("cancel") ||
    norm.includes("refund") ||
    norm.includes("money back") ||
    (norm.includes("sell the car") && norm.includes("what happen"))
  ) {
    return { intent: "cancellation_question", topic_beat_ids: [] };
  }

  // 8. Explicit No
  if (
    norm === "no" ||
    norm === "nope" ||
    norm === "not really" ||
    norm === "i don t understand" ||
    norm.startsWith("no ") ||
    norm.endsWith(" no") ||
    norm.includes(" no ") ||
    norm.includes("still no") ||
    norm.includes("no thanks")
  ) {
    return { intent: "no", topic_beat_ids: [] };
  }

  // 8.5. Tech check & video/audio connection confirmation (e.g. "I can see you", "Yeah I can see you", "Loud and clear")
  // MUST NOT advance sales script beats (e.g. Qualifying questions)
  const isTechCheckPhrase =
    norm.includes("see you") ||
    norm.includes("hear you") ||
    norm.includes("hear and see") ||
    norm.includes("see and hear") ||
    norm.includes("loud and clear") ||
    norm.includes("can see") ||
    norm.includes("can hear") ||
    norm.includes("i see you") ||
    norm.includes("i hear you");

  if (isTechCheckPhrase) {
    return { intent: "tech_check_ack", topic_beat_ids: [] };
  }

  // 8.6. Pause / Hold / Interjection request (e.g. "wait a second", "hold on", "give me a moment", "let me tell you", "let me finish")
  // Do NOT advance beat or treat as cold negation/abandonment
  if (
    norm.includes("hold on") ||
    norm.includes("wait a sec") ||
    norm.includes("wait a minute") ||
    norm.includes("wait a moment") ||
    norm.includes("one second") ||
    norm.includes("one sec") ||
    norm.includes("give me a second") ||
    norm.includes("give me a sec") ||
    norm.includes("give me a minute") ||
    norm.includes("give me a moment") ||
    norm.includes("let me think") ||
    norm.includes("hang on") ||
    norm.includes("hold up") ||
    norm.includes("let me tell you") ||
    norm.includes("let me speak") ||
    norm.includes("let me finish") ||
    norm.includes("let me complete") ||
    norm.includes("listen to me") ||
    norm.includes("listen first") ||
    norm.includes("hear me out")
  ) {
    return { intent: "pause_request", topic_beat_ids: [] };
  }

  // 8.65. Beat 4 Qualifying Question ("What's your understanding of the warranty...")
  // When customer explains what the salesperson told them, advance to Beat 5
  if (currentBeatId === 4) {
    if (
      norm.includes("explained") ||
      norm.includes("told me") ||
      norm.includes("said that") ||
      norm.includes("went over") ||
      norm.includes("mentioned") ||
      norm.includes("basic") ||
      norm.includes("factory warranty") ||
      norm.includes("manufacturer") ||
      norm.includes("some of") ||
      norm.includes("not much") ||
      norm.includes("a little") ||
      norm.includes("showed me")
    ) {
      return { intent: "agree", topic_beat_ids: [] };
    }
  }

  // 8.66. Beat 22 Offer Pitch -> Advance to Beat 23 (Negotiation/Value)
  if (currentBeatId === 22) {
    if (
      norm.includes("sounds good") ||
      norm.includes("sounds great") ||
      norm.includes("great protection") ||
      norm.includes("let's do it") ||
      norm.includes("lets do it") ||
      norm.includes("four dollars") ||
      norm.includes("agree") ||
      norm.includes("yes") ||
      norm.includes("deal") ||
      norm.includes("focus on") ||
      norm.includes("options")
    ) {
      return { intent: "agree", topic_beat_ids: [] };
    }
  }

  // 8.67. Beat 23 Negotiation Value -> Advance to Beat 24 (Verbal Close)
  if (currentBeatId === 23) {
    if (
      norm.includes("value") ||
      norm.includes("warranty") ||
      norm.includes("tire") ||
      norm.includes("maintenance") ||
      norm.includes("four dollars") ||
      norm.includes("fair") ||
      norm.includes("agree") ||
      norm.includes("yes") ||
      norm.includes("sounds good") ||
      norm.includes("both")
    ) {
      return { intent: "agree", topic_beat_ids: [] };
    }
  }

  // 8.68. Beat 24 Verbal Close Confirmation -> Advance to Beat 25 (Verification)
  if (currentBeatId === 24) {
    if (
      norm.includes("confirm") ||
      norm.includes("forward") ||
      norm.includes("yes") ||
      norm.includes("ready") ||
      norm.includes("let's do it") ||
      norm.includes("lets do it") ||
      norm.includes("sounds good") ||
      norm.includes("finalize") ||
      norm.includes("absolutely")
    ) {
      return { intent: "agree", topic_beat_ids: [] };
    }
  }

  // 8.69. Beat 25 Post-Close Verification -> Terminal completion
  if (currentBeatId === 25) {
    if (
      norm.includes("name is") ||
      norm.includes("address") ||
      norm.includes("alex") ||
      norm.includes("terrace") ||
      norm.includes("street") ||
      norm.includes("confirm") ||
      norm.includes("correct") ||
      norm.includes("spelling") ||
      norm.includes("yes")
    ) {
      return { intent: "agree", topic_beat_ids: [] };
    }
  }

  // 8.7. Overwhelmed / Pace adjustment request (e.g. "slow down", "too fast", "moving too fast", "lot of information")
  if (
    norm.includes("slow down") ||
    norm.includes("too fast") ||
    norm.includes("moving too fast") ||
    norm.includes("lot of info") ||
    norm.includes("lot of information") ||
    norm.includes("overwhelmed")
  ) {
    return { intent: "overwhelmed", topic_beat_ids: [] };
  }

  // 8.8. Vehicle compliment, excitement, or humor appreciation (e.g. "I love this car", "beautiful vehicle", "haha that's funny")
  if (
    norm.includes("love this car") ||
    norm.includes("love the car") ||
    norm.includes("beautiful car") ||
    norm.includes("great car") ||
    norm.includes("drove like a dream") ||
    norm.includes("love the color") ||
    norm.includes("gorgeous car") ||
    norm.includes("amazing car") ||
    norm.includes("amazing vehicle") ||
    norm.includes("so excited") ||
    norm.includes("can't wait to drive") ||
    norm.includes("cant wait to drive") ||
    norm.includes("pumped") ||
    norm.includes("stoked") ||
    norm.includes("dream car") ||
    norm.includes("so happy") ||
    norm.includes("thrilled") ||
    norm.includes("haha") ||
    norm.includes("lol") ||
    norm.includes("funny") ||
    norm.includes("hilarious")
  ) {
    return { intent: "compliment", topic_beat_ids: [] };
  }

  // 8.82. Customer Frustration / Impatience / Rush
  if (
    norm.includes("hurry up") ||
    norm.includes("been waiting") ||
    norm.includes("waiting so long") ||
    norm.includes("taking forever") ||
    norm.includes("waste my time") ||
    norm.includes("wasting my time") ||
    norm.includes("don't waste my time") ||
    norm.includes("dont waste my time") ||
    norm.includes("hate paperwork") ||
    norm.includes("let's get this over") ||
    norm.includes("lets get this over") ||
    norm.includes("tired of waiting") ||
    norm.includes("been here 3 hours") ||
    norm.includes("been here for hours") ||
    norm.includes("annoyed") ||
    norm.includes("frustrated") ||
    norm.includes("too slow") ||
    norm.includes("wrap it up") ||
    norm.includes("get on with it") ||
    norm.includes("get to the point")
  ) {
    return { intent: "customer_frustrated", topic_beat_ids: [] };
  }

  // 8.83. Customer Anxiety / Fear / Doubt / Buyer's Remorse
  if (
    norm.includes("scared") ||
    norm.includes("nervous") ||
    norm.includes("anxious") ||
    norm.includes("doubt") ||
    norm.includes("worried") ||
    norm.includes("first time buying") ||
    norm.includes("first car") ||
    norm.includes("hesitant") ||
    norm.includes("afraid") ||
    norm.includes("buyer's remorse") ||
    norm.includes("buyers remorse") ||
    norm.includes("afraid of getting ripped") ||
    norm.includes("scared of hidden fees") ||
    norm.includes("hidden cost") ||
    norm.includes("feel pressured") ||
    norm.includes("feeling pressured") ||
    norm.includes("is this a scam") ||
    norm.includes("what if i make a mistake")
  ) {
    return { intent: "customer_anxious", topic_beat_ids: [] };
  }

  // 9. Comprehensive Natural Affirmation / Progression
  // Handles compound colloquial variations ("yeah, yeah, okay, go on", "ok sure sounds good", "carry on", etc.)
  if (isAffirmativeOrProgression(norm)) {
    return { intent: "agree", topic_beat_ids: [] };
  }

  return { intent: "other", topic_beat_ids: [] };
}

/**
 * Robust affirmative & conversational progression evaluator.
 * Eliminates confusion with preset answers by recognizing any combination of natural affirmations.
 */
export function isAffirmativeOrProgression(norm: string): boolean {
  const words = norm.toLowerCase().replace(/[^a-z0-9 ]/g, " ").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return false;

  // Never treat avatar script echo as customer affirmative
  if (isAvatarScriptEcho(norm)) return false;

  // Never treat tech check as sales affirmative
  const techCheckPhrases = ["see you", "hear you", "can see", "can hear", "loud and clear"];
  if (techCheckPhrases.some((tcp) => norm.includes(tcp))) return false;

  // Explicit negations are NOT affirmations
  const negationWords = new Set(["no", "not", "dont", "nope", "never", "stop", "wait", "hold"]);
  if (words.some((w) => negationWords.has(w))) return false;

  // Explicit questions asking for information or rates are NOT simple progression
  const nonAffirmativeWords = new Set(["what", "why", "how", "who", "where", "when", "which", "rate", "apr", "cost", "price", "payment", "trade"]);
  if (words.some((w) => nonAffirmativeWords.has(w))) return false;

  // If the sentence starts with an affirmative anchor and has no questions/negations:
  const affirmativeAnchors = ["yes", "yeah", "yep", "yup", "yea", "sure", "ok", "okay", "alright", "right", "sounds good", "go on", "go ahead"];
  if (affirmativeAnchors.some((a) => norm === a || norm.startsWith(`${a} `))) {
    return true;
  }

  // Full vocabulary of affirmative & progression tokens
  const affirmativeVocabulary = new Set([
    "yes", "yeah", "yep", "yup", "yea", "sure", "ok", "okay", "k",
    "right", "alright", "all", "good", "sounds", "great", "fine", "cool",
    "continue", "go", "on", "ahead", "proceed", "carry", "moving", "forward",
    "makes", "sense", "understood", "understand", "with", "you",
    "he", "she", "they", "we", "i", "did", "have", "got", "it", "that", "done", "already",
    "drove", "test", "car", "vehicle",
    "definitely", "absolutely", "please", "ready", "set", "perfect", "true", "to", "me"
  ]);

  if (words.every((w) => affirmativeVocabulary.has(w))) {
    return true;
  }

  // Common multi-word progression phrases
  const commonPhrases = [
    "go on", "go ahead", "carry on", "sounds good", "makes sense",
    "i understand", "i understood", "with you", "let's do it", "lets do it",
    "all right", "all set", "take your time", "i drove it", "we drove it"
  ];
  if (commonPhrases.some((p) => norm.includes(p))) {
    return true;
  }

  return false;
}

// LLM Classifier using fast model with temperature: 0
export async function classifyWithLLM(
  customerTranscript: string,
  state: CallState
): Promise<ClassificationResult> {
  // Ultra-Fast Fast-Path: Deterministically classify common affirmations, objections, and standard requests in <1ms without remote LLM roundtrip lag
  const fastRuleResult = classifyCustomerInputRuleBased(customerTranscript, state.current_beat);
  if (fastRuleResult.intent !== "other") {
    return fastRuleResult;
  }

  const apiKey = process.env.XAI_API_KEY?.trim() || process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    return fastRuleResult;
  }

  const isXai = Boolean(process.env.XAI_API_KEY);
  const endpoint = isXai ? "https://api.x.ai/v1/chat/completions" : "https://api.openai.com/v1/chat/completions";
  const model = process.env.GROK_MODEL?.trim() || (isXai ? "grok-4.20-0309-non-reasoning" : "gpt-4o-mini");

  const systemPrompt = `You are a strict, ultra-fast intent classification engine for a car dealership finance manager call.
Output ONLY valid JSON with keys "intent" and "topic_beat_ids".
The LLM never writes sales dialogue. Only classify.

Intents:
- "agree": Customer affirms, agrees, says yes/yeah/ok/sure/makes sense/go on/sounds good, or answers affirmatively.
- "no": Customer says no, disagrees, or indicates confusion ("no", "not really", "i don't get it").
- "question_in_script": Customer asks a question answered by vehicle warranty/protection script topics (coverage, wear and tear, repair costs, tires, oil changes).
- "question_out_of_script": Customer asks a question outside warranty/protection (e.g. APR, loan interest rate, trade-in, dealer doc fee).
- "price_ask": Customer asks what it costs, the price, or daily/monthly payment.
- "garbled": Inaudible, empty, or unintelligible words.
- "repeat_request": Customer explicitly asks Max to repeat what he said ("say that again", "what did you say?").
- "restart_request": Customer asks to restart from the very beginning.
- "human_request": Customer asks for a human manager or real person.
- "ai_question": Customer asks if Max is an AI / robot / real person.
- "pause_request": Customer asks to hold on, pause, or take a moment.
- "overwhelmed": Customer asks Max to slow down or expresses information overload.
- "compliment": Customer compliments the vehicle, features, or experience.
- "customer_frustrated": Customer expresses impatience, anger, or complaints about wait times or paperwork.
- "customer_anxious": Customer expresses fear, anxiety, hesitation, or doubt about making a mistake or hidden costs.
- "identity_question": Customer asks who Max is, what his name is, or who they are speaking with.
- "vehicle_discrepancy": Customer states they are buying a different car (e.g. Maybach, BMW) or that the Mazda CX-5 is the wrong vehicle.
- "manufacturer_vs_dealer": Customer asks whether this protection is from the manufacturer or dealer, or whether they should buy a new warranty from the manufacturer.
- "other": Off-topic greeting or comment.

Topic Beat IDs:
If question_in_script:
- warranty overview: [6]
- wear and tear: [8, 9, 10]
- parts and repair labor costs: [13, 14, 15]
- bumper to bumper VSC coverage: [16]
- tires and wheels: [17]
- scheduled maintenance: [18]
Otherwise: []`;

  const userMessage = JSON.stringify({
    current_beat: state.current_beat,
    last_spoken_text: state.last_spoken_text,
    customer_transcript: customerTranscript,
  });

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMessage },
        ],
      }),
    });

    if (!res.ok) {
      return fastRuleResult;
    }

    const data = await res.json();
    const raw = data.choices?.[0]?.message?.content || "{}";
    const cleaned = raw.replace(/```json/gi, "").replace(/```/g, "").trim();
    const parsed = JSON.parse(cleaned);

    return {
      intent: parsed.intent || "other",
      topic_beat_ids: Array.isArray(parsed.topic_beat_ids) ? parsed.topic_beat_ids : [],
    };
  } catch (err) {
    console.warn("[beat-controller] LLM classification error, falling back to rule-based:", err);
    return fastRuleResult;
  }
}

// Step 0 Dynamic Rapport Generator (CONTEXT_RULES.md Stage 0 & Step 1)
export async function generateStep0Turn(
  customerTranscript: string,
  step0Turns: number,
  dealConfig = DEFAULT_DEAL_CONFIG
): Promise<{ text: string; moveToBeat1: boolean }> {
  const norm = customerTranscript.toLowerCase().replace(/[^a-z0-9 ]/g, " ").trim();
  const isTechAck =
    norm.includes("see you") ||
    norm.includes("hear you") ||
    norm.includes("loud and clear") ||
    norm.includes("can see") ||
    norm.includes("can hear") ||
    norm === "yes" ||
    norm === "yeah" ||
    norm === "yep" ||
    norm === "sure" ||
    norm === "i can" ||
    norm === "alright" ||
    norm === "all right" ||
    norm === "fine";

  // Prevent avatar echo from advancing Step 0 into Beat 1
  if (isAvatarScriptEcho(customerTranscript)) {
    console.warn(`[beat-controller] Step 0 detected avatar script echo: "${customerTranscript}". Staying on Step 0.`);
    let rapportText = STEP_0_RAPPORT_LINE;
    rapportText = rapportText.replace(/\{\{vehicle_year\}\}/g, dealConfig.vehicle_year);
    rapportText = rapportText.replace(/\{\{vehicle_make\}\}/g, dealConfig.vehicle_make);
    rapportText = rapportText.replace(/\{\{vehicle_model\}\}/g, dealConfig.vehicle_model);
    return {
      text: formatSpeechText(rapportText),
      moveToBeat1: false,
    };
  }

  // Turn 1: customer confirmed audio/video ("i can see you", "yes", etc.)
  // Build rapport & deliver formal greeting asking how their experience was
  if (step0Turns <= 1) {
    let rapportText = STEP_0_RAPPORT_LINE;
    rapportText = rapportText.replace(/\{\{vehicle_year\}\}/g, dealConfig.vehicle_year);
    rapportText = rapportText.replace(/\{\{vehicle_make\}\}/g, dealConfig.vehicle_make);
    rapportText = rapportText.replace(/\{\{vehicle_model\}\}/g, dealConfig.vehicle_model);
    return {
      text: formatSpeechText(rapportText),
      moveToBeat1: false,
    };
  }

  // Turn 2+: Check if customer is asking a question or interrupting BEFORE giving a rapport answer
  const isIdentityAsk =
    norm.includes("who are you") ||
    norm.includes("who is this") ||
    norm.includes("whos this") ||
    norm.includes("who am i") ||
    norm.includes("whats your name") ||
    norm.includes("what is your name") ||
    norm.includes("who you") ||
    norm === "who";

  if (isIdentityAsk) {
    return {
      text: "I'm Max, your digital finance manager today! I handle all your paperwork, title details, and warranty options before you drive off in your new car. How was your test drive out there today?",
      moveToBeat1: false,
    };
  }

  const isSalesAsk =
    (norm.includes("sales") &&
      (norm.includes("call") ||
        norm.includes("score") ||
        norm.includes("pitch") ||
        norm.includes("or not") ||
        norm.includes("is this") ||
        norm.includes("are you"))) ||
    norm.includes("sell me") ||
    norm.includes("trying to sell") ||
    norm.includes("selling something") ||
    norm.includes("selling");

  if (isSalesAsk) {
    return {
      text: "Not at all! This isn't a sales call—my job is simply to review your paperwork and factory warranty before you sign anything. Did our sales team treat you well today?",
      moveToBeat1: false,
    };
  }

  const isCallPurposeAsk =
    norm.includes("what is this about") ||
    norm.includes("whats this about") ||
    norm.includes("why are we doing this") ||
    norm.includes("what is this for") ||
    norm.includes("whats this for") ||
    norm.includes("why am i here") ||
    norm.includes("what are we doing");

  if (isCallPurposeAsk) {
    return {
      text: "Every buyer meets with finance before delivery to verify paperwork, registration details, and review factory warranty coverage. Did you get a good feel for the car on your test drive?",
      moveToBeat1: false,
    };
  }

  const isAiAsk =
    norm.includes("are you real") ||
    norm.includes("are you ai") ||
    norm.includes("are you a robot") ||
    norm.includes("is this ai") ||
    norm.includes("real person");

  if (isAiAsk) {
    return {
      text: "I'm an AI digital finance manager, built to make your paperwork fast, clear, and transparent! How was your test drive out there today?",
      moveToBeat1: false,
    };
  }

  const isPauseAsk =
    norm.includes("let me tell you") ||
    norm.includes("listen to me") ||
    norm.includes("wait a second") ||
    norm.includes("wait a minute") ||
    norm.includes("hold on") ||
    norm === "wait" ||
    norm === "stop";

  if (isPauseAsk) {
    return {
      text: "I'm listening, please go ahead.",
      moveToBeat1: false,
    };
  }

  // Turn 2+: Customer answered the rapport question ("it was great", "good", "fine", or complained about wait) -> smooth transition into Beat 1 Legal Disclosure
  const isNegative =
    norm.includes("wait") ||
    norm.includes("hour") ||
    norm.includes("forever") ||
    norm.includes("terrible") ||
    norm.includes("bad") ||
    norm.includes("horrible") ||
    norm.includes("frustrat") ||
    norm.includes("annoy") ||
    norm.includes("waste") ||
    norm.includes("hurry") ||
    norm.includes("rush") ||
    norm.includes("get this over") ||
    norm.includes("been here") ||
    norm.includes("sitting here") ||
    norm.includes("long time");

  const isAnxious =
    norm.includes("scared") ||
    norm.includes("nervous") ||
    norm.includes("anxious") ||
    norm.includes("doubt") ||
    norm.includes("worried") ||
    norm.includes("first time") ||
    norm.includes("hesitant");

  const isExcited =
    norm.includes("amazing") ||
    norm.includes("awesome") ||
    norm.includes("so excited") ||
    norm.includes("love it") ||
    norm.includes("love the car") ||
    norm.includes("best experience") ||
    norm.includes("thrilled") ||
    norm.includes("pumped");

  let transitionLine = STEP_0_TRANSITION_LINE;
  if (isNegative) {
    transitionLine = STEP_0_TRANSITION_LINE.replace(
      "Glad to hear that!",
      "I hear you completely—you've had a long day at the dealership, so I promise to keep this crisp, transparent, and direct."
    );
  } else if (isAnxious) {
    transitionLine = STEP_0_TRANSITION_LINE.replace(
      "Glad to hear that!",
      "I completely understand—buying a car is a big decision, so we'll take it one step at a time with zero pressure."
    );
  } else if (isExcited) {
    transitionLine = STEP_0_TRANSITION_LINE.replace(
      "Glad to hear that!",
      "I love that excitement! That new car is an absolute blast to drive!"
    );
  } else {
    transitionLine = STEP_0_TRANSITION_LINE.replace(
      "Glad to hear that!",
      "Awesome, so glad to hear that! Our team works really hard to take care of our customers."
    );
  }

  return {
    text: formatSpeechText(transitionLine),
    moveToBeat1: true,
  };
}

/**
 * Dynamic off-script responder with strict negative constraints.
 * Generates a concise, polite 1-sentence answer for general/dealership questions.
 *
 * Strict Negative Constraints:
 * 1. NO PRICING OR RATE PROMISES: NEVER state, quote, estimate, or promise interest rates (APR),
 *    monthly payments, loan term/duration, down payment, trade-in value, taxes, or discounts.
 * 2. If the user asks about financing terms, interest rates, monthly payment, down payment, or trade-in value,
 *    MUST defer to human colleague using OUT_OF_SCRIPT_LINE.
 * 3. Max length: 1 single sentence, max 20 words.
 * 4. Zero filler words ("Sure", "Awesome", "Great question", "Got it", "Of course").
 * 5. If response violates constraints (e.g. mentions $, %, rate, apr, payment), immediately fallback to OUT_OF_SCRIPT_LINE.
 */
export async function generateConstrainedOffScriptResponse(
  customerTranscript: string,
  state: CallState
): Promise<string> {
  const norm = customerTranscript.toLowerCase();

  // Hard safety filter: If asking about financial/rates/trade-in/payments, immediately use OUT_OF_SCRIPT_LINE
  const financialKeywords = [
    "rate",
    "apr",
    "interest",
    "monthly payment",
    "payment",
    "down payment",
    "trade in",
    "trade-in",
    "credit score",
    "loan term",
    "discount",
    "rebate",
    "invoice",
    "msrp",
  ];

  if (financialKeywords.some((kw) => norm.includes(kw))) {
    return OUT_OF_SCRIPT_LINE;
  }

  const apiKey = process.env.XAI_API_KEY?.trim() || process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    return "";
  }

  const isXai = Boolean(process.env.XAI_API_KEY);
  const endpoint = isXai ? "https://api.x.ai/v1/chat/completions" : "https://api.openai.com/v1/chat/completions";
  const model = process.env.GROK_MODEL?.trim() || (isXai ? "grok-4.20-0309-non-reasoning" : "gpt-4o-mini");

  const systemPrompt = `You are Max, an authoritative, polite Digital Finance Manager at a car dealership.
The customer asked an off-script question during their finance paperwork review.
Respond with EXACTLY ONE short, authoritative sentence (max 20 words) answering or acknowledging their question directly.

STRICT CONSTRAINTS:
- You have full authority to handle the deal. NEVER refer to a "colleague", "coworker", or "taking a note".
- NEVER tell the customer to "finish your question", "finish your sentence", or "could you please finish". If their statement is a fragment or incomplete, simply acknowledge politely ("Understood, please go ahead") or answer directly.
- NEVER quote, promise, or discuss specific interest rates (APR), monthly payments, loan terms, down payments, discounts, or trade-in values.
- NEVER make mechanical warranty guarantees beyond the manufacturer paperwork.
- NO filler words (do NOT start with "Sure", "Awesome", "Great question", "Got it", "Certainly", "Of course").
- Keep it natural, confident, direct, and under 20 words.
- Output ONLY the exact sentence to speak, no quotes, no markdown.`;

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.1,
        max_tokens: 60,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `Customer asked: "${customerTranscript}"` },
        ],
      }),
    });

    if (!res.ok) {
      return "";
    }

    const data = await res.json();
    let reply = (data.choices?.[0]?.message?.content || "").trim();
    reply = formatSpeechText(reply);

    // Safety checks against rate/price promises or scolding in output
    const replyNorm = reply.toLowerCase();
    if (
      replyNorm.includes("finish your question") ||
      replyNorm.includes("complete your question") ||
      replyNorm.includes("finish your sentence") ||
      replyNorm.includes("could you please finish")
    ) {
      return "I understand, please go ahead.";
    }

    if (
      !reply ||
      replyNorm.includes("$") ||
      replyNorm.includes("%") ||
      replyNorm.includes("percent") ||
      replyNorm.includes(" apr") ||
      replyNorm.includes("interest rate") ||
      replyNorm.includes("per month") ||
      replyNorm.includes("a month")
    ) {
      return OUT_OF_SCRIPT_LINE;
    }

    return reply;
  } catch (err) {
    console.warn("[beat-controller] Dynamic off-script generation error, falling back to empty:", err);
    return "";
  }
}

// -----------------------------------------------------------------------------
// MAIN CONTROLLER DECISION FUNCTION
// Evaluates customer input against current call state and outputs exact text to speak
// -----------------------------------------------------------------------------
export async function processControllerTurn(
  sessionId: string,
  customerTranscript: string,
  dealConfig = DEFAULT_DEAL_CONFIG,
  mockClassification?: ClassificationResult
): Promise<ControllerDecision> {
  const state = getOrCreateCallState(sessionId, dealConfig);

  // If already stopped after Beat 22 or handoff, speak HANDOFF_LINE and stop
  if (state.is_stopped) {
    return {
      textToSpeak: HANDOFF_LINE,
      beatId: state.current_beat,
      beatType: "stop",
      toolCalls: [],
      state,
      intent: "human_request",
      isScriptComplete: true,
    };
  }

  // ===========================================================================
  // 3.6 Step 0 (Before Beat 1)
  // ===========================================================================
  if (!state.step0_completed) {
    state.step0_turns++;
    const step0Result = await generateStep0Turn(customerTranscript, state.step0_turns, state.dealConfig);

    if (step0Result.moveToBeat1) {
      state.step0_completed = true;
      state.current_beat = 1;
      const beat1 = BEATS.find((b) => b.id === 1)!;
      const utterance = step0Result.text || getFullBeatUtterance(beat1, state.dealConfig);
      state.last_spoken_text = utterance;
      state.delivered_beats.push(1);

      return {
        textToSpeak: utterance,
        beatId: 1,
        beatType: beat1.type,
        toolCalls: getBeatToolCalls(1),
        state,
        intent: "step0",
      };
    } else {
      state.last_spoken_text = step0Result.text;
      return {
        textToSpeak: step0Result.text,
        beatId: 0,
        beatType: "wait",
        toolCalls: [],
        state,
        intent: "step0",
      };
    }
  }

  // ===========================================================================
  // 3.4 & 3.5 Intent Classification & Matrix Handling
  // ===========================================================================
  const classification = mockClassification || (await classifyWithLLM(customerTranscript, state));
  const { intent, topic_beat_ids } = classification;

  console.log(`[beat-controller] Turn Intent: "${intent}", Current Beat: ${state.current_beat}`);

  let textToSpeak = "";
  let beatType: "wait" | "continue" | "stop" = "wait";
  let toolCalls: Array<{ name: string; args: Record<string, any> }> = [];

  switch (intent) {
    case "agree": {
      state.no_count_in_a_row = 0;
      const nextBeatId = state.current_beat + 1;

      // Check if finished all script beats
      if (nextBeatId > BEATS.length) {
        state.is_stopped = true;
        textToSpeak = HANDOFF_LINE;
        beatType = "stop";
        toolCalls = [{ name: "show_content", args: { item: "escalate" } }];
        onScriptComplete(state);
        break;
      }

      state.current_beat = nextBeatId;
      state.delivered_beats.push(nextBeatId);
      const nextBeat = BEATS.find((b) => b.id === nextBeatId)!;
      const baseUtterance = getFullBeatUtterance(nextBeat, state.dealConfig);
      const bridge = BEAT_TRANSITION_BRIDGES[nextBeatId];
      textToSpeak = bridge ? `${bridge} ${baseUtterance}` : baseUtterance;
      beatType = nextBeat.type;
      toolCalls = getBeatToolCalls(nextBeatId);
      break;
    }

    case "no": {

      // Beat 3: Did salesperson do the walkaround?
      if (state.current_beat === 3) {
        state.no_count_in_a_row = 0;
        state.current_beat = 4;
        state.delivered_beats.push(4);
        const beat4 = BEATS.find((b) => b.id === 4)!;
        const beat4Utterance = getFullBeatUtterance(beat4, state.dealConfig);
        textToSpeak = `No problem at all, I'll make sure we go over all the features and paperwork so you have full clarity before you take delivery. ${beat4Utterance}`;
        beatType = beat4.type;
        toolCalls = getBeatToolCalls(4);
        break;
      }

      // Beat 4: Did salesperson go over the warranty?
      // TXM Branching logic on Q3:
      // If customer says No: "Allow me to go over it really quick to make sure that you understand everything. Also, if you have any questions, please do not hesitate to stop me and ask me."
      // Followed immediately by transitioning to the warranty presentation (Beat 6) and displaying warranty terms.
      if (state.current_beat === 4) {
        state.no_count_in_a_row = 0;
        state.current_beat = 6;
        if (!state.delivered_beats.includes(5)) state.delivered_beats.push(5);
        state.delivered_beats.push(6);
        const beat6 = BEATS.find((b) => b.id === 6)!;
        const beat6Utterance = getFullBeatUtterance(beat6, state.dealConfig);
        textToSpeak = `Allow me to go over it really quick to make sure that you understand everything. Also, if you have any questions, please do not hesitate to stop me and ask me. ${beat6Utterance}`;
        beatType = beat6.type;
        toolCalls = getBeatToolCalls(6);
        break;
      }

      // Beat 5: "There is actually more information... Is that okay?"
      if (state.current_beat === 5) {
        state.no_count_in_a_row = 0;
        state.current_beat = 6;
        state.delivered_beats.push(6);
        const beat6 = BEATS.find((b) => b.id === 6)!;
        const beat6Utterance = getFullBeatUtterance(beat6, state.dealConfig);
        textToSpeak = `I completely understand and I respect your time! By law, before you sign, I'm just required to go over what the manufacturer warranty does and doesn't cover so there are no surprises. Allow me to go over it really quick with you. ${beat6Utterance}`;
        beatType = beat6.type;
        toolCalls = getBeatToolCalls(6);
        break;
      }

      state.no_count_in_a_row++;
      if (state.no_count_in_a_row >= 2) {
        // After 2 in a row, hand off using HANDOFF_LINE
        state.is_stopped = true;
        textToSpeak = HANDOFF_LINE;
        beatType = "stop";
        toolCalls = [{ name: "show_content", args: { item: "escalate" } }];
        onScriptComplete(state);
      } else {
        // Speak lead-in line LEAD_IN_NO, then the same beat once more plus its check-in
        const currentBeat = BEATS.find((b) => b.id === state.current_beat)!;
        const beatUtterance = getFullBeatUtterance(currentBeat, state.dealConfig);
        textToSpeak = `${LEAD_IN_NO} ${beatUtterance}`;
        beatType = currentBeat.type;
      }
      break;
    }

    case "question_in_script": {
      // Speak only the focused sentence(s) from the primary beat in topic_beat_ids.
      // If a beat was already delivered, speak only its concise recap, never repeat the full paragraph or multiple recaps.
      const ids = topic_beat_ids.length > 0 ? topic_beat_ids : [state.current_beat];
      // Pick the first undelivered beat if any, otherwise the primary matched beat
      const undeliveredId = ids.find((id) => !state.delivered_beats.includes(id));
      const targetId = undeliveredId || ids[0];

      let responseText = "";
      if (state.delivered_beats.includes(targetId)) {
        responseText = BEAT_RECAPS[targetId] || "As a quick reminder, that coverage is fully included in your protection package.";
      } else {
        const beatObj = BEATS.find((b) => b.id === targetId);
        if (beatObj) {
          responseText = formatSpeechText(renderBeatText(beatObj, state.dealConfig));
          state.delivered_beats.push(targetId);
        } else {
          responseText = BEAT_RECAPS[state.current_beat] || "As a quick reminder, that coverage is fully included in your package.";
        }
      }

      const currentBeat = BEATS.find((b) => b.id === state.current_beat);
      const checkIn = currentBeat?.check_in ? formatSpeechText(currentBeat.check_in) : "Does that help clarify things?";
      if (!responseText.includes(checkIn)) {
        responseText += ` ${checkIn}`;
      }

      textToSpeak = responseText;
      beatType = "wait";
      break;
    }

    case "question_out_of_script": {
      // Generate constrained dynamic response with strict negative constraints (no pricing/rate promises), then resume
      const dynamicLeadIn = await generateConstrainedOffScriptResponse(customerTranscript, state);
      const nextBeatId = state.current_beat + 1;
      if (nextBeatId <= BEATS.length) {
        state.current_beat = nextBeatId;
        state.delivered_beats.push(nextBeatId);
        const nextBeat = BEATS.find((b) => b.id === nextBeatId)!;
        const nextUtterance = getFullBeatUtterance(nextBeat, state.dealConfig);
        textToSpeak = dynamicLeadIn ? `${dynamicLeadIn} ${nextUtterance}` : nextUtterance;
        beatType = nextBeat.type;
        toolCalls = getBeatToolCalls(nextBeatId);
      } else {
        textToSpeak = dynamicLeadIn ? `${dynamicLeadIn} ${HANDOFF_LINE}` : HANDOFF_LINE;
        state.is_stopped = true;
        beatType = "stop";
        toolCalls = [{ name: "show_content", args: { item: "escalate" } }];
      }
      break;
    }

    case "price_ask": {
      // Before Beat 22: speak DEFER_LINE, then resume
      if (state.current_beat < 22) {
        const nextBeatId = state.current_beat + 1;
        state.current_beat = nextBeatId;
        state.delivered_beats.push(nextBeatId);
        const nextBeat = BEATS.find((b) => b.id === nextBeatId)!;
        const nextUtterance = getFullBeatUtterance(nextBeat, state.dealConfig);
        textToSpeak = `${DEFER_LINE} ${nextUtterance}`;
        beatType = nextBeat.type;
        toolCalls = getBeatToolCalls(nextBeatId);
      } else {
        // At Beat 22: speak Beat 22 directly
        const beat22 = BEATS.find((b) => b.id === 22)!;
        textToSpeak = getFullBeatUtterance(beat22, state.dealConfig);
        beatType = "wait";
        toolCalls = getBeatToolCalls(22);
      }
      break;
    }

    case "negotiate_price": {
      // Approved ladder: Stage 1 ($4.00) -> Stage 2 ($3.50) -> Stage 3 ($3.25) -> Stage 4 ($3.00 hard floor)
      // Any offer below $3.00 must trigger manager handoff!
      const norm = customerTranscript.toLowerCase();
      const numbersInText = norm.match(/\b\d+(\.\d+)?\b/g)?.map(Number) || [];
      const hasOfferBelowThree =
        numbersInText.some((n) => n > 0 && n < 3.0) ||
        norm.includes("two dollars") ||
        norm.includes("one dollar") ||
        norm.includes("two fifty") ||
        norm.includes("dollar fifty") ||
        norm.includes("1.50") ||
        norm.includes("2.50") ||
        norm.includes("2.00");

      if (hasOfferBelowThree) {
        state.concession_stage = 4;
        state.dealConfig.per_day_price = "three dollars";
        textToSpeak = FLOOR_PRICE_LINE;
        beatType = "wait";
        toolCalls = [{ name: "show_payment_breakdown", args: { daily_rate: 3.0 } }];
        state.current_beat = 23;
        break;
      }

      const currentStage = state.concession_stage || 1;
      if (currentStage === 1) {
        state.concession_stage = 2;
        state.dealConfig.per_day_price = "three dollars and fifty cents";
        textToSpeak = "I understand. While four dollars is our standard rate, the best I can offer directly is three dollars and fifty cents a day. Which two coverages are most important to you?";
        beatType = "wait";
        toolCalls = [{ name: "show_payment_breakdown", args: { daily_rate: 3.5 } }];
        state.current_beat = 23;
      } else if (currentStage === 2) {
        state.concession_stage = 3;
        state.dealConfig.per_day_price = "three dollars and twenty-five cents";
        textToSpeak = "I want to make sure you get the right coverage. I can bring that down to three dollars and twenty-five cents a day. Does that sound fair?";
        beatType = "wait";
        toolCalls = [{ name: "show_payment_breakdown", args: { daily_rate: 3.25 } }];
        state.current_beat = 23;
      } else if (currentStage === 3) {
        state.concession_stage = 4;
        state.dealConfig.per_day_price = "three dollars";
        textToSpeak = "To make this work for you, three dollars a day is our absolute hard floor for full vehicle protection. Are you ready to finalize at three dollars a day?";
        beatType = "wait";
        toolCalls = [{ name: "show_payment_breakdown", args: { daily_rate: 3.0 } }];
        state.current_beat = 23;
      } else {
        // Floor breach / below $3 or pushing past stage 4
        state.concession_stage = 4;
        state.dealConfig.per_day_price = "three dollars";
        textToSpeak = FLOOR_PRICE_LINE;
        beatType = "wait";
        toolCalls = [{ name: "show_payment_breakdown", args: { daily_rate: 3.0 } }];
        state.current_beat = 23;
      }
      break;
    }

    case "garbled": {
      // Speak GARBLED_LINE once, listen again
      textToSpeak = GARBLED_LINE;
      beatType = "wait";
      break;
    }

    case "avatar_echo": {
      // Acoustic self-echo from laptop speakers: do NOT speak GARBLED_LINE (avoids echo loops).
      // Simply re-prompt the current beat or check-in without advancing state.current_beat.
      const currentBeat = BEATS.find((b) => b.id === state.current_beat);
      if (currentBeat) {
        textToSpeak = currentBeat.check_in
          ? formatSpeechText(currentBeat.check_in)
          : getFullBeatUtterance(currentBeat, state.dealConfig);
        beatType = "wait";
      } else {
        textToSpeak = STEP_0_GREETING;
        beatType = "wait";
      }
      break;
    }

    case "repeat_request": {
      // Resend the last beat once, verbatim
      const currentBeat = BEATS.find((b) => b.id === state.current_beat)!;
      textToSpeak = getFullBeatUtterance(currentBeat, state.dealConfig);
      beatType = currentBeat.type;
      break;
    }

    case "restart_request": {
      // Do not reset the pointer; offer to repeat only the last beat
      const currentBeat = BEATS.find((b) => b.id === state.current_beat)!;
      textToSpeak = getFullBeatUtterance(currentBeat, state.dealConfig);
      beatType = currentBeat.type;
      break;
    }

    case "human_request": {
      // Speak HANDOFF_LINE and stop
      state.is_stopped = true;
      textToSpeak = HANDOFF_LINE;
      beatType = "stop";
      toolCalls = [{ name: "show_content", args: { item: "escalate" } }];
      onScriptComplete(state);
      break;
    }

    case "pause_request": {
      // Customer asked to pause, hold on, or interjected to speak ("let me tell you", "listen")
      const norm = customerTranscript.toLowerCase();
      const isInterjection =
        norm.includes("let me tell you") ||
        norm.includes("let me speak") ||
        norm.includes("let me finish") ||
        norm.includes("let me complete") ||
        norm.includes("listen") ||
        norm.includes("hear me");
      textToSpeak = isInterjection ? LISTENING_LINE : PAUSE_LINE;
      beatType = "wait";
      toolCalls = [];
      break;
    }

    case "overwhelmed": {
      // Customer asked to slow down. Reassure and re-prompt current check-in without skipping
      const currentBeat = BEATS.find((b) => b.id === state.current_beat);
      const checkIn = currentBeat?.check_in ? formatSpeechText(currentBeat.check_in) : "";
      textToSpeak = checkIn ? `${SLOW_DOWN_LINE} ${checkIn}` : SLOW_DOWN_LINE;
      beatType = "wait";
      toolCalls = [];
      break;
    }

    case "compliment": {
      // Acknowledge vehicle compliments or laughter/humor and advance to next beat
      const norm = customerTranscript.toLowerCase();
      const isLaughterOrHumor =
        norm.includes("haha") ||
        norm.includes("lol") ||
        norm.includes("funny") ||
        norm.includes("hilarious") ||
        norm.includes("crack me up");

      const leadIn = isLaughterOrHumor ? EQ_EXCITEMENT_LINE : COMPLIMENT_LINE;

      const nextBeatId = state.current_beat + 1;
      if (nextBeatId <= 22) {
        state.current_beat = nextBeatId;
        state.delivered_beats.push(nextBeatId);
        const nextBeat = BEATS.find((b) => b.id === nextBeatId)!;
        const nextUtterance = getFullBeatUtterance(nextBeat, state.dealConfig);
        textToSpeak = `${leadIn} ${nextUtterance}`;
        beatType = nextBeat.type;
        toolCalls = getBeatToolCalls(nextBeatId);
      } else {
        textToSpeak = `${leadIn} ${HANDOFF_LINE}`;
        state.is_stopped = true;
        beatType = "stop";
        toolCalls = [{ name: "show_content", args: { item: "escalate" } }];
      }
      break;
    }

    case "customer_frustrated": {
      // De-escalate frustration, validate time respect, re-prompt current beat check-in
      const currentBeat = BEATS.find((b) => b.id === state.current_beat);
      const checkIn = currentBeat?.check_in ? formatSpeechText(currentBeat.check_in) : "";
      textToSpeak = checkIn ? `${EQ_DEESCALATION_LINE} ${checkIn}` : EQ_DEESCALATION_LINE;
      beatType = "wait";
      toolCalls = [];
      break;
    }

    case "customer_anxious": {
      // Reassure anxiety and doubt, zero-pressure psychological safety, re-prompt current beat check-in
      const currentBeat = BEATS.find((b) => b.id === state.current_beat);
      const checkIn = currentBeat?.check_in ? formatSpeechText(currentBeat.check_in) : "";
      textToSpeak = checkIn ? `${EQ_REASSURANCE_LINE} ${checkIn}` : EQ_REASSURANCE_LINE;
      beatType = "wait";
      toolCalls = [];
      break;
    }

    case "identity_question": {
      // Customer asked who Max is. Answer clearly, and re-prompt current beat without advancing!
      const currentBeat = BEATS.find((b) => b.id === state.current_beat);
      if (currentBeat) {
        const checkInOrUtterance = currentBeat.check_in
          ? `${IDENTITY_LINE} ${formatSpeechText(currentBeat.check_in)}`
          : `${IDENTITY_LINE} ${getFullBeatUtterance(currentBeat, state.dealConfig)}`;
        textToSpeak = checkInOrUtterance;
        beatType = currentBeat.type;
        toolCalls = getBeatToolCalls(state.current_beat);
      } else {
        textToSpeak = IDENTITY_LINE;
        beatType = "wait";
      }
      break;
    }

    case "sales_question": {
      // Customer asked if this is a sales call. Reassure directly and re-prompt current beat without advancing!
      const currentBeat = BEATS.find((b) => b.id === state.current_beat);
      if (currentBeat) {
        const checkInOrUtterance = currentBeat.check_in
          ? `${SALES_CALL_LINE} ${formatSpeechText(currentBeat.check_in)}`
          : `${SALES_CALL_LINE} ${getFullBeatUtterance(currentBeat, state.dealConfig)}`;
        textToSpeak = checkInOrUtterance;
        beatType = currentBeat.type;
        toolCalls = getBeatToolCalls(state.current_beat);
      } else {
        textToSpeak = SALES_CALL_LINE;
        beatType = "wait";
      }
      break;
    }

    case "call_purpose": {
      // Customer asked why they are having this call. Answer clearly and re-prompt current beat without advancing!
      const currentBeat = BEATS.find((b) => b.id === state.current_beat);
      if (currentBeat) {
        const checkInOrUtterance = currentBeat.check_in
          ? `${CALL_PURPOSE_LINE} ${formatSpeechText(currentBeat.check_in)}`
          : `${CALL_PURPOSE_LINE} ${getFullBeatUtterance(currentBeat, state.dealConfig)}`;
        textToSpeak = checkInOrUtterance;
        beatType = currentBeat.type;
        toolCalls = getBeatToolCalls(state.current_beat);
      } else {
        textToSpeak = CALL_PURPOSE_LINE;
        beatType = "wait";
      }
      break;
    }

    case "greeting_check": {
      // Customer checked presence mid-call ("hey", "hello", "are you there").
      // Reassure presence and re-prompt current beat WITHOUT advancing the script!
      const currentBeat = BEATS.find((b) => b.id === state.current_beat);
      if (currentBeat) {
        const checkInOrUtterance = currentBeat.check_in
          ? `I'm right here with you! ${formatSpeechText(currentBeat.check_in)}`
          : `I'm right here with you! Listening loud and clear, please go ahead.`;
        textToSpeak = checkInOrUtterance;
        beatType = currentBeat.type;
        toolCalls = getBeatToolCalls(state.current_beat);
      } else {
        textToSpeak = "I'm right here with you! Can you hear and see me alright?";
        beatType = "wait";
      }
      break;
    }

    case "ai_question": {
      // Speak AI_DISCLOSURE_LINE, then resume
      const nextBeatId = state.current_beat + 1;
      if (nextBeatId <= BEATS.length) {
        state.current_beat = nextBeatId;
        state.delivered_beats.push(nextBeatId);
        const nextBeat = BEATS.find((b) => b.id === nextBeatId)!;
        const nextUtterance = getFullBeatUtterance(nextBeat, state.dealConfig);
        textToSpeak = `${AI_DISCLOSURE_LINE} ${nextUtterance}`;
        beatType = nextBeat.type;
        toolCalls = getBeatToolCalls(nextBeatId);
      } else {
        textToSpeak = `${AI_DISCLOSURE_LINE} ${HANDOFF_LINE}`;
        state.is_stopped = true;
        beatType = "stop";
        toolCalls = [{ name: "show_content", args: { item: "escalate" } }];
      }
      break;
    }

    case "tech_check_ack": {
      // Customer confirmed tech check / video / audio status.
      // Do NOT advance script beats. Re-prompt current beat question politely.
      const currentBeat = BEATS.find((b) => b.id === state.current_beat);
      if (currentBeat) {
        const currentUtterance = getFullBeatUtterance(currentBeat, state.dealConfig);
        textToSpeak = `Great! ${currentUtterance}`;
        beatType = currentBeat.type;
      } else {
        textToSpeak = "Great, glad the audio and video are working well!";
        beatType = "wait";
      }
      break;
    }

    case "spouse_objection": {
      const currentBeat = BEATS.find((b) => b.id === state.current_beat);
      const checkIn = currentBeat?.check_in ? formatSpeechText(currentBeat.check_in) : "";
      textToSpeak = checkIn ? `${SPOUSE_LINE} ${checkIn}` : SPOUSE_LINE;
      beatType = "wait";
      break;
    }

    case "insurance_question": {
      const currentBeat = BEATS.find((b) => b.id === state.current_beat);
      const checkIn = currentBeat?.check_in ? formatSpeechText(currentBeat.check_in) : "";
      textToSpeak = checkIn ? `${INSURANCE_LINE} ${checkIn}` : INSURANCE_LINE;
      beatType = "wait";
      break;
    }

    case "cancellation_question": {
      const currentBeat = BEATS.find((b) => b.id === state.current_beat);
      const checkIn = currentBeat?.check_in ? formatSpeechText(currentBeat.check_in) : "";
      textToSpeak = checkIn ? `${CANCELLATION_LINE} ${checkIn}` : CANCELLATION_LINE;
      beatType = "wait";
      break;
    }

    case "vehicle_discrepancy": {
      // Customer stated they are buying a different vehicle or that the car model is incorrect
      const norm = customerTranscript.toLowerCase();
      let extractedModel = "";
      if (norm.includes("maybach")) extractedModel = "Maybach";
      else if (norm.includes("mercedes")) extractedModel = "Mercedes";
      else if (norm.includes("bmw")) extractedModel = "BMW";
      else if (norm.includes("audi")) extractedModel = "Audi";
      else if (norm.includes("porsche")) extractedModel = "Porsche";
      else if (norm.includes("lexus")) extractedModel = "Lexus";
      else if (norm.includes("ford")) extractedModel = "Ford";
      else if (norm.includes("toyota")) extractedModel = "Toyota";
      else if (norm.includes("honda")) extractedModel = "Honda";
      else if (norm.includes("kia")) extractedModel = "Kia";
      else if (norm.includes("hyundai")) extractedModel = "Hyundai";

      if (extractedModel) {
        state.dealConfig.vehicle_model = extractedModel;
        state.dealConfig.vehicle_make = extractedModel === "Maybach" ? "Mercedes-Maybach" : state.dealConfig.vehicle_make;
      }

      const vehicleName = extractedModel || "correct vehicle";
      textToSpeak = VEHICLE_DISCREPANCY_LINE.replace(/\{\{vehicle_model\}\}/g, vehicleName);
      beatType = "wait";
      // Hold Beat 2 (Qualifying test-drive question) so customer can answer
      state.current_beat = 2;
      toolCalls = [];
      break;
    }

    case "manufacturer_vs_dealer": {
      // Customer asked whether warranty/coverage is from manufacturer or dealership, or if they should buy a new warranty
      textToSpeak = MANUFACTURER_VS_DEALER_LINE;
      beatType = "wait";
      toolCalls = [];
      break;
    }

    case "other":
    default: {
      // Prepared for everything: Answer customer's question or off-script comment directly,
      // then seamlessly bridge into the next undelivered beat
      let dynamicAnswer = "";
      const trimmed = customerTranscript.trim();
      const norm = customerTranscript.toLowerCase();
      const financialKeywords = [
        "rate", "apr", "interest", "monthly payment", "payment",
        "down payment", "trade in", "trade-in", "credit score", "loan term",
      ];
      const isFinancialQuestion = financialKeywords.some((kw) => norm.includes(kw));

      if (trimmed.length > 2) {
        dynamicAnswer = await generateConstrainedOffScriptResponse(customerTranscript, state);
      }

      // Requirement 1: Only use OUT_OF_SCRIPT_LINE in a valid manager-handoff context!
      if (dynamicAnswer === OUT_OF_SCRIPT_LINE && !isFinancialQuestion) {
        dynamicAnswer = "Understood.";
      }

      const nextBeatId = state.current_beat + 1;
      if (nextBeatId <= BEATS.length) {
        state.current_beat = nextBeatId;
        state.delivered_beats.push(nextBeatId);
        const nextBeat = BEATS.find((b) => b.id === nextBeatId)!;
        const nextUtterance = getFullBeatUtterance(nextBeat, state.dealConfig);
        textToSpeak = dynamicAnswer ? `${dynamicAnswer} ${nextUtterance}` : nextUtterance;
        beatType = nextBeat.type;
        toolCalls = getBeatToolCalls(nextBeatId);
      } else {
        textToSpeak = dynamicAnswer ? `${dynamicAnswer} ${HANDOFF_LINE}` : HANDOFF_LINE;
        state.is_stopped = true;
        beatType = "stop";
        toolCalls = [{ name: "show_content", args: { item: "escalate" } }];
      }
      break;
    }
  }

  state.last_spoken_text = textToSpeak;

  return {
    textToSpeak,
    beatId: state.current_beat,
    beatType,
    toolCalls,
    state,
    intent,
    isScriptComplete: state.is_stopped,
  };
}
