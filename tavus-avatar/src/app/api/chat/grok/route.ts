import { readFileSync, existsSync } from "fs";
import { resolve } from "path";
import { NextResponse } from "next/server";

const XAI_API_BASE = "https://api.x.ai/v1";

function getSystemPrompt() {
  const candidatePaths = [
    resolve(process.cwd(), "../prompts/digital-finance-manager/system-instruction.md"),
    resolve(process.cwd(), "prompts/digital-finance-manager/system-instruction.md"),
    resolve("E:/digital_fm/digital-fm/prompts/digital-finance-manager/system-instruction.md"),
  ];

  for (const p of candidatePaths) {
    if (existsSync(p)) {
      return readFileSync(p, "utf8").trim();
    }
  }

  return "You are Max, a Digital Finance Manager at a car dealership in Texas.";
}

const GROK_TOOLS = [
  {
    type: "function",
    function: {
      name: "show_content",
      description:
        "Display a content panel or canvas view on screen while you talk through it. Options include warranty_terms, cost_breakdown, four_square, pricing_ladder, and deal_summary.",
      parameters: {
        type: "object",
        properties: {
          item: {
            type: "string",
            enum: ["warranty_terms", "cost_breakdown", "four_square", "pricing_ladder", "deal_summary", "welcome"],
            description:
              "warranty_terms = factory warranty defect limit; cost_breakdown = repair costs; four_square = 2x2 presentation grid; pricing_ladder = negotiation ladder; deal_summary = verbal close summary.",
          },
        },
        required: ["item"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "draw_grid_outline",
      description:
        "Draw the empty four-box grid on screen, before any product has been filled in. Call this once, right as you begin the Square 4 recap, before the first show_pricing call.",
      parameters: {
        type: "object",
        properties: {},
      },
    },
  },
  {
    type: "function",
    function: {
      name: "show_pricing",
      description:
        "Fill in one box of the on-screen grid with the coverage for one of the bundled products, while you describe what it covers. Call it once per product during the Square 4 recap, after draw_grid_outline.",
      parameters: {
        type: "object",
        properties: {
          product: {
            type: "string",
            enum: ["vsc", "tire_wheel", "maintenance", "gap"],
            description: "Which product's box to fill in: vsc, tire_wheel, maintenance, gap.",
          },
        },
        required: ["product"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "show_payment_breakdown",
      description:
        "Update the price banner on the grid to show ONLY the specific daily rate you are currently saying out loud. Call this every time you state or change the price.",
      parameters: {
        type: "object",
        properties: {
          daily_rate: {
            type: "number",
            enum: [4, 3.5, 3.25, 3],
            description: "The daily rate you just quoted, in dollars (4, 3.5, 3.25, or 3).",
          },
        },
        required: ["daily_rate"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "propose_concession",
      description:
        "Evaluate price negotiation against the deterministic ladder outside LLM weights. Stage 1 = $4.00, Stage 2 = $3.50, Stage 3 = $3.25, Stage 4 = $3.00 (hard floor).",
      parameters: {
        type: "object",
        properties: {
          stage: {
            type: "integer",
            enum: [1, 2, 3, 4],
            description: "The price option level: 1 = $4.00/day, 2 = $3.50/day, 3 = $3.25/day, 4 = $3.00/day floor.",
          },
        },
        required: ["stage"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "escalate_to_human",
      description: "Call when the customer needs a real human team member, especially if they push past the $3.00/day floor.",
      parameters: {
        type: "object",
        properties: {
          reason: { type: "string" },
        },
      },
    },
  },
];

export async function POST(request: Request) {
  try {
    const apiKey = process.env.XAI_API_KEY?.trim();
    if (!apiKey) {
      return NextResponse.json({ error: "Missing XAI_API_KEY" }, { status: 500 });
    }

    const model = process.env.GROK_MODEL?.trim() || "grok-4.20-0309-non-reasoning";
    const body = await request.json();
    const { messages = [], sessionId = "live_session" } = body;

    const baseSystemPrompt = getSystemPrompt();

    // Evaluate Controller State Machine for this turn
    const { evaluateControllerStep } = await import("@/lib/txm-controller");
    const latestUserMessage = [...messages].reverse().find((m: any) => m.role === "user")?.content || "";
    const decision = evaluateControllerStep(sessionId, latestUserMessage);

    console.log(`[controller] Session ${sessionId} -> Beat ${decision.nextBeatId} (${decision.nextBeat.label}), Intent: ${decision.customerIntent}, isQuestionOrRemark: ${decision.isQuestionOrRemark}`);

    // When progressing through the SOP script, deliver the exact word-to-word text from wordtoword.md!
    // No LLM hallucination, no drifting, 100% verbatim fidelity.
    if (!decision.isQuestionOrRemark) {
      const cleanVerbatimText = decision.verbatimScriptText
        .replace(/\([a-zA-Z0-9\s,.'-]{1,80}\)/g, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/[*_#`~\[\]]/g, "")
        .replace(/\n+/g, " ")
        .replace(/\s+/g, " ")
        .trim();

      console.log(`[controller] Verbatim SOP Beat ${decision.nextBeatId} delivered: "${cleanVerbatimText.substring(0, 80)}..."`);
      return NextResponse.json({
        text: cleanVerbatimText,
        toolCalls: decision.toolCalls,
        role: "assistant",
        currentBeatId: decision.nextBeatId,
        beatLabel: decision.nextBeat.label,
      });
    }

    // Out-of-the-box question, remark, sales objection, or curveball: Grok answers dynamically using its own words!
    const systemPrompt = `${baseSystemPrompt}\n\n${decision.promptInjection}`;

    const fullMessages = [
      { role: "system", content: systemPrompt },
      ...messages,
    ];

    const response = await fetch(`${XAI_API_BASE}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: fullMessages,
        tools: GROK_TOOLS,
        tool_choice: "auto",
        temperature: 0.1,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.warn("[api/chat/grok] xAI API warning:", response.status, errorText, "-> Activating TXM deterministic fail-safe");
      const cleanFallbackText = (decision.fallbackText || decision.nextBeat.text)
        .replace(/\([a-zA-Z0-9\s,.'-]{1,80}\)/g, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/[*_#`~\[\]]/g, "")
        .replace(/\n+/g, " ")
        .replace(/\s+/g, " ")
        .trim();

      return NextResponse.json({
        text: cleanFallbackText,
        toolCalls: decision.toolCalls,
        role: "assistant",
        currentBeatId: decision.nextBeatId,
        beatLabel: decision.nextBeat.label,
      });
    }

    const data = await response.json();
    const choice = data.choices?.[0]?.message;

    const toolCalls: Array<{ name: string; args: Record<string, any> }> = [];
    let text = choice?.content || "";

    if (choice?.tool_calls?.length) {
      for (const tc of choice.tool_calls) {
        try {
          toolCalls.push({
            name: tc.function.name,
            args: JSON.parse(tc.function.arguments || "{}"),
          });
        } catch {
          toolCalls.push({
            name: tc.function.name,
            args: {},
          });
        }
      }

      // If text is empty (standard in function calling), resolve tool calls with Grok or fallback to verbatim beat!
      if (!text.trim()) {
        try {
          const followUpMessages = [
            ...fullMessages,
            choice,
            ...choice.tool_calls.map((tc: any) => ({
              role: "tool",
              tool_call_id: tc.id,
              content: JSON.stringify({ status: "displayed", function: tc.function?.name }),
            })),
          ];

          const followUpRes = await fetch(`${XAI_API_BASE}/chat/completions`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model,
              messages: followUpMessages,
              temperature: 0.1,
            }),
          });

          if (followUpRes.ok) {
            const followUpData = await followUpRes.json();
            text = followUpData.choices?.[0]?.message?.content || "";
          }
        } catch (followUpErr) {
          console.warn("[api/chat/grok] Follow-up resolution error:", followUpErr);
        }

        // Instant fail-safe: deliver verbatim beat text directly
        if (!text.trim()) {
          text = decision.fallbackText || decision.nextBeat.text;
        }
      }
    }

    // Clean text for speech synthesis (strip parenthetical stage directions, markdown, brackets, tags, newlines)
    text = (text || decision.fallbackText || decision.nextBeat.text)
      .replace(/\([a-zA-Z0-9\s,.'-]{1,80}\)/g, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/[*_#`~\[\]]/g, "")
      .replace(/\n+/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    // Merge deterministic controller tool calls if not already added by Grok
    for (const dtc of decision.toolCalls) {
      if (!toolCalls.some((tc) => tc.name === dtc.name)) {
        toolCalls.push(dtc);
      }
    }

    return NextResponse.json({
      text,
      toolCalls,
      role: "assistant",
      currentBeatId: decision.nextBeatId,
      beatLabel: decision.nextBeat.label,
    });
  } catch (error: any) {
    console.error("[api/chat/grok] Error:", error);
    return NextResponse.json({ error: error.message || "Failed to process chat with Grok" }, { status: 500 });
  }
}
