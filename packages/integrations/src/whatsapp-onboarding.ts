import { graphVersion, whatsappMode, WhatsAppError } from "./whatsapp";
import { platformSetting } from "./platform-settings";

/**
 * Meta's Embedded Signup, server side. A customer connects their own WhatsApp number through a Meta popup; Meta hands our page a
 * short-lived code (it expires in about 30 seconds), which we exchange for a token for THAT customer's WhatsApp account, then
 * subscribe to its webhooks. Only the app-level credentials below are ours to configure; everything else is per customer.
 *
 * Coexistence: when the number is already used in the WhatsApp Business app, the customer keeps using that app AND our agent
 * works on the same number. Such a number is already registered (so we must not register it again), and Meta lets us pull the
 * contacts and message history ONCE, within 24 hours of connecting.
 *
 * Mock mode (WHATSAPP_MODE=mock) answers every call locally with fake data so the whole flow can be developed and tested without
 * a Meta app. A phone number id that starts with "mock_coex" behaves like a coexistence number.
 */

export type MetaAppConfig = { appId: string | null; appSecret: string | null; configId: string | null };

export function metaConfig(): MetaAppConfig {
  return {
    appId: platformSetting("META_APP_ID") ?? null,
    appSecret: platformSetting("META_APP_SECRET") ?? null,
    configId: platformSetting("META_ES_CONFIG_ID") ?? null,
  };
}

/** Whether Embedded Signup can run here: always in mock mode, otherwise the three Meta app values must be set. */
export function embeddedSignupReady(): boolean {
  if (whatsappMode() === "mock") return true;
  const c = metaConfig();
  return Boolean(c.appId && c.appSecret && c.configId);
}

export type SignupToken = { accessToken: string; expiresInSec: number | null };
export type PhoneDetails = {
  id: string;
  displayPhoneNumber: string;
  verifiedName: string;
  qualityRating: string | null;
  platformType: string | null;
  /** True when the number is also used in the WhatsApp Business app (coexistence). null when Meta didn't say. */
  isOnBizApp: boolean | null;
};

const rand = () => Math.random().toString(36).slice(2, 10);

type GraphError = { error?: { message?: string; code?: number; error_subcode?: number } };

async function graph<T>(method: "GET" | "POST" | "DELETE", path: string, token: string | null, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`https://graph.facebook.com/${graphVersion()}/${path}`, {
      method,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    // Never surface the underlying error: for the token exchange its URL carries the app secret.
    throw new WhatsAppError("Couldn't reach WhatsApp. Try again in a moment.");
  }
  const json = (await res.json().catch(() => ({}))) as T & GraphError;
  if (!res.ok) {
    const message = json.error?.message ?? `WhatsApp returned an error (${res.status}).`;
    throw new WhatsAppError(message, { status: res.status, code: json.error?.code, subcode: json.error?.error_subcode });
  }
  return json;
}

/** Trades the short-lived Embedded Signup code for the customer's token. Must be called right away (the code lives ~30 s). */
export async function exchangeSignupCode(code: string): Promise<SignupToken> {
  if (whatsappMode() === "mock") {
    if (!code.startsWith("mock")) throw new WhatsAppError("That sign-up code isn't valid.");
    return { accessToken: `mock_token_${rand()}`, expiresInSec: null };
  }
  const { appId, appSecret } = metaConfig();
  if (!appId || !appSecret) throw new WhatsAppError("The Meta app isn't configured. Add the app ID and secret in the Engine under Settings.");
  const url = `oauth/access_token?client_id=${encodeURIComponent(appId)}&client_secret=${encodeURIComponent(appSecret)}&code=${encodeURIComponent(code)}`;
  const json = await graph<{ access_token?: string; expires_in?: number }>("GET", url, null);
  if (!json.access_token) throw new WhatsAppError("WhatsApp didn't return an access token.");
  return { accessToken: json.access_token, expiresInSec: typeof json.expires_in === "number" ? json.expires_in : null };
}

/** The numbers on a customer's WhatsApp Business Account. */
export async function getWabaPhoneNumbers(wabaId: string, token: string): Promise<PhoneDetails[]> {
  if (whatsappMode() === "mock") {
    return [{ id: `mock_pn_${wabaId}`, displayPhoneNumber: "+254 700 000 000", verifiedName: "Mock Business", qualityRating: "GREEN", platformType: "CLOUD_API", isOnBizApp: false }];
  }
  const json = await graph<{ data?: Record<string, unknown>[] }>("GET", `${encodeURIComponent(wabaId)}/phone_numbers?fields=id,display_phone_number,verified_name,quality_rating`, token);
  return (json.data ?? []).map((n) => ({
    id: String(n.id),
    displayPhoneNumber: String(n.display_phone_number ?? ""),
    verifiedName: String(n.verified_name ?? ""),
    qualityRating: n.quality_rating ? String(n.quality_rating) : null,
    platformType: null,
    isOnBizApp: null,
  }));
}

