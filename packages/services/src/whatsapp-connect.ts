import { randomBytes } from "node:crypto";
import { and, eq, ne } from "drizzle-orm";
import { getDb, schema, withTenant } from "@garden/db";
import {
  WhatsAppError,
  checkConnection,
  decryptJson,
  encryptJson,
  exchangeSignupCode,
  getPhoneNumber,
  getWabaPhoneNumbers,
  hmacSha256Hex,
  registerNumber,
  requestAppDataSync,
  subscribeApp,
  unsubscribeApp,
  verifyHmacSha256,
  whatsappMode,
  type WhatsAppCreds,
} from "@garden/integrations";
import { ConflictError, NotFoundError, ValidationError } from "./types";

/**
 * Each business connects its OWN WhatsApp number through Meta's Embedded Signup. We only ever configure the Meta APP once
 * (app id, app secret, signup configuration); everything per customer (the number, its account id, its access token) is
 * collected during that flow and stored here, tied to that one business.
 *
 * Messages arrive knowing only the number they were sent to, so \`whatsapp_routes\` maps number to business without needing a
 * tenant context (and its primary key means a number can only ever belong to one business).
 */

/* ───────────────────────────── signed connect links ───────────────────────────── */

const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64url");
const unb64 = (s: string) => Buffer.from(s, "base64url").toString("utf8");

function signingSecret(): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new ValidationError("The server has no AUTH_SECRET configured.");
  return secret;
}

/**
 * A link a customer (or the Palda team, together with them) opens to connect WhatsApp. It names ONE business, expires, and is
 * signed, so it can't be altered to connect a number to a different business. It grants nothing else.
 */
export function createWhatsappConnectToken(tenantId: string, ttlHours = 72): string {
  const payload = b64(JSON.stringify({ p: "wa-connect", t: tenantId, e: Math.floor(Date.now() / 1000) + ttlHours * 3600, n: randomBytes(6).toString("hex") }));
  return `${payload}.${hmacSha256Hex(payload, signingSecret())}`;
}

export function verifyWhatsappConnectToken(token: string, now = Date.now()): { tenantId: string } | null {
  const [payload, sig, extra] = token.split(".");
  if (!payload || !sig || extra !== undefined) return null;
  let secret: string;
  try {
    secret = signingSecret();
  } catch {
    return null;
  }
  if (!verifyHmacSha256(payload, sig, secret)) return null;
  try {
    const data = JSON.parse(unb64(payload)) as { p?: string; t?: string; e?: number };
    if (data.p !== "wa-connect" || typeof data.t !== "string" || typeof data.e !== "number") return null;
    if (data.e * 1000 < now) return null;
    return { tenantId: data.t };
  } catch {
    return null;
  }
}

/* ───────────────────────────────── the connection ───────────────────────────────── */

export type WhatsappConnection = {
  /** "active" works; "attention" means the last check failed; "disconnected" means Meta or the customer ended it. */
  status: "active" | "attention" | "disconnected";
  /** "coexistence": the customer keeps using the WhatsApp Business app on the same number. "cloud_api": the number is ours only. */
  mode: "coexistence" | "cloud_api";
  displayPhone: string;
  verifiedName: string;
  phoneNumberId: string;
  wabaId: string;
  qualityRating: string | null;
  connectedAt: Date | null;
  lastCheckedAt: Date | null;
  lastError: string | null;
  /** Coexistence only: whether the one-time contacts and history sync was requested. */
  sync: { contacts: string | null; history: string | null } | null;
};

function present(meta: Record<string, unknown>): WhatsappConnection {
  const s = (v: unknown) => (typeof v === "string" ? v : "");
  const d = (v: unknown) => (typeof v === "string" && v ? new Date(v) : null);
  const sync = meta.sync && typeof meta.sync === "object" ? (meta.sync as Record<string, unknown>) : null;
  return {
    status: meta.status === "disconnected" ? "disconnected" : meta.status === "attention" ? "attention" : "active",
    mode: meta.mode === "coexistence" ? "coexistence" : "cloud_api",
    displayPhone: s(meta.displayPhone),
    verifiedName: s(meta.verifiedName),
    phoneNumberId: s(meta.phoneNumberId),
    wabaId: s(meta.wabaId),
    qualityRating: s(meta.qualityRating) || null,
    connectedAt: d(meta.connectedAt),
    lastCheckedAt: d(meta.lastCheckedAt),
    lastError: s(meta.lastError) || null,
    sync: sync ? { contacts: s(sync.contacts) || null, history: s(sync.history) || null } : null,
  };
}

