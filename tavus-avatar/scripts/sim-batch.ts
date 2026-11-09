/**
 * Automated test calls (layer 1): an AI plays each customer persona against the real Max controller,
 * turn by turn, then every call is scored (src/lib/call-scorecard.ts) and reviewed by the same AI
 * review as the call log sheet.
 *
 *   npx --yes tsx --conditions=react-server scripts/sim-batch.ts                 (every persona once)
 *   npx --yes tsx --conditions=react-server scripts/sim-batch.ts --calls 50      (cycles the personas)
 *     --personas terse_tester,hard_haggler   only these (ids in testing-skill/tester-personas.json)
 *     --noise 0.15     share of customer turns turned into recognition glitches (a cut-off
 *                      fragment, or an echo of Max's own words), as in the real calls; default 0.1
 *     --no-review      skip the AI review in the report (faster); the sheet row still gets one
 *     --no-sheet       do not send the calls to the call log sheet. By default every call is sent
 *                      (Environment "local · simulation (<persona>)"; about 5 Make operations per call)
 *     --resend <file>  send a past batch's calls (its testing-skill/reports/sim-batch-*.json) to the sheet
 *     --parallel 4     calls at once (default 4)
 *
 * Needs XAI_API_KEY or OPENAI_API_KEY in .env.local (the AI customer; Max's classifier also uses it,
 * like production). Writes testing-skill/reports/sim-batch-<time>.md and .json.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ScoredTurn, Scorecard } from "../src/lib/call-scorecard";

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, "..");
const reportsDir = path.resolve(appRoot, "../testing-skill/reports");
const personasFile = path.resolve(appRoot, "../testing-skill/tester-personas.json");

const realLog = console.log;
console.log = () => {};
console.warn = () => {};
console.error = () => {};

const args = process.argv.slice(2);
const arg = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const MAX_TURNS = 45;

interface Persona {
  id: string;
  name: string;
  behaviour: string;
  goal: string;
}

interface SimCall {
  id: string;
  persona: string;
  turns: ScoredTurn[];
  glitched: number;
  endedBy: "customer" | "max" | "turn limit";
  scorecard: Scorecard;
  review?: { aiScore: number | ""; callSummary: string; problemsFound: string; customerSentiment: string };
  seconds: number;
}

function loadEnvLocal() {
  const file = path.join(appRoot, ".env.local");
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z_0-9]+)=(.*)$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

function customerSystemPrompt(p: Persona): string {
  return `You are role-playing a customer on a live video call with "Max", an AI finance manager at a car dealership. You just agreed to buy a 2026 Mazda CX-5. Max will go over paperwork, the factory warranty, and offer a vehicle protection package with a daily price.

Who you are: ${p.name}. ${p.behaviour}
Your goal: ${p.goal}

Rules:
- Reply with ONLY what you say out loud, as speech-to-text would write it: no quotes, no stage directions, no emojis.
- Keep it natural and short (1-25 words) unless your character rambles.
- React to what Max actually said. If Max repeats himself or makes no sense, react like a real person would.
- When you want to end the call (you are done, annoyed, or Max said goodbye), reply with exactly: [HANG UP]`;
}

async function chat(messages: Array<{ role: string; content: string }>, temperature: number): Promise<string> {
  const xai = process.env.XAI_API_KEY?.trim();
  const key = xai || process.env.OPENAI_API_KEY?.trim();
  if (!key) throw new Error("XAI_API_KEY or OPENAI_API_KEY is needed for the AI customer");
  const endpoint = xai ? "https://api.x.ai/v1/chat/completions" : "https://api.openai.com/v1/chat/completions";
  const model = process.env.GROK_MODEL?.trim() || (xai ? "grok-4.20-0309-non-reasoning" : "gpt-4o-mini");
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model, temperature, max_tokens: 120, messages }),
    });
    if (res.ok) return ((await res.json()).choices?.[0]?.message?.content ?? "").trim();
    await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
  }
  throw new Error("the AI customer did not answer");
}

/** A recognition glitch like the real calls: a cut-off fragment, or Max's own words echoed back */
function glitch(customer: string, lastMax: string): string {
  if (Math.random() < 0.5) {
    const first = customer.split(/\s+/).filter(Boolean)[0] ?? customer;
    return first.replace(/[^\w']/g, "");
  }
  const words = lastMax.split(/\s+/).filter(Boolean);
  if (words.length < 4) return customer.split(/\s+/)[0] ?? customer;
  const start = Math.floor(Math.random() * (words.length - 3));
  return words.slice(start, start + 2 + Math.floor(Math.random() * 4)).join(" ").replace(/[^\w' ]/g, "");
}

async function simulateCall(persona: Persona, n: number, noise: number, review: boolean, sheet: boolean): Promise<SimCall> {
  const bc = await import("../src/lib/beat-controller");
  const { DEFAULT_DEAL_CONFIG } = await import("../src/lib/deal-config");
  const { STEP_0_GREETING } = await import("../src/lib/max-lines");
  const { scoreCall } = await import("../src/lib/call-scorecard");

  const started = Date.now();
  const id = `sim-${persona.id}-${n}-${Date.now().toString(36)}`;
  bc.resetCallState(id);
  bc.getOrCreateCallState(id);
  const history: Array<{ role: string; content: string }> = [
    { role: "system", content: customerSystemPrompt(persona) },
    { role: "user", content: STEP_0_GREETING },
  ];
  const turns: ScoredTurn[] = [];
  let glitched = 0;
  let endedBy: SimCall["endedBy"] = "turn limit";
  let lastMax = STEP_0_GREETING;

  for (let i = 0; i < MAX_TURNS; i++) {
    let said = await chat(history, 0.8);
    if (!said || said.includes("[HANG UP]")) {
      endedBy = "customer";
      break;
    }
    history.push({ role: "assistant", content: said });
    if (Math.random() < noise) {
      said = glitch(said, lastMax);
      glitched++;
    }
    const d = await bc.processControllerTurn(id, said, DEFAULT_DEAL_CONFIG);
    turns.push({ customer: said, max: d.textToSpeak, beat: d.beatId });
    history.push({ role: "user", content: d.textToSpeak });
    lastMax = d.textToSpeak;
    if (d.isScriptComplete) {
      endedBy = "max";
      break;
    }
  }

  const transcript = [
    { role: "assistant", text: STEP_0_GREETING, timestamp: "" },
    ...turns.flatMap((t) => [
      { role: "user", text: t.customer, timestamp: "" },
      { role: "assistant", text: t.max, timestamp: "" },
    ]),
  ];
  const log = {
    sessionId: id,
    engine: "heygen-grok",
    avatarId: "simulation",
    avatarName: "Max",
    startTime: new Date(started).toISOString(),
    endTime: new Date().toISOString(),
    durationSeconds: Math.round((Date.now() - started) / 1000),
    status: "completed",
    transcript,
    sttEngine: `simulation (${persona.id})`,
  } as const;

  const call: SimCall = {
    id,
    persona: persona.id,
    turns,
    glitched,
    endedBy,
    scorecard: scoreCall(turns),
    seconds: Math.round((Date.now() - started) / 1000),
  };

  // One AI review, used for both the report and the sheet row
  const facts = simFacts(persona.name, call.scorecard.furthestBeat, glitched);
  let analysis: Awaited<ReturnType<typeof import("../src/lib/post-call-analysis").analyzeFinishedCall>> | undefined;
  if (review || sheet) {
    const { analyzeFinishedCall } = await import("../src/lib/post-call-analysis");
    const text = transcript.map((t) => `${t.role === "user" ? "Customer" : "Max"}: ${t.text}`).join("\n");
    analysis = await analyzeFinishedCall(log as never, bc.activeStates.get(id), text, facts);
    call.review = {
      aiScore: analysis.aiScore,
      callSummary: analysis.callSummary,
      problemsFound: analysis.problemsFound,
      customerSentiment: analysis.customerSentiment,
    };
  }
  if (sheet) await sendToSheet(id, log, bc.activeStates.get(id), analysis, facts);
  bc.resetCallState(id);
  return call;
}

const simFacts = (personaName: string, furthestBeat: number, glitched: number) =>
  `Simulated call (AI customer: ${personaName}). Furthest script beat: ${furthestBeat} of 25. ` +
  `${glitched} customer turns were turned into recognition glitches on purpose.`;

const SHEET_INSPECTOR_NOTE = "simulated call: no recording or Inspector; full conversation in testing-skill/reports/sim-batch-*.md";

/** One row in the call log sheet (Environment "… · simulation (<persona>)") */
async function sendToSheet(id: string, log: unknown, state: unknown, analysis: unknown, facts: string): Promise<void> {
  const { sendCallLog } = await import("../src/lib/call-log-webhook");
  const result = await sendCallLog(id, "", {
    log: log as never,
    state: state as never,
    analysis: analysis as never,
    inspectorUrl: SHEET_INSPECTOR_NOTE,
    facts,
  });
  if (!result.sent) realLog(`    (${id} not sent to the sheet: ${result.reason})`);
}

/** Sends every call of a past batch (its .json report) to the sheet */
async function resend(file: string): Promise<void> {
  const calls: SimCall[] = JSON.parse(readFileSync(file, "utf8"));
  realLog(`sending ${calls.length} calls from ${path.basename(file)} to the call log sheet...`);
  for (const c of calls) {
    const { STEP_0_GREETING } = await import("../src/lib/max-lines");
    const transcript = [
      { role: "assistant", text: STEP_0_GREETING, timestamp: "" },
      ...c.turns.flatMap((t) => [
        { role: "user", text: t.customer, timestamp: "" },
        { role: "assistant", text: t.max, timestamp: "" },
      ]),
    ];
    const log = {
      sessionId: c.id,
      engine: "heygen-grok",
      avatarId: "simulation",
      avatarName: "Max",
      startTime: new Date().toISOString(),
      endTime: new Date().toISOString(),
      durationSeconds: c.seconds,
      status: "completed",
      transcript,
      sttEngine: `simulation (${c.persona})`,
    };
    // Rebuilt from the report: how far the call got and whether Max ended it
    const state = { current_beat: c.scorecard.furthestBeat, delivered_beats: [], is_stopped: c.endedBy === "max" };
    await sendToSheet(c.id, log, state, undefined, simFacts(c.persona, c.scorecard.furthestBeat, c.glitched));
    realLog(`  ${c.persona.padEnd(18)} beat ${String(c.scorecard.furthestBeat).padStart(2)}  sent`);
  }
}

function report(calls: SimCall[], noise: number): string {
  const personas = [...new Set(calls.map((c) => c.persona))];
  const checkDefs = calls[0]?.scorecard.checks ?? [];
  const pct = (n: number, d: number) => (d ? `${Math.round((100 * n) / d)}%` : "-");
  const scores = calls.map((c) => c.review?.aiScore).filter((s): s is number => typeof s === "number");
  const lines = [
    `# Automated test calls`,
    ``,
    `${calls.length} calls · recognition glitches on ${Math.round(noise * 100)}% of customer turns · ${new Date().toISOString()}`,
    ``,
    `| | |`,
    `|---|---|`,
    `| Reached the price (Beat 22+) | ${pct(calls.filter((c) => c.scorecard.reachedPrice).length, calls.length)} |`,
    `| Finished the script (Beat 25) | ${pct(calls.filter((c) => c.scorecard.completed).length, calls.length)} |`,
    `| Calls with a hard failure | ${calls.filter((c) => c.scorecard.checks.some((k) => k.severity === "hard" && !k.pass)).length} |`,
    `| Average AI score | ${scores.length ? (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1) : "-"} / 10 |`,
    ``,
    `## Checks`,
    ``,
    `| Check | Type | Calls failing |`,
    `|---|---|---|`,
    ...checkDefs.map((d) => `| ${d.label} | ${d.severity} | ${calls.filter((c) => c.scorecard.checks.find((k) => k.id === d.id && !k.pass)).length} |`),
    ``,
    `## By persona`,
    ``,
    `| Persona | Calls | Reached price | Avg furthest beat | Hard failures | Avg AI score |`,
    `|---|---|---|---|---|---|`,
    ...personas.map((p) => {
      const cs = calls.filter((c) => c.persona === p);
      const sc = cs.map((c) => c.review?.aiScore).filter((s): s is number => typeof s === "number");
      return `| ${p} | ${cs.length} | ${pct(cs.filter((c) => c.scorecard.reachedPrice).length, cs.length)} | ${(cs.reduce((a, c) => a + c.scorecard.furthestBeat, 0) / cs.length).toFixed(1)} | ${cs.filter((c) => c.scorecard.checks.some((k) => k.severity === "hard" && !k.pass)).length} | ${sc.length ? (sc.reduce((a, b) => a + b, 0) / sc.length).toFixed(1) : "-"} |`;
    }),
    ``,
    `## Calls`,
    ``,
  ];
  for (const c of calls) {
    const fails = c.scorecard.checks.filter((k) => !k.pass);
    lines.push(`### ${c.id} · Beat ${c.scorecard.furthestBeat} · ended by ${c.endedBy}${c.review ? ` · AI ${c.review.aiScore}/10` : ""}`);
    for (const f of fails) lines.push(`- **${f.severity === "hard" ? "FAIL" : "flag"} · ${f.label}:** ${f.detail}`);
    if (c.review?.callSummary) lines.push(`- **AI summary:** ${c.review.callSummary}`);
    lines.push("", "<details><summary>Conversation</summary>", "");
    for (const t of c.turns) lines.push(`- **Customer:** ${t.customer}`, `  - **Max (Beat ${t.beat}):** ${t.max}`);
    lines.push("", "</details>", "");
  }
  return lines.join("\n");
}

async function main() {
  loadEnvLocal();
  const resendFile = arg("--resend");
  if (resendFile) return resend(resendFile);
  const all: Persona[] = JSON.parse(readFileSync(personasFile, "utf8")).personas;
  const wanted = arg("--personas")?.split(",").map((s) => s.trim());
  const personas = wanted ? all.filter((p) => wanted.includes(p.id)) : all;
  if (!personas.length) throw new Error(`no matching personas; known: ${all.map((p) => p.id).join(", ")}`);
  const total = Number(arg("--calls") ?? personas.length);
  const noise = Number(arg("--noise") ?? 0.1);
  const parallel = Math.max(1, Number(arg("--parallel") ?? 4));
  const review = !args.includes("--no-review");
  // Every simulated call goes to the call log sheet unless --no-sheet (or no webhook is set up)
  const sheet = !args.includes("--no-sheet") && Boolean(process.env.CALL_LOG_WEBHOOK_URL?.trim());

  realLog(
    `running ${total} calls (${personas.length} personas, ${parallel} at a time, glitches ${Math.round(noise * 100)}%)` +
      `${sheet ? ", each sent to the call log sheet" : ""}...`
  );
  const jobs = Array.from({ length: total }, (_, i) => () => simulateCall(personas[i % personas.length], i + 1, noise, review, sheet));
  const calls: SimCall[] = [];
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(parallel, jobs.length) }, async () => {
      while (next < jobs.length) {
        const job = jobs[next++];
        try {
          const c = await job();
          calls.push(c);
          const hard = c.scorecard.checks.filter((k) => k.severity === "hard" && !k.pass);
          realLog(`  ${c.persona.padEnd(18)} beat ${String(c.scorecard.furthestBeat).padStart(2)}  ${c.review ? `AI ${c.review.aiScore}/10  ` : ""}${hard.length ? hard.map((h) => `✗ ${h.label}`).join(", ") : "✓"}`);
        } catch (err) {
          realLog(`  a call failed to run: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    })
  );

  mkdirSync(reportsDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const md = path.join(reportsDir, `sim-batch-${stamp}.md`);
  writeFileSync(md, report(calls, noise));
  writeFileSync(md.replace(/\.md$/, ".json"), JSON.stringify(calls, null, 2));
  realLog(`report: ${path.relative(process.cwd(), md)}`);
}

main().catch((err) => {
  realLog(`error: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
