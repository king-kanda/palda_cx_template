"use server";

import { ServiceError, completeWhatsappSignup, verifyWhatsappConnectToken } from "@garden/services";

export type SignupResult = {
  ok: boolean;
  error?: string;
  /** What was connected, for the confirmation screen. */
  connection?: { displayPhone: string; verifiedName: string; mode: "coexistence" | "cloud_api" };
};

const str = (v: unknown, max = 4000) => (typeof v === "string" ? v.slice(0, max) : "");

/**
 * Finishes the WhatsApp connection. The business comes from the SIGNED link (never from anything the browser sends alongside),
 * so a link can only ever connect a number to the one business it was made for.
 */
export async function completeSignupAction(input: {
  token: string;
  code: string;
  wabaId: string | null;
  phoneNumberId: string | null;
  businessId: string | null;
  coexistence: boolean;
}): Promise<SignupResult> {
  const verified = verifyWhatsappConnectToken(str(input.token, 2000));
  if (!verified) return { ok: false, error: "This link has expired or isn't valid. Ask the Palda team for a new one." };
  try {
    const connection = await completeWhatsappSignup(`connect-link:${verified.tenantId}`, verified.tenantId, {
      code: str(input.code),
      wabaId: str(input.wabaId, 100) || null,
      phoneNumberId: str(input.phoneNumberId, 100) || null,
      businessId: str(input.businessId, 100) || null,
      coexistence: input.coexistence === true,
    });
    return { ok: true, connection: { displayPhone: connection.displayPhone, verifiedName: connection.verifiedName, mode: connection.mode } };
  } catch (error) {
    if (error instanceof ServiceError) return { ok: false, error: error.message };
    console.error("[whatsapp] signup failed", error instanceof Error ? error.message : error);
    return { ok: false, error: "Something went wrong connecting WhatsApp. Please try again." };
  }
}
