import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, "../.env.local");

const envContent = readFileSync(envPath, "utf8");
let apiKey = "";
let personaId = "";

for (const line of envContent.split("\n")) {
  const trimmed = line.trim();
  if (trimmed.startsWith("TAVUS_API_KEY=")) {
    apiKey = trimmed.split("=")[1].trim();
  }
  if (trimmed.startsWith("TAVUS_PERSONA_ID=")) {
    personaId = trimmed.split("=")[1].trim();
  }
}

if (!apiKey || !personaId) {
  console.error("Missing TAVUS_API_KEY or TAVUS_PERSONA_ID in .env.local");
  process.exit(1);
}

// Clean tools schema to register on Tavus
const cleanTools = [
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
        "Fill in one box of the on-screen grid with the coverage for one of the bundled products, while you describe what it covers. Call it once per product during the Square 4 recap, after draw_grid_outline.",
      parameters: {
        type: "object",
        properties: {
          product: {
            type: "string",
            enum: ["vsc", "tire_wheel", "maintenance", "gap"],
            description: "Which product's box to fill in: vsc = 7-Year Bumper-to-Bumper, tire_wheel = 5-Year Tire & Wheel, maintenance = 4-Year Maintenance Package, gap = GAP Coverage.",
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
            description: "The daily rate you just quoted, in dollars. Approved values: 4, 3.5, 3.25, 3.",
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
        "Clear the grid completely and hide it. Use if the presentation restarts from scratch.",
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
        "Call this when a customer needs a real team member instead of you — most importantly when they ask for a price below the $3/day floor.",
      parameters: {
        type: "object",
        properties: {
          reason: {
            type: "string",
            description: "Brief internal note on why you escalated.",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "dismiss_content",
      description:
        "Dismisses the currently displayed content and returns the video conversation to full screen.",
      parameters: {
        type: "object",
        properties: {},
      },
    },
  },
];

console.log(`Patching persona ${personaId} tools on Tavus...`);

const res = await fetch(`https://tavusapi.com/v2/personas/${personaId}`, {
  method: "PATCH",
  headers: {
    "x-api-key": apiKey,
    "Content-Type": "application/json",
  },
  body: JSON.stringify([
    {
      op: "replace",
      path: "/layers/llm/tools",
      value: cleanTools,
    },
  ]),
});

const text = await res.text();
if (!res.ok && res.status !== 304) {
  console.error(`Failed to patch persona tools: ${res.status}`, text);
  process.exit(1);
}

console.log(`✅ Persona ${personaId} tools updated on Tavus! (${res.status})`);
