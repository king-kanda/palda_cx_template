import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SignJWT, jwtVerify } from "jose";

export type Session = {
  userId: string;
  tenantId: string;
  tenantSlug: string;
  role: "owner" | "staff";
  email: string;
  name: string;
  /** Set when a Palda admin opened this account from the Engine to set it up; shown as a banner. */
  impersonator?: { adminId: string; name: string };
};

const COOKIE = "garden_session";

function secret(): Uint8Array {
  const value =
    process.env.AUTH_SECRET ??
    "dev-only-secret-change-me-please-32-characters-minimum";
  return new TextEncoder().encode(value);
}

export async function createSession(session: Session): Promise<void> {
  const token = await new SignJWT(session)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(secret());
  const jar = await cookies();
  jar.set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
}

export async function destroySession(): Promise<void> {
  const jar = await cookies();
  jar.delete(COOKIE);
}

export async function getSession(): Promise<Session | null> {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    if (
      typeof payload.userId !== "string" ||
      typeof payload.tenantId !== "string" ||
      typeof payload.email !== "string"
    ) {
      return null;
    }
    const imp = payload.impersonator as { adminId?: unknown; name?: unknown } | undefined;
    return {
      impersonator:
        imp && typeof imp.adminId === "string" && typeof imp.name === "string"
          ? { adminId: imp.adminId, name: imp.name }
          : undefined,
      userId: payload.userId,
      tenantId: payload.tenantId,
      tenantSlug: String(payload.tenantSlug ?? ""),
      role: payload.role === "owner" ? "owner" : "staff",
      email: payload.email,
      name: String(payload.name ?? payload.email),
    };
  } catch {
    return null;
  }
}

export async function requireSession(): Promise<Session> {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }
  return session;
}
