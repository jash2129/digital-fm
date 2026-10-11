import { readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const envPath = resolve(repoRoot, ".env.local");

if (!existsSync(envPath)) {
  console.error("Error: .env.local not found in tavus-avatar folder.");
  process.exit(1);
}

// Simple parser for .env files
const envContent = readFileSync(envPath, "utf8");
const env = {};
for (const line of envContent.split("\n")) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) continue;
  const parts = trimmed.split("=");
  if (parts.length >= 2) {
    const key = parts[0].trim();
    const value = parts.slice(1).join("=").trim();
    env[key] = value;
  }
}

const tavusApiKey = env.TAVUS_API_KEY;
const openaiApiKey = env.OPENAI_API_KEY;
const defaultReplicaId = "r4ba1277e4fb"; // replica/avatar id

if (!tavusApiKey) {
  console.error("Error: TAVUS_API_KEY is not defined in .env.local.");
  process.exit(1);
}
if (!openaiApiKey) {
  console.error("Error: OPENAI_API_KEY is not defined in .env.local.");
  process.exit(1);
}

const promptPath = resolve(repoRoot, "../prompts/digital-finance-manager/system-instruction.md");
const systemPrompt = readFileSync(promptPath, "utf8");

const body = {
  persona_name: "Digital Finance Manager - Max",
  default_replica_id: defaultReplicaId,
  system_prompt: systemPrompt,
  layers: {
    llm: {
      model: "gpt-4o",
      base_url: "https://api.openai.com/v1",
      api_key: openaiApiKey,
    },
  },
};

console.log("Creating Tavus persona on account...");

const res = await fetch("https://tavusapi.com/v2/personas", {
  method: "POST",
  headers: {
    "x-api-key": tavusApiKey,
    "Content-Type": "application/json",
  },
  body: JSON.stringify(body),
});

const data = await res.json();
if (!res.ok) {
  console.error("API error:", res.status, JSON.stringify(data, null, 2));
  process.exit(1);
}

console.log("\n✅ Persona created!");
console.log("persona_id:", data.persona_id);
console.log("\nFull response:", JSON.stringify(data, null, 2));
