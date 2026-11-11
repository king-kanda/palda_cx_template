import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { schema } from "@garden/db";
import type { Booking, Customer, Invoice, Offering, Payment } from "@garden/db";
import { audit, getSettings, type ServiceContext } from "./context";
import { cancelReminders } from "./reminders";
import { renderTemplate, sendProactive } from "./notify";
import { addDays, dateKey, formatNairobi, formatNairobiTime, nairobiTime } from "./tz";
import { ConflictError, NotFoundError, PolicyError, ValidationError } from "./types";

const APP_URL = process.env.APP_URL ?? "http://localhost:3000";

async function nextInvoiceNumber(ctx: ServiceContext): Promise<string> {
  const year = new Date().getUTCFullYear();
  const [row] = await ctx.db
    .insert(schema.counters)
    .values({ tenantId: ctx.tenantId, key: `invoice:${year}`, value: 1 })
    .onConflictDoUpdate({
      target: [schema.counters.tenantId, schema.counters.key],
      set: { value: sql`${schema.counters.value} + 1` },
    })
    .returning();
  const seq = String(row?.value ?? 1).padStart(4, "0");
  return `INV-${year}-${seq}`;
}

export async function netPaidForBooking(ctx: ServiceContext, bookingId: string): Promise<number> {
  const rows = await ctx.db
    .select({
      method: schema.payments.method,
      amount: schema.payments.amountKes,
    })
    .from(schema.payments)
    .where(
      and(
        eq(schema.payments.tenantId, ctx.tenantId),
        eq(schema.payments.bookingId, bookingId),
        eq(schema.payments.status, "succeeded"),
      ),
    );
  const paid = rows.filter((r) => r.method !== "refund").reduce((s, r) => s + r.amount, 0);
  const refunded = rows.filter((r) => r.method === "refund").reduce((s, r) => s + r.amount, 0);
  return paid - refunded;
}

/** Distributes net paid across the booking's invoices, oldest first. */
export async function recalculateInvoices(ctx: ServiceContext, bookingId: string): Promise<Invoice[]> {
  const invoices = await ctx.db.query.invoices.findMany({
    where: and(eq(schema.invoices.tenantId, ctx.tenantId), eq(schema.invoices.bookingId, bookingId)),
    orderBy: asc(schema.invoices.createdAt),
  });
  if (invoices.length === 0) return [];
  let remaining = Math.max(0, await netPaidForBooking(ctx, bookingId));
  const now = new Date();
  const updated: Invoice[] = [];
  for (const invoice of invoices) {
    if (invoice.status === "void") {
      updated.push(invoice);
      continue;
    }
    const allocated = Math.min(remaining, invoice.totalKes);
    remaining -= allocated;
    const balance = Math.max(0, invoice.totalKes - allocated);
    let status: Invoice["status"];
    if (balance === 0) status = "paid";
    else if (allocated > 0) status = "partial";
    else if (invoice.dueAt && invoice.dueAt.getTime() < now.getTime() && invoice.status !== "draft")
      status = "overdue";
    else status = invoice.issuedAt ? "sent" : "draft";
    const [row] = await ctx.db
      .update(schema.invoices)
      .set({ balanceKes: balance, status })
      .where(eq(schema.invoices.id, invoice.id))
      .returning();
    if (row) updated.push(row);
  }
  return updated;
}

