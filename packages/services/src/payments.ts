import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { schema } from "@garden/db";
import type { Booking, Payment } from "@garden/db";
import { initiateStkPush, parseC2BConfirmation, parseStkCallback, type ParsedCallback } from "@garden/integrations";
import { audit, getSettings, type ServiceContext } from "./context";
import { netPaidForBooking, recalculateInvoices, generateInvoice } from "./invoices";
import { confirmBooking } from "./bookings";
import { sendProactive } from "./notify";
import { ConflictError, ForbiddenError, NotFoundError, PolicyError, ValidationError, kes, requireStaff } from "./types";

async function scopedBooking(ctx: ServiceContext, bookingId: string): Promise<Booking> {
  const booking = await ctx.db.query.bookings.findFirst({
    where: and(eq(schema.bookings.id, bookingId), eq(schema.bookings.tenantId, ctx.tenantId)),
  });
  if (!booking) throw new NotFoundError("Booking", bookingId);
  if (ctx.principal.type === "customer" && booking.customerId !== ctx.principal.customerId) {
    throw new ForbiddenError("You can only pay for your own booking.");
  }
  return booking;
}

async function confirmIfDepositMet(ctx: ServiceContext, booking: Booking): Promise<void> {
  if (booking.status !== "hold" && booking.status !== "inquiry") return;
  const paid = await netPaidForBooking(ctx, booking.id);
  if (paid >= booking.depositRequiredKes && booking.depositRequiredKes > 0) {
    await confirmBooking(ctx, booking.id);
  }
}

export async function recordPayment(
  ctx: ServiceContext,
  input: {
    bookingId: string;
    invoiceId?: string | null;
    method: "mpesa" | "cash" | "bank" | "card";
    amountKes: number;
    mpesaReceipt?: string | null;
    phone?: string | null;
    receivedAt?: Date;
    accountRef?: string | null;
    rawPayload?: Record<string, unknown>;
    notifyCustomer?: boolean;
  },
): Promise<Payment> {
  const booking = await scopedBooking(ctx, input.bookingId);
  if (input.amountKes <= 0) throw new ValidationError("Payment amount must be greater than zero.");
  if (input.mpesaReceipt) {
    const duplicate = await ctx.db.query.payments.findFirst({
      where: and(
        eq(schema.payments.tenantId, ctx.tenantId),
        eq(schema.payments.mpesaReceipt, input.mpesaReceipt),
      ),
    });
    if (duplicate) return duplicate; // idempotent replay
  }

  const [payment] = await ctx.db
    .insert(schema.payments)
    .values({
      tenantId: ctx.tenantId,
      bookingId: booking.id,
      invoiceId: input.invoiceId ?? null,
      method: input.method,
      amountKes: input.amountKes,
      mpesaReceipt: input.mpesaReceipt ?? null,
      phone: input.phone ?? null,
      accountRef: input.accountRef ?? null,
      status: "succeeded",
      rawPayload: input.rawPayload ?? null,
      receivedAt: input.receivedAt ?? new Date(),
    })
    .returning();

  await recalculateInvoices(ctx, booking.id);
  await confirmIfDepositMet(ctx, booking);
  await audit(ctx, "payment.recorded", "payment", payment!.id, {
    bookingId: booking.id,
    method: input.method,
    amountKes: input.amountKes,
  });

  if (input.notifyCustomer !== false && (input.method === "mpesa" || input.amountKes >= 1000)) {
    const customer = await ctx.db.query.customers.findFirst({
      where: eq(schema.customers.id, booking.customerId),
    });
    const settings = await getSettings(ctx);
    if (customer) {
      const template = settings.preset.templates.payment_received;
      if (template) {
        await sendProactive(ctx, {
          customer,
          templateName: "payment_received",
          body: template,
          vars: {
            amount: kes(input.amountKes),
            date: booking.startsAt.toISOString().slice(0, 10),
          },
          language: customer.language,
        });
      }
    }
  }
  return payment!;
}

