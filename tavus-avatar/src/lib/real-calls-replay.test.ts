/**
 * Every real call saved from the call log sheet (testing-skill/real-calls/real-calls.json, updated
 * with `scripts/replay-real-calls.ts --save-fixture`) is replayed against today's Max. A hard check
 * failing means a failure from a real call has come back.
 *
 * The file holds what testers and customers said, so it is git-ignored and stays on the machine that
 * saved it: elsewhere these tests are skipped.
 */
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { replayCall, type RecordedCall } from "./call-replay";

const fixture = path.resolve(__dirname, "../../../testing-skill/real-calls/real-calls.json");
const calls: RecordedCall[] = existsSync(fixture) ? JSON.parse(readFileSync(fixture, "utf8")) : [];

describe.skipIf(calls.length === 0)("real calls replayed against today's Max", () => {
  it.each(calls.map((c) => [c.id, c] as const))("%s: every hard check passes", async (_id, call) => {
    const { scorecard, turns } = await replayCall(call);
    const hardFails = scorecard.checks.filter((c) => c.severity === "hard" && !c.pass);
    expect(hardFails.map((c) => `${c.label}: ${c.detail}`), JSON.stringify(turns.slice(-4), null, 1)).toEqual([]);
  });
});
