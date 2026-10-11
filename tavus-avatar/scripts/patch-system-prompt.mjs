import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, "../.env.local");
const promptPath = resolve(__dirname, "../../prompts/digital-finance-manager/system-instruction.md");

const envContent = readFileSync(envPath, "utf8");
let apiKey = "";
let personaId = "";

for (const line of envContent.split("\n")) {
  const trimmed = line.trim();
  if (trimmed.startsWith("TAVUS_API_KEY=")) {
    apiKey = trimmed.split("=")[1].trim();
  }
  if (trimmed.startsWith("TAVUS_PERSONA_ID=")) {
    personaId = trimmed.split("=")[1].trim();
  }
}

if (!apiKey || !personaId) {
  console.error("Missing TAVUS_API_KEY or TAVUS_PERSONA_ID in .env.local");
  process.exit(1);
}

const systemPrompt = readFileSync(promptPath, "utf8").trim();

console.log(`Patching persona ${personaId} on Tavus...`);

const res = await fetch(`https://tavusapi.com/v2/personas/${personaId}`, {
  method: "PATCH",
  headers: {
    "x-api-key": apiKey,
    "Content-Type": "application/json",
  },
  body: JSON.stringify([
    {
      op: "replace",
      path: "/system_prompt",
      value: systemPrompt,
    },
  ]),
});

const text = await res.text();
let data = {};
try {
  data = text ? JSON.parse(text) : {};
} catch {
  // Not JSON
}

if (!res.ok && res.status !== 304) {
  console.error(`Failed to patch persona: ${res.status}`, text);
  process.exit(1);
}

console.log(`✅ Persona ${personaId} updated on Tavus! (${res.status})`);
console.log(`Updated at: ${data.updated_at || new Date().toISOString()}`);