async function requireTenant(tenantId: string) {
  const tenant = await getDb().query.tenants.findFirst({ where: eq(schema.tenants.id, tenantId) });
  if (!tenant) throw new NotFoundError("Customer", tenantId);
  return tenant;
}

async function integrationRow(tenantId: string) {
  return withTenant(tenantId, (tx) =>
    tx.query.tenantIntegrations.findFirst({
      where: and(eq(schema.tenantIntegrations.tenantId, tenantId), eq(schema.tenantIntegrations.kind, "whatsapp")),
    }),
  );
}

/** What the Engine and the customer's app show. Carries no token. */
export async function getWhatsappConnection(tenantId: string): Promise<WhatsappConnection | null> {
  const row = await integrationRow(tenantId);
  return row ? present(row.meta) : null;
}

/* ───────────────────────────── credentials, per business ───────────────────────────── */

const credCache = new Map<string, { creds: WhatsAppCreds | null; expires: number }>();
const CRED_TTL_MS = 60_000;
export function clearWhatsappCredCache(tenantId?: string): void {
  if (tenantId) credCache.delete(tenantId);
  else credCache.clear();
}

/**
 * The credentials to send this business's messages with, or null when WhatsApp isn't connected for it. Each business only ever
 * gets ITS OWN token. The single-number environment credentials are used only for the default business, so a development setup
 * with one number keeps working, and never for any other business.
 */
export async function getWhatsappCreds(tenantId: string): Promise<WhatsAppCreds | null> {
  const hit = credCache.get(tenantId);
  if (hit && hit.expires > Date.now()) return hit.creds;

  let creds: WhatsAppCreds | null = null;
  const row = await integrationRow(tenantId);
  if (row && row.meta.status !== "disconnected") {
    try {
      const secret = decryptJson<{ accessToken?: string }>(row.configEncrypted);
      const phoneNumberId = typeof row.meta.phoneNumberId === "string" ? row.meta.phoneNumberId : "";
      if (secret.accessToken && phoneNumberId) creds = { phoneNumberId, accessToken: secret.accessToken };
    } catch {
      creds = null;
    }
  } else if (!row) {
    const tenant = await getDb().query.tenants.findFirst({ where: eq(schema.tenants.id, tenantId) });
    const slug = process.env.DEFAULT_TENANT_SLUG ?? "palda";
    if (tenant?.slug === slug && process.env.WHATSAPP_PHONE_NUMBER_ID && process.env.WHATSAPP_ACCESS_TOKEN) {
      creds = { phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID, accessToken: process.env.WHATSAPP_ACCESS_TOKEN };
    }
  }
  credCache.set(tenantId, { creds, expires: Date.now() + CRED_TTL_MS });
  return creds;
}

/* ───────────────────────────────────── routing ───────────────────────────────────── */

/** Which business owns this WhatsApp number? Works without a tenant context. */
export async function routeWhatsappNumber(phoneNumberId: string): Promise<{ tenantId: string } | null> {
  const row = await getDb().query.whatsappRoutes.findFirst({ where: eq(schema.whatsappRoutes.phoneNumberId, phoneNumberId) });
  return row ? { tenantId: row.tenantId } : null;
}

/** Which businesses use this WhatsApp account? (account-level updates carry the account id, not a number) */
export async function routeWhatsappAccount(wabaId: string): Promise<string[]> {
  const rows = await getDb().query.whatsappRoutes.findMany({ where: eq(schema.whatsappRoutes.wabaId, wabaId) });
  return [...new Set(rows.map((r) => r.tenantId))];
}

/* ─────────────────────────────────── connecting ─────────────────────────────────── */

export type SignupInput = {
  /** The short-lived code from Meta's popup. */
  code: string;
  wabaId: string | null;
  phoneNumberId: string | null;
  businessId?: string | null;
  /** True for the "connect an existing WhatsApp Business app number" flow. */
  coexistence?: boolean;
};

const friendly = (error: unknown, fallback: string) => (error instanceof WhatsAppError ? error.message : fallback);

/**
 * Finishes a signup. The order matters: exchange the code (it expires in ~30 s), look the number up, CLAIM it for this business
 * (so it can't also be connected to another), then subscribe to its webhooks and, for a non-coexistence number only, register it.
 * If a later step fails the claim is released and nothing is stored.
 */
