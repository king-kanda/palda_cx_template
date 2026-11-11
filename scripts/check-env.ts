import { loadEnvFile, missingRuntimeEnv } from "../packages/db/src/env";

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

const problems = missingRuntimeEnv(env);
if (problems.length > 0) {
  console.error("");
  console.error("Configuration is incomplete; the app will refuse to start:");
  for (const problem of problems) console.error(`  - ${problem}`);
  console.error("Fill these in .env (see .env.example) or switch the mode back to mock.");
  process.exit(1);
}

console.log("");
console.log("Configuration OK for the selected modes.");
