import { platformSetting } from "./platform-settings";

/**
 * OAuth2 for the apps a customer connects from their own Palda CX app: Google Workspace, Zoho Books and Zoho CRM.
 *
 * One OAuth client per vendor (set by the Palda team in Engine > Settings) serves every business; each business's own tokens
 * are stored encrypted per business by @garden/services. In mock mode (the default) nothing reaches Google or Zoho: connecting
 * stores a mock token and every API call returns sample data, so the whole flow works locally and in CI.
 */

export type OAuthAppId = "google_workspace" | "zoho_books" | "zoho_crm";
export const OAUTH_APPS: OAuthAppId[] = ["google_workspace", "zoho_books", "zoho_crm"];
export const isOAuthApp = (v: string): v is OAuthAppId => (OAUTH_APPS as string[]).includes(v);

export function integrationsMode(): "mock" | "live" {
  return platformSetting("INTEGRATIONS_MODE") === "live" ? "live" : "mock";
}

export class AppApiError extends Error {
  /** "unauthorized": the token was refused (reconnect or refresh); "upstream": the app answered with an error; "network". */
  constructor(
    public readonly kind: "unauthorized" | "upstream" | "network" | "config",
    message: string,
  ) {
    super(message);
    this.name = "AppApiError";
  }
}

export type OAuthTokens = {
  accessToken: string;
  refreshToken: string | null;
  /** Epoch milliseconds. */
  expiresAt: number;
  /** Zoho: the data-centre API host, e.g. https://www.zohoapis.eu */
  apiDomain?: string;
  /** Zoho: the data-centre accounts host the tokens belong to, e.g. https://accounts.zoho.eu */
  accountsServer?: string;
};

/* ─────────────────────────────── per-vendor setup ─────────────────────────────── */

const GOOGLE_SCOPES = [
  "openid",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.freebusy",
  "https://www.googleapis.com/auth/gmail.send",
];

const ZOHO_SCOPES: Record<"zoho_books" | "zoho_crm", string[]> = {
  zoho_books: ["ZohoBooks.contacts.ALL", "ZohoBooks.invoices.ALL", "ZohoBooks.settings.READ"],
  zoho_crm: ["ZohoCRM.modules.leads.ALL", "ZohoCRM.modules.contacts.ALL", "ZohoCRM.modules.notes.CREATE", "ZohoCRM.org.READ"],
};

export function oauthScopes(app: OAuthAppId): string[] {
  return app === "google_workspace" ? GOOGLE_SCOPES : ZOHO_SCOPES[app];
}

const vendorOf = (app: OAuthAppId) => (app === "google_workspace" ? "google" : "zoho");

function clientCreds(app: OAuthAppId): { id: string; secret: string } {
  const vendor = vendorOf(app);
  const id = platformSetting(vendor === "google" ? "GOOGLE_CLIENT_ID" : "ZOHO_CLIENT_ID") ?? "";
  const secret = platformSetting(vendor === "google" ? "GOOGLE_CLIENT_SECRET" : "ZOHO_CLIENT_SECRET") ?? "";
  if (!id || !secret) {
    throw new AppApiError("config", `${vendor === "google" ? "Google" : "Zoho"} isn't set up on the platform yet. Ask the Palda team.`);
  }
  return { id, secret };
}

/** True when this app can be connected for real (live mode with the vendor's client keys set). Mock mode is always ready. */
export function oauthAppReady(app: OAuthAppId): boolean {
  if (integrationsMode() === "mock") return true;
  try {
    clientCreds(app);
    return true;
  } catch {
    return false;
  }
}

/*
 * Zoho runs separate data centres (.com, .eu, .in, .com.au, .jp, .ca, .sa, .com.cn). The callback tells us which accounts
 * server the customer signed in on, and the token response which API host to use. Both are checked against Zoho's own hosts
 * before we send anything there, so a forged callback can't point us (and the client secret) at another server.
 */
const ZOHO_TLD = "(com|eu|in|com\\.au|jp|ca|sa|com\\.cn|uk)";
const ZOHO_ACCOUNTS = new RegExp(`^https://accounts\\.zoho\\.${ZOHO_TLD}$`);
const ZOHO_API = new RegExp(`^https://www\\.zohoapis\\.${ZOHO_TLD}$`);
const ZOHO_DEFAULT_ACCOUNTS = "https://accounts.zoho.com";

