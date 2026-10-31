/**
 * Turn-by-turn CLI for AI-vs-AI call simulation (used by the /simulate-call Claude Code skill).
 * Drives the real Max controller (processControllerTurn) one customer line at a time, persisting
 * call state to a JSON file between invocations so an AI can play the customer across many
 * separate shell calls.
 *
 *   npx --yes tsx scripts/sim-call.ts start <id> [--persona <name>] [--offline]
 *   npx --yes tsx scripts/sim-call.ts say   <id> "<customer line>"
 *   npx --yes tsx scripts/sim-call.ts show  <id>
 *   npx --yes tsx scripts/sim-call.ts audio <id>   (voices the call for the Inspector)
 *   npx --yes tsx scripts/sim-call.ts replay <new id> --from <old id> [--offline]
 *     (re-runs an old call's customer lines against today's Max, each matched to what Max asked)
 *
 * `say` prints only what a real customer would hear (Max's words, and whether the call ended).
 * Beat, intent and tool calls are recorded in the session file for the judge, not printed, so the
 * customer cannot steer by them.
 *
 * By default .env.local is loaded so classification behaves like production (LLM fallback for
 * turns the rules can't classify). --offline skips it: rule-based only, deterministic, free.
 * Sessions live in ../testing-skill/reports/sim-calls/ (gitignored).
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ControllerDecision } from "../src/lib/beat-controller";

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, "..");
const sessionsDir = path.resolve(appRoot, "../testing-skill/reports/sim-calls");

interface Turn {
  n: number;
  customer: string;
  max: string;
  beat: number;
  intent: string;
  beatType: string;
  toolCalls: Array<{ name: string; args: Record<string, unknown> }>;
  stopped: boolean;
  price: string;
  ms: number;
  /** controller breakdown: classifierMs, controllerMs, usedLLM, classifierTimedOut, intent, beatBefore, beatAfter */
  metrics?: ControllerDecision["metrics"];
}

interface Session {
  id: string;
  persona: string;
  offline: boolean;
  started_at: string;
  opening: string;
  turns: Turn[];
  state: Record<string, unknown> | null;
}

// The controller logs to stdout; keep stdout for the customer-facing output only.
console.log = (...a: unknown[]) => process.stderr.write(a.map(String).join(" ") + "\n");
console.warn = console.log;

