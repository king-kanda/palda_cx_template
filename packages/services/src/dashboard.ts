import { and, asc, eq, gte, inArray, lt, lte, sql } from "drizzle-orm";
import { schema } from "@garden/db";
import { getSettings, type ServiceContext } from "./context";
import { addDays, dateKey, endOfNairobiDay, monthBounds, monthKeyOf, startOfNairobiDay } from "./tz";
import type { Booking, Customer, Offering } from "@garden/db";

export type DashboardData = {
  kpis: {
    confirmedThisMonth: number;
    activeHolds: number;
    cancelledThisMonth: number;
    revenueThisMonthKes: number;
    outstandingKes: number;
    needsHuman: number;
  };
  next7Days: {
    booking: Booking;
    customer: Customer;
    offering: Offering;
    resources: string[];
  }[];
  revenueSeries: { month: string; label: string; collectedKes: number }[];
  todayKey: string;
  monthLabel: string;
};

async function resourceNamesFor(ctx: ServiceContext, bookingIds: string[]) {
  if (bookingIds.length === 0) return new Map<string, string[]>();
  const rows = await ctx.db
    .select({
      bookingId: schema.bookingResources.bookingId,
      name: schema.resources.name,
    })
    .from(schema.bookingResources)
    .innerJoin(schema.resources, eq(schema.bookingResources.resourceId, schema.resources.id))
    .where(inArray(schema.bookingResources.bookingId, bookingIds));
  const map = new Map<string, string[]>();
  for (const row of rows) {
    const list = map.get(row.bookingId) ?? [];
    list.push(row.name);
    map.set(row.bookingId, list);
  }
  return map;
}

export async function getDashboard(ctx: ServiceContext, now = new Date()): Promise<DashboardData> {
  const { start: monthStart, end: monthEnd } = monthBounds(monthKeyOf(now));
  const today = dateKey(now);

  const monthBookings = await ctx.db.query.bookings.findMany({
    where: and(
      eq(schema.bookings.tenantId, ctx.tenantId),
      gte(schema.bookings.startsAt, monthStart),
      lt(schema.bookings.startsAt, monthEnd),
    ),
    columns: { status: true },
  });
  const confirmedThisMonth = monthBookings.filter((b) => ["confirmed", "completed"].includes(b.status)).length;
  const cancelledThisMonth = monthBookings.filter((b) => b.status === "cancelled").length;

  const holds = await ctx.db.query.bookings.findMany({
    where: and(eq(schema.bookings.tenantId, ctx.tenantId), eq(schema.bookings.status, "hold")),
    columns: { id: true },
  });

  const [revenueRow] = await ctx.db
    .select({
      collected: sql<number>`coalesce(sum(case when ${schema.payments.method} <> 'refund' then ${schema.payments.amountKes} else -${schema.payments.amountKes} end), 0)::int`,
    })
    .from(schema.payments)
    .where(
      and(
        eq(schema.payments.tenantId, ctx.tenantId),
        eq(schema.payments.status, "succeeded"),
        gte(schema.payments.receivedAt, monthStart),
        lt(schema.payments.receivedAt, monthEnd),
      ),
    );

  const [outstandingRow] = await ctx.db
    .select({ balance: sql<number>`coalesce(sum(${schema.invoices.balanceKes}), 0)::int` })
    .from(schema.invoices)
    .where(
      and(
        eq(schema.invoices.tenantId, ctx.tenantId),
        inArray(schema.invoices.status, ["sent", "partial", "overdue"]),
      ),
    );

  const [handoffRow] = await ctx.db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.handoffs)
    .where(and(eq(schema.handoffs.tenantId, ctx.tenantId), eq(schema.handoffs.status, "open")));
  const [approvalRow] = await ctx.db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.approvals)
    .where(and(eq(schema.approvals.tenantId, ctx.tenantId), eq(schema.approvals.status, "pending")));

  const from = startOfNairobiDay(today);
  const to = endOfNairobiDay(addDays(today, 6));
  const upcoming = await ctx.db
    .select({ booking: schema.bookings, customer: schema.customers, offering: schema.offerings })
    .from(schema.bookings)
    .innerJoin(schema.customers, eq(schema.bookings.customerId, schema.customers.id))
    .innerJoin(schema.offerings, eq(schema.bookings.offeringId, schema.offerings.id))
    .where(
      and(
        eq(schema.bookings.tenantId, ctx.tenantId),
        gte(schema.bookings.startsAt, from),
        lte(schema.bookings.startsAt, to),
        inArray(schema.bookings.status, ["hold", "confirmed"]),
      ),
    )
    .orderBy(asc(schema.bookings.startsAt))
    .limit(50);
  const names = await resourceNamesFor(ctx, upcoming.map((u) => u.booking.id));

  const series: { month: string; label: string; collectedKes: number }[] = [];
  for (let i = 5; i >= 0; i -= 1) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 15);
    const key = monthKeyOf(d);
    const bounds = monthBounds(key);
    const [row] = await ctx.db
      .select({
        collected: sql<number>`coalesce(sum(case when ${schema.payments.method} <> 'refund' then ${schema.payments.amountKes} else -${schema.payments.amountKes} end), 0)::int`,
      })
      .from(schema.payments)
      .where(
        and(
          eq(schema.payments.tenantId, ctx.tenantId),
          eq(schema.payments.status, "succeeded"),
          gte(schema.payments.receivedAt, bounds.start),
          lt(schema.payments.receivedAt, bounds.end),
        ),
      );
    series.push({
      month: key,
      label: new Intl.DateTimeFormat("en-GB", { month: "short" }).format(d),
      collectedKes: row?.collected ?? 0,
    });
  }

  const settings = await getSettings(ctx);
  return {
    kpis: {
      confirmedThisMonth,
      activeHolds: holds.length,
      cancelledThisMonth,
      revenueThisMonthKes: revenueRow?.collected ?? 0,
      outstandingKes: outstandingRow?.balance ?? 0,
      needsHuman: (handoffRow?.count ?? 0) + (approvalRow?.count ?? 0),
    },
    next7Days: upcoming.map((u) => ({
      ...u,
      resources: names.get(u.booking.id) ?? [],
    })),
    revenueSeries: series,
    todayKey: today,
    monthLabel: new Intl.DateTimeFormat("en-GB", {
      month: "long",
      year: "numeric",
      timeZone: "Africa/Nairobi",
    }).format(now),
  };
}

export async function occupancyRate(ctx: ServiceContext, dateKeyValue: string): Promise<number> {
  const { getAvailabilityGrid } = await import("./availability");
  const grid = await getAvailabilityGrid(ctx, { fromDateKey: dateKeyValue, days: 1 });
  if (grid.resources.length === 0) return 0;
  const used = grid.resources.filter((r) => grid.cells[`${r.id}:${dateKeyValue}`]?.status !== "free");
  return Math.round((used.length / grid.resources.length) * 100);
}
