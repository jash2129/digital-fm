import { isFinanceEvent } from "@/lib/event";

const AWS_CONTENT_ITEMS = {
  aws_voice_ai_overview: {
    url: "/content/aws-voice-ai",
    label: "AWS Voice AI Overview",
  },
  guidance_voice_agents_aws: {
    url: "/content/guidance-voice-agents-aws",
    label: "Guidance for Voice Agents on AWS",
  },
  common_use_cases: {
    url: "/content/common-use-cases",
    label: "Voice AI Use Cases by Industry",
  },
} as const;

const AWS_CONTENT_ITEM_ALIASES: Record<keyof typeof AWS_CONTENT_ITEMS, string[]> = {
  aws_voice_ai_overview: [
    "aws_voice_ai_overview",
    "aws voice ai overview",
    "aws ai overview",
    "aws overview",
    "voice ai overview",
    "aws voice overview",
  ],
  guidance_voice_agents_aws: [
    "guidance_voice_agents_aws",
    "guidance for voice agents",
    "guidance for voice agents on aws",
    "voice agents guidance",
    "voice agent guidance aws",
    "aws guidance",
    "aws voice agent guidance",
    "sample voice agent",
    "architecture diagram",
    "reference architecture",
    "diagram",
    "the diagram",
    "show diagram",
    "voice agent architecture",
  ],
  common_use_cases: [
    "common_use_cases",
    "common use cases",
    "use cases",
    "use cases by industry",
    "industry use cases",
    "voice ai use cases",
    "what industries",
    "industry examples",
    "show use cases",
    "use case examples",
  ],
};

const FINANCE_CONTENT_ITEMS = {
  pricing_gap: {
    url: "/content/pricing-gap",
    label: "GAP Coverage",
  },
  pricing_vsc: {
    url: "/content/pricing-vsc",
    label: "10-Year Bumper-to-Bumper",
  },
  pricing_tire_wheel: {
    url: "/content/pricing-tire-wheel",
    label: "Tire & Wheel Coverage",
  },
  pricing_maintenance: {
    url: "/content/pricing-maintenance",
    label: "Maintenance Plan",
  },
  payment_breakdown: {
    url: "/content/payment-breakdown",
    label: "Payment Breakdown",
  },
} as const;

const FINANCE_CONTENT_ITEM_ALIASES: Record<keyof typeof FINANCE_CONTENT_ITEMS, string[]> = {
  pricing_gap: ["pricing_gap", "gap", "gap insurance", "gap coverage", "gap pricing", "show gap"],
  pricing_vsc: [
    "pricing_vsc",
    "vsc",
    "bumper to bumper",
    "bumper-to-bumper",
    "vehicle service contract",
    "extended service contract",
    "service contract",
    "vsc pricing",
  ],
  pricing_tire_wheel: [
    "pricing_tire_wheel",
    "tire and wheel",
    "tire & wheel",
    "tire wheel coverage",
    "tires and wheels",
    "show tire and wheel",
  ],
  pricing_maintenance: [
    "pricing_maintenance",
    "maintenance",
    "maintenance plan",
    "prepaid maintenance",
    "maintenance pricing",
    "show maintenance",
  ],
  payment_breakdown: [
    "payment_breakdown",
    "payment breakdown",
    "monthly payment",
    "daily payment",
    "payment comparison",
    "show payment",
    "show payments",
    "the offer",
    "show the price",
  ],
};

export type ContentItemKey = keyof typeof AWS_CONTENT_ITEMS | keyof typeof FINANCE_CONTENT_ITEMS;

export const CONTENT_ITEMS = (isFinanceEvent() ? FINANCE_CONTENT_ITEMS : AWS_CONTENT_ITEMS) as Record<
  ContentItemKey,
  { url: string; label: string }
>;
const CONTENT_ITEM_ALIASES = (
  isFinanceEvent() ? FINANCE_CONTENT_ITEM_ALIASES : AWS_CONTENT_ITEM_ALIASES
) as Record<ContentItemKey, string[]>;
export const DEFAULT_CONTENT_ITEM_KEY: ContentItemKey = Object.keys(
  CONTENT_ITEMS,
)[0] as ContentItemKey;

function normalizeContentKey(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function isContentItemKey(value: string): value is ContentItemKey {
  return Object.prototype.hasOwnProperty.call(CONTENT_ITEMS, value);
}

export function resolveContentItemKey(value?: unknown): ContentItemKey | null {
  if (typeof value !== "string" || value.trim().length === 0) {
    if (Object.keys(CONTENT_ITEMS).length === 1) {
      return DEFAULT_CONTENT_ITEM_KEY;
    }

    return null;
  }

  if (isContentItemKey(value)) {
    return value;
  }

  const normalizedValue = normalizeContentKey(value);

  const matchedEntry = (Object.entries(CONTENT_ITEM_ALIASES) as Array<
    [ContentItemKey, string[]]
  >).find(([, aliases]) =>
    aliases.some((alias) => {
      const normalizedAlias = normalizeContentKey(alias);
      return (
        normalizedAlias === normalizedValue ||
        normalizedAlias.includes(normalizedValue) ||
        normalizedValue.includes(normalizedAlias)
      );
    }),
  );

  if (matchedEntry) {
    return matchedEntry[0];
  }

  if (Object.keys(CONTENT_ITEMS).length === 1) {
    return DEFAULT_CONTENT_ITEM_KEY;
  }

  return null;
}
