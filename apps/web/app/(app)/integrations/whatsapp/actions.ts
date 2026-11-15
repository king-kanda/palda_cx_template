"use server";

import { revalidatePath } from "next/cache";
import { ServiceError, completeWhatsappSignup, disconnectWhatsapp, refreshWhatsappConnection } from "@garden/services";
import { requireSession } from "@/lib/auth";

export type SignupResult = {
  ok: boolean;
  error?: string;
  /** What was connected, for the confirmation screen. */
  connection?: { displayPhone: string; verifiedName: string; mode: "coexistence" | "cloud_api" };
};

const str = (v: unknown, max = 4000) => (typeof v === "string" ? v.slice(0, max) : "");

/**
 * The customer connects their own WhatsApp number from their own app. The business comes from the signed-in session, never
 * from anything the browser sends, and only the owner may do it.
 */
async function owner() {
  const session = await requireSession();
  if (session.role !== "owner") return null;
  return session;
}

export async function completeSignupAction(input: {
  code: string;
  wabaId: string | null;
  phoneNumberId: string | null;
  businessId: string | null;
  coexistence: boolean;
}): Promise<SignupResult> {
  const session = await owner();
  if (!session) return { ok: false, error: "Only the account owner can connect WhatsApp." };
  try {
    const connection = await completeWhatsappSignup(`owner:${session.userId}`, session.tenantId, {
      code: str(input.code),
      wabaId: str(input.wabaId, 100) || null,
      phoneNumberId: str(input.phoneNumberId, 100) || null,
      businessId: str(input.businessId, 100) || null,
      coexistence: input.coexistence === true,
    });
    revalidatePath("/integrations");
    return { ok: true, connection: { displayPhone: connection.displayPhone, verifiedName: connection.verifiedName, mode: connection.mode } };
  } catch (error) {
    if (error instanceof ServiceError) return { ok: false, error: error.message };
    console.error("[whatsapp] signup failed", error instanceof Error ? error.message : error);
    return { ok: false, error: "Something went wrong connecting WhatsApp. Please try again." };
  }
}

export async function checkWhatsappAction(): Promise<void> {
  const session = await owner();
  if (!session) return;
  await refreshWhatsappConnection(`owner:${session.userId}`, session.tenantId);
  revalidatePath("/integrations");
}

export async function disconnectWhatsappAction(): Promise<void> {
  const session = await owner();
  if (!session) return;
  await disconnectWhatsapp(`owner:${session.userId}`, session.tenantId);
  revalidatePath("/integrations");
}
