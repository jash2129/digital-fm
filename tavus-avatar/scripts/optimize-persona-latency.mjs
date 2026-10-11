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
const personaId = env.TAVUS_PERSONA_ID || "pb0b08db38a9";
const openaiApiKey = env.OPENAI_API_KEY;
const groqApiKey = env.GROQ_API_KEY;

if (!tavusApiKey) {
  console.error("Missing TAVUS_API_KEY.");
  process.exit(1);
}

async function patchPersona(operations) {
  return await fetch(`https://tavusapi.com/v2/personas/${personaId}`, {
    method: "PATCH",
    headers: {
      "x-api-key": tavusApiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(operations),
  });
}

async function run() {
  console.log(`Fetching current persona ${personaId}...`);
  const getRes = await fetch(`https://tavusapi.com/v2/personas/${personaId}`, {
    headers: { "x-api-key": tavusApiKey },
  });
  if (!getRes.ok) {
    console.error("Failed to fetch persona:", getRes.status, await getRes.text());
    process.exit(1);
  }

  const persona = await getRes.json();
  const currentLayers = persona.layers || {};

  console.log(`Current LLM model: ${currentLayers.llm?.model}`);
  console.log(`Current turn detection: ${currentLayers.conversational_flow?.turn_detection_model}`);
  console.log(`Current patience: ${currentLayers.conversational_flow?.turn_taking_patience}`);

  const targetModel = groqApiKey ? "llama-3.3-70b-versatile" : "gpt-4o-mini";
  const targetBaseUrl = groqApiKey ? "https://api.groq.com/openai/v1" : "https://api.openai.com/v1";
  const targetApiKey = groqApiKey || openaiApiKey;

  console.log(`Target LLM: ${targetModel} at ${targetBaseUrl}`);

  // Test operations with sparrow-2
  let patchOps = [
    { op: "replace", path: "/layers/conversational_flow/turn_detection_model", value: "sparrow-2" },
    { op: "replace", path: "/layers/conversational_flow/turn_taking_patience", value: "low" },
    { op: "replace", path: "/layers/conversational_flow/replica_interruptibility", value: "high" },
    { op: "replace", path: "/layers/llm/model", value: targetModel },
    { op: "replace", path: "/layers/llm/base_url", value: targetBaseUrl },
    { op: "replace", path: "/layers/llm/api_key", value: targetApiKey },
    { op: "replace", path: "/layers/llm/speculative_inference", value: true },
  ];

  console.log("\nAttempting JSON patch with sparrow-2 + low patience + fast LLM...");
  let patchRes = await patchPersona(patchOps);

  if (!patchRes.ok && patchRes.status !== 304) {
    const errText = await patchRes.text();
    console.warn(`sparrow-2 attempt returned: ${patchRes.status}. Details: ${errText}`);
    console.log("Trying with sparrow-1...");
    patchOps[0] = { op: "replace", path: "/layers/conversational_flow/turn_detection_model", value: "sparrow-1" };
    patchRes = await patchPersona(patchOps);
  }

  if (!patchRes.ok && patchRes.status !== 304) {
    console.error("PATCH failed:", patchRes.status, await patchRes.text());
    process.exit(1);
  }

  console.log("\n✅ Persona successfully patched for low latency!");

  // Verify
  const verifyRes = await fetch(`https://tavusapi.com/v2/personas/${personaId}`, {
    headers: { "x-api-key": tavusApiKey },
  });
  const updated = await verifyRes.json();
  console.log("\n--- Verified Live Configuration ---");
  console.log("LLM Model:", updated.layers?.llm?.model);
  console.log("LLM Base URL:", updated.layers?.llm?.base_url);
  console.log("Turn Detection Model:", updated.layers?.conversational_flow?.turn_detection_model);
  console.log("Turn Taking Patience:", updated.layers?.conversational_flow?.turn_taking_patience);
  console.log("Replica Interruptibility:", updated.layers?.conversational_flow?.replica_interruptibility);
  console.log("Speculative Inference:", updated.layers?.llm?.speculative_inference);
  console.log("Tools count maintained:", updated.layers?.llm?.tools?.length);
}

run().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
