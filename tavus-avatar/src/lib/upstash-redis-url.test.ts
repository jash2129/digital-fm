import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// A fake Redis server behind the official client's sendCommand(), so the redis:// path runs end to end
const db = new Map<string, string>();
const zset = new Map<string, number>();
const sent: string[][] = [];
vi.mock("redis", () => ({
  createClient: () => ({
    on: () => {},
    connect: async () => {},
    sendCommand: async (args: string[]) => {
      sent.push(args);
      const [op, ...a] = args;
      if (op === "PING") return "PONG";
      if (op === "GET") return db.get(a[0]) ?? null;
      if (op === "SET") return db.set(a[0], a[1]), "OK";
      if (op === "DEL") return db.delete(a[0]) ? 1 : 0;
      if (op === "EXISTS") return db.has(a[0]) ? 1 : 0;
      if (op === "MGET") return a.map((k) => db.get(k) ?? null);
      if (op === "ZADD") return zset.set(a[2], Number(a[1])), 1;
      if (op === "ZCARD") return zset.size;
      if (op === "ZREVRANGE") return [...zset.entries()].sort((x, y) => y[1] - x[1]).map(([id]) => id);
      if (op === "ZREMRANGEBYSCORE") return 0;
      throw new Error(`unsupported ${op}`);
    },
  }),
}));

// Log files in memory: a test must never write into the real logs-heygen folder
const files = new Map<string, unknown>();
vi.mock("./heygen-logger", () => ({
  getHeygenLogsDir: () => "/nonexistent-logs-dir",
  getHeygenTranscript: (id: string) => files.get(id) ?? null,
  saveHeygenTranscript: (log: { sessionId: string }) => void files.set(log.sessionId, log),
  getHeygenAudio: () => null,
}));

import { upstashEnabled, storeBackend, redisUrl } from "./upstash";
import { loadSession, saveSession } from "./session-store";
import { saveCallLog, loadCallLog, storeStatus } from "./call-log-store";
import { activeStates, pendingCommits, processClientTurn, commitTurn, resetCallState, getOrCreateCallState, BEATS } from "./beat-controller";
import type { HeygenCallLog } from "./heygen-logger";

describe("shared store over a standard Redis URL (Vercel's KV_REDIS_URL)", () => {
  beforeEach(() => {
    db.clear();
    zset.clear();
    sent.length = 0;
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
    vi.stubEnv("KV_REST_API_URL", "");
    vi.stubEnv("KV_REDIS_URL", "rediss://default:secret@clever-db-1234.upstash.io:6379");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("is picked up from KV_REDIS_URL alone, and reports the provider without credentials", () => {
    expect(upstashEnabled()).toBe(true);
    expect(redisUrl()).toContain("rediss://");
    expect(storeBackend()).toEqual({ kind: "redis", provider: "upstash.io" });
  });

  it("a call continues when its turns land on different instances", async () => {
    const sid = `redisurl_${Math.random()}`;
    resetCallState(sid);
    const st = getOrCreateCallState(sid);
    st.step0_completed = true;
    st.current_beat = 2;
    st.delivered_beats = [1, 2];
    st.last_spoken_text = BEATS.find((b) => b.id === 2)!.text;
    await saveSession(sid);

    activeStates.delete(sid);
    pendingCommits.delete(sid);
    await loadSession(sid);
    expect((await processClientTurn(sid, "yes I drove it", 1)).beatId).toBe(3);
    await saveSession(sid);

    activeStates.delete(sid);
    pendingCommits.delete(sid);
    await loadSession(sid);
    expect(commitTurn(sid, 1, true, 1)).toEqual({ rolledBack: false });
    await saveSession(sid);

    activeStates.delete(sid);
    await loadSession(sid);
    expect(activeStates.get(sid)?.current_beat).toBe(3);
    expect(sent.some(([op, key, , ex]) => op === "SET" && key === `max:state:${sid}` && ex === "EX")).toBe(true);
  });

  it("call logs are saved and read back (the Inspector), and /api/health sees them", async () => {
    const id = `log_${Math.random()}`;
    await saveCallLog({
      sessionId: id,
      engine: "heygen-grok",
      avatarId: "a",
      avatarName: "Max",
      startTime: "2026-11-08T10:00:00.000Z",
      endTime: null,
      durationSeconds: 60,
      status: "completed",
      transcript: [{ role: "assistant", text: "hi", timestamp: "" }],
    } as HeygenCallLog);
    files.clear(); // another Vercel instance: no log file, only the shared store
    expect((await loadCallLog(id))?.transcript[0].text).toBe("hi");
    expect(await storeStatus(id)).toEqual({ reachable: true, logs: 1, thisCall: true });
  });
});
