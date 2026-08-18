import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { recordConversationEnded, recordConversationStarted } from "./conversation-usage";

describe("conversation-usage logging", () => {
  beforeEach(() => {
    globalThis.__conversationStartedAt__?.clear();
    vi.useFakeTimers();
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("logs a started event with the conversation and persona ids", () => {
    recordConversationStarted("conv-1", "persona-1");

    expect(console.log).toHaveBeenCalledWith(
      "[conversation.started]",
      expect.objectContaining({ conversationId: "conv-1", personaId: "persona-1" }),
    );
  });

  it("computes duration from start to end", () => {
    recordConversationStarted("conv-1", "persona-1");
    vi.advanceTimersByTime(90_000); // 90 seconds later
    recordConversationEnded("conv-1");

    expect(console.log).toHaveBeenCalledWith(
      "[conversation.ended]",
      expect.objectContaining({ conversationId: "conv-1", durationSeconds: 90 }),
    );
  });

  it("logs null duration when the conversation was never recorded as started", () => {
    recordConversationEnded("never-started");

    expect(console.log).toHaveBeenCalledWith(
      "[conversation.ended]",
      expect.objectContaining({ conversationId: "never-started", durationSeconds: null }),
    );
  });

  it("does not double-count if the same conversation is ended twice", () => {
    recordConversationStarted("conv-1", "persona-1");
    recordConversationEnded("conv-1");
    (console.log as ReturnType<typeof vi.spyOn>).mockClear();

    recordConversationEnded("conv-1");

    expect(console.log).toHaveBeenCalledWith(
      "[conversation.ended]",
      expect.objectContaining({ durationSeconds: null }),
    );
  });
});
