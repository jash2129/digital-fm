import "server-only";

// Per-visitor active-conversation tracking so that one customer starting a
// call never ends another customer's in-progress call. Keyed by an anonymous
// visitor-id cookie (see src/lib/visitor.ts), not by the shared demo auth
// token — multiple visitors can share the same auth token but must never
// share the same conversation slot.
//
// In-memory and process-local: correct on a single persistent Node process
// (Railway/Render/Fly.io style hosting). Do NOT deploy this to a
// multi-instance or serverless host (e.g. Vercel functions) without first
// moving this to a shared store (Redis, etc) — separate instances would each
// have their own empty map and the "end the previous call" guarantee would
// silently stop working.
declare global {
  var __activeConversationsByVisitor__: Map<string, string> | undefined;
}

function getStore() {
  if (!globalThis.__activeConversationsByVisitor__) {
    globalThis.__activeConversationsByVisitor__ = new Map<string, string>();
  }

  return globalThis.__activeConversationsByVisitor__;
}

export function getActiveConversation(visitorId: string): string | undefined {
  return getStore().get(visitorId);
}

export function setActiveConversation(visitorId: string, conversationId: string) {
  getStore().set(visitorId, conversationId);
}

/** Clears the tracked conversation for a visitor. If conversationId is given, only clears when it still matches (avoids clobbering a newer call that started in the meantime). */
export function clearActiveConversation(visitorId: string, conversationId?: string) {
  const store = getStore();

  if (conversationId && store.get(visitorId) !== conversationId) {
    return;
  }

  store.delete(visitorId);
}
