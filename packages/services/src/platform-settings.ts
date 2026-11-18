import { inArray } from "drizzle-orm";
import { getDb, schema } from "@garden/db";
import {
  PLATFORM_KEYS,
  applyPlatformSettings,
  checkMetaApp,
  decryptJson,
  encryptJson,
  platformSetting,
  platformSettingFromEnv,
  platformSettingSource,
  randomToken,
  type PlatformKey,
} from "@garden/integrations";
import { ValidationError } from "./types";

/**
 * The Meta / WhatsApp platform settings, edited in the Engine. See `platform-settings.ts` in @garden/integrations for how a
 * saved value reaches the code: every process loads them at start and refreshes every 30 seconds, and the process that saves
 * applies them at once.
 */

const KEYS = Object.keys(PLATFORM_KEYS) as PlatformKey[];
const isKey = (k: string): k is PlatformKey => (KEYS as string[]).includes(k);

export async function loadPlatformSettings(): Promise<void> {
  const rows = await getDb().select().from(schema.platformSettings);
  const values: Partial<Record<PlatformKey, string>> = {};
  for (const row of rows) {
    if (!isKey(row.key)) continue;
    try {
      values[row.key] = decryptJson<{ v: string }>(row.valueEncrypted).v;
    } catch {
      console.error(`[settings] could not decrypt ${row.key}; is ENCRYPTION_KEY the same on every server?`);
    }
  }
  applyPlatformSettings(values);
}

const SYNC = Symbol.for("palda.platformSettingsSync");

/** Loads the settings now and every `intervalMs`. Safe to call more than once; a failed load keeps the last good values. */
export async function startPlatformSettingsSync(intervalMs = 30_000): Promise<void> {
  const g = globalThis as unknown as Record<symbol, NodeJS.Timeout | undefined>;
  try {
    await loadPlatformSettings();
  } catch (error) {
    console.error("[settings] initial load failed, using .env only", error instanceof Error ? error.message : error);
  }
  if (g[SYNC]) return;
  g[SYNC] = setInterval(() => {
    loadPlatformSettings().catch((error) => console.error("[settings] refresh failed", error instanceof Error ? error.message : error));
  }, intervalMs);
  g[SYNC].unref?.();
}

export type PlatformSettingView = {
  key: PlatformKey;
  label: string;
  secret: boolean;
  /** Where the value in use comes from. */
  source: "engine" | "env" | "unset";
  /** The value, for non-secret keys only. */
  value: string | null;
  /** For secrets: "set" and the last four characters, never the value. */
  hint: string | null;
};

export function getPlatformSettingsView(): PlatformSettingView[] {
  return KEYS.map((key) => {
    const meta = PLATFORM_KEYS[key];
    const v = platformSetting(key) ?? null;
    return {
      key,
      label: meta.label,
      secret: meta.secret,
      source: platformSettingSource(key),
      value: meta.secret ? null : v,
      hint: meta.secret && v ? (v.length > 8 ? `…${v.slice(-4)}` : "set") : null,
    };
  });
}

export type PlatformSettingsInput = {
  /** New values. For a secret, an empty string means "keep what is there". */
  values: Partial<Record<PlatformKey, string>>;
  /** Keys to remove from the Engine, so the server's .env value (if any) is used again. */
  clear?: PlatformKey[];
};

function validate(key: PlatformKey, v: string): string {
  const value = v.trim();
  if (value.length > 500) throw new ValidationError(`${PLATFORM_KEYS[key].label} is too long.`);
  if (key === "WHATSAPP_MODE" && value !== "mock" && value !== "cloud") throw new ValidationError("WhatsApp mode must be mock or cloud.");
  if (key === "META_APP_ID" && !/^\d{5,25}$/.test(value)) throw new ValidationError("The Meta app ID is a number (Meta app > Settings > Basic).");
  if (key === "META_ES_CONFIG_ID" && !/^\d{5,25}$/.test(value)) throw new ValidationError("The Embedded Signup configuration ID is a number (Facebook Login for Business > Configurations).");
  if (key === "WHATSAPP_GRAPH_VERSION" && !/^v\d{1,3}\.\d$/.test(value)) throw new ValidationError('The Graph API version looks like "v21.0".');
  if (key === "WHATSAPP_VERIFY_TOKEN" && value.length < 12) throw new ValidationError("Use a verify token of at least 12 characters (or generate one).");
  return value;
}

/**
 * Saves settings from the Engine. Switching WhatsApp to live ("cloud") is refused unless everything it needs is set, so the
 * platform can't be put into a half-configured state from the browser.
 */
export async function savePlatformSettings(by: string, input: PlatformSettingsInput): Promise<void> {
  const writes: { key: PlatformKey; value: string }[] = [];
  for (const [key, raw] of Object.entries(input.values)) {
    if (!isKey(key) || raw === undefined) continue;
    if (PLATFORM_KEYS[key].secret && raw.trim() === "") continue; // blank secret = keep
    if (!PLATFORM_KEYS[key].secret && raw.trim() === "") continue; // blank field = unchanged; use "clear" to remove
    const value = validate(key, raw);
    if (value === platformSetting(key)) continue; // already in use (for example from .env): nothing to save
    writes.push({ key, value });
  }
  const clear = (input.clear ?? []).filter(isKey).filter((k) => !writes.some((w) => w.key === k));

  // What the settings would be after this save.
  const after = (key: PlatformKey): string | undefined => {
    const w = writes.find((x) => x.key === key);
    if (w) return w.value;
    if (clear.includes(key)) return platformSettingFromEnv(key);
    return platformSetting(key);
  };
  if (after("WHATSAPP_MODE") === "cloud") {
    const missing = (["META_APP_ID", "META_APP_SECRET", "META_ES_CONFIG_ID", "WHATSAPP_VERIFY_TOKEN"] as PlatformKey[]).filter((k) => !after(k));
    if (missing.length) {
      throw new ValidationError(`Live WhatsApp needs: ${missing.map((k) => PLATFORM_KEYS[k].label).join(", ")}.`);
    }
  }

  const db = getDb();
  await db.transaction(async (tx) => {
    for (const w of writes) {
      const valueEncrypted = encryptJson({ v: w.value });
      await tx
        .insert(schema.platformSettings)
        .values({ key: w.key, valueEncrypted, updatedBy: by, updatedAt: new Date() })
        .onConflictDoUpdate({ target: schema.platformSettings.key, set: { valueEncrypted, updatedBy: by, updatedAt: new Date() } });
    }
    if (clear.length) await tx.delete(schema.platformSettings).where(inArray(schema.platformSettings.key, clear));
  });
  await loadPlatformSettings();
  // Which keys changed, never their values.
  console.log(`[settings] ${by} saved ${writes.map((w) => w.key).join(", ") || "nothing"}${clear.length ? `; cleared ${clear.join(", ")}` : ""}`);
}

export function newVerifyToken(): string {
  return randomToken(24);
}

/** Checks the app ID and secret in use against Meta. */
export async function checkPlatformMetaApp(): Promise<{ ok: boolean; name?: string; error?: string }> {
  return checkMetaApp(platformSetting("META_APP_ID") ?? "", platformSetting("META_APP_SECRET") ?? "");
}

export async function platformSettingsUpdatedAt(): Promise<Record<string, { by: string | null; at: Date }>> {
  const rows = await getDb().select({ key: schema.platformSettings.key, by: schema.platformSettings.updatedBy, at: schema.platformSettings.updatedAt }).from(schema.platformSettings);
  return Object.fromEntries(rows.map((r) => [r.key, { by: r.by, at: r.at }]));
}
