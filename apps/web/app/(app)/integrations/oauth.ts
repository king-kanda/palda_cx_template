import { cookies } from "next/headers";
import { randomToken } from "@garden/integrations";

/**
 * The short-lived cookie that ties an OAuth round trip to the person who started it. It holds a random `state`, the app and
 * the business, and lives ten minutes. The callback refuses anything that doesn't match it exactly, which stops a forged
 * callback (CSRF) from attaching someone else's Google or Zoho account to this business.
 */
const COOKIE = "palda_oauth";

export function appUrl(): string {
  return (process.env.APP_URL ?? "http://localhost:3000").replace(/\/+$/, "");
}

export function redirectUriFor(app: string): string {
  return `${appUrl()}/integrations/callback/${app}`;
}

export async function startOAuthState(app: string, tenantId: string): Promise<string> {
  const state = randomToken(24);
  const jar = await cookies();
  jar.set(COOKIE, JSON.stringify({ state, app, tenantId }), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/integrations/callback",
    maxAge: 600,
  });
  return state;
}

/** True when `state` is the one we issued for this app and business. The cookie is single-use. */
export async function consumeOAuthState(app: string, tenantId: string, state: string | null): Promise<boolean> {
  const jar = await cookies();
  const raw = jar.get(COOKIE)?.value;
  jar.delete({ name: COOKIE, path: "/integrations/callback" });
  if (!raw || !state) return false;
  try {
    const saved = JSON.parse(raw) as { state?: string; app?: string; tenantId?: string };
    return saved.state === state && saved.app === app && saved.tenantId === tenantId;
  } catch {
    return false;
  }
}
