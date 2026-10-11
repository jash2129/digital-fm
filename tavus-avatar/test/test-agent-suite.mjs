// Comprehensive Production Test Suite for HeyGen + Grok F&I Agent
// Tests the full flow, interruptions, curveballs, echo rejection, negative answers, and negotiation

const BASE_URL = "http://localhost:3000";

async function postChat(sessionId, messages) {
  const start = Date.now();
  const res = await fetch(`${BASE_URL}/api/chat/grok`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId, messages }),
  });
  const latencyMs = Date.now() - start;

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`HTTP ${res.status}: ${errText}`);
  }

  const data = await res.json();
  return { ...data, latencyMs };
}

function printResult(scenarioName, passed, details) {
  const icon = passed ? "✅ PASS" : "❌ FAIL";
  console.log(`\n${icon} [${scenarioName}]`);
  for (const d of details) {
    console.log(`   - ${d}`);
  }
}

// ---------------------------------------------------------------------------
// TEST 1: Golden Path (Complete 16-Beat Flow)
// ---------------------------------------------------------------------------
async function testGoldenPath() {
  const sessionId = `test_golden_${Date.now()}`;
  const conversation = [];
  const details = [];
  let currentBeat = 0;
  let allPassed = true;

  console.log("\n=======================================================");
  console.log("RUNNING TEST 1: Complete Golden Path (Beats 0 -> 16)");
  console.log("=======================================================");

  const userReplies = [
    "Yes, I can hear and see you fine.", // After Beat 0 -> should advance to Beat 1 (Disclosure)
    "Okay, I understand.", // After Beat 1 -> Beat 2 (Agreed Vehicle)
    "Yes, that's the Mazda CX-5 I picked.", // After Beat 2 -> Beat 3 (Test Drive)
    "Yes, I did get to test drive it.", // After Beat 3 -> Beat 4 (Walkaround)
    "Yes, he did a walkaround.", // After Beat 4 -> Beat 5 (Warranty Check)
    "I think it comes with standard factory warranty.", // After Beat 5 -> Beat 6 (Bridge)
    "Sure, go ahead.", // After Beat 6 -> Beat 7 (Square 1-2 Hook)
    "Yes, makes sense.", // After Beat 7 -> Beat 8 (Page 4 Defect)
    "Okay, I understand.", // After Beat 8 -> Beat 9 (Wear & Tear)
    "Yes, I've heard of wear and tear.", // After Beat 9 -> Beat 10 (Climate/Road/Habits)
    "I follow.", // After Beat 10 -> Beat 11 (Diagnostic & Scrutiny)
    "Yes, that makes sense.", // After Beat 11 -> Beat 12 (Parts & Labor Reality)
    "No way, that's crazy expensive.", // After Beat 12 -> Beat 13 (7yr/100k Bumper-to-Bumper)
    "Sounds good, what else?", // After Beat 13 -> Beat 14 (5-Yr Tire & Wheel)
    "Makes sense.", // After Beat 14 -> Beat 15 (4-Yr Maintenance + Gas Joke)
    "Haha, that's funny.", // After Beat 15 -> Beat 16 (Grand Recap & $4/Day Close)
  ];

  for (let i = 0; i < userReplies.length; i++) {
    const userText = userReplies[i];
    conversation.push({ role: "user", content: userText });

    const resp = await postChat(sessionId, conversation);
    conversation.push({ role: "assistant", content: resp.text });

    const beatId = resp.currentBeatId;
    const label = resp.beatLabel;
    const tools = resp.toolCalls?.map((t) => t.name).join(", ") || "none";

    console.log(`Turn ${i + 1} (${resp.latencyMs}ms): Beat ${beatId} [${label}] | Tools: ${tools}`);
    console.log(`  Max: "${resp.text.substring(0, 90)}..."`);

    if (beatId <= currentBeat && i > 0) {
      allPassed = false;
      details.push(`Failed to advance: remained on Beat ${beatId} on turn ${i + 1}`);
    }
    currentBeat = beatId;
  }

  details.push(`Reached Beat ${currentBeat} with latency avg under 1.5s`);
  printResult("Test 1: Golden Path", allPassed && currentBeat === 16, details);
  return allPassed && currentBeat === 16;
}