export function zohoAccountsServer(raw: string | null | undefined): string {
  const value = (raw ?? "").trim().replace(/\/+$/, "");
  if (!value) return ZOHO_DEFAULT_ACCOUNTS;
  if (!ZOHO_ACCOUNTS.test(value)) throw new AppApiError("upstream", "Zoho sent back an unexpected sign-in server.");
  return value;
}

export function zohoApiDomain(raw: string | null | undefined): string {
  const value = (raw ?? "").trim().replace(/\/+$/, "");
  if (!ZOHO_API.test(value)) throw new AppApiError("upstream", "Zoho sent back an unexpected API address.");
  return value;
}

/** The address to send the owner to, to approve access. `state` must be checked on the way back. */
export function buildAuthorizeUrl(app: OAuthAppId, input: { redirectUri: string; state: string }): string {
  const { id } = clientCreds(app);
  if (vendorOf(app) === "google") {
    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.search = new URLSearchParams({
      client_id: id,
      redirect_uri: input.redirectUri,
      response_type: "code",
      scope: oauthScopes(app).join(" "),
      access_type: "offline",
      // Always ask again, so Google always returns a refresh token (it only does on consent).
      prompt: "consent",
      include_granted_scopes: "true",
      state: input.state,
    }).toString();
    return url.toString();
  }
  const url = new URL(`${ZOHO_DEFAULT_ACCOUNTS}/oauth/v2/auth`);
  url.search = new URLSearchParams({
    client_id: id,
    redirect_uri: input.redirectUri,
    response_type: "code",
    scope: oauthScopes(app).join(","),
    access_type: "offline",
    prompt: "consent",
    state: input.state,
  }).toString();
  return url.toString();
}

async function postForm(url: string, form: Record<string, string>): Promise<Record<string, unknown>> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: new URLSearchParams(form).toString(),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new AppApiError("network", "Couldn't reach the sign-in server. Please try again.");
  }
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  // Zoho answers 200 with {"error": "..."} on failure; Google uses 4xx.
  if (!res.ok || typeof body.error === "string") {
    const code = String(body.error ?? res.status);
    throw new AppApiError(code === "invalid_grant" || code === "invalid_code" ? "unauthorized" : "upstream", `The sign-in server refused: ${code}.`);
  }
  return body;
}

function tokensFrom(body: Record<string, unknown>, extra: Partial<OAuthTokens>, previousRefresh: string | null): OAuthTokens {
  const accessToken = String(body.access_token ?? "");
  if (!accessToken) throw new AppApiError("upstream", "The sign-in server returned no access token.");
  const expiresIn = Number(body.expires_in ?? 3600);
  return {
    accessToken,
    refreshToken: typeof body.refresh_token === "string" ? body.refresh_token : previousRefresh,
    expiresAt: Date.now() + (Number.isFinite(expiresIn) ? expiresIn : 3600) * 1000,
    ...extra,
  };
}

/** Swaps the one-time code from the callback for tokens. Zoho needs the `accounts-server` the callback carried. */
export async function exchangeOAuthCode(
  app: OAuthAppId,
  input: { code: string; redirectUri: string; accountsServer?: string | null },
): Promise<OAuthTokens> {
  if (integrationsMode() === "mock") {
    return {
      accessToken: `mock_access_${app}`,
      refreshToken: `mock_refresh_${app}`,
      expiresAt: Date.now() + 3600_000,
      ...(app === "google_workspace" ? {} : { apiDomain: "https://www.zohoapis.com", accountsServer: ZOHO_DEFAULT_ACCOUNTS }),
    };
  }
  const { id, secret } = clientCreds(app);
  const form = { grant_type: "authorization_code", code: input.code, redirect_uri: input.redirectUri, client_id: id, client_secret: secret };
  if (vendorOf(app) === "google") return tokensFrom(await postForm("https://oauth2.googleapis.com/token", form), {}, null);
  const accounts = zohoAccountsServer(input.accountsServer);
  const body = await postForm(`${accounts}/oauth/v2/token`, form);
  return tokensFrom(body, { apiDomain: zohoApiDomain(String(body.api_domain ?? "")), accountsServer: accounts }, null);
}

