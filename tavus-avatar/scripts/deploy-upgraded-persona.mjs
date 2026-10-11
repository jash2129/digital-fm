import { readFileSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const envPath = resolve(repoRoot, ".env.local");

// Target parameters provided by user
const NEW_API_KEY = "39136604c36842338aa5f68816212b3e";
const NEW_WORKSPACE_ID = "b1513176a7";
const NEW_FACE_ID = "rf1bd7e252de";

// Read existing .env.local to get OPENAI_API_KEY
const envContent = readFileSync(envPath, "utf8");
let openaiApiKey = "";
for (const line of envContent.split("\n")) {
  const trimmed = line.trim();
  if (trimmed.startsWith("OPENAI_API_KEY=")) {
    openaiApiKey = trimmed.split("=")[1].trim();
  }
}

// Load golden persona template
const template = JSON.parse(readFileSync(resolve(__dirname, "old-persona.json"), "utf8"));

// Build payload for new persona creation
const payload = {
  persona_name: "Digital Finance Manager Max",
  default_replica_id: NEW_FACE_ID,
  system_prompt: template.system_prompt,
  context: template.context || "",
  layers: {
    ...template.layers,
    llm: {
      ...template.layers.llm,
      model: "gpt-4o-mini",
      base_url: "https://api.openai.com/v1",
      api_key: openaiApiKey,
      speculative_inference: true,
      tools: template.layers.llm.tools || [],
    },
    conversational_flow: {
      turn_detection_model: "sparrow-2",
      turn_taking_patience: "low",
      replica_interruptibility: "high",
      voice_isolation: "near",
      wake_phrase: null,
      sleep_phrase: null,
      idle_engagement: "off",
      idle_end_behavior: "wait",
    },
  },
};

console.log(`Deploying persona to workspace ${NEW_WORKSPACE_ID} using face ${NEW_FACE_ID}...`);

const res = await fetch("https://tavusapi.com/v2/personas", {
  method: "POST",
  headers: {
    "x-api-key": NEW_API_KEY,
    "Content-Type": "application/json",
  },
  body: JSON.stringify(payload),
});

const data = await res.json();
if (!res.ok) {
  console.error("Failed to create persona:", res.status, JSON.stringify(data, null, 2));
  process.exit(1);
}

const newPersonaId = data.persona_id;
console.log(`\n✅ Persona created successfully! Persona ID: ${newPersonaId}`);

// Verify layers and tools on created persona
console.log("Verifying persona layers and tools...");
const verifyRes = await fetch(`https://tavusapi.com/v2/personas/${newPersonaId}`, {
  headers: { "x-api-key": NEW_API_KEY },
});
const verified = await verifyRes.json();
console.log(`Replica: ${verified.default_replica_id}`);
console.log(`Turn Detection: ${verified.layers?.conversational_flow?.turn_detection_model}`);
console.log(`LLM Model: ${verified.layers?.llm?.model}`);
console.log(`Tools registered: ${verified.layers?.llm?.tools?.length || 0}`);

// Update .env.local
let updatedEnv = envContent;

function setEnvVar(name, value) {
  const regex = new RegExp(`^${name}=.*$`, "m");
  if (regex.test(updatedEnv)) {
    updatedEnv = updatedEnv.replace(regex, `${name}=${value}`);
  } else {
    updatedEnv += `\n${name}=${value}`;
  }
}

setEnvVar("TAVUS_API_KEY", NEW_API_KEY);
setEnvVar("TAVUS_WORKSPACE_ID", NEW_WORKSPACE_ID);
setEnvVar("TAVUS_REPLICA_ID", NEW_FACE_ID);
setEnvVar("TAVUS_PERSONA_ID", newPersonaId);

writeFileSync(envPath, updatedEnv, "utf8");
console.log(`\n✅ Updated .env.local:`);
console.log(`  TAVUS_API_KEY=${NEW_API_KEY}`);
console.log(`  TAVUS_WORKSPACE_ID=${NEW_WORKSPACE_ID}`);
console.log(`  TAVUS_REPLICA_ID=${NEW_FACE_ID}`);
console.log(`  TAVUS_PERSONA_ID=${newPersonaId}`);