/** One number's details, including whether it is also on the WhatsApp Business app. Falls back to the basics if Meta refuses a field. */
export async function getPhoneNumber(phoneNumberId: string, token: string): Promise<PhoneDetails> {
  if (whatsappMode() === "mock") {
    const coex = phoneNumberId.startsWith("mock_coex");
    return {
      id: phoneNumberId,
      displayPhoneNumber: "+254 700 000 000",
      verifiedName: "Mock Business",
      qualityRating: "GREEN",
      platformType: "CLOUD_API",
      isOnBizApp: coex,
    };
  }
  const id = encodeURIComponent(phoneNumberId);
  let json: Record<string, unknown>;
  try {
    json = await graph<Record<string, unknown>>("GET", `${id}?fields=display_phone_number,verified_name,quality_rating,platform_type,is_on_biz_app`, token);
  } catch {
    json = await graph<Record<string, unknown>>("GET", `${id}?fields=display_phone_number,verified_name,quality_rating`, token);
  }
  return {
    id: phoneNumberId,
    displayPhoneNumber: String(json.display_phone_number ?? ""),
    verifiedName: String(json.verified_name ?? ""),
    qualityRating: json.quality_rating ? String(json.quality_rating) : null,
    platformType: json.platform_type ? String(json.platform_type) : null,
    isOnBizApp: typeof json.is_on_biz_app === "boolean" ? json.is_on_biz_app : null,
  };
}

/** Subscribes our app to the customer's WhatsApp account, so their messages reach our webhook. */
export async function subscribeApp(wabaId: string, token: string): Promise<void> {
  if (whatsappMode() === "mock") return;
  await graph("POST", `${encodeURIComponent(wabaId)}/subscribed_apps`, token);
}

export async function unsubscribeApp(wabaId: string, token: string): Promise<void> {
  if (whatsappMode() === "mock") return;
  await graph("DELETE", `${encodeURIComponent(wabaId)}/subscribed_apps`, token);
}

/** Registers a NEW (non-coexistence) number for the Cloud API with a two-step-verification PIN. Never call this for a coexistence number. */
export async function registerNumber(phoneNumberId: string, token: string, pin: string): Promise<void> {
  if (whatsappMode() === "mock") return;
  await graph("POST", `${encodeURIComponent(phoneNumberId)}/register`, token, { messaging_product: "whatsapp", pin });
}

export type AppDataSyncType = "smb_app_state_sync" | "history";

/**
 * Coexistence only: asks Meta to send the number's contacts ("smb_app_state_sync") or message history ("history") to our webhook.
 * Each can be requested only ONCE, and only within 24 hours of connecting. Returns Meta's request id.
 */
export async function requestAppDataSync(phoneNumberId: string, token: string, syncType: AppDataSyncType): Promise<string | null> {
  if (whatsappMode() === "mock") return `mock_sync_${syncType}_${rand()}`;
  const json = await graph<{ request_id?: string }>("POST", `${encodeURIComponent(phoneNumberId)}/smb_app_data`, token, {
    messaging_product: "whatsapp",
    sync_type: syncType,
  });
  return json.request_id ?? null;
}

/** Is the stored token still good? Used by "Check connection". Never throws. */
export async function checkConnection(phoneNumberId: string, token: string): Promise<{ ok: boolean; details?: PhoneDetails; error?: string }> {
  try {
    return { ok: true, details: await getPhoneNumber(phoneNumberId, token) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Couldn't check the connection." };
  }
}

export { parseSignupMessage, type SignupMessage } from "./whatsapp-signup-message";

/** Proves an app ID and secret belong together, using an app access token ("<id>|<secret>"). Never throws. */
export async function checkMetaApp(appId: string, appSecret: string): Promise<{ ok: boolean; name?: string; error?: string }> {
  if (!appId || !appSecret) return { ok: false, error: "Both the app ID and the app secret are needed." };
  try {
    const res = await fetch(
      `https://graph.facebook.com/${graphVersion()}/${encodeURIComponent(appId)}?fields=id,name&access_token=${encodeURIComponent(`${appId}|${appSecret}`)}`,
    );
    const json = (await res.json().catch(() => ({}))) as { id?: string; name?: string; error?: { message?: string } };
    if (!res.ok || json.id !== appId) return { ok: false, error: json.error?.message ?? "Meta didn't accept that app ID and secret." };
    return { ok: true, name: json.name };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Couldn't reach Meta." };
  }
}
