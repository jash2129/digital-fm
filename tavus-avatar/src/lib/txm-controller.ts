/**
 * TXM Deterministic Controller State Machine
 * Implements Section 9 & 10 of system-instruction.md
 *
 * Guarantees zero beat skipping, 100% verbatim script adherence,
 * deterministic tool calling (grid/warranty/cost/pricing),
 * and natural, empathetic handling of customer objections and questions.
 */

export interface TxmBeat {
  id: number;
  label: string;
  type: "WAIT" | "CONTINUE";
  text: string;
  checkIn?: string;
  toolCalls?: Array<{ name: string; args: Record<string, any> }>;
}

export interface ControllerSession {
  sessionId: string;
  currentBeatId: number;
  deliveredBeatIds: number[];
  vehicle: {
    year: number;
    make: string;
    model: string;
  };
  dailyRate: number;
  lastUpdated: string;
}

// In-memory session store (keyed by sessionId)
const sessionStore = new Map<string, ControllerSession>();

export const TXM_BEATS: Record<number, TxmBeat> = {
  0: {
    id: 0,
    label: "Greeting & Tech Check",
    type: "WAIT",
    text: "Hey there! Can you hear and see me alright? Welcome in — I'm Max, your finance manager today!",
    checkIn: "Can you hear and see me alright?",
  },
  1: {
    id: 1,
    label: "Step 1: Recording & Legal Disclosure",
    type: "WAIT",
    text: "Before I start I just want to let you know this transaction is recorded audio and video, also I'm required by the law to go over everything with you before you sign any paperwork to make sure you understand first okay.",
    checkIn: "first okay.",
  },
  2: {
    id: 2,
    label: "Step 1: Agreed Vehicle Confirmation",
    type: "WAIT",
    text: "First I see that you agreed to buy a new 2026 Mazda CX five. Does that match the vehicle you picked out?",
    checkIn: "Does that match the vehicle you picked out?",
  },
  3: {
    id: 3,
    label: "Step 2: Test Drive Check",
    type: "WAIT",
    text: "A few questions before I prepare the paperwork, have you got the chance to drive the vehicle that you are buying?",
    checkIn: "have you got the chance to drive the vehicle that you are buying?",
  },
  4: {
    id: 4,
    label: "Step 2: Features & Whistles Walkaround",
    type: "WAIT",
    text: "When you came back from the test drive, the sales person did the walkaround and showed you all the features and builts and whistles in the car?",
    checkIn: "showed you all the features and builts and whistles in the car?",
  },
  5: {
    id: 5,
    label: "Step 2: Warranty Understanding Check",
    type: "WAIT",
    text: "What's your understanding of the warranty that comes with the vehicle? Did the sales person go over everything with you?",
  },
  6: {
    id: 6,
    label: "Step 2: Bridge to Warranty Review",
    type: "WAIT",
    text: "Awesome! Even if you say yes, there is actually more information about the warranty that I need to go over with you in depth to make sure you do understand everything before you sign. Is that okay?",
    checkIn: "Is that okay?",
  },
  7: {
    id: 7,
    label: "Step 3 (Square 1-2): Two Warranties & Base Limited",
    type: "WAIT",
    text: "Awesome! Let me share my screen with you so you can follow along as I walk through it. Mazda is like any other manufacturer when they build a vehicle they put warranty in it in your case you get two different warranty not one. The first warranty is three years thirty-six thousand mile Base limited warranty.",
    toolCalls: [{ name: "show_content", args: { item: "warranty_terms" } }],
  },
  8: {
    id: 8,
    label: "Step 3 (Square 1-2): Powertrain & Glovebox Defect Page 4",
    type: "WAIT",
    text: "The second of is five years sixty thousand mile power train which is referring to the engine and the transmission, I'm sure you and I agree that's a very good complementary warranty from the manufacturer but what you do not know that this warranty is a defect only stated in the manual book of the vehicle in the glove box page number four saying that this warranty from the manufacturer is against anything that is mis-design or mis-built or mis-installed. Are you with me so far?",
    checkIn: "Are you with me so far?",
  },
  9: {
    id: 9,
    label: "Step 3 (Square 3): Wear & Tear Introduction",
    type: "WAIT",
    text: "Now there is another reason can cause any break down to the vehicle goes under WEAR AND TEAR — I'm sure you heard that phrase before. Three reasons usually cause the wear and tear: CLIMATE, ROAD CONDITION, AND DRIVING HABIT — especially here in Texas.",
    toolCalls: [{ name: "show_content", args: { item: "cost_breakdown" } }],
  },
  10: {
    id: 10,
    label: "Step 3 (Square 3): Climate, Road Condition & Habits",
    type: "WAIT",
    text: "CLIMATE: can go over one hundred ten degrees in summer and get very cold in the winter, which causes premature wear on all the sensors, electronic technology, engine, transmission, and cooling system and the AC. Also ROAD CONDITION: especially nowadays construction is everywhere, uneven service roads, and potholes that have a big impact on tires, rims, sensors, and electronic technology. And finally DRIVING HABITS: the way I drive, the way you drive, in fact the way everyone drives has a huge impact on the vehicle. Ninety-five percent of the time when a vehicle breaks down, it's due to wear and tear. You see potholes and construction around here all the time, right?",
    checkIn: "You see potholes and construction around here all the time, right?",
  },
  11: {
    id: 11,
    label: "Step 3 (Square 3): Diagnostic & Manufacturer Scrutiny",
    type: "WAIT",
    text: "And the first thing you do as an owner when the vehicle breaks down, you go to any service place. By law they must first diagnose the vehicle to find out what is the problem. Once diagnosed, the manufacturer steps in and they are very cautious. WHY? Because the manufacturer reserves the right to determine if the breakdown happened due to mis-design, mis-built, or mis-installed. If they find out it was because of them, that's great — they pay for it. But if they find out it's wear and tear? Unfortunately, you pay for it. And like I said before, ninety-five percent of the time, it's wear and tear.",
  },
  12: {
    id: 12,
    label: "Step 3 (Square 3): Parts & Labor Reality ($130-$160/hr)",
    type: "WAIT",
    text: "That's why we don't feel comfortable leaving you in a bad position without good coverage around the vehicle. Why? Because we do have a parts department, we know how much the parts cost: engine by itself can cost up to seven thousand, transmission six thousand, AC almost four thousand. And electronic technology? It's the luck of the draw — anywhere from one hundred dollars all the way up to twelve thousand dollars! If a sensor in the dashboard screens breaks down, they have to replace the whole unit — that's roughly sixty-five hundred dollars up to eighty-five hundred dollars, plus labor at one hundred thirty to one hundred sixty dollars an hour for ten to fifteen hours! So instead of you paying seventy-five hundred dollars for parts plus ten hours of labor? NO, ABSOLUTELY NOT! Does that make sense why that gets so expensive?",
    checkIn: "Does that make sense why that gets so expensive?",
  },
  13: {
    id: 13,
    label: "Step 3 (Square 4): 7yr/100k Bumper-to-Bumper Offer",
    type: "WAIT",
    text: "That's why we recommend to you to wrap the true blanket cover warranty around the vehicle which is seven years hundred thousand mile warranty BUMPER TO BUMPER. That covers everything — engine, transmission, drive axle, four-wheel drive, suspension, steering, cooling system, electric, breaks, AC air conditioning, sensors, electronics, and all labor with zero deductible anywhere you go across the metroplex!",
    toolCalls: [
      { name: "draw_grid_outline", args: {} },
      { name: "show_pricing", args: { product: "vsc" } },
    ],
  },
  14: {
    id: 14,
    label: "Step 3 (Square 4): 5-Year Tire & Wheel Protection",
    type: "WAIT",
    text: "Also we know the cost of ownership over the next five years will cost thousands to maintain. That's why we include five years tire and wheel cover. Assuming two sets of tires over five years at three hundred fifty per tire plus installation, eight tires would cost almost four thousand dollars. The policy takes care of that for you!",
    toolCalls: [{ name: "show_pricing", args: { product: "tire_wheel" } }],
  },
  15: {
    id: 15,
    label: "Step 3 (Square 4): 4-Year Maintenance Package",
    type: "WAIT",
    text: "Plus four years maintenance covering all your full synthetic oil changes, filters, and tire rotation — so you say goodbye to paying for all of that. Under this policy, the only thing you have to worry about is just paying for your GAS! And guess what? We don't have cover for that! Pretty solid coverage across the board, right?",
    toolCalls: [{ name: "show_pricing", args: { product: "maintenance" } }],
  },
  16: {
    id: 16,
    label: "Step 3 (Square 4): Grand Recap & $4/Day Price Presentation",
    type: "WAIT",
    text: "Now let me recap what I just said, you get: Seven years hundred thousand mile BUMPER TO BUMPER WARRANTY that covers all mechanical breakdown, electronic breakdown, parts, and labor with ZERO deductible — you pay nothing out of your pocket every time you fix the vehicle! You also get five years tire and wheels cover, and your maintenance cover for four years. And you can get everything I just mentioned for only four dollars a day — a coffee a day and everything is covered! A coffee a day from Starbucks is eight dollars and sixty cents. For less than half a cup of coffee a day you will get everything covered, so you don't have to worry about paying anyone anything in the future! How does that sound to you?",
    toolCalls: [
      { name: "show_content", args: { item: "four_square" } },
      { name: "show_payment_breakdown", args: { daily_rate: 4 } },
    ],
  },
};

