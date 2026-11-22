import { and, eq, inArray } from "drizzle-orm";
import { schema, withTenant } from "@garden/db";
import {
  AppApiError,
  decryptJson,
  encryptJson,
  exchangeOAuthCode,
  googleAccountEmail,
  integrationsMode,
  isOAuthApp,
  normaliseOdooUrl,
  oauthAppReady,
  odooTest,
  refreshOAuthTokens,
  revokeOAuthTokens,
  zohoBooksOrganizations,
  zohoCrmOrgName,
  ExternalMcpError,
  type OAuthAppId,
  type OAuthTokens,
  type OdooRef,
  type ZohoBooksRef,
  type ZohoRef,
} from "@garden/integrations";
import { audit, type ServiceContext } from "./context";
import { APPS, APP_IDS, appInfo, type AppId, type AppInfo } from "./integrations-catalog";
import { ServiceError, ValidationError, requireOwner } from "./types";

/**
 * Per-business connections to the apps Palda CX works with natively (Google Workspace, Zoho Books, Zoho CRM, Odoo).
 *
 * Stored in `tenant_integrations` (one row per business per app, `kind` = the app id): the tokens or API key encrypted in
 * `config_encrypted`, and only non-secret facts (status, which account) in `meta`. Nothing here ever returns a secret to a page.
 *
 * Who connects what: OAuth apps are connected by the business OWNER from their own app; API-key apps by the Palda team in the
 * Engine. The agent's tools reach an app only through `withApp`, which refreshes tokens and marks a broken connection.
 */

type ConnectionMeta = {
  status: "connected" | "attention";
  /** The signed-in account or organisation, shown so people can tell which one is connected. */
  account: string | null;
  /** Zoho Books organisation the tools act in. */
  organizationId?: string;
  connectedAt: string;
  connectedBy: string;
  lastError: string | null;
  lastUsedAt?: string;
  mock: boolean;
};

export class AppNotConnectedError extends ServiceError {
  constructor(app: AppId) {
    super("NOT_CONNECTED", `${appInfo(app).name} isn't connected for this business.`, 409);
    this.name = "AppNotConnectedError";
  }
}

export class AppUnavailableError extends ServiceError {
  constructor(app: AppId, message: string) {
    super("APP_ERROR", `${appInfo(app).name}: ${message}`, 502);
    this.name = "AppUnavailableError";
  }
}

/* ───────────────────────────────── views ───────────────────────────────── */

export type AppConnectionView = AppInfo & {
  status: "connected" | "attention" | "not_connected";
  account: string | null;
  connectedAt: Date | null;
  lastError: string | null;
  /** Connected in mock mode (sample data, nothing reaches the app). */
  mock: boolean;
  /** For OAuth apps: whether the platform is set up so an owner can connect it now. */
  canConnect: boolean;
};

function view(app: AppInfo, row: { meta: Record<string, unknown> } | undefined): AppConnectionView {
  const meta = row?.meta as Partial<ConnectionMeta> | undefined;
  return {
    ...app,
    status: !row ? "not_connected" : meta?.status === "attention" ? "attention" : "connected",
    account: meta?.account ?? null,
    connectedAt: meta?.connectedAt ? new Date(meta.connectedAt) : null,
    lastError: row ? (meta?.lastError ?? null) : null,
    mock: Boolean(meta?.mock),
    canConnect: isOAuthApp(app.id) ? oauthAppReady(app.id) : true,
  };
}

/** Every native app with this business's connection state. Safe for both the customer app and the Engine: no secrets. */
export async function listAppConnections(tenantId: string): Promise<AppConnectionView[]> {
  const rows = await withTenant(tenantId, (tx) =>
    tx.query.tenantIntegrations.findMany({
      where: and(eq(schema.tenantIntegrations.tenantId, tenantId), inArray(schema.tenantIntegrations.kind, APP_IDS)),
    }),
  );
  return APPS.map((app) => view(app, rows.find((r) => r.kind === app.id)));
}

