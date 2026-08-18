import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { middleware } from "./middleware";

function requestFor(path: string, cookie?: string) {
  const headers = new Headers();
  if (cookie) headers.set("cookie", cookie);
  return new NextRequest(new URL(path, "http://localhost"), { headers });
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("middleware auth gate", () => {
  it("always lets /api/auth through, even with no token configured", () => {
    vi.stubEnv("DEMO_API_TOKEN", "");
    const response = middleware(requestFor("/api/auth"));
    expect(response.status).toBe(200);
  });

  it("always lets /api/auth through, even with a token configured and no cookie", () => {
    vi.stubEnv("DEMO_API_TOKEN", "secret");
    const response = middleware(requestFor("/api/auth"));
    expect(response.status).toBe(200);
  });

  it("fails closed with 503 in production when DEMO_API_TOKEN is not set", () => {
    vi.stubEnv("DEMO_API_TOKEN", "");
    vi.stubEnv("NODE_ENV", "production");
    const response = middleware(requestFor("/api/conversation"));
    expect(response.status).toBe(503);
  });

  it("skips auth in non-production when DEMO_API_TOKEN is not set (local dev convenience)", () => {
    vi.stubEnv("DEMO_API_TOKEN", "");
    vi.stubEnv("NODE_ENV", "development");
    const response = middleware(requestFor("/api/conversation"));
    expect(response.status).toBe(200);
  });

  it("rejects requests with no session cookie when a token is configured", () => {
    vi.stubEnv("DEMO_API_TOKEN", "secret");
    const response = middleware(requestFor("/api/conversation"));
    expect(response.status).toBe(401);
  });

  it("rejects requests whose session cookie does not match the token", () => {
    vi.stubEnv("DEMO_API_TOKEN", "secret");
    const response = middleware(requestFor("/api/conversation", "demo-session=wrong-value"));
    expect(response.status).toBe(401);
  });

  it("allows requests whose session cookie matches the token", () => {
    vi.stubEnv("DEMO_API_TOKEN", "secret");
    const response = middleware(requestFor("/api/conversation", "demo-session=secret"));
    expect(response.status).toBe(200);
  });
});
