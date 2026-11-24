import "server-only";

import { upstashEnabled, upstashPipeline } from "./upstash";

// -----------------------------------------------------------------------------
// LEARNED SETTINGS (Phase 6, 2026-11-24). The timing knobs Max tunes from TXM's coaching ("don't cut
// me off", "don't snooze") and from what the nightly report sees in all calls (customers cut off
// mid-sentence). Used at once, no approval (client request). Each knob has hard bounds, and every
// change is kept in `history` (shown on /learning) so a bad one can be seen and reset.
// Saved in Upstash (`max:settings`) when connected, otherwise in this server's memory.
// -----------------------------------------------------------------------------

export interface LearnedSettings {
  /** added to every end-of-turn wait on the call screen (turn-taking.ts endOfTurnWaitMs) */
  endOfTurnExtraMs: number;
  /** the pause after a part of the explanation before Max carries on (was CONTINUE_PAUSE_MS) */
  continuePauseMs: number;
  history: SettingChange[];
}

export interface SettingChange {
  at: number;
  key: "endOfTurnExtraMs" | "continuePauseMs";
  from: number;
  to: number;
  source: "coaching" | "signals" | "reset";
  reason: string;
  sessionId?: string;
}

export const SETTING_BOUNDS = {
  endOfTurnExtraMs: { min: 0, max: 1000, default: 0 },
  continuePauseMs: { min: 800, max: 3500, default: 1500 },
} as const;

const KEY = "max:settings";
const CACHE_MS = 30_000;
const fresh = (): LearnedSettings => ({
  endOfTurnExtraMs: SETTING_BOUNDS.endOfTurnExtraMs.default,
  continuePauseMs: SETTING_BOUNDS.continuePauseMs.default,
  history: [],
});
let settings: LearnedSettings = fresh();
let loadedAt = 0;

export function currentSettings(): LearnedSettings {
  return settings;
}

/** What the call screen needs (no history) */
export function settingsForClient(): { endOfTurnExtraMs: number; continuePauseMs: number } {
  return { endOfTurnExtraMs: settings.endOfTurnExtraMs, continuePauseMs: settings.continuePauseMs };
}

export async function loadSettings(force = false): Promise<LearnedSettings> {
  if (!upstashEnabled() || (!force && Date.now() - loadedAt < CACHE_MS)) return settings;
  try {
    const [raw] = await upstashPipeline([["GET", KEY]]);
    settings = typeof raw === "string" ? { ...fresh(), ...(JSON.parse(raw) as LearnedSettings) } : fresh();
    loadedAt = Date.now();
  } catch (err) {
    console.error("[learned-settings] load failed, using this server's copy:", err);
  }
  return settings;
}

async function persist(): Promise<void> {
  if (!upstashEnabled()) return;
  try {
    await upstashPipeline([["SET", KEY, JSON.stringify(settings)]]);
    loadedAt = Date.now();
  } catch (err) {
    console.error("[learned-settings] save failed:", err);
  }
}

/** Moves one knob by `delta` within its bounds; returns the change, or null when it was already at the bound */
export async function adjustSetting(
  key: SettingChange["key"],
  delta: number,
  source: SettingChange["source"],
  reason: string,
  sessionId?: string
): Promise<SettingChange | null> {
  await loadSettings(true);
  const b = SETTING_BOUNDS[key];
  const from = settings[key];
  const to = Math.max(b.min, Math.min(b.max, from + delta));
  if (to === from) return null;
  const change: SettingChange = { at: Date.now(), key, from, to, source, reason, sessionId };
  settings = { ...settings, [key]: to, history: [...settings.history, change].slice(-100) };
  await persist();
  console.log(JSON.stringify({ event: "setting_learned", ...change }));
  return change;
}

/** Back to the defaults (kept in the history) */
export async function resetSettings(): Promise<void> {
  await loadSettings(true);
  const history = [...settings.history];
  for (const key of ["endOfTurnExtraMs", "continuePauseMs"] as const) {
    const d = SETTING_BOUNDS[key].default;
    if (settings[key] !== d) history.push({ at: Date.now(), key, from: settings[key], to: d, source: "reset", reason: "reset on /learning" });
  }
  settings = { ...fresh(), history: history.slice(-100) };
  await persist();
}

/** Tests only */
export function resetSettingsForTest(): void {
  settings = fresh();
  loadedAt = 0;
}

const n = (t: string) => t.toLowerCase().replace(/['’]/g, "").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

/** The timing changes a coaching note asks for (TXM's own words from the test calls) */
export function settingsFromNote(note: string): Array<{ key: SettingChange["key"]; delta: number; reason: string }> {
  const t = n(note);
  const out: Array<{ key: SettingChange["key"]; delta: number; reason: string }> = [];
  if (/\b(cut(ting|s)? (me|them|him|her|the customer|people) off|let (me|them|him|her|the customer) finish|wait (for me|for them|until (i|they|he|she) finish(es)?|longer)|(dont|do not|stop) interrupt(ing)?|interrupting (me|them)|jump(ing|s)? in too (fast|quick|soon)|too quick to (reply|answer|respond)|answers? too fast)\b/.test(t)) {
    out.push({ key: "endOfTurnExtraMs", delta: 300, reason: "coaching: let the customer finish" });
  }
  if (/\b(dont|do not|stop) snooze|snoozing|pauses? (is |are )?too long|too long (a )?pause|(dont|do not) pause( so long)?|keep (it )?moving|less (of a )?pause|freez(e|ing)\b/.test(t)) {
    out.push({ key: "continuePauseMs", delta: -300, reason: "coaching: shorter pause between parts" });
  } else if (/\b(pause (more|longer)|give (me|them|the customer) (a )?(second|moment|time|chance)|too fast between|rushing|you are rushing|youre rushing)\b/.test(t)) {
    out.push({ key: "continuePauseMs", delta: 500, reason: "coaching: longer pause between parts" });
  }
  return out;
}
