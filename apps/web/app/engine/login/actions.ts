"use server";

import { redirect } from "next/navigation";
import { authenticatePlatformAdmin } from "@garden/services";
import { createEngineSession, destroyEngineSession } from "@/lib/engine-auth";

export type EngineLoginState = { error?: string };

export async function engineLoginAction(_prev: EngineLoginState, formData: FormData): Promise<EngineLoginState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  if (!email || !password) return { error: "Email and password are required." };
  const admin = await authenticatePlatformAdmin(email, password);
  if (!admin) return { error: "Wrong email or password." };
  await createEngineSession(admin.id);
  redirect("/engine");
}

export async function engineLogoutAction(): Promise<void> {
  await destroyEngineSession();
  redirect("/engine/login");
}
