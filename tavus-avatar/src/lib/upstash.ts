import "server-only";

// The shared store for call state and call logs on serverless hosts (Vercel). Two ways in:
//  - Upstash's REST API: UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN, KV_REST_API_URL /
//    KV_REST_API_TOKEN, or any <prefix>_REST_API_URL / <prefix>_REST_API_TOKEN pair
//  - a standard Redis connection URL (redis:// or rediss://): REDIS_URL, KV_REDIS_URL, KV_URL, or any
//    other variable holding one. Vercel's storage integrations may create only this (e.g. KV_REDIS_URL).
// With neither set, nothing uses it: one long-running server keeps everything in memory.

const TIMEOUT_MS = 3000;

function restConfig(): { url: string; token: string } | null {
  let url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || "";
  let token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || "";
  if (!url || !token) {
    // Vercel's integration lets you pick a custom prefix (STORAGE_REST_API_URL, ...): accept any
    const prefixed = Object.keys(process.env).find((k) => k.endsWith("_REST_API_URL") && process.env[k.replace(/_URL$/, "_TOKEN")]);
    if (prefixed) {
      url = process.env[prefixed] ?? "";
      token = process.env[prefixed.replace(/_URL$/, "_TOKEN")] ?? "";
    }
  }
  url = url.trim().replace(/\/$/, "");
  token = token.trim();
  return url && token ? { url, token } : null;
}

const isRedisUrl = (v: string | undefined) => /^rediss?:\/\//.test(v?.trim() ?? "");

/** A standard Redis connection URL, used when there is no REST pair */
export function redisUrl(): string | null {
  for (const name of ["REDIS_URL", "KV_REDIS_URL", "KV_URL"]) {
    if (isRedisUrl(process.env[name])) return process.env[name]!.trim();
  }
  const other = Object.keys(process.env).find((k) => k.endsWith("_URL") && isRedisUrl(process.env[k]));
  return other ? process.env[other]!.trim() : null;
}

export function upstashEnabled(): boolean {
  return restConfig() !== null || redisUrl() !== null;
}

/** For /api/health: which way in, and the provider's domain (no credentials, no database id) */
export function storeBackend(): { kind: "rest" | "redis" | null; provider: string | null } {
  const rest = restConfig();
  const url = rest?.url ?? redisUrl();
  if (!url) return { kind: null, provider: null };
  let provider: string | null = null;
  try {
    provider = new URL(url).hostname.split(".").slice(-2).join(".");
  } catch {}
  return { kind: rest ? "rest" : "redis", provider };
}

/** Names (never values) of the environment variables that look like store settings, for /api/health */
export function upstashEnvNames(): string[] {
  return Object.keys(process.env)
    .filter((k) => /(UPSTASH|REDIS|STORAGE|_REST_API_|^KV_)/.test(k))
    .sort();
}

function withTimeout<T>(p: Promise<T>, what: string): Promise<T> {
  return Promise.race([p, new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`${what} timed out`)), TIMEOUT_MS))]);
}

// One Redis connection per server instance, reused across requests (Vercel keeps warm instances)
type RedisClient = { sendCommand: (args: string[]) => Promise<unknown> };
const globalForRedis = globalThis as unknown as { maxRedisClient?: Promise<RedisClient> | null };

async function redisClient(url: string): Promise<RedisClient> {
  if (!globalForRedis.maxRedisClient) {
    globalForRedis.maxRedisClient = (async () => {
      const { createClient } = await import("redis");
      const client = createClient({
        url,
        socket: { connectTimeout: TIMEOUT_MS, reconnectStrategy: (retries: number) => (retries > 3 ? false : 200) },
      });
      client.on("error", (err: unknown) => console.error("[store] Redis connection error:", err));
      await client.connect();
      return client as unknown as RedisClient;
    })().catch((err) => {
      globalForRedis.maxRedisClient = null; // try a fresh connection next time
      throw err;
    });
  }
  return globalForRedis.maxRedisClient;
}

/** Runs several Redis commands in one round trip; returns each command's result. Throws on failure. */
export async function upstashPipeline(commands: Array<Array<string | number>>): Promise<unknown[]> {
  if (commands.length === 0) return [];
  const rest = restConfig();
  if (rest) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(`${rest.url}/pipeline`, {
        method: "POST",
        headers: { Authorization: `Bearer ${rest.token}`, "Content-Type": "application/json" },
        body: JSON.stringify(commands),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`Upstash answered ${res.status}`);
      const out = (await res.json()) as Array<{ result?: unknown; error?: string }>;
      return out.map((r) => {
        if (r.error) throw new Error(`Upstash: ${r.error}`);
        return r.result;
      });
    } finally {
      clearTimeout(timer);
    }
  }

  const url = redisUrl();
  if (!url) return [];
  const client = await withTimeout(redisClient(url), "Redis connection");
  // Commands sent in the same tick go out as one pipeline
  return withTimeout(Promise.all(commands.map((c) => client.sendCommand(c.map(String)))), "Redis commands");
}