export async function initiateStk(
  ctx: ServiceContext,
  input: { bookingId: string; invoiceId?: string; phone?: string; amountKes?: number },
): Promise<{ payment: Payment; customerMessage: string; mocked: boolean }> {
  const booking = await scopedBooking(ctx, input.bookingId);
  const customer = await ctx.db.query.customers.findFirst({
    where: eq(schema.customers.id, booking.customerId),
  });
  if (!customer) throw new NotFoundError("Customer", booking.customerId);
  const phone = input.phone ?? customer.phoneE164;

  let invoiceId = input.invoiceId ?? null;
  let amount = input.amountKes;
  if (!amount) {
    if (!invoiceId) {
      const invoice = await generateInvoice(ctx, { bookingId: booking.id, kind: "deposit" }).catch(async () => {
        return generateInvoice(ctx, { bookingId: booking.id, kind: "balance" });
      });
      invoiceId = invoice.id;
      amount = invoice.balanceKes;
    } else {
      const invoice = await ctx.db.query.invoices.findFirst({
        where: and(eq(schema.invoices.id, invoiceId), eq(schema.invoices.tenantId, ctx.tenantId)),
      });
      if (!invoice) throw new NotFoundError("Invoice", invoiceId);
      amount = invoice.balanceKes;
    }
  }
  if (!amount || amount <= 0) throw new ValidationError("Nothing to pay on this booking.");
  if (ctx.principal.type === "customer" && phone !== ctx.principal.phoneE164) {
    throw new ForbiddenError("Payment requests can only go to your own WhatsApp number.");
  }

  const [pending] = await ctx.db
    .insert(schema.payments)
    .values({
      tenantId: ctx.tenantId,
      bookingId: booking.id,
      invoiceId,
      method: "mpesa",
      amountKes: amount,
      phone,
      status: "pending",
    })
    .returning();

  try {
    const stk = await initiateStkPush({
      phone,
      amountKes: amount,
      accountRef: invoiceId ? `INV${invoiceId.slice(-6)}` : `BK${booking.id.slice(-6)}`,
      description: "Booking payment",
    });
    const [updated] = await ctx.db
      .update(schema.payments)
      .set({
        mpesaCheckoutRequestId: stk.checkoutRequestId,
        rawPayload: { merchantRequestId: stk.merchantRequestId, mocked: stk.mocked },
      })
      .where(eq(schema.payments.id, pending!.id))
      .returning();
    await audit(ctx, "payment.stk_initiated", "payment", pending!.id, { amountKes: amount });
    return { payment: updated!, customerMessage: stk.customerMessage, mocked: stk.mocked };
  } catch (error) {
    await ctx.db
      .update(schema.payments)
      .set({ status: "failed", rawPayload: { error: error instanceof Error ? error.message : String(error) } })
      .where(eq(schema.payments.id, pending!.id));
    throw error;
  }
}

async function applySuccessfulCallback(
  ctx: ServiceContext,
  payment: Payment,
  parsed: ParsedCallback,
): Promise<Payment> {
  if (payment.status === "succeeded") return payment;
  const [updated] = await ctx.db
    .update(schema.payments)
    .set({
      status: "succeeded",
      mpesaReceipt: parsed.receipt,
      phone: parsed.phone ?? payment.phone,
      amountKes: parsed.amountKes > 0 ? parsed.amountKes : payment.amountKes,
      rawPayload: parsed.raw,
      receivedAt: new Date(),
    })
    .where(eq(schema.payments.id, payment.id))
    .returning();
  const booking = payment.bookingId
    ? await ctx.db.query.bookings.findFirst({ where: eq(schema.bookings.id, payment.bookingId) })
    : null;
  if (booking) {
    await recalculateInvoices(ctx, booking.id);
    await confirmIfDepositMet(ctx, booking);
  }
  await audit(ctx, "payment.mpesa_callback", "payment", payment.id, {
    resultCode: parsed.resultCode,
    receipt: parsed.receipt,
  });
  return updated!;
}

