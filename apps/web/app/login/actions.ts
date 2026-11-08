"use server";

import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { getDb, schema, withTenant } from "@garden/db";
import { passwordVerify } from "@garden/integrations";
import { createSession, destroySession } from "@/lib/auth";

export type LoginState = { error?: string };

export async function loginAction(
  _prev: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const slug = String(formData.get("slug") ?? "").trim();

  if (!email || !password) return { error: "Email and password are required." };

  const db = getDb();
  const tenant = slug
    ? await db.query.tenants.findFirst({ where: eq(schema.tenants.slug, slug) })
    : (await db.query.tenants.findMany({ limit: 1 }))[0] ?? null;

  if (!tenant) return { error: "No workspace found. Run the seed script first." };

  const user = await withTenant(tenant.id, (tx) =>
    tx.query.users.findFirst({
      where: (u, { and, eq: eqOp }) =>
        and(eqOp(u.tenantId, tenant.id), eqOp(u.email, email)),
    }),
  );
  if (!user || !user.active || !passwordVerify(password, user.passwordHash)) {
    return { error: "Wrong email or password." };
  }

  await createSession({
    userId: user.id,
    tenantId: tenant.id,
    tenantSlug: tenant.slug,
    role: user.role === "owner" ? "owner" : "staff",
    email: user.email,
    name: user.name,
  });
  redirect("/dashboard");
}

export async function logoutAction(): Promise<void> {
  await destroySession();
  redirect("/login");
}
