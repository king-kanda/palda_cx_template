"use server";

import { redirect } from "next/navigation";
import { createWhatsappConnectToken } from "@garden/services";
import { requireSession } from "@/lib/auth";

/**
 * Sends the owner to the WhatsApp connect page for THEIR OWN business. The business comes from the signed-in session, never
 * from the request, and the link made here is short-lived. Staff accounts are sent back: only the owner connects channels.
 */
export async function startWhatsappConnectAction(): Promise<void> {
  const session = await requireSession();
  if (session.role !== "owner") redirect("/integrations");
  redirect(`/connect/whatsapp/${createWhatsappConnectToken(session.tenantId, 2)}`);
}