export async function generateInvoice(
  ctx: ServiceContext,
  input: { bookingId: string; kind: "deposit" | "balance" | "full"; dueInDays?: number },
): Promise<Invoice> {
  const booking = await ctx.db.query.bookings.findFirst({
    where: and(eq(schema.bookings.id, input.bookingId), eq(schema.bookings.tenantId, ctx.tenantId)),
  });
  if (!booking) throw new NotFoundError("Booking", input.bookingId);
  if (["cancelled", "no_show"].includes(booking.status)) {
    throw new PolicyError("Cannot invoice a cancelled booking.");
  }

  const existing = await ctx.db.query.invoices.findFirst({
    where: and(
      eq(schema.invoices.tenantId, ctx.tenantId),
      eq(schema.invoices.bookingId, booking.id),
      eq(schema.invoices.kind, input.kind),
      inArray(schema.invoices.status, ["draft", "sent", "partial", "overdue"]),
    ),
  });
  if (existing) return existing;

  const paid = Math.max(0, await netPaidForBooking(ctx, booking.id));
  let amount: number;
  if (input.kind === "deposit") amount = Math.max(0, booking.depositRequiredKes);
  else if (input.kind === "balance") amount = Math.max(0, booking.totalKes - paid);
  else amount = booking.totalKes;

  if (amount <= 0) throw new ValidationError("Nothing left to invoice for this booking.");

  const now = new Date();
  const dueAt =
    input.kind === "balance"
      ? new Date(Math.max(now.getTime(), booking.startsAt.getTime() - 14 * 86_400_000))
      : new Date(now.getTime() + (input.dueInDays ?? 3) * 86_400_000);

  const [invoice] = await ctx.db
    .insert(schema.invoices)
    .values({
      tenantId: ctx.tenantId,
      bookingId: booking.id,
      number: await nextInvoiceNumber(ctx),
      kind: input.kind,
      status: "draft",
      issuedAt: null,
      dueAt,
      totalKes: amount,
      balanceKes: amount,
    })
    .returning();

  await recalculateInvoices(ctx, booking.id);
  await audit(ctx, "invoice.generated", "invoice", invoice!.id, {
    bookingId: booking.id,
    kind: input.kind,
    amount,
  });
  return invoice!;
}

export async function sendInvoice(ctx: ServiceContext, invoiceId: string): Promise<Invoice> {
  const invoice = await ctx.db.query.invoices.findFirst({
    where: and(eq(schema.invoices.id, invoiceId), eq(schema.invoices.tenantId, ctx.tenantId)),
  });
  if (!invoice) throw new NotFoundError("Invoice", invoiceId);
  if (invoice.status === "paid") throw new PolicyError("This invoice is already paid.");
  const booking = await ctx.db.query.bookings.findFirst({
    where: eq(schema.bookings.id, invoice.bookingId),
  });
  const customer = booking
    ? await ctx.db.query.customers.findFirst({ where: eq(schema.customers.id, booking.customerId) })
    : null;
  const settings = await getSettings(ctx);

  if (booking && customer) {
    const templateName = invoice.kind === "deposit" ? "deposit_request" : "balance_due";
    const body =
      settings.preset.templates[templateName] ??
      `Hi {{customer_name}}, invoice {{invoice_number}} for KES {{amount}} is ready: {{invoice_link}}`;
    await sendProactive(ctx, {
      customer,
      templateName,
      body: body.replace(/\{\{invoice_number\}\}/g, invoice.number).replace(
        /\{\{invoice_link\}\}/g,
        `${APP_URL}/invoices/${invoice.id}/pdf`,
      ),
      vars: {
        // Templates own the "KES" prefix; the variable is the bare amount.
        amount: Math.round(invoice.totalKes),
        date: formatNairobi(booking.startsAt),
        invoice_number: invoice.number,
        invoice_link: `${APP_URL}/invoices/${invoice.id}/pdf`,
        offering: "",
      },
      language: customer.language,
    });
  }

  const [updated] = await ctx.db
    .update(schema.invoices)
    .set({ status: invoice.status === "draft" ? "sent" : invoice.status, issuedAt: invoice.issuedAt ?? new Date() })
    .where(eq(schema.invoices.id, invoiceId))
    .returning();
  await audit(ctx, "invoice.sent", "invoice", invoiceId);
  return updated!;
}

export async function voidInvoice(ctx: ServiceContext, invoiceId: string): Promise<Invoice> {
  const invoice = await ctx.db.query.invoices.findFirst({
    where: and(eq(schema.invoices.id, invoiceId), eq(schema.invoices.tenantId, ctx.tenantId)),
  });
  if (!invoice) throw new NotFoundError("Invoice", invoiceId);
  if (invoice.status === "paid") throw new ConflictError("Paid invoices cannot be voided.");
  const [updated] = await ctx.db
    .update(schema.invoices)
    .set({ status: "void", balanceKes: 0 })
    .where(eq(schema.invoices.id, invoiceId))
    .returning();
  await audit(ctx, "invoice.voided", "invoice", invoiceId);
  return updated!;
}

