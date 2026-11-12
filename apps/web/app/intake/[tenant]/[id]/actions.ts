"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  getTenantBySlug,
  submitIntakeForm,
  systemPrincipal,
  withPrincipal,
} from "@garden/services";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SLUG = /^[a-z0-9][a-z0-9-]{0,59}$/;

export async function submitIntakeAction(formData: FormData): Promise<void> {
  const bookingId = String(formData.get("bookingId") ?? "");
  const tenantSlug = String(formData.get("tenant") ?? "").toLowerCase();
  if (!UUID.test(bookingId) || !SLUG.test(tenantSlug)) redirect("/");

  // The booking id in the link is the only credential; the tenant slug only
  // supplies the RLS context needed to read it.
  const tenant = await getTenantBySlug(tenantSlug);
  if (!tenant) redirect("/");

  try {
    await withPrincipal(systemPrincipal(tenant.id, `intake-form:${bookingId}`), (ctx) =>
      submitIntakeForm(ctx, bookingId, {
        topic: String(formData.get("topic") ?? ""),
        attendees: String(formData.get("attendees") ?? ""),
        goals: String(formData.get("goals") ?? ""),
        notes: String(formData.get("notes") ?? ""),
        consented: formData.get("consent") === "on",
      }),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not save the form.";
    redirect(`/intake/${tenantSlug}/${bookingId}?error=${encodeURIComponent(message)}`);
  }

  revalidatePath(`/intake/${tenantSlug}/${bookingId}`);
  redirect(`/intake/${tenantSlug}/${bookingId}?submitted=1`);
}
