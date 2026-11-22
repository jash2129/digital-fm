import { describe, it, expect, vi, afterEach } from "vitest";
import { sentryTarget, sentryEnvelope, reportError } from "./error-report";

const ENV = { ...process.env };
afterEach(() => {
  process.env = { ...ENV };
  vi.restoreAllMocks();
});

describe("error reporting", () => {
  it("reads a Sentry DSN into its envelope address and key", () => {
    expect(sentryTarget("https://abc123@o4500.ingest.us.sentry.io/4501")).toEqual({ url: "https://o4500.ingest.us.sentry.io/api/4501/envelope/", key: "abc123" });
    expect(sentryTarget("")).toBeNull();
    expect(sentryTarget("not a url")).toBeNull();
    expect(sentryTarget("https://o4500.ingest.sentry.io/4501")).toBeNull();
  });

  it("builds a three-line envelope with the error, where it happened and the call", () => {
    const env = sentryEnvelope(new TypeError("boom"), { source: "server", where: "/api/chat/grok", sessionId: "s1" }, "e1", new Date("2026-11-22T10:00:00Z"));
    const [header, item, event] = env.split("\n").map((l) => JSON.parse(l));
    expect(header).toEqual({ event_id: "e1", sent_at: "2026-11-22T10:00:00.000Z" });
    expect(item).toEqual({ type: "event" });
    expect(event.exception.values[0]).toEqual({ type: "TypeError", value: "boom" });
    expect(event.tags).toEqual({ source: "server", where: "/api/chat/grok" });
    expect(event.extra.sessionId).toBe("s1");
  });

  it("always logs one JSON line; sends to Sentry only with SENTRY_DSN", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchMock = vi.fn(async () => new Response("", { status: 200 }));
    delete process.env.SENTRY_DSN;
    await reportError(new Error("first"), { source: "client" }, fetchMock as unknown as typeof fetch);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(JSON.parse(String(log.mock.calls[0][0]))).toMatchObject({ event: "error", source: "client", message: "first" });

    process.env.SENTRY_DSN = "https://abc123@o1.ingest.sentry.io/42";
    await reportError(new Error("second"), { source: "server" }, fetchMock as unknown as typeof fetch);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://o1.ingest.sentry.io/api/42/envelope/");
    expect(String((init.headers as Record<string, string>)["X-Sentry-Auth"])).toContain("sentry_key=abc123");
  });

  it("never throws, even when Sentry is unreachable", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    process.env.SENTRY_DSN = "https://abc123@o1.ingest.sentry.io/42";
    const failing = vi.fn(async () => {
      throw new Error("offline");
    });
    await expect(reportError("plain string error", { source: "server" }, failing as unknown as typeof fetch)).resolves.toBeUndefined();
  });
});
