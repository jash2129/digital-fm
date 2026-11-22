import { beforeEach, describe, expect, it, vi } from "vitest";

import { createDeal, formatDealContext, getDeal } from "./deal-context";

describe("deal-context store", () => {
  beforeEach(async () => {
    globalThis.__dealContextStore__?.clear();
    vi.useRealTimers();
  });

  it("returns undefined for an unknown deal id", async () => {
    expect(await getDeal("does-not-exist")).toBeUndefined();
  });

  it("stores and retrieves a deal by the id it returns", async () => {
    const dealId = await createDeal({ customerName: "Sam" });
    expect(await getDeal(dealId)).toEqual({ customerName: "Sam" });
  });

  it("expires a deal after its TTL", async () => {
    vi.useFakeTimers();
    const dealId = await createDeal({ customerName: "Sam" });
    expect(await getDeal(dealId)).toBeDefined();

    vi.advanceTimersByTime(2 * 60 * 60 * 1000 + 1); // just past the 2-hour TTL
    expect(await getDeal(dealId)).toBeUndefined();
  });
});

describe("formatDealContext", () => {
  it("returns null when there is nothing to say", async () => {
    expect(formatDealContext({})).toBeNull();
  });

  it("includes only the fields that are present", async () => {
    const result = formatDealContext({ customerName: "Sam" });
    expect(result).toContain("Customer name: Sam");
    expect(result).not.toContain("Vehicle:");
    expect(result).not.toContain("Financing terms:");
  });

  it("joins vehicle year/make/model into one line", async () => {
    const result = formatDealContext({ vehicle: { year: "2026", make: "Hyundai", model: "Elantra" } });
    expect(result).toContain("Vehicle: 2026 Hyundai Elantra");
  });

  it("handles a partial vehicle (missing make)", async () => {
    const result = formatDealContext({ vehicle: { year: "2026", model: "Elantra" } });
    expect(result).toContain("Vehicle: 2026 Elantra");
  });

  it("includes financing terms when present", async () => {
    const result = formatDealContext({ financingTerms: "60mo @ 6.9% APR" });
    expect(result).toContain("Financing terms: 60mo @ 6.9% APR");
  });
});

describe("deal-context on a shared store (Upstash, Vercel)", () => {
  it("a deal written by one server is read by another, and Redis expires it after 2 hours", async () => {
    const saved = { ...process.env };
    process.env.UPSTASH_REDIS_REST_URL = "https://example.upstash.io";
    process.env.UPSTASH_REDIS_REST_TOKEN = "test-token";
    const redis = new Map<string, string>();
    const calls: unknown[][] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      const commands = JSON.parse(String(init.body)) as string[][];
      const out = commands.map((c) => {
        calls.push(c);
        if (c[0] === "SET") { redis.set(c[1], c[2]); return { result: "OK" }; }
        if (c[0] === "GET") return { result: redis.get(c[1]) ?? null };
        return { result: null };
      });
      return new Response(JSON.stringify(out), { status: 200 });
    }));
    try {
      const dealId = await createDeal({ customerName: "Sam", vehicle: { make: "Mazda" } });
      globalThis.__dealContextStore__?.clear(); // another server: nothing in memory
      expect(await getDeal(dealId)).toEqual({ customerName: "Sam", vehicle: { make: "Mazda" } });
      expect(calls[0]).toEqual(["SET", `max:deal:${dealId}`, JSON.stringify({ customerName: "Sam", vehicle: { make: "Mazda" } }), "EX", 7200]);
    } finally {
      process.env = saved;
      vi.unstubAllGlobals();
    }
  });
});
