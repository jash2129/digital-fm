import "server-only";

import type { DealContext } from "@/lib/deal-context";

// Snapshots the resolved deal context (customer/vehicle/financing) against a conversation id
// at the moment a conversation is created, so escalate_to_human can enrich its email with who
// the customer was — even after the original deal-context entry's own TTL has expired. See
// deal-context.ts for the write side of the original deal; this is a separate, conversation-
// keyed copy purely for later lookup, not the deal's source of truth.
//
// Same in-memory/process-local constraint as the other *-by-visitor stores in this app.
declare global {
  var __dealContextByConversation__: Map<string, DealContext> | undefined;
}

function getStore() {
  if (!globalThis.__dealContextByConversation__) {
    globalThis.__dealContextByConversation__ = new Map<string, DealContext>();
  }

  return globalThis.__dealContextByConversation__;
}

export function linkDealToConversation(conversationId: string, context: DealContext) {
  getStore().set(conversationId, context);
}

export function getDealForConversation(conversationId: string): DealContext | undefined {
  return getStore().get(conversationId);
}
