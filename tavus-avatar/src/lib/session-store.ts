import "server-only";

import { activeStates, pendingCommits, type CallState, type PendingCommit } from "./beat-controller";
import { upstashEnabled, upstashPipeline } from "./upstash";

// Shared storage for a live call's state on serverless hosts (Vercel), where each request can land
// on a different instance with empty memory. Each API request loads the call's state into the
// in-memory maps the beat controller already uses, runs unchanged, then saves it back.
//
// Uses Upstash Redis (src/lib/upstash.ts). With no Upstash settings it does nothing: one long-running
// server (your PC, Render) keeps everything in memory exactly as before.

/** A call's state is kept this long after its last turn */
export const SESSION_TTL_SECONDS = 2 * 60 * 60;

const stateKey = (id: string) => `max:state:${id}`;
const commitKey = (id: string) => `max:commit:${id}`;

export const sharedStoreEnabled = upstashEnabled;
const pipeline = upstashPipeline;

let warnedNoStore = false;

/** Before a request: puts the call's saved state and pending commit into the controller's maps. */
export async function loadSession(sessionId: string): Promise<void> {
  if (!sessionId) return;
  if (!sharedStoreEnabled()) {
    if (process.env.VERCEL && !warnedNoStore) {
      warnedNoStore = true;
      console.error("[session-store] Running on Vercel without Upstash: calls will lose their place. Connect Upstash (docs/DEPLOY-VERCEL.md).");
    }
    return;
  }
  try {
    const [state, commit] = await pipeline([
      ["GET", stateKey(sessionId)],
      ["GET", commitKey(sessionId)],
    ]);
    if (typeof state === "string") activeStates.set(sessionId, JSON.parse(state) as CallState);
    else activeStates.delete(sessionId); // never reuse a stale copy left on this instance
    if (typeof commit === "string") pendingCommits.set(sessionId, JSON.parse(commit) as PendingCommit);
    else pendingCommits.delete(sessionId);
  } catch (err) {
    // Keep going on this instance's memory rather than fail the turn
    console.error("[session-store] load failed, using local memory:", err);
  }
}

/** After a request: saves the call's state and pending commit (or clears a commit that is done). */
export async function saveSession(sessionId: string): Promise<void> {
  if (!sessionId || !sharedStoreEnabled()) return;
  const state = activeStates.get(sessionId);
  const commit = pendingCommits.get(sessionId);
  const commands: Array<Array<string | number>> = [];
  if (state) commands.push(["SET", stateKey(sessionId), JSON.stringify(state), "EX", SESSION_TTL_SECONDS]);
  commands.push(commit ? ["SET", commitKey(sessionId), JSON.stringify(commit), "EX", SESSION_TTL_SECONDS] : ["DEL", commitKey(sessionId)]);
  try {
    await pipeline(commands);
  } catch (err) {
    console.error("[session-store] save failed; the next turn may not see this one:", err);
  }
}
