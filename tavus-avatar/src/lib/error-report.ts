import "server-only";
import { randomUUID } from "crypto";

/**
 * One place every server and call-screen error goes. Always one JSON log line (`"event":"error"`, in
 * Vercel's logs today); with SENTRY_DSN set, also sent to Sentry, which groups errors and alerts.
 * No Sentry SDK: one HTTP request per error to Sentry's envelope endpoint, never thrown, 3 s timeout.
 */

export type ErrorSource = "server" | "request" | "client";

export interface ErrorContext {
  source: ErrorSource;
  /** route or screen, e.g. "/api/chat/grok" */
  where?: string;
  sessionId?: string;
  /** small extra facts (never customer speech or personal data) */
  extra?: Record<string, string | number | boolean | undefined>;
}

const SENT_TIMEOUT_MS = 3000;

function describe(error: unknown): { type: string; message: string; stack?: string } {
  if (error instanceof Error) return { type: error.name || "Error", message: error.message, stack: error.stack };
  if (typeof error === "string") return { type: "Error", message: error };
  try {
    return { type: "Error", message: JSON.stringify(error) };
  } catch {
    return { type: "Error", message: String(error) };
  }
}

/** Parses a Sentry DSN (https://<key>@<host>/<project id>) into its envelope URL and key, or null. */
export function sentryTarget(dsn: string | undefined): { url: string; key: string } | null {
  if (!dsn?.trim()) return null;
  try {
    const u = new URL(dsn.trim());
    const project = u.pathname.replace(/^\/+|\/+$/g, "");
    if (!u.username || !project) return null;
    return { url: `${u.protocol}//${u.host}/api/${project}/envelope/`, key: u.username };
  } catch {
    return null;
  }
}

/** The Sentry envelope for one error event (exported for tests). */
export function sentryEnvelope(error: unknown, ctx: ErrorContext, eventId: string, now = new Date()): string {
  const d = describe(error);
  const event = {
    event_id: eventId,
    timestamp: now.getTime() / 1000,
    platform: "node",
    level: "error",
    environment: process.env.VERCEL_ENV || process.env.NODE_ENV || "development",
    release: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7),
    server_name: "max",
    tags: { source: ctx.source, ...(ctx.where ? { where: ctx.where } : {}) },
    extra: { ...(ctx.sessionId ? { sessionId: ctx.sessionId } : {}), ...(ctx.extra ?? {}), ...(d.stack ? { stack: d.stack.slice(0, 4000) } : {}) },
    exception: { values: [{ type: d.type, value: d.message.slice(0, 1000) }] },
  };
  return [JSON.stringify({ event_id: eventId, sent_at: now.toISOString() }), JSON.stringify({ type: "event" }), JSON.stringify(event)].join("\n");
}

export async function reportError(error: unknown, ctx: ErrorContext, fetchImpl: typeof fetch = fetch): Promise<void> {
  const d = describe(error);
  const eventId = randomUUID().replace(/-/g, "");
  console.error(
    JSON.stringify({ event: "error", id: eventId, source: ctx.source, where: ctx.where, sessionId: ctx.sessionId, type: d.type, message: d.message.slice(0, 500), ...(ctx.extra ?? {}) })
  );
  const target = sentryTarget(process.env.SENTRY_DSN);
  if (!target) return;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SENT_TIMEOUT_MS);
  try {
    await fetchImpl(target.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-sentry-envelope",
        "X-Sentry-Auth": `Sentry sentry_version=7, sentry_key=${target.key}, sentry_client=max-error-report/1.0`,
      },
      body: sentryEnvelope(error, ctx, eventId),
      signal: controller.signal,
    });
  } catch {
    // Error reporting must never cause a second error
  } finally {
    clearTimeout(timer);
  }
}
