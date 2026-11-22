import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AppApiError,
  applyPlatformSettings,
  buildAuthorizeUrl,
  exchangeGoogleSignIn,
  exchangeOAuthCode,
  googleSignInAvailable,
  googleSignInMockAllowed,
  oauthAppReady,
  phoneKey,
  refreshOAuthTokens,
  sameEmail,
  samePhone,
  zohoAccountsServer,
  zohoApiDomain,
} from "../../packages/integrations/src/index";
import { agentOverrideSchema } from "../../packages/services/src/engine";
import { INTEGRATION_TOOL_APPS, TOOLS } from "../../packages/mcp-server/src/index";

const LIVE = {
  INTEGRATIONS_MODE: "live",
  GOOGLE_CLIENT_ID: "123-abc.apps.googleusercontent.com",
  GOOGLE_CLIENT_SECRET: "g-secret",
  ZOHO_CLIENT_ID: "1000.ABCDEFGHIJKLMNOP",
  ZOHO_CLIENT_SECRET: "z-secret",
};

afterEach(() => {
  applyPlatformSettings({});
  vi.unstubAllGlobals();
});

describe("OAuth authorize URLs", () => {
  it("asks Google for offline access with consent, the agreed scopes and our state", () => {
    applyPlatformSettings(LIVE);
    const url = new URL(buildAuthorizeUrl("google_workspace", { redirectUri: "https://app.example/cb", state: "st4te" }));
    expect(url.origin).toBe("https://accounts.google.com");
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("state")).toBe("st4te");
    expect(url.searchParams.get("scope")).toContain("gmail.send");
    // Drive is deliberately not requested (restricted scope).
    expect(url.searchParams.get("scope")).not.toContain("drive");
  });

  it("asks Zoho with comma-separated scopes per app", () => {
    applyPlatformSettings(LIVE);
    const books = new URL(buildAuthorizeUrl("zoho_books", { redirectUri: "https://app.example/cb", state: "s" }));
    expect(books.host).toBe("accounts.zoho.com");
    expect(books.searchParams.get("scope")).toBe("ZohoBooks.contacts.ALL,ZohoBooks.invoices.ALL,ZohoBooks.settings.READ");
    const crm = new URL(buildAuthorizeUrl("zoho_crm", { redirectUri: "https://app.example/cb", state: "s" }));
    expect(crm.searchParams.get("scope")).toContain("ZohoCRM.modules.leads.ALL");
  });

  it("refuses to start without the platform's client keys in live mode", () => {
    applyPlatformSettings({ INTEGRATIONS_MODE: "live" });
    expect(() => buildAuthorizeUrl("google_workspace", { redirectUri: "x", state: "s" })).toThrow(AppApiError);
    expect(oauthAppReady("google_workspace")).toBe(false);
    applyPlatformSettings({});
    expect(oauthAppReady("google_workspace")).toBe(true); // mock mode is always ready
  });
});

describe("Zoho data centres", () => {
  it("accepts Zoho's own hosts and rejects anything else", () => {
    expect(zohoAccountsServer("https://accounts.zoho.eu")).toBe("https://accounts.zoho.eu");
    expect(zohoAccountsServer("https://accounts.zoho.com.au/")).toBe("https://accounts.zoho.com.au");
    expect(zohoAccountsServer(null)).toBe("https://accounts.zoho.com");
    for (const bad of ["https://accounts.zoho.eu.evil.com", "http://accounts.zoho.eu", "https://evil.com", "https://accounts.zoho.eu@evil.com"]) {
      expect(() => zohoAccountsServer(bad)).toThrow(AppApiError);
    }
    expect(zohoApiDomain("https://www.zohoapis.in")).toBe("https://www.zohoapis.in");
    expect(() => zohoApiDomain("https://www.zohoapis.in.attacker.io")).toThrow(AppApiError);
  });

  it("exchanges the code on the accounts server the callback named, and keeps the API domain", async () => {
    applyPlatformSettings(LIVE);
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      new Response(JSON.stringify({ access_token: "at", refresh_token: "rt", expires_in: 3600, api_domain: "https://www.zohoapis.eu" })),
    );
    vi.stubGlobal("fetch", fetchMock);
    const tokens = await exchangeOAuthCode("zoho_books", { code: "c", redirectUri: "https://app.example/cb", accountsServer: "https://accounts.zoho.eu" });
    expect((fetchMock.mock.calls[0] as unknown[])[0]).toBe("https://accounts.zoho.eu/oauth/v2/token");
    expect(tokens).toMatchObject({ accessToken: "at", refreshToken: "rt", apiDomain: "https://www.zohoapis.eu", accountsServer: "https://accounts.zoho.eu" });
  });

  it("refuses a token response that points API calls at a foreign host", async () => {
    applyPlatformSettings(LIVE);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ access_token: "at", api_domain: "https://evil.example" }))));
    await expect(exchangeOAuthCode("zoho_crm", { code: "c", redirectUri: "x", accountsServer: null })).rejects.toThrow(AppApiError);
  });

  it("treats Zoho's 200-with-error as a failure, and invalid_grant as needing a reconnect", async () => {
    applyPlatformSettings(LIVE);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "invalid_code" }))));
    await expect(
      refreshOAuthTokens("zoho_books", { accessToken: "at", refreshToken: "rt", expiresAt: 0, accountsServer: "https://accounts.zoho.com" }),
    ).rejects.toMatchObject({ kind: "unauthorized" });
  });

  it("keeps the old refresh token when the refresh response doesn't send a new one", async () => {
    applyPlatformSettings(LIVE);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ access_token: "new", expires_in: 3600 }))));
    const t = await refreshOAuthTokens("google_workspace", { accessToken: "old", refreshToken: "keep-me", expiresAt: 0 });
    expect(t.accessToken).toBe("new");
    expect(t.refreshToken).toBe("keep-me");
    expect(t.expiresAt).toBeGreaterThan(Date.now());
  });
});

