/**
 * Platform settings the Palda team can change from the Engine (Settings) instead of editing `.env` on the server.
 *
 * A value saved in the Engine wins; a key left empty there falls back to the environment. The values live in the database
 * (encrypted) and every process loads them into this store at start and every ~30 seconds (see `startPlatformSettingsSync` in
 * @garden/services). Reads stay synchronous, so existing callers are unchanged.
 *
 * The store sits on `globalThis` on purpose: Next.js bundles instrumentation, route handlers and server actions separately, and
 * each bundle has its own copy of this module. One store per process means a value loaded once is seen everywhere.
 */

export const PLATFORM_KEYS = {
  WHATSAPP_MODE: { label: "WhatsApp mode", secret: false },
  META_APP_ID: { label: "Meta app ID", secret: false },
  META_APP_SECRET: { label: "Meta app secret", secret: true },
  META_ES_CONFIG_ID: { label: "Embedded Signup configuration ID", secret: false },
  // Not a credential: it only answers Meta's one-time webhook handshake, and admins must be able to copy it into Meta.
  WHATSAPP_VERIFY_TOKEN: { label: "Webhook verify token", secret: false },
  WHATSAPP_GRAPH_VERSION: { label: "Graph API version", secret: false },
  // Apps the customer connects with OAuth from their own app (Google Workspace, Zoho Books, Zoho CRM). One OAuth client per
  // vendor serves every customer; each customer's own tokens are stored per business, encrypted.
  INTEGRATIONS_MODE: { label: "Apps mode", secret: false },
  GOOGLE_CLIENT_ID: { label: "Google OAuth client ID", secret: false },
  GOOGLE_CLIENT_SECRET: { label: "Google OAuth client secret", secret: true },
  ZOHO_CLIENT_ID: { label: "Zoho OAuth client ID", secret: false },
  ZOHO_CLIENT_SECRET: { label: "Zoho OAuth client secret", secret: true },
} as const;

/** Which Settings panel a key belongs on. */
export const PLATFORM_KEY_SECTION: Record<keyof typeof PLATFORM_KEYS, "whatsapp" | "apps"> = {
  WHATSAPP_MODE: "whatsapp",
  META_APP_ID: "whatsapp",
  META_APP_SECRET: "whatsapp",
  META_ES_CONFIG_ID: "whatsapp",
  WHATSAPP_VERIFY_TOKEN: "whatsapp",
  WHATSAPP_GRAPH_VERSION: "whatsapp",
  INTEGRATIONS_MODE: "apps",
  GOOGLE_CLIENT_ID: "apps",
  GOOGLE_CLIENT_SECRET: "apps",
  ZOHO_CLIENT_ID: "apps",
  ZOHO_CLIENT_SECRET: "apps",
};

export type PlatformKey = keyof typeof PLATFORM_KEYS;

/** Older names that mean the same thing, still honoured in `.env`. */
const ENV_ALIASES: Partial<Record<PlatformKey, string[]>> = { META_APP_SECRET: ["WHATSAPP_APP_SECRET"] };

type Store = { values: Partial<Record<PlatformKey, string>>; loadedAt: number | null };
const KEY = Symbol.for("palda.platformSettings");
function store(): Store {
  const g = globalThis as unknown as Record<symbol, Store | undefined>;
  if (!g[KEY]) g[KEY] = { values: {}, loadedAt: null };
  return g[KEY]!;
}

export function applyPlatformSettings(values: Partial<Record<PlatformKey, string>>): void {
  const s = store();
  s.values = { ...values };
  s.loadedAt = Date.now();
}

/** The value the server's environment gives, ignoring anything saved in the Engine. */
export function platformSettingFromEnv(key: PlatformKey): string | undefined {
  for (const name of [key, ...(ENV_ALIASES[key] ?? [])]) {
    const v = process.env[name]?.trim();
    if (v) return v;
  }
  return undefined;
}

/** The effective value: saved in the Engine, else the environment, else undefined. */
export function platformSetting(key: PlatformKey): string | undefined {
  const saved = store().values[key]?.trim();
  return saved || platformSettingFromEnv(key);
}

export function platformSettingSource(key: PlatformKey): "engine" | "env" | "unset" {
  if (store().values[key]?.trim()) return "engine";
  return platformSettingFromEnv(key) ? "env" : "unset";
}

export function platformSettingsLoadedAt(): number | null {
  return store().loadedAt;
}
