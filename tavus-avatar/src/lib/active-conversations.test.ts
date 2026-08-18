import { beforeEach, describe, expect, it } from "vitest";

import {
  clearActiveConversation,
  getActiveConversation,
  setActiveConversation,
} from "./active-conversations";

// Regression coverage for the concurrency bug: conversations used to be tracked in a
// single global variable, so visitor B starting a call would silently end visitor A's
// live call. These tests exist specifically to catch that regression if it ever comes back.
describe("active-conversations", () => {
  beforeEach(() => {
    // The store is a module-level singleton (see active-conversations.ts) — clear it
    // between tests by ending anything left over from the previous test.
    globalThis.__activeConversationsByVisitor__?.clear();
  });

  it("returns undefined for a visitor with no active conversation", () => {
    expect(getActiveConversation("visitor-a")).toBeUndefined();
  });

  it("tracks a conversation for the visitor that started it", () => {
    setActiveConversation("visitor-a", "conv-1");
    expect(getActiveConversation("visitor-a")).toBe("conv-1");
  });

  it("does not let one visitor's conversation affect another visitor", () => {
    setActiveConversation("visitor-a", "conv-1");
    setActiveConversation("visitor-b", "conv-2");

    expect(getActiveConversation("visitor-a")).toBe("conv-1");
    expect(getActiveConversation("visitor-b")).toBe("conv-2");
  });

  it("clears a visitor's tracked conversation", () => {
    setActiveConversation("visitor-a", "conv-1");
    clearActiveConversation("visitor-a");
    expect(getActiveConversation("visitor-a")).toBeUndefined();
  });

  it("does not clear a visitor's conversation if the id no longer matches (a newer call already replaced it)", () => {
    setActiveConversation("visitor-a", "conv-1");
    setActiveConversation("visitor-a", "conv-2"); // visitor started a second call

    clearActiveConversation("visitor-a", "conv-1"); // stale cleanup for the first call

    expect(getActiveConversation("visitor-a")).toBe("conv-2");
  });

  it("clears unconditionally when no conversationId is given", () => {
    setActiveConversation("visitor-a", "conv-1");
    clearActiveConversation("visitor-a");
    expect(getActiveConversation("visitor-a")).toBeUndefined();
  });
});
