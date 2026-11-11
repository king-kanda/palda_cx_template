import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { config } from "dotenv";

/**
 * Loads the repo-root `.env` no matter which workspace package a command runs
 * from (pnpm runs package scripts with the package directory as cwd).
 * Returns the path it loaded, or null when no `.env` exists.
 */
export function loadEnvFile(startDir = process.cwd()): string | null {
  let dir = resolve(/* turbopackIgnore: true */ startDir);
  for (let depth = 0; depth < 6; depth += 1) {
    const candidate = resolve(dir, ".env");
    if (existsSync(/* turbopackIgnore: true */ candidate)) {
      config({ path: candidate });
      return candidate;
    }
    const parent = resolve(dir, "..");
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/**
 * Loads `.env` and validates the selected integration modes. Mock mode is
 * always valid; choosing a real provider without its credentials fails loudly
 * here instead of at the first customer payment or message.
 */
export function loadEnv(startDir = process.cwd()): string | null {
  const loaded = loadEnvFile(startDir);
  assertRuntimeEnv(process.env);
  return loaded;
}

export type EnvLike = Record<string, string | undefined>;

const MODES = {
  mpesa: ["mock", "tuma", "daraja"],
  whatsapp: ["mock", "cloud"],
  meetings: ["mock", "google"],
} as const;

function value(env: EnvLike, key: string): string {
  return (env[key] ?? "").trim();
}

function isHttpsUrl(url: string): boolean {
  try {
    return new URL(url).protocol === "https:";
  } catch {
    return false;
  }
}

function requireAll(env: EnvLike, keys: string[], label: string): string[] {
  return keys.filter((key) => !value(env, key)).map((key) => `${label}: ${key} is empty`);
}

/**
 * Returns every configuration problem for the currently selected modes.
 * Pure and side-effect free so it can be unit tested without touching .env.
 */
export function missingRuntimeEnv(env: EnvLike = process.env): string[] {
  const problems: string[] = [];

  const mpesa = value(env, "MPESA_MODE") || "mock";
  if (!MODES.mpesa.includes(mpesa as (typeof MODES.mpesa)[number])) {
    problems.push(`MPESA_MODE="${mpesa}" is not one of ${MODES.mpesa.join(" | ")}`);
  } else if (mpesa === "tuma") {
    problems.push(...requireAll(env, ["TUMA_EMAIL", "TUMA_API_KEY"], "MPESA_MODE=tuma"));
    const callback = value(env, "TUMA_CALLBACK_URL") || value(env, "MPESA_CALLBACK_URL");
    if (!callback) {
      problems.push("MPESA_MODE=tuma: TUMA_CALLBACK_URL (or MPESA_CALLBACK_URL) is empty");
    } else if (!isHttpsUrl(callback)) {
      problems.push("MPESA_MODE=tuma: TUMA_CALLBACK_URL must be a public https:// URL");
    }
  } else if (mpesa === "daraja") {
    problems.push(
      ...requireAll(
        env,
        ["MPESA_CONSUMER_KEY", "MPESA_CONSUMER_SECRET", "MPESA_SHORTCODE", "MPESA_PASSKEY"],
        "MPESA_MODE=daraja",
      ),
    );
    const callback = value(env, "MPESA_CALLBACK_URL");
    if (!callback) {
      problems.push("MPESA_MODE=daraja: MPESA_CALLBACK_URL is empty");
    } else if (!isHttpsUrl(callback)) {
      problems.push("MPESA_MODE=daraja: MPESA_CALLBACK_URL must be a public https:// URL");
    }
  }

  const whatsapp = value(env, "WHATSAPP_MODE") || "mock";
  if (!MODES.whatsapp.includes(whatsapp as (typeof MODES.whatsapp)[number])) {
    problems.push(`WHATSAPP_MODE="${whatsapp}" is not one of ${MODES.whatsapp.join(" | ")}`);
  } else if (whatsapp === "cloud") {
    problems.push(
      ...requireAll(
        env,
        [
          "WHATSAPP_PHONE_NUMBER_ID",
          "WHATSAPP_ACCESS_TOKEN",
          "WHATSAPP_VERIFY_TOKEN",
          "WHATSAPP_APP_SECRET",
        ],
        "WHATSAPP_MODE=cloud",
      ),
    );
  }

  const meetings = value(env, "MEETINGS_MODE") || "mock";
  if (!MODES.meetings.includes(meetings as (typeof MODES.meetings)[number])) {
    problems.push(`MEETINGS_MODE="${meetings}" is not one of ${MODES.meetings.join(" | ")}`);
  }

  // The engine falls back to the offline adapter when no key is present. Make
  // that explicit: a real model id with no key is almost always a mistake.
  const model = value(env, "WAMBO_MODEL");
  if (model && model !== "mock" && !value(env, "OPENROUTER_API_KEY")) {
    problems.push(
      `WAMBO_MODEL="${model}" requires OPENROUTER_API_KEY (or set WAMBO_MODEL=mock for offline replies)`,
    );
  }

  return problems;
}

export function assertRuntimeEnv(env: EnvLike = process.env): void {
  const problems = missingRuntimeEnv(env);
  if (problems.length === 0) return;
  throw new Error(
    [
      "Configuration is incomplete; refusing to start.",
      ...problems.map((problem) => `  - ${problem}`),
      "Fill these in .env (see .env.example) or switch the mode back to mock.",
    ].join("\n"),
  );
}
