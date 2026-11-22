import { NextResponse } from "next/server";
import { AppApiError, buildGoogleSignInUrl, googleSignInAvailable, googleSignInMockAllowed } from "@garden/integrations";
import { appUrl, loginPath, redirectUri, startState, type SignInTarget } from "./state";

export const dynamic = "force-dynamic";

/** `/auth/google?for=app|engine`: "Continue with Google". Sends the person to Google (or the local test picker). */
export async function GET(request: Request): Promise<Response> {
  const target: SignInTarget = new URL(request.url).searchParams.get("for") === "engine" ? "engine" : "app";
  const fail = (message: string) => NextResponse.redirect(`${appUrl()}${loginPath(target)}?error=${encodeURIComponent(message)}`);
  if (!googleSignInAvailable()) return fail("Google sign-in isn't set up yet. Use your email and password.");

  const state = await startState(target);
  if (googleSignInMockAllowed()) return NextResponse.redirect(`${appUrl()}/auth/google/test?state=${encodeURIComponent(state)}`);
  try {
    return NextResponse.redirect(buildGoogleSignInUrl({ redirectUri: redirectUri(), state }));
  } catch (error) {
    return fail(error instanceof AppApiError ? error.message : "Couldn't start Google sign-in.");
  }
}
