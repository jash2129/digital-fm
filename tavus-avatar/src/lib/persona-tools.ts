import { isFinanceEvent } from "@/lib/event";

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

const FINANCE_PERSONA_TOOL_PATCH = [
  {
    op: "replace",
    path: "/layers/llm/tools",
    value: [
      {
        type: "function",
        function: {
          name: "show_pricing",
          description:
            "Display the coverage panel for one of the four bundled products while you describe what it covers. These products are sold as one bundled package, not priced individually — this panel shows coverage details only, no dollar amount. Call it once per product during the Square 4 recap.",
          parameters: {
            type: "object",
            properties: {
              product: {
                type: "string",
                enum: ["vsc", "maintenance", "tire_wheel", "gap"],
                description:
                  "Which product's coverage panel to show: vsc = 10-year/100,000-mile bumper-to-bumper contract, maintenance = 5-year maintenance plan, tire_wheel = 5-year tire & wheel coverage, gap = GAP.",
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
            "Display the package price panel showing ONLY the specific daily rate you are currently saying out loud. Call this every time you state or change the price — first with the opening anchor, and again each time you move to a new rate during negotiation — so the screen always matches what you just said. Never call it with a rate you have not spoken yet, and never reveal the full discount ladder; only ever show the one number that is live in the conversation right now.",
          parameters: {
            type: "object",
            properties: {
              daily_rate: {
                type: "number",
                enum: [4, 3.5, 3.25, 3],
                description:
                  "The daily rate you just quoted, in dollars. Approved values only: 4 (opening anchor), 3.5, 3.25, or 3 (hard floor — do not go below this without a human team member).",
              },
            },
            required: ["daily_rate"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "dismiss_content",
          description:
            "Dismisses the currently displayed panel and returns the video conversation to full screen. Use when the customer is done looking at a panel or asks to go back.",
          parameters: {
            type: "object",
            properties: {},
          },
        },
      },
    ],
  },
] as const;

export const PERSONA_TOOL_PATCH = isFinanceEvent() ? FINANCE_PERSONA_TOOL_PATCH : AWS_PERSONA_TOOL_PATCH;
