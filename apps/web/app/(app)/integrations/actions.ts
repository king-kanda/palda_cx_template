"use server";

import { revalidatePath } from "next/cache";
import {
  ForbiddenError,
  ServiceError,
  addExternalServer,
  deleteExternalServer,
  setExternalServerStatus,
  syncExternalServer,
} from "@garden/services";
import { requireSession } from "@/lib/auth";

export type IntegrationFormState = { ok?: boolean; error?: string; message?: string };

function messageOf(error: unknown): string {
  if (error instanceof ServiceError) return error.message;
  console.error("[integrations] action failed", error);
  return "Something went wrong. Please try again.";
}

/**
 * The tenant always comes from the signed-in session, never from the form, so a customer can only ever act on their own
 * integrations. Only the owner can change them; staff can see them.
 */
async function ownerSession() {
  const session = await requireSession();
  if (session.role !== "owner") throw new ForbiddenError("Only the account owner can change integrations.");
  return session;
}

export async function connectIntegrationAction(_prev: IntegrationFormState, formData: FormData): Promise<IntegrationFormState> {
  try {
    const session = await ownerSession();
    const res = await addExternalServer({ kind: "owner", id: session.userId }, session.tenantId, {
      name: String(formData.get("name") ?? ""),
      url: String(formData.get("url") ?? ""),
      token: String(formData.get("token") ?? ""),
    });
    revalidatePath("/integrations");
    return {
      ok: true,
      message: `Connected. We found ${res.toolCount} tool${res.toolCount === 1 ? "" : "s"}. The Palda team will review them and switch on the ones that are right for you.`,
    };
  } catch (error) {
    return { error: messageOf(error) };
  }
}

export async function recheckIntegrationAction(_prev: IntegrationFormState, formData: FormData): Promise<IntegrationFormState> {
  try {
    const session = await ownerSession();
    const res = await syncExternalServer({ kind: "owner", id: session.userId }, session.tenantId, String(formData.get("serverId") ?? ""));
    revalidatePath("/integrations");
    return {
      ok: true,
      message: res.changed.length
        ? "Checked. Some tools changed on the other side, so they are paused until the Palda team reviews them."
        : `Checked. ${res.toolCount} tools, nothing changed.`,
    };
  } catch (error) {
    revalidatePath("/integrations");
    return { error: messageOf(error) };
  }
}

export async function setIntegrationStatusAction(formData: FormData): Promise<void> {
  const session = await ownerSession();
  const status = String(formData.get("status")) === "disabled" ? "disabled" : "active";
  await setExternalServerStatus({ kind: "owner", id: session.userId }, session.tenantId, String(formData.get("serverId") ?? ""), status);
  revalidatePath("/integrations");
}

export async function removeIntegrationAction(formData: FormData): Promise<void> {
  const session = await ownerSession();
  await deleteExternalServer({ kind: "owner", id: session.userId }, session.tenantId, String(formData.get("serverId") ?? ""));
  revalidatePath("/integrations");
}
