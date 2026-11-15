import { loadEnvFile, missingRuntimeEnv } from "../packages/db/src/env";
import { embeddingModel } from "../packages/integrations/src/embeddings";
import { embeddingDimensions, embeddingMode, vectorHealth, vectorMode } from "../packages/integrations/src/vector";

/**
 * `pnpm env:check` prints the selected integration modes and every key that is
 * missing for them, without ever printing a secret value.
 *
 * Exit codes: 0 = ready to run, 1 = configuration incomplete.
 */
const loaded = loadEnvFile();
const env = process.env;

const mode = (key: string, fallback: string) => (env[key] ?? "").trim() || fallback;
const has = (key: string) => ((env[key] ?? "").trim() ? "set" : "empty");

console.log(`env file:      ${loaded ?? "none (using defaults / shell environment)"}`);
console.log(`MPESA_MODE:    ${mode("MPESA_MODE", "mock")}`);
console.log(`WHATSAPP_MODE: ${mode("WHATSAPP_MODE", "mock")}`);
console.log(`MEETINGS_MODE: ${mode("MEETINGS_MODE", "mock")}`);
console.log(`WAMBO_MODEL:   ${mode("WAMBO_MODEL", "mock")}`);
console.log("");
console.log("Required keys:");
for (const key of [
  "DATABASE_URL",
  "AUTH_SECRET",
  "ENCRYPTION_KEY",
  "INTERNAL_SECRET",
  "MCP_TOKEN_SECRET",
]) {
  console.log(`  ${key}: ${has(key)}`);
}

if (mode("MPESA_MODE", "mock") === "tuma") {
  console.log("Tuma keys:");
  for (const key of ["TUMA_EMAIL", "TUMA_API_KEY", "TUMA_CALLBACK_URL"]) {
    console.log(`  ${key}: ${has(key)}`);
  }
}

if (mode("WHATSAPP_MODE", "mock") === "cloud") {
  console.log("WhatsApp Cloud keys:");
  for (const key of [
    "WHATSAPP_PHONE_NUMBER_ID",
    "WHATSAPP_ACCESS_TOKEN",
    "WHATSAPP_VERIFY_TOKEN",
    "WHATSAPP_APP_SECRET",
  ]) {
    console.log(`  ${key}: ${has(key)}`);
  }
}

console.log("");
console.log("Agent model, knowledge and memory:");
const realModel = mode("WAMBO_MODEL", "mock") !== "mock";
console.log(`  WAMBO_MODEL: ${realModel ? mode("WAMBO_MODEL", "mock") : "mock (scripted replies, no real model)"}`);
console.log(`  OPENROUTER_API_KEY: ${has("OPENROUTER_API_KEY")}`);
console.log(`  vector store: ${vectorMode()}${vectorMode() === "mock" ? " (in-memory: knowledge and memory vectors vanish on restart)" : ""}`);
console.log(`  embeddings:   ${embeddingMode()}${embeddingMode() === "openrouter" ? ` (${embeddingModel()}, ${embeddingDimensions()} dims)` : " (hash-based, for tests)"}`);
async function finish(): Promise<void> {
const vectorProblems: string[] = [];
if (realModel && !(env.OPENROUTER_API_KEY ?? "").trim()) vectorProblems.push("WAMBO_MODEL is a real model but OPENROUTER_API_KEY is empty.");
if (vectorMode() === "qdrant") {
  if (!(env.QDRANT_URL ?? "").trim()) vectorProblems.push("VECTOR_MODE=qdrant needs QDRANT_URL.");
  else {
    const health = await vectorHealth();
    console.log(`  qdrant:       ${health.ok ? "reachable" : "NOT reachable"} (${health.detail})`);
    if (!health.ok) vectorProblems.push("Qdrant is not reachable. Start it with: docker compose up -d qdrant (and check QDRANT_API_KEY).");
  }
}
if (embeddingMode() === "mock" && realModel) {
  console.log("  note: embeddings are still in mock mode. Set EMBEDDING_MODE=openrouter for real semantic search.");
}

const problems = [...missingRuntimeEnv(env), ...vectorProblems];
if (problems.length > 0) {
  console.error("");
  console.error("Configuration is incomplete; the app will refuse to start:");
  for (const problem of problems) console.error(`  - ${problem}`);
  console.error("Fill these in .env (see .env.example) or switch the mode back to mock.");
  process.exit(1);
}

console.log("");
console.log("Configuration OK for the selected modes.");
}

finish().catch((error) => {
  console.error("env:check crashed:", error);
  process.exit(1);
});