/** Apps whose tools may be offered to the agent right now (connected and healthy). */
export async function healthyApps(tenantId: string): Promise<Set<AppId>> {
  const list = await listAppConnections(tenantId);
  return new Set(list.filter((c) => c.status === "connected").map((c) => c.id));
}

/* ───────────────────────────── connecting (owner, OAuth) ───────────────────────────── */

function friendly(error: unknown, fallback: string): string {
  if (error instanceof AppApiError) return error.message;
  if (error instanceof ServiceError) return error.message;
  console.error("[connections]", error instanceof Error ? error.message : error);
  return fallback;
}

async function upsert(
  db: ServiceContext["db"],
  tenantId: string,
  app: AppId,
  secret: OAuthTokens | OdooRef,
  meta: ConnectionMeta,
): Promise<void> {
  const configEncrypted = encryptJson(secret);
  await db
    .insert(schema.tenantIntegrations)
    .values({ tenantId, kind: app, configEncrypted, meta })
    .onConflictDoUpdate({
      target: [schema.tenantIntegrations.tenantId, schema.tenantIntegrations.kind],
      set: { configEncrypted, meta },
    });
}

/**
 * Finishes an OAuth connection: swaps the code for tokens, reads which account/organisation was connected, and saves it.
 * Owner only. The caller (the callback route) has already checked the OAuth `state`.
 */
export async function completeOAuthConnection(
  ctx: ServiceContext,
  app: OAuthAppId,
  input: { code: string; redirectUri: string; accountsServer?: string | null },
): Promise<AppConnectionView> {
  requireOwner(ctx.principal);
  let tokens: OAuthTokens;
  let account: string | null = null;
  let organizationId: string | undefined;
  try {
    tokens = await exchangeOAuthCode(app, input);
    if (app === "google_workspace") {
      account = await googleAccountEmail(tokens.accessToken);
    } else if (app === "zoho_books") {
      const orgs = await zohoBooksOrganizations({ token: tokens.accessToken, apiDomain: tokens.apiDomain! });
      const org = orgs.find((o) => o.isDefault) ?? orgs[0];
      if (!org) throw new ValidationError("That Zoho account has no Zoho Books organisation yet. Create one in Zoho Books, then connect again.");
      organizationId = org.id;
      account = org.name;
    } else {
      account = await zohoCrmOrgName({ token: tokens.accessToken, apiDomain: tokens.apiDomain! });
    }
  } catch (error) {
    throw new ValidationError(friendly(error, `Couldn't connect ${appInfo(app).name}. Please try again.`));
  }
  const meta: ConnectionMeta = {
    status: "connected",
    account,
    ...(organizationId ? { organizationId } : {}),
    connectedAt: new Date().toISOString(),
    connectedBy: ctx.principal.type === "staff" ? ctx.principal.userId : "system",
    lastError: null,
    mock: integrationsMode() === "mock",
  };
  await upsert(ctx.db, ctx.tenantId, app, tokens, meta);
  await audit(ctx, "integration.connected", "integration", app, { app, account, mock: meta.mock });
  return view(appInfo(app), { meta });
}

/** Removes a connection (and tells Google/Zoho to forget the grant). OAuth apps: owner only, from their app. */
export async function disconnectApp(ctx: ServiceContext, app: AppId): Promise<void> {
  requireOwner(ctx.principal);
  if (!isOAuthApp(app)) throw new ValidationError(`${appInfo(app).name} is managed by the Palda team.`);
  const row = await rowOf(ctx.db, ctx.tenantId, app);
  if (!row) return;
  try {
    await revokeOAuthTokens(app, decryptJson<OAuthTokens>(row.configEncrypted));
  } catch {
    /* unreadable tokens: deleting the row is what matters */
  }
  await ctx.db.delete(schema.tenantIntegrations).where(eq(schema.tenantIntegrations.id, row.id));
  await audit(ctx, "integration.disconnected", "integration", app, { app });
}

