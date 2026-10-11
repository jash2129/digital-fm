import { finalizeCallLog } from "./call-logger";
import "server-only";

// Minimal cost-visibility logging: Tavus bills by conversation minutes, so duration is the
// direct proxy for spend. This is a first pass — logs to stdout only, no aggregation or
// dashboard. Once deployed, these lines show up in the host's log viewer (Railway/Render/
// Fly.io all capture stdout). Upgrade path: replace the console.log calls with a real
// metrics/usage store once that's worth building.
declare global {
  var __conversationStartedAt__: Map<string, number> | undefined;
}

function getStore() {
  if (!globalThis.__conversationStartedAt__) {
    globalThis.__conversationStartedAt__ = new Map<string, number>();
  }

  return globalThis.__conversationStartedAt__;
}

export function recordConversationStarted(conversationId: string, personaId: string) {
  getStore().set(conversationId, Date.now());
  console.log("[conversation.started]", {
    conversationId,
    personaId,
    timestamp: new Date().toISOString(),
  });
}

export function recordConversationEnded(conversationId: string) {
  const store = getStore();
  const startedAt = store.get(conversationId);
  store.delete(conversationId);

  const durationSeconds = startedAt ? Math.round((Date.now() - startedAt) / 1000) : null;
  finalizeCallLog(conversationId, durationSeconds);

  console.log("[conversation.ended]", {
    conversationId,
    durationSeconds,
    timestamp: new Date().toISOString(),
  });
}
