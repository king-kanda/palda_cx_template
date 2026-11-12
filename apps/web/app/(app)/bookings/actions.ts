"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  attachMeetingLink,
  cancelBookingFor,
  confirmBookingFor,
  createBookingFor,
  generateInvoice,
  getBookingFor,
  recordPayment,
  requestReview,
  rescheduleBookingFor,
  sendIntakeForm,
  sendInvoice,
  withPrincipal,
  ServiceError,
} from "@garden/services";
import { requireSession } from "@/lib/auth";
import { principalOf } from "@/lib/principal";
import { nairobiTime } from "@garden/services";

function fail(path: string, error: unknown): never {
  const message =
    error instanceof ServiceError
      ? error.message
      : error instanceof Error
        ? error.message
        : "Something went wrong.";
  redirect(`${path}?error=${encodeURIComponent(message)}`);
}

export async function createBookingAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  const principal = principalOf(session);

  const offeringId = String(formData.get("offeringId") ?? "");
  const resourceId = String(formData.get("resourceId") ?? "");
  const date = String(formData.get("date") ?? "");
  const time = String(formData.get("time") ?? "09:00");
  const partySize = Number(formData.get("partySize") ?? 1);
  const status = String(formData.get("status") ?? "hold") as "hold" | "confirmed" | "inquiry";
  const customerId = String(formData.get("customerId") ?? "").trim();
  const customerName = String(formData.get("customerName") ?? "").trim();
  const customerPhone = String(formData.get("customerPhone") ?? "").trim();
  const eventType = String(formData.get("eventType") ?? "other");
  const notes = String(formData.get("notes") ?? "").trim();

  if (!offeringId || !resourceId || !date) {
    fail("/bookings/new", new Error("Package, space and date are required."));
  }
  if (!customerId && (!customerName || !customerPhone)) {
    fail("/bookings/new", new Error("Pick an existing customer or enter a name and phone."));
  }

  try {
    const created = await createBookingFor(principal, {
      customerId: customerId || undefined,
      customer:
        !customerId && customerName && customerPhone
          ? { name: customerName, phone: customerPhone }
          : undefined,
      offeringId,
      resourceIds: [resourceId],
      startsAt: nairobiTime(date, time).toISOString(),
      partySize: Number.isFinite(partySize) && partySize > 0 ? partySize : 1,
      status,
      source: "staff",
      attributes: { eventType },
      notes: notes || undefined,
      idempotencyKey: `ui-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    });
    revalidatePath("/bookings");
    redirect(`/bookings/${created.booking.id}`);
  } catch (error) {
    if (error instanceof Error && error.message === "NEXT_REDIRECT") throw error;
    fail("/bookings/new", error);
  }
}

export async function confirmBookingAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  const id = String(formData.get("bookingId") ?? "");
  try {
    await confirmBookingFor(principalOf(session), id);
    revalidatePath(`/bookings/${id}`);
    revalidatePath("/bookings");
  } catch (error) {
    fail(`/bookings/${id}`, error);
  }
}

export async function cancelBookingAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  const id = String(formData.get("bookingId") ?? "");
  const reason = String(formData.get("reason") ?? "Staff cancellation");
  try {
    const result = await cancelBookingFor(principalOf(session), id, reason);
    revalidatePath(`/bookings/${id}`);
    revalidatePath("/bookings");
    if (result.status === "requires_approval") {
      redirect(`/approvals?requested=${result.approvalId}`);
    }
  } catch (error) {
    if (error instanceof Error && error.message === "NEXT_REDIRECT") throw error;
    fail(`/bookings/${id}`, error);
  }
}

export async function rescheduleBookingAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  const id = String(formData.get("bookingId") ?? "");
  const date = String(formData.get("date") ?? "");
  const time = String(formData.get("time") ?? "");
  try {
    await rescheduleBookingFor(principalOf(session), id, {
      startsAt: nairobiTime(date, time).toISOString(),
    });
    revalidatePath(`/bookings/${id}`);
    revalidatePath("/bookings");
  } catch (error) {
    fail(`/bookings/${id}`, error);
  }
}

export async function generateInvoiceAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  const id = String(formData.get("bookingId") ?? "");
  const kind = String(formData.get("kind") ?? "deposit") as "deposit" | "balance" | "full";
  try {
    const invoice = await withPrincipal(principalOf(session), (ctx) =>
      generateInvoice(ctx, { bookingId: id, kind }),
    );
    revalidatePath(`/bookings/${id}`);
    revalidatePath("/invoices");
    redirect(`/invoices?highlight=${invoice.id}`);
  } catch (error) {
    if (error instanceof Error && error.message === "NEXT_REDIRECT") throw error;
    fail(`/bookings/${id}`, error);
  }
}

export async function recordPaymentAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  const bookingId = String(formData.get("bookingId") ?? "");
  const amount = Number(formData.get("amountKes") ?? 0);
  const method = String(formData.get("method") ?? "mpesa") as "mpesa" | "cash" | "bank" | "card";
  const receipt = String(formData.get("mpesaReceipt") ?? "").trim();
  const invoiceId = String(formData.get("invoiceId") ?? "").trim();
  try {
    const detail = await getBookingFor(principalOf(session), bookingId);
    await withPrincipal(principalOf(session), (ctx) =>
      recordPayment(ctx, {
        bookingId,
        invoiceId: invoiceId || undefined,
        method,
        amountKes: amount,
        mpesaReceipt: receipt || undefined,
        phone: detail.customer.phoneE164,
        notifyCustomer: false,
      }),
    );
    revalidatePath(`/bookings/${bookingId}`);
    revalidatePath("/invoices");
    redirect(`/bookings/${bookingId}`);
  } catch (error) {
    if (error instanceof Error && error.message === "NEXT_REDIRECT") throw error;
    fail(`/bookings/${bookingId}`, error);
  }
}

export async function sendInvoiceAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  const invoiceId = String(formData.get("invoiceId") ?? "");
  try {
    await withPrincipal(principalOf(session), (ctx) => sendInvoice(ctx, invoiceId));
    revalidatePath("/invoices");
    redirect("/invoices");
  } catch (error) {
    if (error instanceof Error && error.message === "NEXT_REDIRECT") throw error;
    fail("/invoices", error);
  }
}

export async function requestReviewAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  const bookingId = String(formData.get("bookingId") ?? "");
  try {
    await withPrincipal(principalOf(session), (ctx) => requestReview(ctx, bookingId));
    revalidatePath(`/bookings/${bookingId}`);
    redirect(`/bookings/${bookingId}`);
  } catch (error) {
    if (error instanceof Error && error.message === "NEXT_REDIRECT") throw error;
    fail(`/bookings/${bookingId}`, error);
  }
}

export async function sendIntakeFormAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  const bookingId = String(formData.get("bookingId") ?? "");
  try {
    await withPrincipal(principalOf(session), (ctx) => sendIntakeForm(ctx, bookingId));
    revalidatePath(`/bookings/${bookingId}`);
    redirect(`/bookings/${bookingId}`);
  } catch (error) {
    if (error instanceof Error && error.message === "NEXT_REDIRECT") throw error;
    fail(`/bookings/${bookingId}`, error);
  }
}

export async function createMeetingLinkAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  const bookingId = String(formData.get("bookingId") ?? "");
  try {
    await withPrincipal(principalOf(session), (ctx) => attachMeetingLink(ctx, bookingId));
    revalidatePath(`/bookings/${bookingId}`);
    redirect(`/bookings/${bookingId}`);
  } catch (error) {
    if (error instanceof Error && error.message === "NEXT_REDIRECT") throw error;
    fail(`/bookings/${bookingId}`, error);
  }
}