/* ───────────────────────────── connecting (Engine, API key) ───────────────────────────── */

/** Saves Odoo details for a business after proving they work. Palda team only (the Engine). */
export async function saveOdooConnection(
  adminId: string,
  tenantId: string,
  input: { url: string; db: string; username: string; apiKey: string },
): Promise<AppConnectionView> {
  const db = input.db.trim();
  const username = input.username.trim();
  const apiKey = input.apiKey.trim();
  let url: string;
  try {
    url = normaliseOdooUrl(input.url);
  } catch (error) {
    throw new ValidationError(error instanceof ExternalMcpError ? error.message : "That address can't be used.");
  }
  if (!/^[\w.-]{1,63}$/.test(db)) throw new ValidationError("Enter the Odoo database name (letters, digits, dots, dashes).");
  if (username.length < 2 || username.length > 120) throw new ValidationError("Enter the Odoo login (usually an email address).");

  return withTenant(tenantId, async (tx) => {
    // A blank key on an existing connection means "keep the saved key".
    let key = apiKey;
    if (!key) {
      const existing = await rowOf(tx, tenantId, "odoo");
      if (!existing) throw new ValidationError("Enter the Odoo API key.");
      key = decryptJson<OdooRef>(existing.configEncrypted).apiKey;
    }
    if (key.length < 8 || key.length > 200) throw new ValidationError("That API key doesn't look right.");
    const ref: OdooRef = { url, db, username, apiKey: key };
    let company: string;
    try {
      company = (await odooTest(ref)).company;
    } catch (error) {
      throw new ValidationError(friendly(error, "Couldn't connect to Odoo with those details."));
    }
    const meta: ConnectionMeta = {
      status: "connected",
      account: `${company} · ${new URL(url).host}`,
      connectedAt: new Date().toISOString(),
      connectedBy: `engine:${adminId}`,
      lastError: null,
      mock: integrationsMode() === "mock",
    };
    await upsert(tx, tenantId, "odoo", ref, meta);
    await tx.insert(schema.auditLog).values({
      tenantId,
      actor: `engine:${adminId}`,
      action: "engine.app_connected",
      entity: "integration",
      entityId: "odoo",
      diff: { app: "odoo", host: new URL(url).host, db },
    });
    return view(appInfo("odoo"), { meta });
  });
}

/** Removes any app connection from the Engine (the Palda team can always switch an app off for a business). */
export async function removeAppConnectionAsAdmin(adminId: string, tenantId: string, app: AppId): Promise<void> {
  await withTenant(tenantId, async (tx) => {
    const row = await rowOf(tx, tenantId, app);
    if (!row) return;
    if (isOAuthApp(app)) {
      try {
        await revokeOAuthTokens(app, decryptJson<OAuthTokens>(row.configEncrypted));
      } catch {
        /* ignore */
      }
    }
    await tx.delete(schema.tenantIntegrations).where(eq(schema.tenantIntegrations.id, row.id));
    await tx.insert(schema.auditLog).values({
      tenantId,
      actor: `engine:${adminId}`,
      action: "engine.app_removed",
      entity: "integration",
      entityId: app,
      diff: { app },
    });
  });
}

/** The saved Odoo details without the key, to pre-fill the Engine form. */
export async function getOdooSettings(tenantId: string): Promise<{ url: string; db: string; username: string; hasKey: boolean } | null> {
  const row = await withTenant(tenantId, (tx) => rowOf(tx, tenantId, "odoo"));
  if (!row) return null;
  try {
    const ref = decryptJson<OdooRef>(row.configEncrypted);
    return { url: ref.url, db: ref.db, username: ref.username, hasKey: Boolean(ref.apiKey) };
  } catch {
    return null;
  }
}

/* ───────────────────────────── using an app (the agent's tools) ───────────────────────────── */

async function rowOf(db: ServiceContext["db"], tenantId: string, app: AppId) {
  return db.query.tenantIntegrations.findFirst({
    where: and(eq(schema.tenantIntegrations.tenantId, tenantId), eq(schema.tenantIntegrations.kind, app)),
  });
}

