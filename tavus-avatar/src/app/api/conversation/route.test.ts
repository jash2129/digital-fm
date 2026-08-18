import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "./route";

// Integration-level regression test for the concurrency fix: drives real concurrent HTTP
// requests through the actual route handler (not just the underlying tracking module in
// isolation) with a mocked Tavus API, so it doesn't depend on live Tavus credits. This is
// what a "load test" against the real API would be checking — visitor isolation under
// genuine concurrent load — without the cost or the current credits blocker.

type MockCall = { url: string; method: string };

function buildMockFetch() {
  const calls: MockCall[] = [];
  let nextConversationSeq = 0;

  const impl: typeof fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input.toString();
    const method = init?.method ?? "GET";
    calls.push({ url, method });

    if (url.endsWith("/conversations") && method === "POST") {
      nextConversationSeq += 1;
      const conversationId = `conv-${nextConversationSeq}`;
      return new Response(
        JSON.stringify({
          conversation_id: conversationId,
          conversation_url: `https://tavus.daily.co/${conversationId}`,
        }),
        { status: 200 },
      );
    }

    if (url.includes("/conversations/") && url.endsWith("/end") && method === "POST") {
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }

    throw new Error(`Unexpected fetch in test: ${method} ${url}`);
  };

  return { impl, calls };
}

function requestFrom(visitorCookie?: string) {
  const headers = new Headers();
  if (visitorCookie) headers.set("cookie", `visitor-id=${visitorCookie}`);
  return new Request("http://localhost/api/conversation", { method: "POST", headers });
}

async function conversationIdOf(response: Response): Promise<string> {
  const body = await response.json();
  return body.conversation_id;
}

describe("POST /api/conversation — concurrency", () => {
  let mockFetch: ReturnType<typeof buildMockFetch>;

  beforeEach(() => {
    globalThis.__activeConversationsByVisitor__?.clear();
    globalThis.__conversationRateLimitByVisitor__?.clear();
    globalThis.__conversationStartedAt__?.clear();

    vi.stubEnv("TAVUS_API_KEY", "test-key");
    vi.stubEnv("TAVUS_PERSONA_ID", "persona-default");
    vi.stubEnv("DEMO_API_TOKEN", ""); // rate limiting off — this test is about isolation, not limits

    mockFetch = buildMockFetch();
    vi.stubGlobal("fetch", mockFetch.impl);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("gives two simultaneous different visitors independent conversations", async () => {
    const [responseA, responseB] = await Promise.all([
      POST(requestFrom("visitor-a")),
      POST(requestFrom("visitor-b")),
    ]);

    const conversationIdA = await conversationIdOf(responseA);
    const conversationIdB = await conversationIdOf(responseB);

    expect(conversationIdA).not.toBe(conversationIdB);

    // The regression this guards against: visitor B's request should never have called
    // .../end on visitor A's conversation (or vice versa) — no /end calls at all here,
    // since neither visitor had a prior conversation to clean up.
    const endCalls = mockFetch.calls.filter((call) => call.url.endsWith("/end"));
    expect(endCalls).toHaveLength(0);
  });

  it("still ends the SAME visitor's previous conversation when they start a new one", async () => {
    const first = await POST(requestFrom("visitor-a"));
    const firstConversationId = await conversationIdOf(first);

    const second = await POST(requestFrom("visitor-a"));
    const secondConversationId = await conversationIdOf(second);

    expect(secondConversationId).not.toBe(firstConversationId);

    const endCalls = mockFetch.calls.filter((call) => call.url.endsWith("/end"));
    expect(endCalls).toHaveLength(1);
    expect(endCalls[0].url).toContain(firstConversationId);
  });

  it("holds visitor isolation across many simultaneous distinct visitors", async () => {
    const visitorIds = Array.from({ length: 10 }, (_, i) => `visitor-${i}`);

    const responses = await Promise.all(
      visitorIds.map((visitorId) => POST(requestFrom(visitorId))),
    );

    const conversationIds = await Promise.all(responses.map(conversationIdOf));
    const uniqueConversationIds = new Set(conversationIds);

    expect(uniqueConversationIds.size).toBe(visitorIds.length);

    const endCalls = mockFetch.calls.filter((call) => call.url.endsWith("/end"));
    expect(endCalls).toHaveLength(0);
  });

  it("issues a new visitor-id cookie for a request with none", async () => {
    const response = await POST(requestFrom());
    const setCookie = response.headers.get("set-cookie");
    expect(setCookie).toContain("visitor-id=");
  });

  it("does not re-issue a visitor-id cookie when one was already present", async () => {
    const response = await POST(requestFrom("visitor-a"));
    expect(response.headers.get("set-cookie")).toBeNull();
  });
});