export async function completeWhatsappSignup(by: string, tenantId: string, input: SignupInput): Promise<WhatsappConnection> {
  await requireTenant(tenantId);
  const code = input.code.trim();
  if (!code || code.length > 4000) throw new ValidationError("WhatsApp didn't send a sign-up code. Please try connecting again.");
  const wabaId = (input.wabaId ?? "").trim();
  if (!wabaId) throw new ValidationError("WhatsApp didn't say which account was connected. Please try again.");

  let token: Awaited<ReturnType<typeof exchangeSignupCode>>;
  try {
    token = await exchangeSignupCode(code);
  } catch (error) {
    throw new ValidationError(friendly(error, "Couldn't complete the WhatsApp sign-up. Please try again."));
  }

  let phoneNumberId = (input.phoneNumberId ?? "").trim();
  let details: Awaited<ReturnType<typeof getPhoneNumber>>;
  try {
    if (!phoneNumberId) {
      const numbers = await getWabaPhoneNumbers(wabaId, token.accessToken);
      if (numbers.length === 0) throw new ValidationError("No phone number was added to that WhatsApp account.");
      phoneNumberId = numbers[0]!.id;
    }
    details = await getPhoneNumber(phoneNumberId, token.accessToken);
  } catch (error) {
    if (error instanceof ValidationError) throw error;
    throw new ValidationError(friendly(error, "Couldn't read the connected WhatsApp number."));
  }
  const coexistence = Boolean(input.coexistence) || details.isOnBizApp === true;

  // Claim the number for this business FIRST. The primary key makes this atomic.
  const claimed = await getDb()
    .insert(schema.whatsappRoutes)
    .values({ phoneNumberId, tenantId, wabaId })
    .onConflictDoNothing()
    .returning({ phoneNumberId: schema.whatsappRoutes.phoneNumberId });
  const newlyClaimed = claimed.length > 0;
  if (!newlyClaimed) {
    const existing = await getDb().query.whatsappRoutes.findFirst({ where: eq(schema.whatsappRoutes.phoneNumberId, phoneNumberId) });
    if (existing && existing.tenantId !== tenantId) {
      throw new ConflictError("This WhatsApp number is already connected to another business.");
    }
    if (existing) await getDb().update(schema.whatsappRoutes).set({ wabaId }).where(eq(schema.whatsappRoutes.phoneNumberId, phoneNumberId));
  }

  let pin: string | undefined;
  try {
    await subscribeApp(wabaId, token.accessToken);
    if (!coexistence) {
      // A coexistence number is already registered; registering it again would break the customer's app. Only a new number needs this.
      pin = String(100000 + (randomBytes(4).readUInt32BE() % 900000));
      await registerNumber(phoneNumberId, token.accessToken, pin);
    }
  } catch (error) {
    if (newlyClaimed) await getDb().delete(schema.whatsappRoutes).where(eq(schema.whatsappRoutes.phoneNumberId, phoneNumberId));
    throw new ValidationError(friendly(error, "Couldn't finish connecting that number to WhatsApp."));
  }

  // Coexistence: ask Meta for the contacts and history, once. This can't be repeated later without reconnecting.
  let sync: { contacts: string | null; history: string | null } | null = null;
  if (coexistence) {
    sync = { contacts: null, history: null };
    try {
      sync.contacts = await requestAppDataSync(phoneNumberId, token.accessToken, "smb_app_state_sync");
      sync.history = await requestAppDataSync(phoneNumberId, token.accessToken, "history");
    } catch (error) {
      console.error("[whatsapp] coexistence sync request failed", error instanceof Error ? error.message : error);
    }
  }

  const now = new Date().toISOString();
  const meta: Record<string, unknown> = {
    source: "embedded_signup",
    status: "active",
    mode: coexistence ? "coexistence" : "cloud_api",
    phoneNumberId,
    wabaId,
    businessId: input.businessId ?? null,
    displayPhone: details.displayPhoneNumber,
    verifiedName: details.verifiedName,
    qualityRating: details.qualityRating,
    connectedAt: now,
    lastCheckedAt: now,
    tokenExpiresAt: token.expiresInSec ? new Date(Date.now() + token.expiresInSec * 1000).toISOString() : null,
    ...(sync ? { sync } : {}),
  };
  const configEncrypted = encryptJson({ accessToken: token.accessToken, ...(pin ? { pin } : {}) });

  await withTenant(tenantId, async (tx) => {
    await tx
      .insert(schema.tenantIntegrations)
      .values({ tenantId, kind: "whatsapp", configEncrypted, meta })
      .onConflictDoUpdate({
        target: [schema.tenantIntegrations.tenantId, schema.tenantIntegrations.kind],
        set: { configEncrypted, meta },
      });
    await tx.insert(schema.auditLog).values({
      tenantId,
      actor: by,
      action: "whatsapp.connected",
      entity: "whatsapp",
      entityId: phoneNumberId,
      diff: { mode: meta.mode, displayPhone: details.displayPhoneNumber, wabaId },
    });
  });
  // If this business had a different number before, release it so it can be used elsewhere.
  await getDb()
    .delete(schema.whatsappRoutes)
    .where(and(eq(schema.whatsappRoutes.tenantId, tenantId), ne(schema.whatsappRoutes.phoneNumberId, phoneNumberId)));
  clearWhatsappCredCache(tenantId);
  return present(meta);
}

