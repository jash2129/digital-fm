import { isFinanceEvent } from "@/lib/event";
import { getApprovedDailyRates, getOrderedProductKeys, getPricingConfig } from "@/lib/pricing-config";

const AWS_PERSONA_TOOL_PATCH = [
  {
    op: "replace",
    path: "/layers/llm/tools",
    value: [
      {
        type: "function",
        function: {
          name: "show_content",
          description:
            "Shows content on the main display while moving the video conversation to a small overlay. Use this when the user asks to see, show, or look at something — including requests for diagrams, architecture diagrams, or the reference architecture.",
          parameters: {
            type: "object",
            properties: {
              item: {
                type: "string",
                enum: [
                  "aws_voice_ai_overview",
                  "guidance_voice_agents_aws",
                  "common_use_cases",
                ],
                description:
                  "The item to display. Options: aws_voice_ai_overview = local AWS voice AI overview page; guidance_voice_agents_aws = Guidance for Voice Agents on AWS reference architecture; common_use_cases = Voice AI use cases by industry",
              },
            },
            required: ["item"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "show_schedule",
          description:
            "Shows one to three schedule boxes on the main display while moving the video conversation to a small overlay. Use this when the user asks about the AWS Summit Sydney schedule, booth sessions, what is happening on a given day, or which sessions to visit. First consult the schedule knowledge base, then decide whether the answer fits best as 1, 2, or 3 boxes. Each box should contain a concise pipe-delimited Markdown table. Aim for 8 body rows or fewer per box, but you may use up to 11 body rows when needed. If the content would be taller than that, split it across multiple boxes with clear titles such as Day 1, Day 2, or by topic.",
          parameters: {
            type: "object",
            properties: {
              title: {
                type: "string",
                description:
                  "Short title for the overall schedule screen, such as Thursday Booth Demos or Voice AI Related Demos.",
              },
              columns: {
                type: "array",
                minItems: 1,
                maxItems: 3,
                description:
                  "One to three schedule boxes to render side by side. Split the answer into multiple boxes when that makes the schedule easier to fit and read.",
                items: {
                  type: "object",
                  properties: {
                    title: {
                      type: "string",
                      description:
                        "Short title for this box, such as Monday, Tuesday, Scheduled Demos, Drop-in Demos, Theater Sessions, or Kiosk 3.",
                    },
                    markdown_table: {
                      type: "string",
                      description:
                        "A concise pipe-delimited Markdown table for this box. Aim for 8 body rows or fewer, with an absolute maximum of 11 body rows.",
                    },
                  },
                  required: ["markdown_table"],
                },
              },
            },
            required: ["title", "columns"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "dismiss_content",
          description:
            "Dismisses the currently displayed content and returns the video conversation to full screen. Use when the user is done looking at the content or asks to go back.",
          parameters: {
            type: "object",
            properties: {},
          },
        },
      },
    ],
  },
] as const;

function buildFinancePersonaToolPatch() {
  const config = getPricingConfig();
  const productKeys = getOrderedProductKeys(config);
  const dailyRates = getApprovedDailyRates(config);
  const floorRate = config.negotiation.floorRateUsd;
  const productEnumDescription = productKeys
    .map((key) => `${key} = ${config.products[key].label}`)
    .join(", ");

  return [
    {
      op: "replace",
      path: "/layers/llm/tools",
      value: [
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
                  enum: [
                    "warranty_terms",
                    "cost_breakdown",
                    "four_square",
                    "pricing_ladder",
                    "deal_summary",
                    "welcome",
                  ],
                  description:
                    "warranty_terms = factory warranty defect limit; cost_breakdown = repair costs; four_square = 2x2 presentation grid; pricing_ladder = negotiation ladder; deal_summary = verbal close summary.",
                },
                view: {
                  type: "string",
                  enum: [
                    "warranty_terms",
                    "cost_breakdown",
                    "four_square",
                    "pricing_ladder",
                    "deal_summary",
                    "welcome",
                  ],
                  description: "Alias for item.",
                },
              },
            },
          },
        },
        {
          type: "function",
          function: {
            name: "propose_concession",
            description:
              "Evaluate price negotiation against the deterministic ladder outside LLM weights. Option 1 = $4.00, Option 2 = $3.50, Option 3 = $3.25, Option 4 = $3.00 (hard floor). Prices below $3.00 are rejected and require manager escalation.",
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
            name: "advance_stage",
            description:
              "Advance the call to the next conversational section. Enforces sequential pipeline order.",
            parameters: {
              type: "object",
              properties: {
                targetStep: {
                  type: "string",
                  enum: [
                    "rapport",
                    "greeting",
                    "disclosure",
                    "qualifying",
                    "four_square",
                    "objection",
                    "close",
                    "verification",
                    "payment",
                    "documents",
                  ],
                  description: "The target section in the conversation.",
                },
              },
              required: ["targetStep"],
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
              "Fill in one box of the on-screen grid with the coverage for one of the bundled products, while you describe what it covers. These products are sold as one bundled package, not priced individually — the box shows coverage details only, no dollar amount. Call it once per product during the Square 4 recap, after draw_grid_outline.",
            parameters: {
              type: "object",
              properties: {
                product: {
                  type: "string",
                  enum: productKeys,
                  description: `Which product's box to fill in: ${productEnumDescription}.`,
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
              "Update the price banner on the grid to show ONLY the specific daily rate you are currently saying out loud. Call this every time you state or change the price — first with the opening anchor, and again each time you move to a new rate during negotiation — so the screen always matches what you just said. Never call it with a rate you have not spoken yet, and never reveal the full discount ladder; only ever show the one number that is live in the conversation right now.",
            parameters: {
              type: "object",
              properties: {
                daily_rate: {
                  type: "number",
                  enum: dailyRates,
                  description: `The daily rate you just quoted, in dollars. Approved values only: ${dailyRates.join(", ")} (${floorRate} is the hard floor — do not go below this without a human team member).`,
                },
              },
              required: ["daily_rate"],
            },
          },
        },
        {
          type: "function",
          function: {
            name: "clear_canvas",
            description:
              "Clear the grid completely and hide it. Use if the presentation restarts from scratch, or the customer asks to see it again from the beginning.",
            parameters: {
              type: "object",
              properties: {},
            },
          },
        },
        {
          type: "function",
          function: {
            name: "escalate_to_human",
            description:
              `Call this when a customer needs a real team member instead of you — most importantly when they ask for a price below the $${floorRate}/day floor, but also for anything else you cannot resolve yourself. Displays a panel confirming a team member has been notified. Say the hand-off line out loud in the same turn as calling this.`,
            parameters: {
              type: "object",
              properties: {
                reason: {
                  type: "string",
                  description: "Brief internal note on why you escalated, e.g. \"customer requested below price floor\". Not shown to the customer.",
                },
              },
              required: [],
            },
          },
        },
        {
          type: "function",
          function: {
            name: "dismiss_content",
            description:
              "Dismisses the currently displayed panel or grid and returns the video conversation to full screen. Use when the customer is done looking at it or asks to go back.",
            parameters: {
              type: "object",
              properties: {},
            },
          },
        },
      ],
    },
    {
      op: "replace",
      path: "/layers/perception/perception_tool_prompt",
      value:
        "If the customer holds up a document, ID, driver's license, registration, or any piece of " +
        "paper to the camera, read whatever text is legible on it — especially a name — and say " +
        "what you read back to the customer to confirm it's correct before using it. If the text " +
        "isn't clearly legible (angle, lighting, distance, glare), say so plainly and ask them to " +
        "hold it closer/steadier rather than guessing at what it says.",
    },
  ];
}

export const PERSONA_TOOL_PATCH = isFinanceEvent() ? buildFinancePersonaToolPatch() : AWS_PERSONA_TOOL_PATCH;
