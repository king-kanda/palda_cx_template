"use server";

import { redirect } from "next/navigation";
import { passwordVerify } from "@garden/integrations";
import { findAccountsByEmail } from "@garden/services";
import { createSession, destroySession } from "@/lib/auth";

export type LoginState = { error?: string };

export async function loginAction(
  _prev: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) return { error: "Email and password are required." };

  // Sign in with email + password only: find the business this email belongs to.
  const accounts = await findAccountsByEmail(email);
  const valid = accounts.filter(
    ({ user, tenant }) =>
      user.active && tenant.status === "active" && passwordVerify(password, user.passwordHash),
  );

  if (valid.length === 0) return { error: "Wrong email or password." };
  if (valid.length > 1) {
    // Only possible when the same email and password were used to create several businesses by hand.
    return { error: "That email is registered with more than one business. Please contact support." };
  }

  const { user, tenant } = valid[0]!;
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
