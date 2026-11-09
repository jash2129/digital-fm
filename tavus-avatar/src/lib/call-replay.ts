/**
 * Replays a call's customer lines, in order, against today's Max and scores the result. A real call
 * from the call log sheet becomes a repeatable test: did yesterday's failure come back?
 */
import { processControllerTurn, resetCallState, getOrCreateCallState } from "./beat-controller";
import { DEFAULT_DEAL_CONFIG } from "./deal-config";
import { STEP_0_GREETING } from "./max-lines";
import { scoreCall, type ScoredTurn, type Scorecard } from "./call-scorecard";

export interface RecordedCall {
  id: string;
  /** What the customer said, in order (recognition errors and echoes included, as they happened) */
  customerLines: string[];
}

export interface ReplayResult {
  id: string;
  opening: string;
  turns: ScoredTurn[];
  scorecard: Scorecard;
}

/** Customer lines from a "Max: …\nCustomer: …" transcript (the call log sheet's Transcript column) */
export function customerLinesFromTranscript(transcript: string): string[] {
  return transcript
    .split(/\r?\n/)
    .map((l) => l.match(/^Customer:\s*(.*)$/)?.[1]?.trim() ?? null)
    .filter((l): l is string => l !== null && l.length > 0);
}

export async function replayCall(call: RecordedCall): Promise<ReplayResult> {
  const sid = `replay_${call.id}_${Math.random().toString(36).slice(2, 8)}`;
  resetCallState(sid);
  getOrCreateCallState(sid);
  const turns: ScoredTurn[] = [];
  for (const line of call.customerLines) {
    const d = await processControllerTurn(sid, line, DEFAULT_DEAL_CONFIG);
    turns.push({ customer: line, max: d.textToSpeak, beat: d.beatId });
    if (d.isScriptComplete) break;
  }
  resetCallState(sid);
  return { id: call.id, opening: STEP_0_GREETING, turns, scorecard: scoreCall(turns) };
}
