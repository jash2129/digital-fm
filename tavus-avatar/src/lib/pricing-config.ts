import "server-only";

import { readFileSync } from "fs";
import { resolve } from "path";

// Single source of truth for the finance event's negotiation tiers and product coverage
// panels — see prompts/digital-finance-manager/pricing.json. Consumed by the content pages,
// the persona tool schemas (product/daily_rate enums), and the payment-breakdown page, so a
// dealership only has to edit one file instead of five scattered ones.
//
// Not cached across requests on purpose: this is a low-traffic admin-editable file, and
// always reading fresh means an edit takes effect on the next request with no restart.

export type PricingProduct = {
  order: number;
  label: string;
  eyebrow: string;
  title: string;
  description: string;
  bullets: string[];
};

export type PricingConfig = {
  negotiation: {
    openingRateUsd: number;
    tiersUsd: number[];
    floorRateUsd: number;
  };
  products: Record<string, PricingProduct>;
};

function getConfigPath(): string {
  return resolve(process.cwd(), "../prompts/digital-finance-manager/pricing.json");
}

export function getPricingConfig(): PricingConfig {
  const raw = readFileSync(getConfigPath(), "utf-8");
  return JSON.parse(raw) as PricingConfig;
}

/** Product keys in display order (matches the Square 4 recap order in the script). */
export function getOrderedProductKeys(config: PricingConfig = getPricingConfig()): string[] {
  return Object.entries(config.products)
    .sort(([, a], [, b]) => a.order - b.order)
    .map(([key]) => key);
}

export function getApprovedDailyRates(config: PricingConfig = getPricingConfig()): number[] {
  return config.negotiation.tiersUsd;
}