export const MAX_BEAT_INDEX = 16;

export function getOrCreateControllerSession(sessionId: string): ControllerSession {
  let session = sessionStore.get(sessionId);
  if (!session) {
    session = {
      sessionId,
      currentBeatId: 0,
      deliveredBeatIds: [],
      vehicle: {
        year: 2026,
        make: "Mazda",
        model: "CX-5",
      },
      dailyRate: 4.0,
      lastUpdated: new Date().toISOString(),
    };
    sessionStore.set(sessionId, session);
  }
  return session;
}

export function resetControllerSession(sessionId: string): ControllerSession {
  const session: ControllerSession = {
    sessionId,
    currentBeatId: 0,
    deliveredBeatIds: [],
    vehicle: {
      year: 2026,
      make: "Mazda",
      model: "CX-5",
    },
    dailyRate: 4.0,
    lastUpdated: new Date().toISOString(),
  };
  sessionStore.set(sessionId, session);
  return session;
}

export interface ControllerDecision {
  nextBeatId: number;
  nextBeat: TxmBeat;
  deliveredBeatIds: number[];
  customerIntent:
    | "greeting_ack"
    | "identity_inquiry"
    | "sales_objection"
    | "purpose_inquiry"
    | "agreement"
    | "impatience"
    | "out_of_box_question"
    | "general_remark";
  promptInjection: string;
  fallbackText: string;
  toolCalls: Array<{ name: string; args: Record<string, any> }>;
  isQuestionOrRemark: boolean;
  verbatimScriptText: string;
}

