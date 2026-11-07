import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { loadSession, saveSession, sharedStoreEnabled, SESSION_TTL_SECONDS } from "./session-store";
import { activeStates, pendingCommits, processClientTurn, commitTurn, resetCallState, getOrCreateCallState, BEATS } from "./beat-controller";

// A fake Upstash REST pipeline backed by a Map
function fakeUpstash() {
  const db = new Map<string, string>();
  const calls: unknown[][][] = [];
  const fetchMock = vi.fn(async (_url: string, init: { body: string }) => {
    const commands = JSON.parse(init.body) as unknown[][];
    calls.push(commands);
    const result = commands.map(([op, key, value]) => {
      if (op === "GET") return { result: db.get(String(key)) ?? null };
      if (op === "SET") return db.set(String(key), String(value)), { result: "OK" };
      if (op === "DEL") return { result: db.delete(String(key)) ? 1 : 0 };
      return { error: `unsupported ${op}` };
    });
    return { ok: true, json: async () => result };
  });
  return { db, calls, fetchMock };
}

// A different serverless instance: nothing from earlier requests in memory
function newInstance(sid: string) {
  activeStates.delete(sid);
  pendingCommits.delete(sid);
}

describe("shared call state (serverless hosts)", () => {
  let upstash: ReturnType<typeof fakeUpstash>;

  beforeEach(() => {
    upstash = fakeUpstash();
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://fake.upstash.io");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "t");
    vi.stubGlobal("fetch", upstash.fetchMock);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("a call continues when every turn lands on a different instance", async () => {
    const sid = `store_${Math.random()}`;
    resetCallState(sid);
    const st = getOrCreateCallState(sid);
    st.step0_completed = true;
    st.current_beat = 2;
    st.delivered_beats = [1, 2];
    st.last_spoken_text = BEATS.find((b) => b.id === 2)!.text;
    await saveSession(sid);

    // Request 1 (instance A): the customer answers Beat 2
    newInstance(sid);
    await loadSession(sid);
    const turn = await processClientTurn(sid, "yes I drove it", 1);
    expect(turn.beatId).toBe(3);
    await saveSession(sid);

    // Request 2 (instance B): the client confirms Max's reply was heard
    newInstance(sid);
    await loadSession(sid);
    expect(commitTurn(sid, 1, true, 1)).toEqual({ rolledBack: false });
    await saveSession(sid);

    // Request 3 (instance C): the next answer continues from Beat 3, not from scratch
    newInstance(sid);
    await loadSession(sid);
    expect(activeStates.get(sid)?.current_beat).toBe(3);
    const next = await processClientTurn(sid, "yes he did", 2);
    expect(next.beatId).toBe(4);
  });

  it("an undelivered reply can still be rolled back from another instance", async () => {
    const sid = `store_rb_${Math.random()}`;
    resetCallState(sid);
    const st = getOrCreateCallState(sid);
    st.step0_completed = true;
    st.current_beat = 2;
    st.delivered_beats = [1, 2];
    await saveSession(sid);

    newInstance(sid);
    await loadSession(sid);
    await processClientTurn(sid, "yes I drove it", 1);
    await saveSession(sid);
    expect(upstash.db.has(`max:commit:${sid}`)).toBe(true);

    newInstance(sid);
    await loadSession(sid);
    expect(commitTurn(sid, 1, false, 0)).toEqual({ rolledBack: true });
    await saveSession(sid);
    expect(upstash.db.has(`max:commit:${sid}`)).toBe(false);
    expect(JSON.parse(upstash.db.get(`max:state:${sid}`)!).current_beat).toBe(2);
  });

  it("saves with a 2 hour expiry, in one round trip", async () => {
    const sid = `store_ttl_${Math.random()}`;
    resetCallState(sid);
    getOrCreateCallState(sid);
    await saveSession(sid);
    const last = upstash.calls.at(-1)!;
    expect(last[0]).toEqual(["SET", `max:state:${sid}`, expect.any(String), "EX", SESSION_TTL_SECONDS]);
    expect(SESSION_TTL_SECONDS).toBe(7200);
  });

  it("drops a stale copy left in this instance's memory when the store has none", async () => {
    const sid = `store_stale_${Math.random()}`;
    getOrCreateCallState(sid).current_beat = 9;
    await loadSession(sid);
    expect(activeStates.has(sid)).toBe(false);
  });

  it("if the store is down, the turn still runs on local memory", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    const sid = `store_down_${Math.random()}`;
    getOrCreateCallState(sid).current_beat = 5;
    await expect(loadSession(sid)).resolves.toBeUndefined();
    expect(activeStates.get(sid)?.current_beat).toBe(5);
    await expect(saveSession(sid)).resolves.toBeUndefined();
  });
});

describe("one long-running server (your PC, Render)", () => {
  it("with no Upstash settings nothing is called and memory is untouched", async () => {
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
    vi.stubEnv("KV_REST_API_URL", "");
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const sid = `store_local_${Math.random()}`;
    getOrCreateCallState(sid).current_beat = 7;
    expect(sharedStoreEnabled()).toBe(false);
    await loadSession(sid);
    await saveSession(sid);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(activeStates.get(sid)?.current_beat).toBe(7);
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });
});
