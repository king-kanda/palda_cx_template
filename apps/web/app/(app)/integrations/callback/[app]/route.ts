import { NextResponse } from "next/server";
import { isOAuthApp } from "@garden/integrations";
import { ServiceError, appInfo, completeOAuthConnection, withPrincipal } from "@garden/services";
import { getSession } from "@/lib/auth";
import { principalOf } from "@/lib/principal";
import { appUrl, consumeOAuthState, redirectUriFor } from "../../oauth";

export const dynamic = "force-dynamic";

const back = (kind: "ok" | "error", message: string) =>
  NextResponse.redirect(`${appUrl()}/integrations?${kind === "ok" ? "appOk" : "appError"}=${encodeURIComponent(message)}`);

/** Where Google / Zoho send the owner back. Checks the state cookie, then saves the connection for the signed-in business. */
export async function GET(request: Request, { params }: { params: Promise<{ app: string }> }): Promise<Response> {
  const { app } = await params;
  const url = new URL(request.url);
  const session = await getSession();
  if (!session) return NextResponse.redirect(`${appUrl()}/login`);
  if (!isOAuthApp(app)) return back("error", "Unknown app.");
  const name = appInfo(app).name;

  const valid = await consumeOAuthState(app, session.tenantId, url.searchParams.get("state"));
  if (!valid) return back("error", `That ${name} sign-in expired or didn't start here. Please press Connect again.`);
  if (url.searchParams.get("error")) return back("error", `${name} wasn't connected: access was not approved.`);
  const code = url.searchParams.get("code");
  if (!code || code.length > 2000) return back("error", `${name} didn't send back a sign-in code. Please try again.`);

  try {
    const connection = await withPrincipal(principalOf(session), (ctx) =>
      completeOAuthConnection(ctx, app, {
        code,
        redirectUri: redirectUriFor(app),
        accountsServer: url.searchParams.get("accounts-server"),
      }),
    );
    return back("ok", `${name} is connected${connection.account ? ` (${connection.account})` : ""}.`);
  } catch (error) {
    if (error instanceof ServiceError) return back("error", error.message);
    console.error("[integrations] callback failed", error instanceof Error ? error.message : error);
    return back("error", `Couldn't connect ${name}. Please try again.`);
  }
}
