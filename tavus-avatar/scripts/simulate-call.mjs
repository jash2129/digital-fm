import { execSync } from "child_process";
import path from "path";
import fs from "fs";

console.log("================================================================================");
console.log("TWO-AGENT AUTOMATED CALL TESTING (Agent 1 Max vs Agent 2 Customer Simulator)");
console.log("================================================================================");

const args = process.argv.slice(2);
const personaArg = args.find(a => a.startsWith("--persona="))?.split("=")[1] || "all";

console.log(`[Simulator] Running multi-agent automated QA (Persona: ${personaArg})...\n`);

try {
  // Run the automated test suite using vitest
  execSync("npx vitest run src/lib/ai-agent-qa.test.ts", {
    stdio: "inherit",
    cwd: path.resolve(process.cwd())
  });
} catch {
  console.error("\n❌ Automated call simulation failed!");
  process.exit(1);
}

// Find the latest generated simulation log
const logsDir = path.resolve(process.cwd(), "logs-heygen");
if (fs.existsSync(logsDir)) {
  const simFiles = fs.readdirSync(logsDir)
    .filter(f => f.startsWith("simulated_") && f.endsWith(".json"))
    .map(f => ({ name: f, time: fs.statSync(path.join(logsDir, f)).mtimeMs }))
    .sort((a, b) => b.time - a.time);

  if (simFiles.length > 0) {
    const latestLog = path.join(logsDir, simFiles[0].name);
    console.log("\n================================================================================");
    console.log("ANALYZING LATEST SIMULATED CALL WITH calculate-latency.py:");
    console.log("================================================================================");
    try {
      execSync(`python ../scripts/calculate-latency.py "${latestLog}"`, {
        stdio: "inherit",
        cwd: path.resolve(process.cwd())
      });
    } catch {
      // ignore
    }
  }
}