/** A fresh access token from the refresh token. Throws AppApiError("unauthorized") when the customer revoked access. */
export async function refreshOAuthTokens(app: OAuthAppId, tokens: OAuthTokens): Promise<OAuthTokens> {
  if (integrationsMode() === "mock" || tokens.accessToken.startsWith("mock_")) {
    return { ...tokens, expiresAt: Date.now() + 3600_000 };
  }
  if (!tokens.refreshToken) throw new AppApiError("unauthorized", "This connection has no refresh token. Reconnect it.");
  const { id, secret } = clientCreds(app);
  const form = { grant_type: "refresh_token", refresh_token: tokens.refreshToken, client_id: id, client_secret: secret };
  if (vendorOf(app) === "google") return tokensFrom(await postForm("https://oauth2.googleapis.com/token", form), {}, tokens.refreshToken);
  const accounts = zohoAccountsServer(tokens.accountsServer);
  const body = await postForm(`${accounts}/oauth/v2/token`, form);
  return tokensFrom(body, { apiDomain: tokens.apiDomain, accountsServer: accounts }, tokens.refreshToken);
}

/* ─────────────────────────────── Sign in with Google ─────────────────────────────── */

/*
 * "Continue with Google" on the sign-in screens. Same Google OAuth client as the Google Workspace integration, but only the
 * basic identity scopes: Google tells us the verified email, and that email must already belong to an account. Nobody can
 * sign up this way.
 *
 * Test mode (Apps mode = mock) uses a pretend account picker instead of Google. It is only allowed when the app runs on a local
 * http address: on any https deployment it is off, because it would let anyone sign in as any email.
 */
export function googleSignInMockAllowed(): boolean {
  if (integrationsMode() !== "mock") return false;
  const appUrl = process.env.APP_URL ?? "http://localhost:3000";
  return /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(appUrl);
}

/** Whether to show "Continue with Google": real Google is configured, or local test mode. */
export function googleSignInAvailable(): boolean {
  if (googleSignInMockAllowed()) return true;
  if (integrationsMode() !== "live") return false;
  return Boolean(platformSetting("GOOGLE_CLIENT_ID") && platformSetting("GOOGLE_CLIENT_SECRET"));
}

export function buildGoogleSignInUrl(input: { redirectUri: string; state: string }): string {
  const { id } = clientCreds("google_workspace");
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({
    client_id: id,
    redirect_uri: input.redirectUri,
    response_type: "code",
    scope: "openid email profile",
    prompt: "select_account",
    state: input.state,
  }).toString();
  return url.toString();
}

/** Swaps the sign-in code for the person's Google identity. Only a Google-verified email is returned. */
export async function exchangeGoogleSignIn(input: { code: string; redirectUri: string }): Promise<{ email: string; name: string | null }> {
  if (input.code.startsWith("mock:")) {
    if (!googleSignInMockAllowed()) throw new AppApiError("config", "Test sign-in is off on this server.");
    const email = input.code.slice(5).trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new AppApiError("upstream", "Enter a valid email.");
    return { email, name: null };
  }
  const { id, secret } = clientCreds("google_workspace");
  const body = await postForm("https://oauth2.googleapis.com/token", {
    grant_type: "authorization_code",
    code: input.code,
    redirect_uri: input.redirectUri,
    client_id: id,
    client_secret: secret,
  });
  const token = String(body.access_token ?? "");
  let res: Response;
  try {
    res = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new AppApiError("network", "Couldn't reach Google. Please try again.");
  }
  const me = (await res.json().catch(() => ({}))) as { email?: string; email_verified?: boolean; name?: string };
  if (!res.ok || !me.email) throw new AppApiError("upstream", "Google didn't share an email address.");
  if (me.email_verified !== true) throw new AppApiError("unauthorized", "That Google account's email isn't verified.");
  return { email: me.email.trim().toLowerCase(), name: me.name ?? null };
}

/** Best effort: tells the vendor to forget the grant. Never throws. */
export async function revokeOAuthTokens(app: OAuthAppId, tokens: OAuthTokens): Promise<void> {
  if (integrationsMode() === "mock" || tokens.accessToken.startsWith("mock_")) return;
  const token = tokens.refreshToken ?? tokens.accessToken;
  try {
    if (vendorOf(app) === "google") {
      await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, { method: "POST", signal: AbortSignal.timeout(10_000) });
    } else {
      const accounts = zohoAccountsServer(tokens.accountsServer);
      await fetch(`${accounts}/oauth/v2/token/revoke?token=${encodeURIComponent(token)}`, { method: "POST", signal: AbortSignal.timeout(10_000) });
    }
  } catch {
    /* the grant is deleted on our side either way */
  }
}
