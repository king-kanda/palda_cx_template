"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  getInvoiceDetail,
  initiateStk,
  matchUnmatchedPayment,
  recordPayment,
  requestPayment,
  sendPaymentOptions,
  sendInvoice,
  simulateMpesaSuccess,
  voidInvoice,
  withPrincipal,
} from "@garden/services";
import { requireSession } from "@/lib/auth";
import { principalOf } from "@/lib/principal";

function fail(path: string, error: unknown): never {
  const message = error instanceof Error ? error.message : "Something went wrong.";
  redirect(`${path}?error=${encodeURIComponent(message)}`);
}

export async function sendInvoiceFromListAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  const invoiceId = String(formData.get("invoiceId") ?? "");
  try {
    await withPrincipal(principalOf(session), (ctx) => sendInvoice(ctx, invoiceId));
    revalidatePath("/invoices");
    revalidatePath(`/invoices/${invoiceId}`);
  } catch (error) {
    fail("/invoices", error);
  }
}

export async function voidInvoiceAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  const invoiceId = String(formData.get("invoiceId") ?? "");
  try {
    await withPrincipal(principalOf(session), (ctx) => voidInvoice(ctx, invoiceId));
    revalidatePath("/invoices");
    revalidatePath(`/invoices/${invoiceId}`);
  } catch (error) {
    fail(`/invoices/${invoiceId}`, error);
  }
}

export async function recordInvoicePaymentAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  const invoiceId = String(formData.get("invoiceId") ?? "");
  const principal = principalOf(session);
  const amount = Number(formData.get("amountKes") ?? 0);
  const method = String(formData.get("method") ?? "mpesa") as "mpesa" | "cash" | "bank" | "card";
  const receipt = String(formData.get("mpesaReceipt") ?? "").trim();

  try {
    const detail = await withPrincipal(principal, (ctx) => getInvoiceDetail(ctx, invoiceId));
    await withPrincipal(principal, (ctx) =>
      recordPayment(ctx, {
        bookingId: detail.booking.id,
        invoiceId: detail.invoice.id,
        method,
        amountKes: amount,
        mpesaReceipt: receipt || undefined,
        phone: detail.customer.phoneE164,
        notifyCustomer: false,
      }),
    );
    revalidatePath("/invoices");
    revalidatePath(`/invoices/${invoiceId}`);
    revalidatePath(`/bookings/${detail.booking.id}`);
  } catch (error) {
    fail(`/invoices/${invoiceId}`, error);
  }
}

/** STK push for the invoice balance (mock mode records a pending payment). */
export async function initiateStkAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  const invoiceId = String(formData.get("invoiceId") ?? "");
  const phone = String(formData.get("phone") ?? "").trim();
  const amount = Number(formData.get("amountKes") ?? 0);
  try {
    const principal = principalOf(session);
    const detail = await withPrincipal(principal, (ctx) => getInvoiceDetail(ctx, invoiceId));
    await withPrincipal(principal, (ctx) =>
      initiateStk(ctx, {
        bookingId: detail.booking.id,
        invoiceId: detail.invoice.id,
        phone: phone || undefined,
        amountKes: amount > 0 ? amount : undefined,
      }),
    );
    revalidatePath(`/invoices/${invoiceId}`);
    revalidatePath("/invoices");
    revalidatePath(`/bookings/${detail.booking.id}`);
  } catch (error) {
    fail(`/invoices/${invoiceId}`, error);
  }
}

/** Attach an unmatched M-Pesa receipt to this invoice's booking. */
export async function matchPaymentAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  const invoiceId = String(formData.get("invoiceId") ?? "");
  const paymentId = String(formData.get("paymentId") ?? "");
  const bookingId = String(formData.get("bookingId") ?? "");
  try {
    await withPrincipal(principalOf(session), (ctx) =>
      matchUnmatchedPayment(ctx, paymentId, { bookingId, invoiceId }),
    );
    revalidatePath(`/invoices/${invoiceId}`);
    revalidatePath("/invoices");
    revalidatePath(`/bookings/${bookingId}`);
  } catch (error) {
    fail(`/invoices/${invoiceId}`, error);
  }
}

export async function simulateMpesaAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  const invoiceId = String(formData.get("invoiceId") ?? "");
  const paymentId = String(formData.get("paymentId") ?? "");
  try {
    await withPrincipal(principalOf(session), (ctx) => simulateMpesaSuccess(ctx, paymentId));
    revalidatePath(`/invoices/${invoiceId}`);
    revalidatePath(`/bookings`);
    revalidatePath("/invoices");
  } catch (error) {
    fail(`/invoices/${invoiceId}`, error);
  }
}

/** Sends the customer the WhatsApp payment message (a "Pay with M-Pesa" button and a "Pay online" link, depending on the business's providers). */
export async function sendPaymentOptionsAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  const invoiceId = String(formData.get("invoiceId") ?? "");
  let notice = "";
  try {
    const principal = principalOf(session);
    const detail = await withPrincipal(principal, (ctx) => getInvoiceDetail(ctx, invoiceId));
    const result = await withPrincipal(principal, (ctx) =>
      sendPaymentOptions(ctx, { bookingId: detail.booking.id, invoiceId: detail.invoice.id }),
    );
    notice = result.sent
      ? result.kind === "stk"
        ? "M-Pesa prompt sent to the customer."
        : "Payment message sent on WhatsApp."
      : `Couldn't send the WhatsApp message${result.message ? `: ${result.message}` : "."}`;
    revalidatePath(`/invoices/${invoiceId}`);
  } catch (error) {
    fail(`/invoices/${invoiceId}`, error);
  }
  redirect(`/invoices/${invoiceId}?notice=${encodeURIComponent(notice)}`);
}

/** Makes a hosted payment link for the balance and shows it, to share by hand. */
export async function createPaymentLinkAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  const invoiceId = String(formData.get("invoiceId") ?? "");
  let url = "";
  try {
    const principal = principalOf(session);
    const detail = await withPrincipal(principal, (ctx) => getInvoiceDetail(ctx, invoiceId));
    const result = await withPrincipal(principal, (ctx) =>
      requestPayment(ctx, { bookingId: detail.booking.id, invoiceId: detail.invoice.id, mode: "link" }),
    );
    url = result.url ?? "";
    revalidatePath(`/invoices/${invoiceId}`);
  } catch (error) {
    fail(`/invoices/${invoiceId}`, error);
  }
  redirect(`/invoices/${invoiceId}?link=${encodeURIComponent(url)}`);
}