function loadEnvLocal() {
  const file = path.join(appRoot, ".env.local");
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const sessionFile = (id: string) => path.join(sessionsDir, `${id}.json`);

function readSession(id: string): Session {
  const file = sessionFile(id);
  if (!existsSync(file)) fail(`No session "${id}". Run: start ${id}`);
  return JSON.parse(readFileSync(file, "utf8"));
}

function writeSession(s: Session) {
  mkdirSync(sessionsDir, { recursive: true });
  writeFileSync(sessionFile(s.id), JSON.stringify(s, null, 2));
}

function fail(msg: string): never {
  process.stderr.write(`sim-call: ${msg}\n`);
  process.exit(1);
}

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

async function main() {
  const [cmd, id, ...rest] = process.argv.slice(2);
  if (!cmd || !id || !/^[\w.-]+$/.test(id)) {
    fail('usage: sim-call.ts start|say|show|audio <id> ["customer line"] [--persona <name>] [--offline] | replay <new id> --from <old id>');
  }

  if (cmd === "start") {
    const { STEP_0_GREETING } = await import("../src/lib/max-lines");
    const session: Session = {
      id,
      persona: flag(rest, "--persona") ?? "unspecified",
      offline: rest.includes("--offline"),
      started_at: new Date().toISOString(),
      // The client speaks the tech-check line on connect, before the customer says anything
      opening: STEP_0_GREETING,
      turns: [],
      state: null,
    };
    writeSession(session);
    process.stdout.write(`MAX: ${STEP_0_GREETING}\n`);
    return;
  }

  if (cmd === "show") {
    process.stdout.write(JSON.stringify(readSession(id), null, 2) + "\n");
    return;
  }

  if (cmd === "say") {
    const line = rest.filter((a) => a !== "--offline").join(" ").trim();
    if (!line) fail("say needs the customer's line");
    const session = readSession(id);
    if (session.turns.at(-1)?.stopped) {
      process.stdout.write("[call already ended]\n");
      return;
    }
    const t = await takeTurn(session, line);
    process.stdout.write(`MAX: ${t.max}\n`);
    if (t.stopped) process.stdout.write("[call ended]\n");
    return;
  }

  if (cmd === "replay") {
    const from = flag(rest, "--from");
    if (!from) fail("replay needs --from <old session id>");
    await replay(id, readSession(from), rest.includes("--offline"));
    return;
  }

  if (cmd === "audio") {
    await renderAudio(readSession(id));
    return;
  }

  fail(`unknown command "${cmd}"`);
}

// Runs one customer line through the real controller and records it in the session file
async function takeTurn(session: Session, line: string): Promise<Turn> {
  if (!session.offline) loadEnvLocal();
  else {
    delete process.env.XAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
  }
  const { processControllerTurn, getOrCreateCallState, resetCallState } = await import("../src/lib/beat-controller");
  resetCallState(session.id);
  const state = getOrCreateCallState(session.id);
  if (session.state) Object.assign(state, session.state);

  const t0 = Date.now();
  const d = await processControllerTurn(session.id, line);
  const turn: Turn = {
    n: session.turns.length + 1,
    customer: line,
    max: d.textToSpeak,
    beat: d.beatId,
    intent: d.intent,
    beatType: d.beatType,
    toolCalls: d.toolCalls,
    stopped: d.state.is_stopped,
    price: d.state.dealConfig.per_day_price,
    ms: Date.now() - t0,
    metrics: d.metrics,
  };
  session.turns.push(turn);
  session.state = JSON.parse(JSON.stringify(d.state));
  writeSession(session);
  return turn;
}

// -----------------------------------------------------------------------------
// replay: re-run an old call's customer lines against today's Max. Each reply is chosen by what
// Max just asked, not by turn number: the old line whose prompting Max line best matches the
// current one (mostly its last question). So when the script changes, a name-and-address request
// still gets the name and address, and replies to questions Max no longer asks are skipped.
// If Max says something the old call never answered, the replay stops and says so.
// -----------------------------------------------------------------------------
const REPLAY_STOP = new Set("a an the and or but so to of in on at for with is are was were be do does did you your i me my it this that we our".split(" "));
const REPLAY_MIN_SCORE = 0.35;

function replayWords(t: string): Set<string> {
  return new Set(t.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w) => w && !REPLAY_STOP.has(w)));
}

// The last question in an utterance, or its last sentence if it asks nothing
function lastAsk(t: string): string {
  const parts = t.match(/[^.!?]+[.!?]*/g) ?? [t];
  return parts.filter((p) => p.includes("?")).at(-1) ?? parts.at(-1) ?? t;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let inter = 0;
  for (const w of a) if (b.has(w)) inter++;
  return inter / (a.size + b.size - inter);
}

