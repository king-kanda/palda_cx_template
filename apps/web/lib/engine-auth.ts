import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SignJWT, jwtVerify } from "jose";
import { getPlatformAdmin, type PlatformAdmin } from "@garden/services";

/**
 * Engine (Palda staff) sessions. A separate cookie and token type from customer sessions, so a customer token can
 * never open the Engine and an Engine token can never act as a customer. The admin row is re-checked on every
 * request, so deactivating an admin ends their access immediately.
 */
const COOKIE = "palda_engine";
const SCOPE = "engine";

function secret(): Uint8Array {
  return new TextEncoder().encode(process.env.AUTH_SECRET ?? "dev-only-secret-change-me-please-32-characters-minimum");
}

export async function createEngineSession(adminId: string): Promise<void> {
  const token = await new SignJWT({ scope: SCOPE, adminId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("12h")
    .sign(secret());
  const jar = await cookies();
  jar.set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 12,
  });
}

export async function destroyEngineSession(): Promise<void> {
  (await cookies()).delete(COOKIE);
}

export async function getEngineAdmin(): Promise<PlatformAdmin | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    if (payload.scope !== SCOPE || typeof payload.adminId !== "string") return null;
    return await getPlatformAdmin(payload.adminId);
  } catch {
    return null;
  }
}

export async function requireEngineAdmin(): Promise<PlatformAdmin> {
  const admin = await getEngineAdmin();
  if (!admin) redirect("/engine/login");
  return admin;
}
