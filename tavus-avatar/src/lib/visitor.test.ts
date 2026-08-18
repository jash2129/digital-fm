import { describe, expect, it } from "vitest";

import { getOrCreateVisitorId, getVisitorId } from "./visitor";

function requestWithCookie(cookie: string | null) {
  const headers = new Headers();
  if (cookie) headers.set("cookie", cookie);
  return new Request("http://localhost/api/conversation", { headers });
}

describe("getVisitorId", () => {
  it("returns null when there is no cookie header at all", () => {
    expect(getVisitorId(requestWithCookie(null))).toBeNull();
  });

  it("returns null when the visitor-id cookie is missing", () => {
    expect(getVisitorId(requestWithCookie("demo-session=abc123"))).toBeNull();
  });

  it("reads the visitor-id cookie out of a single-cookie header", () => {
    expect(getVisitorId(requestWithCookie("visitor-id=v-123"))).toBe("v-123");
  });

  it("reads the visitor-id cookie out of a multi-cookie header", () => {
    expect(getVisitorId(requestWithCookie("demo-session=abc123; visitor-id=v-123"))).toBe(
      "v-123",
    );
  });
});

describe("getOrCreateVisitorId", () => {
  it("reuses an existing visitor-id cookie instead of generating a new one", () => {
    const result = getOrCreateVisitorId(requestWithCookie("visitor-id=v-123"));
    expect(result).toEqual({ visitorId: "v-123", isNew: false });
  });

  it("generates a new visitor id when there is no cookie yet", () => {
    const result = getOrCreateVisitorId(requestWithCookie(null));
    expect(result.isNew).toBe(true);
    expect(result.visitorId).toBeTruthy();
  });

  it("generates a different id on each call when no cookie is present (never reuses across visitors)", () => {
    const a = getOrCreateVisitorId(requestWithCookie(null));
    const b = getOrCreateVisitorId(requestWithCookie(null));
    expect(a.visitorId).not.toBe(b.visitorId);
  });
});
