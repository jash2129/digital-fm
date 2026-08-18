import "server-only";

import { randomUUID } from "crypto";

// Short-lived intake for real deal data (customer + vehicle + financing terms) from an
// external system (CRM, DMS, etc). Nothing calls the write side yet — this is the seam a
// future integration plugs into. Read side is already wired into POST /api/conversation
// via ?deal=<deal_id>, which folds the stored context into the Tavus conversation's
// conversational_context so the AI doesn't have to ask for information the dealership
// already has.
//
// In-memory, process-local — same constraint as active-conversations.ts: correct on a
// single persistent Node process, not on multi-instance/serverless hosting without a
// shared store.

export type DealContext = {
  customerName?: string;
  vehicle?: {
    year?: string;
    make?: string;
    model?: string;
  };
  financingTerms?: string;
};

type StoredDeal = {
  context: DealContext;
  expiresAt: number;
};

const DEAL_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours — long enough to cover a dealership visit

declare global {
  var __dealContextStore__: Map<string, StoredDeal> | undefined;
}

function getStore() {
  if (!globalThis.__dealContextStore__) {
    globalThis.__dealContextStore__ = new Map<string, StoredDeal>();
  }

  return globalThis.__dealContextStore__;
}

export function createDeal(context: DealContext): string {
  const dealId = randomUUID();
  getStore().set(dealId, { context, expiresAt: Date.now() + DEAL_TTL_MS });
  return dealId;
}

export function getDeal(dealId: string): DealContext | undefined {
  const store = getStore();
  const stored = store.get(dealId);

  if (!stored) {
    return undefined;
  }

  if (Date.now() >= stored.expiresAt) {
    store.delete(dealId);
    return undefined;
  }

  return stored.context;
}

/** Renders a DealContext into the free-text blob Tavus's conversational_context expects. Returns null if there's nothing usable to say. */
export function formatDealContext(context: DealContext): string | null {
  const lines: string[] = [];

  if (context.customerName) {
    lines.push(`Customer name: ${context.customerName}`);
  }

  const vehicleParts = [context.vehicle?.year, context.vehicle?.make, context.vehicle?.model]
    .filter((part): part is string => Boolean(part && part.trim()));
  if (vehicleParts.length > 0) {
    lines.push(`Vehicle: ${vehicleParts.join(" ")}`);
  }

  if (context.financingTerms) {
    lines.push(`Financing terms: ${context.financingTerms}`);
  }

  if (lines.length === 0) {
    return null;
  }

  return `Known deal information (confirm with the customer, don't assume it's unchanged):\n${lines.join("\n")}`;
}