export type AppAccess = {
  google_workspace: { token: string };
  zoho_books: ZohoBooksRef;
  zoho_crm: ZohoRef;
  odoo: OdooRef;
};

/**
 * Written in its own transaction, not the tool call's: when a tool then fails, its transaction rolls back, and a refreshed token
 * or a "needs attention" mark must survive that.
 */
async function setMeta(ctx: ServiceContext, rowId: string, meta: ConnectionMeta, secret?: OAuthTokens) {
  await withTenant(ctx.tenantId, (tx) =>
    tx
      .update(schema.tenantIntegrations)
      .set(secret ? { meta, configEncrypted: encryptJson(secret) } : { meta })
      .where(eq(schema.tenantIntegrations.id, rowId)),
  );
}

/**
 * Runs `fn` with working credentials for `app`. Refreshes an OAuth token that is about to expire (or was just refused, once),
 * marks the connection "needs attention" when the app keeps refusing, and turns every failure into a short ServiceError the
 * agent can relay. Throws AppNotConnectedError when the business hasn't connected the app.
 */
export async function withApp<A extends AppId, T>(ctx: ServiceContext, app: A, fn: (access: AppAccess[A]) => Promise<T>): Promise<T> {
  const row = await rowOf(ctx.db, ctx.tenantId, app);
  if (!row) throw new AppNotConnectedError(app);
  const meta = row.meta as ConnectionMeta;
  if (meta.status === "attention") {
    throw new AppUnavailableError(app, "the connection needs to be renewed by the business before it can be used.");
  }

  const fail = async (message: string): Promise<never> => {
    await setMeta(ctx, row.id, { ...meta, status: "attention", lastError: message });
    throw new AppUnavailableError(app, "the connection stopped working and needs to be renewed.");
  };

  if (app === "odoo") {
    const ref = decryptJson<OdooRef>(row.configEncrypted);
    try {
      return await fn(ref as AppAccess[A]);
    } catch (error) {
      if (error instanceof AppApiError && error.kind === "unauthorized") return fail(error.message);
      throw toServiceError(app, error);
    }
  }

  const oauthApp = app as OAuthAppId;
  let tokens = decryptJson<OAuthTokens>(row.configEncrypted);
  const accessFor = (t: OAuthTokens): AppAccess[A] =>
    (app === "google_workspace"
      ? { token: t.accessToken }
      : app === "zoho_books"
        ? { token: t.accessToken, apiDomain: t.apiDomain!, organizationId: meta.organizationId ?? "" }
        : { token: t.accessToken, apiDomain: t.apiDomain! }) as AppAccess[A];

  const refresh = async () => {
    try {
      tokens = await refreshOAuthTokens(oauthApp, tokens);
      await setMeta(ctx, row.id, { ...meta, lastError: null }, tokens);
    } catch (error) {
      if (error instanceof AppApiError && error.kind === "unauthorized") return fail(error.message);
      throw toServiceError(app, error);
    }
  };

  if (tokens.expiresAt - Date.now() < 60_000) await refresh();
  try {
    return await fn(accessFor(tokens));
  } catch (error) {
    if (!(error instanceof AppApiError && error.kind === "unauthorized")) throw toServiceError(app, error);
  }
  // Refused once: refresh and try exactly one more time.
  await refresh();
  try {
    return await fn(accessFor(tokens));
  } catch (error) {
    if (error instanceof AppApiError && error.kind === "unauthorized") return fail(error.message);
    throw toServiceError(app, error);
  }
}

function toServiceError(app: AppId, error: unknown): ServiceError {
  if (error instanceof ServiceError) return error;
  if (error instanceof AppApiError) return new AppUnavailableError(app, error.message);
  console.error(`[connections] ${app} call failed`, error instanceof Error ? error.message : error);
  return new AppUnavailableError(app, "something went wrong talking to the app.");
}