export async function listInvoices(
  ctx: ServiceContext,
  filters: { status?: string[]; search?: string; limit?: number } = {},
) {
  const conditions = [eq(schema.invoices.tenantId, ctx.tenantId)];
  if (filters.status?.length) conditions.push(inArray(schema.invoices.status, filters.status));
  if (filters.search) {
    conditions.push(
      sql`(${schema.invoices.number} ilike ${`%${filters.search}%`} or ${schema.customers.name} ilike ${`%${filters.search}%`})`,
    );
  }
  return ctx.db
    .select({
      invoice: schema.invoices,
      booking: schema.bookings,
      customer: schema.customers,
    })
    .from(schema.invoices)
    .innerJoin(schema.bookings, eq(schema.invoices.bookingId, schema.bookings.id))
    .innerJoin(schema.customers, eq(schema.bookings.customerId, schema.customers.id))
    .where(and(...conditions))
    .orderBy(desc(schema.invoices.createdAt))
    .limit(filters.limit ?? 100);
}

export async function getInvoiceDetail(ctx: ServiceContext, invoiceId: string) {
  const row = await ctx.db
    .select({
      invoice: schema.invoices,
      booking: schema.bookings,
      customer: schema.customers,
      offering: schema.offerings,
    })
    .from(schema.invoices)
    .innerJoin(schema.bookings, eq(schema.invoices.bookingId, schema.bookings.id))
    .innerJoin(schema.customers, eq(schema.bookings.customerId, schema.customers.id))
    .innerJoin(schema.offerings, eq(schema.bookings.offeringId, schema.offerings.id))
    .where(and(eq(schema.invoices.id, invoiceId), eq(schema.invoices.tenantId, ctx.tenantId)))
    .limit(1);
  const found = row[0];
  if (!found) throw new NotFoundError("Invoice", invoiceId);
  const payments = await ctx.db.query.payments.findMany({
    where: and(eq(schema.payments.tenantId, ctx.tenantId), eq(schema.payments.invoiceId, invoiceId)),
    orderBy: desc(schema.payments.createdAt),
  });
  const items = await ctx.db.query.bookingItems.findMany({
    where: eq(schema.bookingItems.bookingId, found.booking.id),
  });
  return { ...found, payments, items };
}

export function invoicePdfData(input: {
  businessName: string;
  invoice: Invoice;
  booking: Booking;
  customer: Customer;
  offering: Offering;
  addons: { description: string; qty: number; unitPriceKes: number }[];
  paidKes: number;
}) {
  const { invoice, booking, customer, offering, addons, paidKes, businessName } = input;
  const eventDate = formatNairobi(booking.startsAt);
  const eventTime = formatNairobiTime(booking.startsAt);
  const items =
    invoice.kind === "full"
      ? [
          { description: `${offering.name} — ${eventDate}`, qty: 1, unitPriceKes: offering.basePriceKes },
          ...addons.map((a) => ({
            description: a.description,
            qty: a.qty,
            unitPriceKes: a.unitPriceKes,
          })),
        ]
      : [
          {
            description:
              invoice.kind === "deposit"
                ? `Deposit — ${offering.name} (${eventDate})`
                : `Balance — ${offering.name} (${eventDate})`,
            qty: 1,
            unitPriceKes: invoice.totalKes,
          },
        ];
  return {
    businessName,
    invoiceNumber: invoice.number,
    kind: invoice.kind,
    status: invoice.status,
    issuedAt: invoice.issuedAt,
    dueAt: invoice.dueAt,
    customerName: customer.name,
    customerPhone: customer.phoneE164,
    bookingDate: eventDate,
    bookingTime: eventTime,
    eventType: String((booking.attributes as Record<string, unknown>)?.eventType ?? ""),
    items,
    subtotalKes: invoice.kind === "full" ? booking.subtotalKes : invoice.totalKes,
    discountKes: invoice.kind === "full" ? booking.discountKes : 0,
    taxKes: invoice.kind === "full" ? booking.taxKes : 0,
    totalKes: invoice.totalKes,
    paidKes: Math.max(0, invoice.totalKes - invoice.balanceKes),
    balanceKes: invoice.balanceKes,
    notes: booking.notes ?? undefined,
    paidTotalKes: paidKes,
  };
}

export { addDays, dateKey, nairobiTime, cancelReminders, renderTemplate };
