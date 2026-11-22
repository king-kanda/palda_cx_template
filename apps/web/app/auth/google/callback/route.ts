import { NextResponse } from "next/server";
import { AppApiError, exchangeGoogleSignIn } from "@garden/integrations";
import { findAccountForSignIn, findPlatformAdminByEmail } from "@garden/services";
import { createSession } from "@/lib/auth";
import { createEngineSession } from "@/lib/engine-auth";
import { appUrl, consumeState, loginPath, redirectUri } from "../state";

export const dynamic = "force-dynamic";

/**
 * Where Google sends the person back. Google has verified the email; it must belong to an existing account (a business user
 * for the app, a Palda team login for the Engine). Nothing is created here.
 */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const target = await consumeState(url.searchParams.get("state"));
  if (!target) return NextResponse.redirect(`${appUrl()}/login?error=${encodeURIComponent("That Google sign-in expired. Please try again.")}`);
  const fail = (message: string) => NextResponse.redirect(`${appUrl()}${loginPath(target)}?error=${encodeURIComponent(message)}`);

  if (url.searchParams.get("error")) return fail("Google sign-in was cancelled.");
  // The local test picker sends the chosen email instead of a Google code (refused on https deployments).
  const testEmail = url.searchParams.get("email");
  const code = url.searchParams.get("code") ?? (testEmail ? `mock:${testEmail}` : null);
  if (!code || code.length > 2000) return fail("Google didn't send back a sign-in code. Please try again.");

  let email: string;
  try {
    email = (await exchangeGoogleSignIn({ code, redirectUri: redirectUri() })).email;
  } catch (error) {
    return fail(error instanceof AppApiError ? error.message : "Couldn't sign in with Google. Please try again.");
  }

  if (target === "engine") {
    const admin = await findPlatformAdminByEmail(email);
    if (!admin) return fail("That Google account isn't on the Palda CX team.");
    await createEngineSession(admin.id);
    return NextResponse.redirect(`${appUrl()}/engine`);
  }

  const found = await findAccountForSignIn(email);
  if ("error" in found) return fail(found.error);
  const { user, tenant } = found.account;
  await createSession({
    userId: user.id,
    tenantId: tenant.id,
    tenantSlug: tenant.slug,
    role: user.role === "owner" ? "owner" : "staff",
    email: user.email,
    name: user.name,
  });
  return NextResponse.redirect(`${appUrl()}/dashboard`);
}