export async function handleStkCallback(ctx: ServiceContext, payload: unknown): Promise<Payment | null> {
  const parsed = parseStkCallback(payload);
  const payment = await ctx.db.query.payments.findFirst({
    where: and(
      eq(schema.payments.tenantId, ctx.tenantId),
      eq(schema.payments.mpesaCheckoutRequestId, parsed.checkoutRequestId),
    ),
  });
  if (!payment) {
    // Callback for a checkout we do not know (e.g. another environment).
    await ctx.db.insert(schema.integrationsLog).values({
      tenantId: ctx.tenantId,
      kind: "mpesa",
      direction: "inbound",
      request: parsed.raw,
      response: { matched: false },
      ok: false,
      error: "Unknown CheckoutRequestID",
    });
    return null;
  }
  if (!parsed.success) {
    const [failed] = await ctx.db
      .update(schema.payments)
      .set({ status: "failed", rawPayload: parsed.raw })
      .where(eq(schema.payments.id, payment.id))
      .returning();
    await audit(ctx, "payment.mpesa_failed", "payment", payment.id, { resultDesc: parsed.resultDesc });
    return failed ?? null;
  }
  return applySuccessfulCallback(ctx, payment, parsed);
}

/**
 * C2B / Till confirmation with no prior checkout. Matches by account reference
 * (invoice number) or payer phone; otherwise lands in reconciliation.
 */
export async function handleC2BCallback(ctx: ServiceContext, payload: unknown): Promise<Payment> {
  const parsed = parseC2BConfirmation(payload);
  const existing = parsed.receipt
    ? await ctx.db.query.payments.findFirst({
        where: and(
          eq(schema.payments.tenantId, ctx.tenantId),
          eq(schema.payments.mpesaReceipt, parsed.receipt),
        ),
      })
    : null;
  if (existing) return existing;

  let booking: Booking | null = null;
  const accountRef = String((payload as Record<string, unknown>).BillRefNumber ?? "");
  if (accountRef) {
    const invoice = await ctx.db.query.invoices.findFirst({
      where: and(eq(schema.invoices.tenantId, ctx.tenantId), eq(schema.invoices.number, accountRef)),
    });
    if (invoice) {
      booking =
        (await ctx.db.query.bookings.findFirst({
          where: eq(schema.bookings.id, invoice.bookingId),
        })) ?? null;
    }
  }
  if (!booking && parsed.phone) {
    const customer = await ctx.db.query.customers.findFirst({
      where: and(eq(schema.customers.tenantId, ctx.tenantId), eq(schema.customers.phoneE164, parsed.phone)),
    });
    if (customer) {
      booking =
        (await ctx.db.query.bookings.findFirst({
          where: and(
            eq(schema.bookings.tenantId, ctx.tenantId),
            eq(schema.bookings.customerId, customer.id),
            eq(schema.bookings.status, "hold"),
          ),
          orderBy: desc(schema.bookings.createdAt),
        })) ?? null;
    }
  }

  const [payment] = await ctx.db
    .insert(schema.payments)
    .values({
      tenantId: ctx.tenantId,
      bookingId: booking?.id ?? null,
      method: "mpesa",
      amountKes: parsed.amountKes,
      mpesaReceipt: parsed.receipt,
      phone: parsed.phone,
      accountRef: accountRef || null,
      status: "succeeded",
      rawPayload: parsed.raw,
      receivedAt: new Date(),
    })
    .returning();

  if (booking) {
    await recalculateInvoices(ctx, booking.id);
    await confirmIfDepositMet(ctx, booking);
  }
  await audit(ctx, "payment.c2b", "payment", payment!.id, { matched: Boolean(booking) });
  return payment!;
}

export async function matchUnmatchedPayment(
  ctx: ServiceContext,
  paymentId: string,
  input: { bookingId: string; invoiceId?: string },
): Promise<Payment> {
  requireStaff(ctx.principal);
  const payment = await ctx.db.query.payments.findFirst({
    where: and(eq(schema.payments.id, paymentId), eq(schema.payments.tenantId, ctx.tenantId)),
  });
  if (!payment) throw new NotFoundError("Payment", paymentId);
  if (payment.bookingId) throw new ConflictError("This payment is already matched.");
  const booking = await scopedBooking(ctx, input.bookingId);
  const [updated] = await ctx.db
    .update(schema.payments)
    .set({ bookingId: booking.id, invoiceId: input.invoiceId ?? null })
    .where(eq(schema.payments.id, paymentId))
    .returning();
  await recalculateInvoices(ctx, booking.id);
  await confirmIfDepositMet(ctx, booking);
  await audit(ctx, "payment.matched", "payment", paymentId, { bookingId: booking.id });
  return updated!;
}

