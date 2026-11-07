import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Log files in memory: a test must never write into the real logs-heygen folder
const files = new Map<string, unknown>();
vi.mock("./heygen-logger", () => ({
  getHeygenLogsDir: () => "/nonexistent-logs-dir",
  getHeygenTranscript: (id: string) => files.get(id) ?? null,
  saveHeygenTranscript: (log: { sessionId: string }) => void files.set(log.sessionId, log),
  getHeygenAudio: () => null,
}));

import { saveCallLog, loadCallLog, listCallLogs, fitForStore, MAX_STORED_LOG_CHARS, LOG_TTL_SECONDS } from "./call-log-store";
import { sendCallLog } from "./call-log-webhook";
import type { HeygenCallLog } from "./heygen-logger";

function fakeUpstash() {
  const kv = new Map<string, string>();
  const zset = new Map<string, number>();
  const handle = (cmd: unknown[]) => {
    const [op, ...a] = cmd.map(String);
    if (op === "SET") return kv.set(a[0], a[1]), "OK";
    if (op === "GET") return kv.get(a[0]) ?? null;
    if (op === "MGET") return a.map((k) => kv.get(k) ?? null);
    if (op === "ZADD") return zset.set(a[2], Number(a[1])), 1;
    if (op === "ZREVRANGE") return [...zset.entries()].sort((x, y) => y[1] - x[1]).map(([id]) => id);
    if (op === "ZREMRANGEBYSCORE") return 0;
    throw new Error(`unsupported ${op}`);
  };
  return { kv, zset, handle };
}

const log = (id: string, startTime: string, extra: Partial<HeygenCallLog> = {}) =>
  ({
    sessionId: id,
    engine: "heygen-grok",
    avatarId: "a",
    avatarName: "Max",
    startTime,
    endTime: startTime,
    durationSeconds: 60,
    status: "completed",
    transcript: [{ role: "assistant", text: "hi", timestamp: "" }],
    timingLogs: [],
    bargeIns: [],
    turnLogs: [],
    ...extra,
  }) as HeygenCallLog;

describe("call log store", () => {
  let upstash: ReturnType<typeof fakeUpstash>;

  beforeEach(() => {
    files.clear();
    upstash = fakeUpstash();
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://fake.upstash.io");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "t");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: { body: string }) => {
        if (!url.startsWith("https://fake.upstash.io")) throw new Error(`unexpected ${url}`);
        const out = (JSON.parse(init.body) as unknown[][]).map((c) => ({ result: upstash.handle(c) }));
        return { ok: true, json: async () => out };
      })
    );
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("a log saved on one server can be opened on another (no file there)", async () => {
    await saveCallLog(log("call-A", "2026-11-07T10:00:00.000Z"));
    expect(upstash.kv.has("max:log:call-A")).toBe(true);
    files.clear(); // another Vercel server: no log file
    const loaded = await loadCallLog("call-A");
    expect(loaded?.sessionId).toBe("call-A");
    expect(loaded?.transcript[0].text).toBe("hi");
  });

  it("the Inspector's list has calls that exist only in Upstash, newest first", async () => {
    await saveCallLog(log("older", "2026-11-06T10:00:00.000Z"));
    await saveCallLog(log("newer", "2026-11-07T10:00:00.000Z"));
    files.clear();
    const list = await listCallLogs();
    expect(list.map((s) => s.sessionId)).toEqual(["newer", "older"]);
    expect(list[0]).toMatchObject({ durationSeconds: 60, turnsCount: 1, hasAudio: false });
  });

  it("keeps logs for 30 days", async () => {
    expect(LOG_TTL_SECONDS).toBe(30 * 24 * 60 * 60);
  });

  it("a huge log drops its turn and timing tables so it still fits", () => {
    const huge = log("big", "2026-11-07T10:00:00.000Z", {
      turnLogs: Array.from({ length: 20000 }, () => ({ event: "x".repeat(60) })) as unknown as HeygenCallLog["turnLogs"],
    });
    const json = fitForStore(huge);
    expect(json.length).toBeLessThanOrEqual(MAX_STORED_LOG_CHARS);
    expect(JSON.parse(json).transcript).toHaveLength(1);
  });

  it("remembers the Drive recording link the Make scenario sends back", async () => {
    vi.stubEnv("CALL_LOG_WEBHOOK_URL", "https://hook.example/make");
    vi.stubEnv("XAI_API_KEY", "");
    vi.stubEnv("OPENAI_API_KEY", "");
    const upstashFetch = vi.mocked(fetch);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: { body: string }) => {
        if (url === "https://hook.example/make") return { ok: true, status: 200, json: async () => ({ ok: true, recordingUrl: "https://drive.google.com/file/d/abc/view" }) };
        return upstashFetch(url, init);
      })
    );
    await saveCallLog(log("call-R", "2026-11-07T11:00:00.000Z"));
    expect((await sendCallLog("call-R", "https://max.vercel.app")).sent).toBe(true);
    files.clear();
    expect((await loadCallLog("call-R"))?.recordingUrl).toBe("https://drive.google.com/file/d/abc/view");
  });
});
