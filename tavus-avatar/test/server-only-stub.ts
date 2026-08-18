// Stub for the "server-only" package in tests. Next.js's bundler normally
// swaps that package for a no-op when compiling real server code; Vitest
// runs our lib code directly (never through a client bundle), so the
// import-time guard it provides isn't relevant here. See vitest.config.ts.
export {};
