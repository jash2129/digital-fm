/**
 * Replays real calls against today's Max and scores them (layer 2 of automated testing).
 *
 *   npx --yes tsx --conditions=react-server scripts/replay-real-calls.ts --csv "<call log sheet export>.csv"
 *   npx --yes tsx --conditions=react-server scripts/replay-real-calls.ts --api https://digital-fm.vercel.app
 *       (reads every stored call from the live app; needs DEMO_API_TOKEN in .env.local or the env)
 *   add --save-fixture to also update testing-skill/real-calls/real-calls.json, which
 *       src/lib/real-calls-replay.test.ts replays on every `npm test`
 *   add --llm to let the AI classifier help (like production); default is rules only, free and repeatable
 *
 * Writes a report to testing-skill/reports/replay-<time>.md (and .json).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { RecordedCall, ReplayResult } from "../src/lib/call-replay";

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, "..");
const reportsDir = path.resolve(appRoot, "../testing-skill/reports");
const fixturePath = path.resolve(appRoot, "../testing-skill/real-calls/real-calls.json");

// Max's controller logs a lot to stdout; keep the console for the report summary
const realLog = console.log;
console.log = () => {};
console.warn = () => {};
console.error = () => {};

const args = process.argv.slice(2);
const arg = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

function loadEnvLocal() {
  const file = path.join(appRoot, ".env.local");
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z_0-9]+)=(.*)$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

/** Minimal CSV parser: quoted fields with commas, newlines and doubled quotes */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

async function callsFromCsv(file: string): Promise<RecordedCall[]> {
  const { customerLinesFromTranscript } = await import("../src/lib/call-replay");
  const [header, ...rows] = parseCsv(readFileSync(file, "utf8"));
  const idCol = header.indexOf("Call ID");
  const trCol = header.indexOf("Transcript");
  const envCol = header.indexOf("Environment");
  if (idCol < 0 || trCol < 0) throw new Error("the CSV needs 'Call ID' and 'Transcript' columns");
  const byId = new Map<string, RecordedCall>();
  for (const r of rows) {
    const id = r[idCol]?.trim();
    if (!id || id.startsWith("SAMPLE") || (r[envCol] ?? "").includes("simulation")) continue;
    const lines = customerLinesFromTranscript(r[trCol] ?? "");
    // The sheet can hold the same call twice: keep the longer transcript
    if (!byId.has(id) || byId.get(id)!.customerLines.length < lines.length) byId.set(id, { id, customerLines: lines });
  }
  return [...byId.values()].filter((c) => c.customerLines.length > 0);
}

async function callsFromApi(base: string): Promise<RecordedCall[]> {
  const token = process.env.DEMO_API_TOKEN?.trim();
  if (!token) throw new Error("DEMO_API_TOKEN is needed to read calls from the live app");
  const headers = { cookie: `demo-session=${token}` };
  const list = (await (await fetch(`${base}/api/heygen/logs`, { headers })).json()) as { sessions?: Array<{ sessionId: string }> };
  const calls: RecordedCall[] = [];
  for (const { sessionId } of list.sessions ?? []) {
    const log = (await (await fetch(`${base}/api/heygen/logs/${encodeURIComponent(sessionId)}`, { headers })).json()) as {
      transcript?: Array<{ role: string; text: string }>;
    };
    const lines = (log.transcript ?? []).filter((t) => t.role === "user").map((t) => t.text.trim()).filter(Boolean);
    if (lines.length) calls.push({ id: sessionId, customerLines: lines });
  }
  return calls;
}

function report(results: ReplayResult[], source: string): string {
  const checkIds = results[0]?.scorecard.checks.map((c) => c.id) ?? [];
  const labels = Object.fromEntries((results[0]?.scorecard.checks ?? []).map((c) => [c.id, c.label]));
  const lines = [
    `# Real-call replay against today's Max`,
    ``,
    `Source: ${source} · ${results.length} calls · ${new Date().toISOString()}`,
    ``,
    `| Check | Calls failing |`,
    `|---|---|`,
    ...checkIds.map((id) => `| ${labels[id]} | ${results.filter((r) => r.scorecard.checks.find((c) => c.id === id && !c.pass)).length} |`),
    `| Reached the price (Beat 22+) | ${results.filter((r) => r.scorecard.reachedPrice).length} of ${results.length} |`,
    ``,
    `## Calls`,
    ``,
  ];
  for (const r of results) {
    const fails = r.scorecard.checks.filter((c) => !c.pass);
    lines.push(`### ${r.id} · furthest Beat ${r.scorecard.furthestBeat} · ${fails.length ? `${fails.length} failing` : "all checks pass"}`);
    for (const f of fails) lines.push(`- **${f.label}:** ${f.detail}`);
    lines.push("", "<details><summary>Replayed conversation</summary>", "");
    for (const t of r.turns) lines.push(`- **Customer:** ${t.customer}`, `  - **Max (Beat ${t.beat}):** ${t.max}`);
    lines.push("", "</details>", "");
  }
  return lines.join("\n");
}

async function main() {
  loadEnvLocal();
  if (!args.includes("--llm")) {
    delete process.env.XAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
  }
  const csv = arg("--csv");
  const api = arg("--api");
  if (!csv && !api) throw new Error('usage: replay-real-calls.ts --csv "<file>.csv" | --api <base url> [--save-fixture] [--llm]');
  const calls = csv ? await callsFromCsv(csv) : await callsFromApi(api!.replace(/\/$/, ""));
  const { replayCall } = await import("../src/lib/call-replay");
  const results: ReplayResult[] = [];
  for (const c of calls) results.push(await replayCall(c));

  mkdirSync(reportsDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const md = path.join(reportsDir, `replay-${stamp}.md`);
  writeFileSync(md, report(results, csv ?? api!));
  writeFileSync(md.replace(/\.md$/, ".json"), JSON.stringify(results, null, 2));
  if (args.includes("--save-fixture")) {
    mkdirSync(path.dirname(fixturePath), { recursive: true });
    const existing: RecordedCall[] = existsSync(fixturePath) ? JSON.parse(readFileSync(fixturePath, "utf8")) : [];
    const merged = new Map(existing.map((c) => [c.id, c]));
    for (const c of calls) merged.set(c.id, c);
    writeFileSync(fixturePath, JSON.stringify([...merged.values()], null, 2) + "\n");
    realLog(`fixture: ${merged.size} calls in ${path.relative(process.cwd(), fixturePath)}`);
  }

  realLog(`${results.length} calls replayed`);
  for (const r of results) {
    const fails = r.scorecard.checks.filter((c) => !c.pass);
    realLog(`  ${r.id.slice(0, 8)}  beat ${String(r.scorecard.furthestBeat).padStart(2)}  ${fails.length ? fails.map((f) => `✗ ${f.label}: ${f.detail}`).join(" | ") : "✓ all checks pass"}`);
  }
  realLog(`report: ${path.relative(process.cwd(), md)}`);
}

main().catch((err) => {
  realLog(`error: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
