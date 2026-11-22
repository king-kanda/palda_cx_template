import { cookies } from "next/headers";
import { randomToken } from "@garden/integrations";

/**
 * A ten-minute, single-use cookie that ties a Google sign-in round trip to the browser that started it (the OAuth `state`),
 * and remembers which screen it was for: the business app or the Engine.
 */
const COOKIE = "palda_google_signin";
export type SignInTarget = "app" | "engine";

export const appUrl = () => (process.env.APP_URL ?? "http://localhost:3000").replace(/\/+$/, "");
export const redirectUri = () => `${appUrl()}/auth/google/callback`;
export const loginPath = (target: SignInTarget) => (target === "engine" ? "/engine/login" : "/login");

export async function startState(target: SignInTarget): Promise<string> {
  const state = randomToken(24);
  (await cookies()).set(COOKIE, JSON.stringify({ state, target }), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production" && appUrl().startsWith("https://"),
    path: "/auth/google",
    maxAge: 600,
  });
  return state;
}

/** The target the round trip was started for, or null when `state` doesn't match. Clears the cookie either way. */
export async function consumeState(state: string | null): Promise<SignInTarget | null> {
  const jar = await cookies();
  const raw = jar.get(COOKIE)?.value;
  jar.delete({ name: COOKIE, path: "/auth/google" });
  if (!raw || !state) return null;
  try {
    const saved = JSON.parse(raw) as { state?: string; target?: string };
    if (saved.state !== state) return null;
    return saved.target === "engine" ? "engine" : "app";
  } catch {
    return null;
  }
}
