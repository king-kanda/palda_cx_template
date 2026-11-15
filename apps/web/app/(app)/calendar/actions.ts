"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  createBlock,
  deleteBlock,
  getBookingFor,
  nairobiTime,
  rescheduleBookingFor,
  withPrincipal,
} from "@garden/services";
import { requireSession } from "@/lib/auth";
import { principalOf } from "@/lib/principal";

export async function createBlockAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  const resourceId = String(formData.get("resourceId") ?? "");
  const date = String(formData.get("date") ?? "");
  const from = String(formData.get("from") ?? "08:00");
  const to = String(formData.get("to") ?? "18:00");
  const reason = String(formData.get("reason") ?? "Blocked");
  try {
    await withPrincipal(principalOf(session), (ctx) =>
      createBlock(ctx, {
        resourceId,
        startsAt: nairobiTime(date, from).toISOString(),
        endsAt: nairobiTime(date, to).toISOString(),
        reason,
      }),
    );
    revalidatePath("/calendar");
    redirect("/calendar");
  } catch (error) {
    if (error instanceof Error && error.message === "NEXT_REDIRECT") throw error;
    const message = error instanceof Error ? error.message : "Could not block that period.";
    redirect(`/calendar?error=${encodeURIComponent(message)}`);
  }
}

/** Drag/drop reschedule: move a booking to another day, keeping its Nairobi time. */
export async function moveBookingToDayAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  const bookingId = String(formData.get("bookingId") ?? "");
  const date = String(formData.get("date") ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) redirect("/calendar?error=Invalid%20date");
  const principal = principalOf(session);
  try {
    const detail = await getBookingFor(principal, bookingId);
    const time = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Africa/Nairobi",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(detail.booking.startsAt);
    await rescheduleBookingFor(principal, bookingId, {
      startsAt: nairobiTime(date, time).toISOString(),
    });
    revalidatePath("/calendar");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not move that booking.";
    redirect(`/calendar?error=${encodeURIComponent(message)}`);
  }
}

export async function deleteBlockAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  const blockId = String(formData.get("blockId") ?? "");
  try {
    await withPrincipal(principalOf(session), (ctx) => deleteBlock(ctx, blockId));
    revalidatePath("/calendar");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not remove that block.";
    redirect(`/calendar?error=${encodeURIComponent(message)}`);
  }
}
