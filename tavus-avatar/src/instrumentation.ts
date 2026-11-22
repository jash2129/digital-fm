// Next.js calls onRequestError for every uncaught error in a route, server component or proxy.
// Each goes to the one error reporter (a JSON log line; Sentry too once SENTRY_DSN is set).
export async function onRequestError(
  err: unknown,
  request: { path: string; method: string },
  context: { routerKind: string; routePath: string; routeType: string }
): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { reportError } = await import("./lib/error-report");
  await reportError(err, {
    source: "request",
    where: context.routePath || request.path,
    extra: { method: request.method, routeType: context.routeType, routerKind: context.routerKind },
  });
}