/** Ends the connection on our side. For a coexistence number the customer must also remove it from their WhatsApp Business app. */
export async function disconnectWhatsapp(by: string, tenantId: string): Promise<void> {
  const row = await integrationRow(tenantId);
  if (!row) return;
  try {
    const { accessToken } = decryptJson<{ accessToken?: string }>(row.configEncrypted);
    const wabaId = typeof row.meta.wabaId === "string" ? row.meta.wabaId : "";
    if (accessToken && wabaId && row.meta.mode !== "coexistence") await unsubscribeApp(wabaId, accessToken);
  } catch {
    /* best effort: the connection is removed on our side regardless */
  }
  await getDb().delete(schema.whatsappRoutes).where(eq(schema.whatsappRoutes.tenantId, tenantId));
  await withTenant(tenantId, async (tx) => {
    await tx
      .delete(schema.tenantIntegrations)
      .where(and(eq(schema.tenantIntegrations.tenantId, tenantId), eq(schema.tenantIntegrations.kind, "whatsapp")));
    await tx.insert(schema.auditLog).values({
      tenantId,
      actor: by,
      action: "whatsapp.disconnected",
      entity: "whatsapp",
      entityId: typeof row.meta.phoneNumberId === "string" ? row.meta.phoneNumberId : null,
    });
  });
  clearWhatsappCredCache(tenantId);
}

/** Re-reads the number from Meta to prove the stored token still works, and updates its status and quality. Never throws. */
export async function refreshWhatsappConnection(by: string, tenantId: string): Promise<WhatsappConnection | null> {
  const row = await integrationRow(tenantId);
  if (!row) return null;
  const phoneNumberId = typeof row.meta.phoneNumberId === "string" ? row.meta.phoneNumberId : "";
  let accessToken = "";
  try {
    accessToken = decryptJson<{ accessToken?: string }>(row.configEncrypted).accessToken ?? "";
  } catch {
    /* handled below */
  }
  const result = accessToken && phoneNumberId ? await checkConnection(phoneNumberId, accessToken) : { ok: false as const, error: "No saved access token." };
  const meta: Record<string, unknown> = {
    ...row.meta,
    lastCheckedAt: new Date().toISOString(),
    status: row.meta.status === "disconnected" ? "disconnected" : result.ok ? "active" : "attention",
    lastError: result.ok ? null : (result.error ?? "The connection check failed."),
    ...(result.ok && result.details ? { qualityRating: result.details.qualityRating, displayPhone: result.details.displayPhoneNumber || row.meta.displayPhone } : {}),
  };
  await withTenant(tenantId, async (tx) => {
    await tx
      .update(schema.tenantIntegrations)
      .set({ meta })
      .where(and(eq(schema.tenantIntegrations.tenantId, tenantId), eq(schema.tenantIntegrations.kind, "whatsapp")));
    await tx.insert(schema.auditLog).values({ tenantId, actor: by, action: "whatsapp.checked", entity: "whatsapp", entityId: phoneNumberId, diff: { ok: result.ok } });
  });
  clearWhatsappCredCache(tenantId);
  return present(meta);
}

/** Meta told us the customer or Meta ended the connection (for example the WhatsApp Business app was idle too long). Stop sending. */
export async function markWhatsappDisconnected(tenantId: string, reason: string): Promise<void> {
  const row = await integrationRow(tenantId);
  if (!row) return;
  const meta = { ...row.meta, status: "disconnected", lastError: reason.slice(0, 200), lastCheckedAt: new Date().toISOString() };
  await withTenant(tenantId, async (tx) => {
    await tx
      .update(schema.tenantIntegrations)
      .set({ meta })
      .where(and(eq(schema.tenantIntegrations.tenantId, tenantId), eq(schema.tenantIntegrations.kind, "whatsapp")));
    await tx.insert(schema.auditLog).values({ tenantId, actor: "whatsapp:meta", action: "whatsapp.disconnected_by_meta", entity: "whatsapp", diff: { reason: reason.slice(0, 200) } });
  });
  clearWhatsappCredCache(tenantId);
}

/** True when real WhatsApp is switched on for this server (not mock mode). */
export const whatsappIsLive = () => whatsappMode() === "cloud";
