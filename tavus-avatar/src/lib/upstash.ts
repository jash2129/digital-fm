import "server-only";

// Upstash Redis over its REST API (no extra dependency), shared by the call-state store and the
// call-log store. Reads UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN, or the KV_REST_API_URL /
// KV_REST_API_TOKEN names Vercel's Upstash integration creates. With neither set, nothing uses it.

const TIMEOUT_MS = 3000;

function redisConfig(): { url: string; token: string } | null {
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

export function upstashEnabled(): boolean {
  return redisConfig() !== null;
}

/** Names (never values) of the environment variables that look like Upstash settings, for /api/health */
export function upstashEnvNames(): string[] {
  return Object.keys(process.env)
    .filter((k) => /(UPSTASH|REDIS|STORAGE|_REST_API_|^KV_)/.test(k))
    .sort();
}

/** Runs several Redis commands in one round trip; returns each command's result. Throws on failure. */
export async function upstashPipeline(commands: Array<Array<string | number>>): Promise<unknown[]> {
  const cfg = redisConfig();
  if (!cfg || commands.length === 0) return [];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${cfg.url}/pipeline`, {
      method: "POST",
      headers: { Authorization: `Bearer ${cfg.token}`, "Content-Type": "application/json" },
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