async function replay(newId: string, old: Session, offline: boolean) {
  const session: Session = {
    id: newId,
    persona: old.persona,
    offline,
    started_at: new Date().toISOString(),
    opening: old.opening,
    turns: [],
    state: null,
  };
  writeSession(session);

  // What Max said right before each old customer line
  const pairs = old.turns.map((t, k) => ({ k, prompt: k === 0 ? old.opening : old.turns[k - 1].max, reply: t.customer }));
  const used = new Set<number>();
  let maxLine = session.opening;
  let lastUsed = -1;
  let fallbacks = 0;
  process.stdout.write(`MAX: ${maxLine}\n`);

  for (;;) {
    let best: { k: number; score: number } | null = null;
    for (const p of pairs) {
      if (used.has(p.k)) continue;
      const score =
        0.6 * jaccard(replayWords(lastAsk(maxLine)), replayWords(lastAsk(p.prompt))) +
        0.4 * jaccard(replayWords(maxLine), replayWords(p.prompt)) +
        (p.k === lastUsed + 1 ? 0.05 : 0); // tie-break toward the original order
      if (!best || score > best.score) best = { k: p.k, score };
    }
    if (!best) {
      process.stdout.write("[replay finished: every original line was used]\n");
      break;
    }
    // Nothing the old call answered looks like this (Max now says something new, e.g. a re-asked
    // check-in): fall back to the next unused line in the original order, at most 3 times in a row.
    let how = `match ${best.score.toFixed(2)}`;
    if (best.score < REPLAY_MIN_SCORE) {
      const next = pairs.find((p) => !used.has(p.k) && p.k > lastUsed);
      if (!next || fallbacks >= 3) {
        process.stdout.write(`[replay stopped: no line in ${old.id} answers Max's last line. Continue by hand with: say ${newId} "..."]\n`);
        break;
      }
      fallbacks++;
      best = { k: next.k, score: best.score };
      how = "no match, next in order";
    } else {
      fallbacks = 0;
    }
    used.add(best.k);
    lastUsed = best.k;
    const line = pairs[best.k].reply;
    process.stdout.write(`CUSTOMER (orig T${best.k + 1}, ${how}): ${line}\n`);
    const t = await takeTurn(session, line);
    maxLine = t.max;
    process.stdout.write(`MAX: ${t.max}\n`);
    if (t.stopped) {
      process.stdout.write("[call ended]\n");
      break;
    }
  }

  const skipped = pairs.filter((p) => !used.has(p.k));
  if (skipped.length > 0) {
    const list = skipped.map((p) => `T${p.k + 1} "${p.reply}"`).join(", ");
    process.stdout.write(`skipped ${skipped.length} original line(s) Max never prompted: ${list}\n`);
  }
}

// -----------------------------------------------------------------------------
// audio: voice the finished call with OpenAI TTS and write it where the Inspector reads calls
// (logs-heygen/sim-<id>.json + .webm). Simulated voices, not Max's real HeyGen voice.
// -----------------------------------------------------------------------------
const PCM_RATE = 24000; // OpenAI "pcm" format: 24 kHz, 16-bit little-endian, mono
const MAX_VOICE = { voice: "onyx", instructions: "A warm, confident, friendly car-dealership finance manager on a video call." };
const CUSTOMER_VOICE = { voice: "ash", instructions: "An ordinary car buyer talking casually on a video call." };

