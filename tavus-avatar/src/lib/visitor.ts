import "server-only";

import { randomUUID } from "crypto";

import type { NextResponse } from "next/server";

// Identifies a single browser/visitor, independent of the shared demo auth
// token — everyone who logs in with the same DEMO_API_TOKEN gets an
// identical auth cookie, so the auth cookie alone cannot tell two
// simultaneous customers apart. This cookie can.
const VISITOR_COOKIE = "visitor-id";
const VISITOR_COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

export function getVisitorId(request: Request): string | null {
  return (
    request.headers
      .get("cookie")
      ?.split(";")
      .find((cookie) => cookie.trim().startsWith(`${VISITOR_COOKIE}=`))
      ?.split("=")[1]
      ?.trim() || null
  );
}

export function getOrCreateVisitorId(request: Request): { visitorId: string; isNew: boolean } {
  const existing = getVisitorId(request);

  if (existing) {
    return { visitorId: existing, isNew: false };
  }

  return { visitorId: randomUUID(), isNew: true };
}

export function attachVisitorCookie(
  response: NextResponse,
  visitorId: string,
  isSecure = process.env.NODE_ENV === "production",
) {
  response.cookies.set(VISITOR_COOKIE, visitorId, {
    httpOnly: true,
    maxAge: VISITOR_COOKIE_MAX_AGE,
    path: "/",
    sameSite: "lax",
    secure: isSecure,
  });
}