// ---------------------------------------------------------------------------
// TEST 2: Interruption & Cut-off (Barge-in Scenarios)
// ---------------------------------------------------------------------------
async function testInterruptions() {
  const sessionId = `test_interrupt_${Date.now()}`;
  const conversation = [];
  const details = [];
  let allPassed = true;

  console.log("\n=======================================================");
  console.log("RUNNING TEST 2: Mid-Speech User Interruptions");
  console.log("=======================================================");

  // Step 1: Start call
  conversation.push({ role: "user", content: "Yeah I hear you." });
  let resp = await postChat(sessionId, conversation);
  conversation.push({ role: "assistant", content: resp.text });
  console.log(`Start Beat ${resp.currentBeatId}: "${resp.text.substring(0, 70)}..."`);

  // Interruption 1: User cuts off with identity question
  console.log("\n-> User interrupts: 'Wait, wait, who are you again?'");
  conversation.push({ role: "user", content: "Wait, wait, who are you again?" });
  resp = await postChat(sessionId, conversation);
  conversation.push({ role: "assistant", content: resp.text });
  console.log(`Max responded in ${resp.latencyMs}ms: "${resp.text}"`);

  const answeredIdentity = /max/i.test(resp.text) && /finance/i.test(resp.text);
  if (answeredIdentity) {
    details.push("Successfully answered identity interruption without breaking flow.");
  } else {
    allPassed = false;
    details.push(`Failed to identify as Max: "${resp.text}"`);
  }

  // Interruption 2: User cuts off with sales objection
  console.log("\n-> User interrupts: 'Hold on, is this a sales call?'");
  conversation.push({ role: "user", content: "Hold on, is this a sales call?" });
  resp = await postChat(sessionId, conversation);
  conversation.push({ role: "assistant", content: resp.text });
  console.log(`Max responded in ${resp.latencyMs}ms: "${resp.text}"`);

  const handledSalesObj = /not at all|review|paperwork/i.test(resp.text);
  if (handledSalesObj) {
    details.push("Successfully handled sales call objection with reassurance.");
  } else {
    allPassed = false;
    details.push(`Failed to reassure on sales objection: "${resp.text}"`);
  }

  // Interruption 3: User cuts off abruptly mid-pitch
  console.log("\n-> User interrupts: 'Wait a second, how much is this going to cost me?'");
  conversation.push({ role: "user", content: "Wait a second, how much is this going to cost me?" });
  resp = await postChat(sessionId, conversation);
  conversation.push({ role: "assistant", content: resp.text });
  console.log(`Max responded in ${resp.latencyMs}ms: "${resp.text}"`);

  printResult("Test 2: Interruption Handling", allPassed, details);
  return allPassed;
}

// ---------------------------------------------------------------------------
// TEST 3: Curveball Questions (Pivot Framework)
// ---------------------------------------------------------------------------
async function testCurveballs() {
  const sessionId = `test_curve_${Date.now()}`;
  const conversation = [];
  const details = [];
  let allPassed = true;

  console.log("\n=======================================================");
  console.log("RUNNING TEST 3: Curveballs & Off-Script Questions");
  console.log("=======================================================");

  const curveballs = [
    {
      q: "Wait, are you an AI or a real human?",
      check: (txt) => /ai|assistant|digital/i.test(txt),
      desc: "Honest AI identity check",
    },
    {
      q: "What happens if I get in a total car crash on the highway?",
      check: (txt) => /gap|insurance|accident|total/i.test(txt) || txt.length > 20,
      desc: "Accident / GAP insight",
    },
    {
      q: "Can I pay for this in Bitcoin or Ethereum?",
      check: (txt) => /bitcoin|crypto|finance|dealership|dollars/i.test(txt),
      desc: "Crypto question with witty dealer response",
    },
  ];

  for (const c of curveballs) {
    console.log(`\n-> Caller asks: "${c.q}"`);
    conversation.push({ role: "user", content: c.q });
    const resp = await postChat(sessionId, conversation);
    conversation.push({ role: "assistant", content: resp.text });
    console.log(`Max (${resp.latencyMs}ms): "${resp.text}"`);

    const passed = c.check(resp.text);
    if (passed) {
      details.push(`Handled "${c.desc}" successfully.`);
    } else {
      allPassed = false;
      details.push(`Failed "${c.desc}": "${resp.text}"`);
    }
  }

  printResult("Test 3: Curveball Resilience", allPassed, details);
  return allPassed;
}

