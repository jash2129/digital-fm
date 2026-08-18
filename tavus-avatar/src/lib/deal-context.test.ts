import { beforeEach, describe, expect, it, vi } from "vitest";

import { createDeal, formatDealContext, getDeal } from "./deal-context";

describe("deal-context store", () => {
  beforeEach(() => {
    globalThis.__dealContextStore__?.clear();
    vi.useRealTimers();
  });

  it("returns undefined for an unknown deal id", () => {
    expect(getDeal("does-not-exist")).toBeUndefined();
  });

  it("stores and retrieves a deal by the id it returns", () => {
    const dealId = createDeal({ customerName: "Sam" });
    expect(getDeal(dealId)).toEqual({ customerName: "Sam" });
  });

  it("expires a deal after its TTL", () => {
    vi.useFakeTimers();
    const dealId = createDeal({ customerName: "Sam" });
    expect(getDeal(dealId)).toBeDefined();

    vi.advanceTimersByTime(2 * 60 * 60 * 1000 + 1); // just past the 2-hour TTL
    expect(getDeal(dealId)).toBeUndefined();
  });
});

describe("formatDealContext", () => {
  it("returns null when there is nothing to say", () => {
    expect(formatDealContext({})).toBeNull();
  });

  it("includes only the fields that are present", () => {
    const result = formatDealContext({ customerName: "Sam" });
    expect(result).toContain("Customer name: Sam");
    expect(result).not.toContain("Vehicle:");
    expect(result).not.toContain("Financing terms:");
  });

  it("joins vehicle year/make/model into one line", () => {
    const result = formatDealContext({ vehicle: { year: "2026", make: "Hyundai", model: "Elantra" } });
    expect(result).toContain("Vehicle: 2026 Hyundai Elantra");
  });

  it("handles a partial vehicle (missing make)", () => {
    const result = formatDealContext({ vehicle: { year: "2026", model: "Elantra" } });
    expect(result).toContain("Vehicle: 2026 Elantra");
  });

  it("includes financing terms when present", () => {
    const result = formatDealContext({ financingTerms: "60mo @ 6.9% APR" });
    expect(result).toContain("Financing terms: 60mo @ 6.9% APR");
  });
});
