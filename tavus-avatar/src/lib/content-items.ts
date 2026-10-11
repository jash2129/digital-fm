/**
 * Digital Finance Manager (DFM) Presentation Content Items
 * Maps tool call arguments and conversational aliases to presentation overlays.
 */

export const FINANCE_CONTENT_ITEMS = {
  warranty_terms: {
    url: "/content/warranty-terms",
    label: "Factory Warranty Terms",
  },
  cost_breakdown: {
    url: "/content/cost-breakdown",
    label: "Repair Cost Breakdown",
  },
  four_square: {
    url: "/content/four-square",
    label: "Digital Four Square Menu",
  },
  pricing_ladder: {
    url: "/content/pricing-ladder",
    label: "Protection Investment Summary",
  },
  deal_summary: {
    url: "/content/deal-summary",
    label: "Deal Summary & Agreement",
  },
  escalate_to_human: {
    url: "/content/escalate",
    label: "Connecting You With a Team Member",
  },
} as const;

export type ContentItemKey = keyof typeof FINANCE_CONTENT_ITEMS;

export const CONTENT_ITEMS: Record<ContentItemKey, { url: string; label: string }> = FINANCE_CONTENT_ITEMS;

export const FINANCE_CONTENT_ITEM_ALIASES: Record<ContentItemKey, string[]> = {
  warranty_terms: [
    "warranty_terms",
    "warranty terms",
    "factory warranty",
    "manufacturer warranty",
    "bumper to bumper warranty",
    "powertrain warranty",
    "defect only",
    "show warranty",
    "warranty",
    "warranties",
    "coverage terms",
    "page 4",
  ],
  cost_breakdown: [
    "cost_breakdown",
    "cost breakdown",
    "repair costs",
    "repair cost breakdown",
    "wear and tear",
    "what things cost",
    "show cost breakdown",
    "show repair costs",
    "breakdown costs",
    "climate costs",
    "labor rate",
  ],
  four_square: [
    "four_square",
    "four square",
    "protection menu",
    "protection plan",
    "protection package",
    "bundled package",
    "4 square",
    "four products",
    "products",
    "menu",
    "all products",
    "blanket cover",
    "grid",
    "vsc",
    "tire_wheel",
    "maintenance",
    "gap",
    "tires",
    "oil change",
  ],
  pricing_ladder: [
    "pricing_ladder",
    "pricing ladder",
    "pricing",
    "ladder",
    "negotiation ladder",
    "tiers",
    "discount ladder",
    "investment summary",
    "daily rate",
    "coffee comparison",
    "starbucks",
    "monthly payment",
    "rates",
  ],
  deal_summary: [
    "deal_summary",
    "deal summary",
    "summary",
    "verbal close",
    "close summary",
    "agreed package",
    "final summary",
    "confirmation",
    "agreement",
    "verbal close summary",
    "closed deal",
  ],
  escalate_to_human: [
    "escalate_to_human",
    "connect me with a team member",
    "get a team member",
    "talk to a human",
    "talk to someone else",
    "manager",
    "speak to a person",
    "escalate",
    "floor breach",
  ],
};

const CONTENT_ITEM_ALIASES: Record<ContentItemKey, string[]> = FINANCE_CONTENT_ITEM_ALIASES;

export const DEFAULT_CONTENT_ITEM_KEY: ContentItemKey = "warranty_terms";

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

  return null;
}