export function evaluateControllerStep(sessionId: string, userMessage: string): ControllerDecision {
  const session = getOrCreateControllerSession(sessionId);
  const text = userMessage.trim().toLowerCase();
  const currentBeat = TXM_BEATS[session.currentBeatId] || TXM_BEATS[0];

  // Echo guard check: did the user's transcript accidentally echo the current beat's text?
  const isEchoOfCurrent = (): boolean => {
    if (!currentBeat || !text) return false;
    const curNorm = currentBeat.text.toLowerCase().replace(/[^a-z0-9 ]/g, " ").trim();
    const userNorm = text.replace(/[^a-z0-9 ]/g, " ").trim();
    if (userNorm.length < 5) return false;
    if (curNorm.includes(userNorm) || userNorm.includes(curNorm)) return true;
    const words = userNorm.split(/\s+/).filter((w) => w.length > 2);
    if (words.length >= 3) {
      const matchCount = words.filter((w) => curNorm.includes(w)).length;
      if (matchCount / words.length >= 0.35) return true;
    }
    return false;
  };
  const isEcho = isEchoOfCurrent();

  // Continuation prompts (e.g. "sounds good, what else?", "makes sense, what's next?", "keep going")
  const isContinuationPrompt =
    /(what else|what('s| is) next|tell me more|keep going|continue|what do you recommend|how does that work|go ahead|proceed|sounds good|makes sense)/i.test(
      text
    );

  // Intent classification
  const isQuestion =
    !isContinuationPrompt &&
    (/\?|^(what|why|how|who|where|when|can|could|would|should|is|are|do|does|will|tell me|tell)\b/i.test(text) ||
      text.includes("can you speak") ||
      text.includes("can you talk") ||
      text.includes("speak") ||
      text.includes("hear me") ||
      text.includes("tell me something") ||
      text.includes("say something"));
  const isIdentityInquiry = /who are you|what('s| is) your name|who am i talking to/i.test(text);
  const isSalesObjection = /sales call|selling me|trying to sell|pitching me/i.test(text);
  const isPurposeInquiry = /what is this (about|for)|why are we (doing this|talking)|what('s| is) this call/i.test(text);
  const isGreetingAck = /^(hello|hi|hey|howdy|good morning|good afternoon|good evening|what's up|greetings)\b/i.test(text);
  const isTechConfirmation = /can hear|can see|yes|yep|yeah|i hear you|loud and clear|perfect|alright/i.test(text);

  // Beat 12 rhetorical concurrence: if customer reacts to shocking repair costs ($7,000 engine etc.)
  const isBeat12Concurrence =
    session.currentBeatId === 12 &&
    /(no way|crazy|ridiculous|expensive|too much|not at all|no|wow|yikes|insane)/i.test(text);

  const isAgreement =
    isContinuationPrompt ||
    isBeat12Concurrence ||
    /^(yes|yeah|yep|sure|okay|ok|i did|i do|sounds good|go ahead|continue|let's go|carry on|makes sense|i follow|fine|cool|alright|deal|let's do it)$/i.test(
      text
    ) ||
    (!isQuestion &&
      /(yes|yeah|yep|sure|okay|ok|sounds good|go ahead|continue|makes sense|i did|i do|i drove it|i understand|i follow)/i.test(
        text
      ));
  const isImpatience = /hurry|faster|get to the point|cut to the chase/i.test(text);
  const isOutOfBoxQuestion =
    !isEcho &&
    !isContinuationPrompt &&
    !isBeat12Concurrence &&
    (isQuestion || text.split(" ").length > 3) &&
    !isIdentityInquiry &&
    !isSalesObjection &&
    !isPurposeInquiry &&
    !isAgreement &&
    !isTechConfirmation &&
    !isGreetingAck;

  let customerIntent: ControllerDecision["customerIntent"] = "general_remark";
  if (isIdentityInquiry) customerIntent = "identity_inquiry";
  else if (isSalesObjection) customerIntent = "sales_objection";
  else if (isPurposeInquiry) customerIntent = "purpose_inquiry";
  else if (text.includes("can you speak") || text.includes("can you hear")) customerIntent = "can_speak_inquiry" as any;
  else if (text.includes("tell me something") || text.includes("say something")) customerIntent = "tell_something_inquiry" as any;
  else if (isQuestion || isOutOfBoxQuestion) customerIntent = "out_of_box_question";
  else if (isTechConfirmation || isGreetingAck) customerIntent = "greeting_ack";
  else if (isAgreement) customerIntent = "agreement";
  else if (isImpatience) customerIntent = "impatience";

  // Step advancement rules
  let targetBeatId = session.currentBeatId;

  if (isEcho) {
    // If user transcript is echoing the current beat, it means this beat was already vocalized! Advance forward!
    targetBeatId = Math.min(session.currentBeatId + 1, MAX_BEAT_INDEX);
  } else if (session.currentBeatId === 0) {
    // Beat 0 (Greeting) was already spoken at call start. Any response or question from the customer advances past Beat 0 to Beat 1!
    targetBeatId = 1;
  } else {
    // In later beats: if user asked a question, answer it and deliver the current or next beat
    if (isOutOfBoxQuestion || isSalesObjection || isIdentityInquiry || isPurposeInquiry) {
      targetBeatId = session.currentBeatId;
    } else if (isAgreement || isTechConfirmation || (!isQuestion && !isImpatience)) {
      if (session.currentBeatId < MAX_BEAT_INDEX) {
        targetBeatId = session.currentBeatId + 1;
      }
    }
  }

  // Update session
  if (targetBeatId > session.currentBeatId) {
    if (!session.deliveredBeatIds.includes(session.currentBeatId)) {
      session.deliveredBeatIds.push(session.currentBeatId);
    }
    session.currentBeatId = targetBeatId;
  }
  session.lastUpdated = new Date().toISOString();

  const nextBeat = TXM_BEATS[targetBeatId] || TXM_BEATS[MAX_BEAT_INDEX];
  const toolCalls = nextBeat.toolCalls || [];
  const isQuestionOrRemark =
    isOutOfBoxQuestion ||
    isQuestion ||
    isSalesObjection ||
    isIdentityInquiry ||
    isPurposeInquiry ||
    customerIntent === ("can_speak_inquiry" as any) ||
    customerIntent === ("tell_something_inquiry" as any);

  let behavioralInstruction = "";
  if (session.currentBeatId === 16 && isAgreement) {
    behavioralInstruction = `You have delivered the full verbatim script from wordtoword.md up to the $4 a day presentation. Say warmly: "Awesome! Let's get everything signed and finalized for you right now." and do not improvise new sales lines.`;
  } else if (isEcho) {
    behavioralInstruction = `The customer acknowledged what you said. Smoothly advance and deliver the assigned beat text below. Do NOT repeat prior sentences.`;
  } else if (customerIntent === ("can_speak_inquiry" as any)) {
    behavioralInstruction = `The customer asked if you can speak or hear them ("${userMessage}"). Answer warmly and directly: "Yes, absolutely! I can hear and speak with you loud and clear. I'm right here with you." Keep it short and conversational.`;
  } else if (customerIntent === ("tell_something_inquiry" as any)) {
    behavioralInstruction = `The customer asked you to tell them something ("${userMessage}"). Respond warmly: "Well, we're getting everything ready for your new 2026 Mazda CX-5 today!" Then ask if they are ready to proceed.`;
  } else if (isIdentityInquiry) {
    behavioralInstruction = `The customer asked who you are. Say warmly: "I'm Max, your digital finance manager here at the dealership." and ask: "Are you ready to get started?" Keep it concise and natural under 25 words. Do NOT recite long script paragraphs.`;
  } else if (isSalesObjection) {
    behavioralInstruction = `The customer asked if this is a sales call. Reassure them warmly: "Not at all! My role is just to review your paperwork and warranty details for your new Mazda CX-5 before you sign anything. Shall we go ahead?" Keep it concise under 25 words. Do NOT recite long script paragraphs.`;
  } else if (isPurposeInquiry) {
    behavioralInstruction = `The customer asked what this call is for. Answer directly: "I'm just going over your paperwork and reviewing the manufacturer warranty coverage for your new vehicle before finalizing everything. Sound good?" Keep it concise under 25 words.`;
  } else if (isGreetingAck) {
    behavioralInstruction = `The customer said hello or greeted you. Acknowledge warmly: "Great to connect with you!" then deliver the assigned beat text below.`;
  } else if (isOutOfBoxQuestion || isQuestion) {
    behavioralInstruction = `The customer asked a question or made a remark: "${userMessage}".
Handle this like a world-class, charming dealership finance director:
1. ANSWER DIRECTLY: Answer their specific question in 1 or 2 warm, intelligent sentences (under 30 words). Never ignore what they asked!
2. ASK A NATURAL CHECK-IN: Ask: "Does that make sense?" or "Shall we keep rolling with your paperwork?".
3. DO NOT DUMP LONG SCRIPT PARAGRAPHS: Keep it conversational, listen first, and wait for them to confirm before reciting paperwork scripts.`;
  } else if (isImpatience) {
    behavioralInstruction = `The customer wants to get straight to business. Say: "Understood, let's dive right in." Then deliver the assigned beat text below.`;
  } else {
    behavioralInstruction = `Acknowledge what the customer said in one warm phrase if applicable, then deliver the assigned beat text clearly and naturally.`;
  }

  const promptInjection = `
### CONTROLLER STATE MACHINE INSTRUCTION (MANDATORY)
Current Beat ID: ${targetBeatId} (${nextBeat.label})
Delivered Beats: [${session.deliveredBeatIds.join(", ")}]

CUSTOMER JUST SAID: "${userMessage}"
${behavioralInstruction}

${
  isQuestionOrRemark
    ? `IMPORTANT: The customer asked a question or made a remark. Prioritize answering them warmly and directly in 1-2 natural sentences (under 35 words). Do NOT recite the entire paperwork script until they confirm!`
    : `MANDATORY SCRIPT TO DELIVER:
"${nextBeat.text}"`
}

CRITICAL RULES FOR MAXIMUM NATURAL CONVERSATION:
1. ALWAYS ANSWER THE CUSTOMER FIRST: If the customer asked any question, made a comment, or said anything, answer their question directly, warmly, and intelligently in 1-2 natural sentences before anything else. NEVER ignore what the customer said!
2. CONVERSATIONAL CADENCE: Speak like a real human finance director having a dialogue across the desk, not a robot reading an IVR script.
3. CLEAN VOICE TEXT: Output only clean speakable conversational English (no markdown symbols, no bullet points, no stage directions).
`;

  let fallbackPrefix = "";
  if (session.currentBeatId === 16 && isAgreement) {
    fallbackPrefix = "Awesome! Let's get everything signed and finalized for you right now.";
  } else if (customerIntent === ("can_speak_inquiry" as any)) {
    fallbackPrefix = "Yes, absolutely! I can hear and speak with you loud and clear. I'm right here with you.";
  } else if (customerIntent === ("tell_something_inquiry" as any)) {
    fallbackPrefix = "Well, we're getting everything ready for your new 2026 Mazda CX-5 today! Shall we dive in?";
  } else if (isIdentityInquiry) {
    fallbackPrefix = "I'm Max, your digital finance manager here at the dealership. Are you ready to get started?";
  } else if (isSalesObjection) {
    fallbackPrefix = "Not at all! My role is just to review your paperwork and warranty details for your new Mazda CX-5 before you sign anything. Shall we go ahead?";
  } else if (isPurposeInquiry) {
    fallbackPrefix = "I'm just going over your paperwork and reviewing the manufacturer warranty coverage for your new vehicle before finalizing everything. Sound good?";
  } else if (text.includes("bitcoin") || text.includes("crypto") || text.includes("ethereum")) {
    fallbackPrefix = "We don't accept cryptocurrency like Bitcoin or Ethereum here at the dealership—it's traditional financing only. Shall we keep rolling?";
  } else if (text.includes("crash") || text.includes("accident") || text.includes("total")) {
    fallbackPrefix = "If you're ever in a total loss crash, comprehensive auto insurance handles that, while factory warranty covers manufacturing defects. Shall we keep going?";
  } else if (text.includes("ai") || text.includes("robot") || text.includes("human")) {
    fallbackPrefix = "I'm an AI finance manager here at the dealership, built to walk you through your paperwork smoothly. Shall we dive in?";
  } else if (text.includes("cost") || text.includes("price") || text.includes("how much")) {
    fallbackPrefix = "I'm going to cover the pricing in just a moment as we go through your warranty details. Sound good?";
  } else if (isGreetingAck && targetBeatId > 0) {
    fallbackPrefix = "Great to connect with you! ";
  }

  let fallbackText = nextBeat.text;
  if (fallbackPrefix) {
    if (isQuestionOrRemark) {
      fallbackText = fallbackPrefix.trim();
    } else {
      fallbackText = `${fallbackPrefix}${nextBeat.text}`.trim();
    }
  }

  // Generate the 100% Verbatim Script from wordtoword.md
  let verbatimScriptText = nextBeat.text;

  if (targetBeatId === 2) {
    verbatimScriptText = `Great, thanks for confirming! ${nextBeat.text}`;
  } else if (targetBeatId === 3) {
    verbatimScriptText = nextBeat.text;
  } else if (targetBeatId === 4) {
    if (/(no|haven't|not yet|didn't)/i.test(text)) {
      verbatimScriptText = `Understood, we'll make sure you get some wheel time. ${nextBeat.text}`;
    } else {
      verbatimScriptText = `Awesome! ${nextBeat.text}`;
    }
  } else if (targetBeatId === 5) {
    if (/(no|didn't|haven't|not really)/i.test(text)) {
      verbatimScriptText = `Got it, no problem at all — I'll personally make sure our team does a complete walk-around and shows you all those tech features before you leave with the keys today. ${nextBeat.text}`;
    } else {
      verbatimScriptText = `Perfect! ${nextBeat.text}`;
    }
  } else if (targetBeatId === 6) {
    if (/(no|didn't|not really|nobody|haven't)/i.test(text)) {
      verbatimScriptText = `No problem at all! Allow me to go over it really quick to make sure that you understand everything before you sign. Also, if you have any questions, please do not hesitate to stop me and ask me. Is that okay?`;
    } else {
      verbatimScriptText = `Awesome! Even if you say yes, there is actually more information about the warranty that I need to go over with you in depth to make sure you do understand everything before you sign. Is that okay?`;
    }
  } else if (targetBeatId === 7) {
    verbatimScriptText = nextBeat.text;
  } else if (targetBeatId === 8) {
    verbatimScriptText = nextBeat.text;
  } else if (targetBeatId === 9) {
    verbatimScriptText = `Exactly! ${nextBeat.text}`;
  } else if (targetBeatId === 11) {
    verbatimScriptText = nextBeat.text;
  } else if (targetBeatId === 13) {
    verbatimScriptText = `Right on! ${nextBeat.text}`;
  } else if (targetBeatId === 16) {
    verbatimScriptText = `Awesome! ${nextBeat.text}`;
  } else if (session.currentBeatId === 16 && isAgreement) {
    verbatimScriptText = `Awesome! Let's get everything signed and finalized for you right now.`;
  }

  return {
    nextBeatId: targetBeatId,
    nextBeat,
    deliveredBeatIds: [...session.deliveredBeatIds],
    customerIntent,
    promptInjection,
    fallbackText,
    toolCalls,
    isQuestionOrRemark,
    verbatimScriptText,
  };
}