export async function recordRefund(
  ctx: ServiceContext,
  input: { bookingId: string; amountKes: number; reason: string },
): Promise<Payment> {
  if (ctx.principal.type === "staff" && ctx.principal.role !== "owner") {
    throw new ForbiddenError("Only an owner can record refunds.");
  }
  const booking = await scopedBooking(ctx, input.bookingId);
  if (input.amountKes <= 0) throw new ValidationError("Refund must be greater than zero.");
  const paid = await netPaidForBooking(ctx, booking.id);
  if (input.amountKes > paid) throw new PolicyError("Refund exceeds the amount paid.");
  const [payment] = await ctx.db
    .insert(schema.payments)
    .values({
      tenantId: ctx.tenantId,
      bookingId: booking.id,
      method: "refund",
      amountKes: input.amountKes,
      status: "succeeded",
      receivedAt: new Date(),
      rawPayload: { reason: input.reason },
    })
    .returning();
  await recalculateInvoices(ctx, booking.id);
  await audit(ctx, "payment.refunded", "payment", payment!.id, {
    amountKes: input.amountKes,
    reason: input.reason,
  });
  return payment!;
}

export async function listPayments(
  ctx: ServiceContext,
  input: { bookingId?: string; limit?: number } = {},
): Promise<Payment[]> {
  return ctx.db.query.payments.findMany({
    where: and(
      eq(schema.payments.tenantId, ctx.tenantId),
      input.bookingId ? eq(schema.payments.bookingId, input.bookingId) : undefined,
    ),
    orderBy: desc(schema.payments.createdAt),
    limit: input.limit ?? 100,
  });
}

export async function listUnmatchedPayments(ctx: ServiceContext): Promise<Payment[]> {
  requireStaff(ctx.principal);
  return ctx.db.query.payments.findMany({
    where: and(
      eq(schema.payments.tenantId, ctx.tenantId),
      isNull(schema.payments.bookingId),
      eq(schema.payments.status, "succeeded"),
    ),
    orderBy: desc(schema.payments.receivedAt),
    limit: 100,
  });
}

export async function revenueSummary(ctx: ServiceContext, from: Date, to: Date) {
  const [row] = await ctx.db
    .select({
      collected: sql<number>`coalesce(sum(case when ${schema.payments.method} <> 'refund' then ${schema.payments.amountKes} else 0 end), 0)::int`,
      refunded: sql<number>`coalesce(sum(case when ${schema.payments.method} = 'refund' then ${schema.payments.amountKes} else 0 end), 0)::int`,
    })
    .from(schema.payments)
    .where(
      and(
        eq(schema.payments.tenantId, ctx.tenantId),
        eq(schema.payments.status, "succeeded"),
        sql`${schema.payments.receivedAt} >= ${from}`,
        sql`${schema.payments.receivedAt} < ${to}`,
      ),
    );
  return { collectedKes: row?.collected ?? 0, refundedKes: row?.refunded ?? 0 };
}

export async function simulateMpesaSuccess(
  ctx: ServiceContext,
  paymentId: string,
): Promise<Payment> {
  if ((process.env.MPESA_MODE ?? "mock") !== "mock") {
    throw new PolicyError("Simulation is only available in mock mode.");
  }
  requireStaff(ctx.principal);
  const payment = await ctx.db.query.payments.findFirst({
    where: and(eq(schema.payments.id, paymentId), eq(schema.payments.tenantId, ctx.tenantId)),
  });
  if (!payment) throw new NotFoundError("Payment", paymentId);
  const parsed: ParsedCallback = {
    checkoutRequestId: payment.mpesaCheckoutRequestId ?? payment.id,
    merchantRequestId: null,
    receipt: `MOCK${Date.now().toString().slice(-8)}`,
    amountKes: payment.amountKes,
    phone: payment.phone,
    success: true,
    resultCode: 0,
    resultDesc: "Mock success",
    raw: { simulated: true },
  };
  return applySuccessfulCallback(ctx, payment, parsed);
}
