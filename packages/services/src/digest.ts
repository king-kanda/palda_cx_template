import { and, asc, eq, gte, inArray, lt, lte, isNull, sql } from "drizzle-orm";
import { schema } from "@garden/db";
import { getSettings, type ServiceContext } from "./context";
import { dateKey, formatNairobi, formatNairobiTime, addDays, startOfNairobiDay, endOfNairobiDay } from "./tz";
import { kes } from "./types";
import { sendStaffAlert } from "./notify";

export type DailyDigest = {
  dateKey: string;
  text: string;
  today: { time: string; offering: string; customer: string; partySize: number; status: string; resources: string[] }[];
  unpaid: { customer: string; date: string; balanceKes: number; bookingId: string }[];
  openHandoffs: number;
  unmatchedPayments: number;
  expiringHolds: number;
};

export async function buildDailyDigest(
  ctx: ServiceContext,
  forDateKey: string = dateKey(new Date()),
): Promise<DailyDigest> {
  const settings = await getSettings(ctx);
  const dayStart = startOfNairobiDay(forDateKey);
  const dayEnd = endOfNairobiDay(forDateKey);

  const todayRows = await ctx.db
    .select({
      booking: schema.bookings,
      customer: schema.customers,
      offering: schema.offerings,
    })
    .from(schema.bookings)
    .innerJoin(schema.customers, eq(schema.bookings.customerId, schema.customers.id))
    .innerJoin(schema.offerings, eq(schema.bookings.offeringId, schema.offerings.id))
    .where(
      and(
        eq(schema.bookings.tenantId, ctx.tenantId),
        gte(schema.bookings.startsAt, dayStart),
        lt(schema.bookings.startsAt, dayEnd),
        inArray(schema.bookings.status, ["hold", "confirmed", "completed"]),
      ),
    )
    .orderBy(asc(schema.bookings.startsAt));

  const resourcesByBooking = new Map<string, string[]>();
  if (todayRows.length) {
    const rows = await ctx.db
      .select({ bookingId: schema.bookingResources.bookingId, name: schema.resources.name })
      .from(schema.bookingResources)
      .innerJoin(schema.resources, eq(schema.bookingResources.resourceId, schema.resources.id))
      .where(
        inArray(
          schema.bookingResources.bookingId,
          todayRows.map((r) => r.booking.id),
        ),
      );
    for (const row of rows) {
      const list = resourcesByBooking.get(row.bookingId) ?? [];
      list.push(row.name);
      resourcesByBooking.set(row.bookingId, list);
    }
  }

  const unpaidRows = await ctx.db
    .select({
      booking: schema.bookings,
      customer: schema.customers,
      invoice: schema.invoices,
    })
    .from(schema.invoices)
    .innerJoin(schema.bookings, eq(schema.invoices.bookingId, schema.bookings.id))
    .innerJoin(schema.customers, eq(schema.bookings.customerId, schema.customers.id))
    .where(
      and(
        eq(schema.invoices.tenantId, ctx.tenantId),
        inArray(schema.invoices.status, ["sent", "partial", "overdue"]),
        gte(schema.invoices.balanceKes, 1),
        lte(schema.bookings.startsAt, new Date(Date.now() + 14 * 86_400_000)),
      ),
    )
    .orderBy(asc(schema.bookings.startsAt))
    .limit(20);

  const [handoffRow] = await ctx.db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.handoffs)
    .where(and(eq(schema.handoffs.tenantId, ctx.tenantId), eq(schema.handoffs.status, "open")));

  const [unmatchedRow] = await ctx.db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.payments)
    .where(
      and(
        eq(schema.payments.tenantId, ctx.tenantId),
        isNull(schema.payments.bookingId),
        eq(schema.payments.status, "succeeded"),
      ),
    );

  const [holdsRow] = await ctx.db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.bookings)
    .where(
      and(
        eq(schema.bookings.tenantId, ctx.tenantId),
        eq(schema.bookings.status, "hold"),
        sql`${schema.bookings.holdExpiresAt} < ${new Date(Date.now() + 24 * 3_600_000)}`,
      ),
    );

  const today = todayRows.map((row) => ({
    time: formatNairobiTime(row.booking.startsAt),
    offering: row.offering.name,
    customer: row.customer.name,
    partySize: row.booking.partySize,
    status: row.booking.status,
    resources: resourcesByBooking.get(row.booking.id) ?? [],
  }));

  const unpaid = unpaidRows.map((row) => ({
    customer: row.customer.name,
    date: formatNairobi(row.booking.startsAt),
    balanceKes: row.invoice.balanceKes,
    bookingId: row.booking.id,
  }));

  const lines: string[] = [
    `🌿 ${settings.tenant.name} — daily digest for ${formatNairobi(dayStart, { weekday: "long", day: "numeric", month: "long" })}`,
    "",
    `Today's events (${today.length}):`,
    ...(today.length
      ? today.map(
          (t) =>
            `• ${t.time} — ${t.offering} · ${t.customer} · ${t.partySize} ${settings.labels.partySize.toLowerCase()}${t.resources.length ? ` (${t.resources.join(", ")})` : ""} [${t.status}]`,
        )
      : ["• Nothing booked"]),
    "",
    `Unpaid balances next 14 days (${unpaid.length}):`,
    ...(unpaid.length
      ? unpaid.map((u) => `• ${u.customer} — ${u.date} — ${kes(u.balanceKes)}`)
      : ["• None"]),
    "",
    `Needs attention: ${handoffRow?.count ?? 0} open handoff(s), ${unmatchedRow?.count ?? 0} unmatched M-Pesa receipt(s), ${holdsRow?.count ?? 0} hold(s) expiring within 24h.`,
  ];

  return {
    dateKey: forDateKey,
    text: lines.join("\n"),
    today,
    unpaid,
    openHandoffs: handoffRow?.count ?? 0,
    unmatchedPayments: unmatchedRow?.count ?? 0,
    expiringHolds: holdsRow?.count ?? 0,
  };
}

export async function sendDailyDigest(ctx: ServiceContext, forDateKey?: string) {
  const digest = await buildDailyDigest(ctx, forDateKey);
  const settings = await getSettings(ctx);
  await sendStaffAlert(ctx, digest.text, settings.managerPhone);
  return digest;
}