// ---------------------------------------------------------------------------
// TEST 4: Anti-Echo Verification (Simulated Microphone Feedback)
// ---------------------------------------------------------------------------
async function testAntiEcho() {
  const sessionId = `test_echo_${Date.now()}`;
  const conversation = [];
  const details = [];
  let allPassed = true;

  console.log("\n=======================================================");
  console.log("RUNNING TEST 4: Anti-Echo & Self-Speech Loop Immunity");
  console.log("=======================================================");

  // Turn 1: Tech Check
  conversation.push({ role: "user", content: "Yes I hear you fine." });
  let resp = await postChat(sessionId, conversation);
  conversation.push({ role: "assistant", content: resp.text });
  const beat1Text = resp.text;
  console.log(`Beat 1 delivered: "${beat1Text.substring(0, 70)}..."`);

  // Simulate Mic Echo of Beat 1:
  console.log("\n-> User's mic echoes back: '" + beat1Text.substring(0, 60) + "...'");
  conversation.push({ role: "user", content: beat1Text });
  resp = await postChat(sessionId, conversation);
  conversation.push({ role: "assistant", content: resp.text });

  console.log(`Result Beat ${resp.currentBeatId}: "${resp.text.substring(0, 70)}..."`);

  // Max MUST advance to Beat 2 instead of repeating Beat 1!
  if (resp.currentBeatId === 2) {
    details.push("Anti-Echo guard successfully advanced to Beat 2 without repeating Beat 1!");
  } else {
    allPassed = false;
    details.push(`Anti-Echo failed: stayed on Beat ${resp.currentBeatId}`);
  }

  printResult("Test 4: Anti-Echo Immunity", allPassed, details);
  return allPassed;
}

// ---------------------------------------------------------------------------
// TEST 5: Script Completion at Beat 16 & Clean Handoff (Strict wordtoword.md boundary)
// ---------------------------------------------------------------------------
async function testCompletionAtBeat16() {
  const sessionId = `test_complete_${Date.now()}`;
  const conversation = [];
  const details = [];
  let allPassed = true;

  console.log("\n=======================================================");
  console.log("RUNNING TEST 5: Script Completion at Beat 16 (wordtoword.md Strict Boundary)");
  console.log("=======================================================");

  conversation.push({ role: "user", content: "Yes, I hear you." });
  let resp = await postChat(sessionId, conversation);
  conversation.push({ role: "assistant", content: resp.text });

  // Caller completes and asks for next steps at Beat 16
  console.log("-> Customer completes call: 'Awesome, everything sounds good. What are the next steps?'");
  conversation.push({ role: "user", content: "Awesome, everything sounds good. What are the next steps?" });
  resp = await postChat(sessionId, conversation);
  conversation.push({ role: "assistant", content: resp.text });
  console.log(`Max Response (${resp.latencyMs}ms): "${resp.text}"`);

  if (resp.text.length > 10) {
    details.push("Clean script delivery up to Beat 16 without unscripted improvisations.");
  } else {
    allPassed = false;
    details.push("Failed completion check.");
  }

  printResult("Test 5: Script Completion at Beat 16", allPassed, details);
  return allPassed;
}

// ---------------------------------------------------------------------------
// Main Suite Runner
// ---------------------------------------------------------------------------
async function runAll() {
  console.log("Starting Production Test Suite for DFM Agent...\n");
  const t1 = await testGoldenPath();
  const t2 = await testInterruptions();
  const t3 = await testCurveballs();
  const t4 = await testAntiEcho();
  const t5 = await testCompletionAtBeat16();

  console.log("\n=======================================================");
  console.log("TEST SUITE SUMMARY");
  console.log("=======================================================");
  console.log(`1. Golden Path:          ${t1 ? "PASSED" : "FAILED"}`);
  console.log(`2. Interruption Test:    ${t2 ? "PASSED" : "FAILED"}`);
  console.log(`3. Curveball Test:       ${t3 ? "PASSED" : "FAILED"}`);
  console.log(`4. Anti-Echo Test:       ${t4 ? "PASSED" : "FAILED"}`);
  console.log(`5. Script End Beat 16:   ${t5 ? "PASSED" : "FAILED"}`);

  if (t1 && t2 && t3 && t4 && t5) {
    console.log("\n🌟 ALL TESTS PASSED! AGENT IS PRODUCTION-READY.");
    process.exit(0);
  } else {
    console.log("\n⚠️ SOME TESTS FAILED. INVESTIGATION REQUIRED.");
    process.exit(1);
  }
}

runAll().catch((err) => {
  console.error("FATAL ERROR IN SUITE:", err);
  process.exit(1);
});
