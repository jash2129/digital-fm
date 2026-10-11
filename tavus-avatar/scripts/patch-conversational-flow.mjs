import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, "../.env.local");

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

console.log(`Updating conversational flow layers for persona ${personaId}...`);

const patchPayload = [
  {
    op: "replace",
    path: "/layers/conversational_flow/turn_taking_patience",
    value: "high",
  },
  {
    op: "replace",
    path: "/layers/conversational_flow/replica_interruptibility",
    value: "high",
  },
  {
    op: "replace",
    path: "/layers/conversational_flow/idle_engagement",
    value: "patient",
  },
];

const res = await fetch(`https://tavusapi.com/v2/personas/${personaId}`, {
  method: "PATCH",
  headers: {
    "x-api-key": apiKey,
    "Content-Type": "application/json",
  },
  body: JSON.stringify(patchPayload),
});

const text = await res.text();
if (!res.ok && res.status !== 304) {
  console.error(`Failed to update conversational flow: ${res.status}`, text);
  process.exit(1);
}

console.log(`✅ Conversational flow updated on Tavus persona ${personaId}! (${res.status})`);