async function tts(text: string, v: { voice: string; instructions: string }, key: string): Promise<Buffer> {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "gpt-4o-mini-tts", voice: v.voice, instructions: v.instructions, input: text, response_format: "pcm" }),
    });
    if (res.ok) return Buffer.from(await res.arrayBuffer());
    if (attempt >= 3) fail(`TTS failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
    await new Promise((r) => setTimeout(r, 1000 * attempt));
  }
}

const silence = (ms: number) => Buffer.alloc(Math.round((PCM_RATE * ms) / 1000) * 2);

function wav(pcm: Buffer): Buffer {
  const h = Buffer.alloc(44);
  h.write("RIFF", 0); h.writeUInt32LE(36 + pcm.length, 4); h.write("WAVE", 8);
  h.write("fmt ", 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(PCM_RATE, 24); h.writeUInt32LE(PCM_RATE * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write("data", 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

async function findFfmpeg(): Promise<string> {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
  const { execFileSync } = await import("node:child_process");
  try {
    return execFileSync("python", ["-c", "import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())"], { encoding: "utf8" }).trim();
  } catch {
    return "ffmpeg";
  }
}

async function renderAudio(session: Session) {
  loadEnvLocal();
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) fail("audio needs OPENAI_API_KEY in .env.local");
  if (session.turns.length === 0) fail("no turns to voice yet");

  // Every utterance in call order: Max's opening, then customer/Max pairs
  const lines: Array<{ role: "user" | "assistant"; text: string; turn?: Turn }> = [{ role: "assistant", text: session.opening }];
  for (const t of session.turns) {
    lines.push({ role: "user", text: t.customer, turn: t });
    lines.push({ role: "assistant", text: t.max, turn: t });
  }

  process.stderr.write(`voicing ${lines.length} lines...\n`);
  const clips: Buffer[] = new Array(lines.length);
  for (let i = 0; i < lines.length; i += 4) {
    await Promise.all(
      lines.slice(i, i + 4).map(async (l, j) => {
        clips[i + j] = await tts(l.text, l.role === "assistant" ? MAX_VOICE : CUSTOMER_VOICE, key);
      })
    );
  }

  // Lay the clips on one track. Gap before Max = his real controller time plus a render
  // allowance; gap before the customer = a natural pause.
  const startMs = Date.parse(session.started_at) || Date.now();
  const parts: Buffer[] = [];
  const transcript: Array<Record<string, unknown>> = [];
  const timingLogs: Array<Record<string, unknown>> = [];
  let cursor = 0; // ms into the track
  let userEnd = 0;
  lines.forEach((l, i) => {
    const gap = i === 0 ? 300 : l.role === "assistant" ? Math.min(3000, 700 + (l.turn?.ms ?? 0)) : 600;
    parts.push(silence(gap));
    cursor += gap;
    const begin = cursor;
    const durMs = Math.round((clips[i].length / 2 / PCM_RATE) * 1000);
    parts.push(clips[i]);
    cursor += durMs;
    transcript.push({
      role: l.role,
      speaker: l.role === "assistant" ? "Max (AI)" : "Simulated customer",
      time: `${Math.floor(begin / 1000)}-${Math.ceil(cursor / 1000)}s`,
      text: l.text,
      timestamp: new Date(startMs + begin).toISOString(),
    });
    if (l.role === "user") userEnd = cursor;
    if (l.role === "assistant" && l.turn) {
      const ue = startMs + userEnd;
      const decision = ue + l.turn.ms;
      timingLogs.push({
        turnId: l.turn.n,
        userInput: l.turn.customer,
        avatarText: l.turn.max,
        controller: l.turn.metrics,
        timestamps: { user_speech_end: ue, final_transcript: ue, controller_decision: decision, speak_sent: decision, avatar_audio_start: startMs + begin },
        gaps: {
          transcription_gap_ms: 0,
          controller_gap_ms: l.turn.ms,
          speak_sent_gap_ms: 0,
          avatar_render_gap_ms: startMs + begin - decision,
          total_latency_ms: begin - userEnd,
        },
      });
    }
  });

  const logsDir = path.join(appRoot, "logs-heygen");
  mkdirSync(logsDir, { recursive: true });
  const sid = `sim-${session.id}`;
  const tmpWav = path.join(sessionsDir, `${session.id}.wav`);
  writeFileSync(tmpWav, wav(Buffer.concat(parts)));
  const { execFileSync } = await import("node:child_process");
  execFileSync(await findFfmpeg(), ["-y", "-loglevel", "error", "-i", tmpWav, "-c:a", "libopus", "-b:a", "48k", path.join(logsDir, `${sid}.webm`)]);
  rmSync(tmpWav);

  const last = session.turns.at(-1)!;
  const priceNum = { "four dollars": 4, "three dollars and fifty cents": 3.5, "three dollars and twenty-five cents": 3.25, "three dollars": 3 }[last.price];
  writeFileSync(
    path.join(logsDir, `${sid}.json`),
    JSON.stringify(
      {
        sessionId: sid,
        engine: "heygen-grok",
        avatarId: "simulated",
        avatarName: `Max (simulated call: ${session.persona})`,
        startTime: new Date(startMs).toISOString(),
        endTime: new Date(startMs + cursor).toISOString(),
        durationSeconds: Math.ceil(cursor / 1000),
        status: "completed",
        finalDailyRate: last.stopped && last.beat >= 24 ? priceNum ?? last.price : null,
        transcript,
        timingLogs,
        bargeIns: [],
        transcriptionModel: "simulated (text, voiced with OpenAI TTS)",
      },
      null,
      2
    )
  );
  process.stdout.write(`${sid}\n`);
}

main().catch((e) => fail(e instanceof Error ? e.stack ?? e.message : String(e)));