describe("matching a customer in an app", () => {
  it("matches a Kenyan mobile however it was written, and emails case-insensitively", () => {
    expect(phoneKey("+254 712 345 678")).toBe("712345678");
    expect(samePhone("+254712345678", "0712345678")).toBe(true);
    expect(samePhone("+254712345678", "0712345679")).toBe(false);
    expect(samePhone("", "")).toBe(false);
    expect(sameEmail("Jane@Example.com ", "jane@example.com")).toBe(true);
    expect(sameEmail(null, null)).toBe(false);
  });
});

describe("app tools", () => {
  it("every app tool names its app, is offered to the customer agent, and sensitive ones need approval", () => {
    const appTools = TOOLS.filter((t) => t.integration);
    expect(appTools.length).toBe(INTEGRATION_TOOL_APPS.size);
    expect(appTools.length).toBeGreaterThanOrEqual(10);
    for (const t of appTools) {
      expect(t.principalTypes).toContain("customer");
      expect(t.scopes.some((s) => s.endsWith("_own"))).toBe(true);
    }
    const sensitive = appTools.filter((t) => t.tier === "write-sensitive").map((t) => t.name).sort();
    expect(sensitive).toEqual(["google.email_customer", "zohobooks.invoice_booking"]);
    for (const name of sensitive) expect(TOOLS.find((t) => t.name === name)!.authorize).toBeTypeOf("function");
  });

  it("an older saved version without app tools still parses, with every app tool off", () => {
    const parsed = agentOverrideSchema.parse({ toolPolicy: { blockedTools: ["bookings.cancel"] } });
    expect(parsed.toolPolicy.enabledIntegrationTools).toEqual([]);
  });
});

describe("Continue with Google", () => {
  const appUrl = process.env.APP_URL;
  afterEach(() => {
    if (appUrl === undefined) delete process.env.APP_URL;
    else process.env.APP_URL = appUrl;
  });

  it("the test picker only works on a local http install", async () => {
    applyPlatformSettings({});
    process.env.APP_URL = "http://localhost:3000";
    expect(googleSignInMockAllowed()).toBe(true);
    expect(await exchangeGoogleSignIn({ code: "mock:Owner@Palda.co.ke", redirectUri: "x" })).toEqual({ email: "owner@palda.co.ke", name: null });

    process.env.APP_URL = "https://cx.palda.co.ke";
    expect(googleSignInMockAllowed()).toBe(false);
    expect(googleSignInAvailable()).toBe(false); // mock mode, no client: the button is hidden
    await expect(exchangeGoogleSignIn({ code: "mock:owner@palda.co.ke", redirectUri: "x" })).rejects.toThrow(AppApiError);
  });

  it("asks Google only for identity, and refuses an unverified email", async () => {
    applyPlatformSettings(LIVE);
    process.env.APP_URL = "https://cx.palda.co.ke";
    expect(googleSignInAvailable()).toBe(true);
    const fetchMock = vi.fn(async (url: string) =>
      String(url).includes("/token")
        ? new Response(JSON.stringify({ access_token: "at", expires_in: 3600 }))
        : new Response(JSON.stringify({ email: "owner@palda.co.ke", email_verified: false })),
    );
    vi.stubGlobal("fetch", fetchMock);
    await expect(exchangeGoogleSignIn({ code: "real-code", redirectUri: "https://cx.palda.co.ke/auth/google/callback" })).rejects.toMatchObject({
      kind: "unauthorized",
    });
  });
});
