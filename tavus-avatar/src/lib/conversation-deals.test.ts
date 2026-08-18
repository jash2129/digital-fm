import { beforeEach, describe, expect, it } from "vitest";

import { getDealForConversation, linkDealToConversation } from "./conversation-deals";

describe("conversation-deals", () => {
  beforeEach(() => {
    globalThis.__dealContextByConversation__?.clear();
  });

  it("returns undefined for a conversation with no linked deal", () => {
    expect(getDealForConversation("conv-1")).toBeUndefined();
  });

  it("returns the linked deal for a conversation", () => {
    linkDealToConversation("conv-1", { customerName: "Sam" });
    expect(getDealForConversation("conv-1")).toEqual({ customerName: "Sam" });
  });

  it("keeps different conversations' deals independent", () => {
    linkDealToConversation("conv-1", { customerName: "Sam" });
    linkDealToConversation("conv-2", { customerName: "Alex" });

    expect(getDealForConversation("conv-1")).toEqual({ customerName: "Sam" });
    expect(getDealForConversation("conv-2")).toEqual({ customerName: "Alex" });
  });
});
