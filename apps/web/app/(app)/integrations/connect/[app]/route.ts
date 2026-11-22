import { NextResponse } from "next/server";
import { buildAuthorizeUrl, integrationsMode, isOAuthApp, AppApiError } from "@garden/integrations";
import { appInfo } from "@garden/services";
import { getSession } from "@/lib/auth";
import { appUrl, redirectUriFor, startOAuthState } from "../../oauth";

export const dynamic = "force-dynamic";

const back = (kind: "ok" | "error", message: string) =>
  NextResponse.redirect(`${appUrl()}/integrations?${kind === "ok" ? "appOk" : "appError"}=${encodeURIComponent(message)}`);

/**
 * `/integrations/connect/<app>`: the owner's "Connect" button. Sends them to Google or Zoho to sign in and approve access; they
 * come back to `/integrations/callback/<app>`. In mock mode it skips the vendor and goes straight to the callback.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ app: string }> }): Promise<Response> {
  const { app } = await params;
  const session = await getSession();
  if (!session) return NextResponse.redirect(`${appUrl()}/login`);
  if (session.role !== "owner") return back("error", "Only the account owner can connect apps.");
  if (!isOAuthApp(app)) return back("error", "That app can't be connected from here.");

  const state = await startOAuthState(app, session.tenantId);
  if (integrationsMode() === "mock") {
    return NextResponse.redirect(`${redirectUriFor(app)}?code=mock-code&state=${encodeURIComponent(state)}`);
  }
  try {
    return NextResponse.redirect(buildAuthorizeUrl(app, { redirectUri: redirectUriFor(app), state }));
  } catch (error) {
    return back("error", error instanceof AppApiError ? error.message : `Couldn't start connecting ${appInfo(app).name}.`);
  }
}
