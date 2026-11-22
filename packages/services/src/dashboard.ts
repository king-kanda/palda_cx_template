import { and, asc, desc, eq, gte, inArray, isNull, lt, lte, ne, notInArray, sql } from "drizzle-orm";
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

/* ───────────── Overview: the extra data the web dashboard shows (not part of the MCP dashboard tool) ───────────── */

export type DashboardOverview = {
  /** Trailing 12 months, oldest first: money received vs invoiced. */
  money: { month: string; label: string; collectedKes: number; billedKes: number }[];
  previous: { revenueKes: number; confirmed: number };
  /** Bookings created this month, by where they came from (whatsapp | staff | web | internal). */
  sources: { source: string; count: number }[];
  recentPayments: {
    id: string;
    customerName: string | null;
    bookingId: string | null;
    method: string;
    provider: string | null;
    amountKes: number;
    receivedAt: Date | null;
    matched: boolean;
  }[];
  unmatched: { count: number; totalKes: number };
  /** Recent audit entries, with the actor resolved to a person's name where we can. */
  activity: { id: string; actor: string; action: string; entity: string; entityId: string | null; createdAt: Date }[];
};

const MONEY_SIGNED = sql<number>`coalesce(sum(case when ${schema.payments.method} <> 'refund' then ${schema.payments.amountKes} else -${schema.payments.amountKes} end), 0)::int`;

export async function getDashboardOverview(ctx: ServiceContext, now = new Date()): Promise<DashboardOverview> {
  const thisMonth = monthKeyOf(now);
  const keys: string[] = [];
  for (let i = 11; i >= 0; i -= 1) keys.push(monthKeyOf(new Date(now.getFullYear(), now.getMonth() - i, 15)));
  const from = monthBounds(keys[0]!).start;
  const end = monthBounds(thisMonth).end;
  const prevKey = keys[10]!;
  const prev = monthBounds(prevKey);

  const nairobiMonth = (col: unknown) => sql<string>`to_char(${col} at time zone 'Africa/Nairobi', 'YYYY-MM')`;

  const collected = await ctx.db
    .select({ month: nairobiMonth(schema.payments.receivedAt), kes: MONEY_SIGNED })
    .from(schema.payments)
    .where(
      and(
        eq(schema.payments.tenantId, ctx.tenantId),
        eq(schema.payments.status, "succeeded"),
        gte(schema.payments.receivedAt, from),
        lt(schema.payments.receivedAt, end),
      ),
    )
    .groupBy(nairobiMonth(schema.payments.receivedAt));

  const billed = await ctx.db
    .select({
      month: nairobiMonth(schema.invoices.createdAt),
      kes: sql<number>`coalesce(sum(${schema.invoices.totalKes}), 0)::int`,
    })
    .from(schema.invoices)
    .where(
      and(
        eq(schema.invoices.tenantId, ctx.tenantId),
        notInArray(schema.invoices.status, ["draft", "void"]),
        gte(schema.invoices.createdAt, from),
        lt(schema.invoices.createdAt, end),
      ),
    )
    .groupBy(nairobiMonth(schema.invoices.createdAt));

  const collectedBy = new Map(collected.map((r) => [r.month, r.kes]));
  const billedBy = new Map(billed.map((r) => [r.month, r.kes]));
  // Fixed three-letter months: en-GB's Intl gives "Sept", which sits oddly beside "Aug" and "Oct".
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const money = keys.map((key) => {
    const m = Number(key.split("-")[1]);
    return {
      month: key,
      label: MONTHS[m - 1]!,
      collectedKes: collectedBy.get(key) ?? 0,
      billedKes: billedBy.get(key) ?? 0,
    };
  });

  const [prevConfirmed] = await ctx.db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.bookings)
    .where(
      and(
        eq(schema.bookings.tenantId, ctx.tenantId),
        inArray(schema.bookings.status, ["confirmed", "completed"]),
        gte(schema.bookings.startsAt, prev.start),
        lt(schema.bookings.startsAt, prev.end),
      ),
    );

  const { start: monthStart } = monthBounds(thisMonth);
  const sources = await ctx.db
    .select({ source: schema.bookings.source, count: sql<number>`count(*)::int` })
    .from(schema.bookings)
    .where(
      and(
        eq(schema.bookings.tenantId, ctx.tenantId),
        gte(schema.bookings.createdAt, monthStart),
        lt(schema.bookings.createdAt, end),
      ),
    )
    .groupBy(schema.bookings.source)
    .orderBy(desc(sql`count(*)`));

  const payments = await ctx.db
    .select({ payment: schema.payments, customerName: schema.customers.name })
    .from(schema.payments)
    .leftJoin(schema.bookings, eq(schema.payments.bookingId, schema.bookings.id))
    .leftJoin(schema.customers, eq(schema.bookings.customerId, schema.customers.id))
    .where(and(eq(schema.payments.tenantId, ctx.tenantId), eq(schema.payments.status, "succeeded")))
    .orderBy(desc(sql`coalesce(${schema.payments.receivedAt}, ${schema.payments.createdAt})`))
    .limit(6);

  const [unmatchedRow] = await ctx.db
    .select({
      count: sql<number>`count(*)::int`,
      total: sql<number>`coalesce(sum(${schema.payments.amountKes}), 0)::int`,
    })
    .from(schema.payments)
    .where(
      and(
        eq(schema.payments.tenantId, ctx.tenantId),
        isNull(schema.payments.bookingId),
        eq(schema.payments.status, "succeeded"),
      ),
    );

  const audit = await ctx.db
    .select()
    .from(schema.auditLog)
    .where(
      and(
        eq(schema.auditLog.tenantId, ctx.tenantId),
        ne(schema.auditLog.action, "seed.completed"),
        // What the Palda team does in the Engine is our back office, not the customer's activity.
        sql`${schema.auditLog.actor} not like 'engine:%'`,
        sql`${schema.auditLog.action} not like 'engine.%'`,
      ),
    )
    .orderBy(desc(schema.auditLog.createdAt))
    .limit(8);

  // Resolve "staff:<id>" / "owner:<id>" and "customer:<id>" actors to names; everything else becomes a readable label.
  const userIdOf = (actor: string) =>
    actor.startsWith("staff:") ? actor.slice(6) : actor.startsWith("owner:") ? actor.slice(6) : null;
  const staffIds = [...new Set(audit.map((a) => userIdOf(a.actor)).filter((id): id is string => id !== null))];
  const customerIds = [
    ...new Set(audit.map((a) => a.actor).filter((a) => a.startsWith("customer:")).map((a) => a.slice(9))),
  ];
  const staff = staffIds.length
    ? await ctx.db
        .select({ id: schema.users.id, name: schema.users.name })
        .from(schema.users)
        .where(inArray(schema.users.id, staffIds))
    : [];
  const customers = customerIds.length
    ? await ctx.db
        .select({ id: schema.customers.id, name: schema.customers.name })
        .from(schema.customers)
        .where(and(eq(schema.customers.tenantId, ctx.tenantId), inArray(schema.customers.id, customerIds)))
    : [];
  const staffNames = new Map(staff.map((s) => [s.id, s.name]));
  const customerNames = new Map(customers.map((c) => [`customer:${c.id}`, c.name]));
  const settings = await getSettings(ctx);
  const actorName = (actor: string) => {
    const userId = userIdOf(actor);
    const known = userId ? staffNames.get(userId) : customerNames.get(actor);
    if (known) return known;
    if (actor.startsWith("connect-link:")) return "WhatsApp setup";
    if (actor.startsWith("system:")) {
      const who = actor.slice(7);
      if (who === "agent" || who === "wambo") return settings.agentName;
      if (who === "whatsapp") return "WhatsApp";
      if (who === "mpesa" || who === "tuma") return "M-Pesa";
      return "Palda CX";
    }
    if (actor.startsWith("staff:") || actor.startsWith("owner:")) return "A team member";
    if (actor.startsWith("customer:")) return "A customer";
    return actor;
  };

  return {
    money,
    previous: {
      revenueKes: money[10]?.collectedKes ?? 0,
      confirmed: prevConfirmed?.count ?? 0,
    },
    sources: sources.map((s) => ({ source: s.source, count: s.count })),
    recentPayments: payments.map(({ payment, customerName }) => ({
      id: payment.id,
      customerName,
      bookingId: payment.bookingId,
      method: payment.method,
      provider: payment.provider,
      amountKes: payment.amountKes,
      receivedAt: payment.receivedAt ?? payment.createdAt,
      matched: payment.bookingId !== null,
    })),
    unmatched: { count: unmatchedRow?.count ?? 0, totalKes: unmatchedRow?.total ?? 0 },
    activity: audit.map((a) => ({
      id: a.id,
      actor: actorName(a.actor),
      action: a.action,
      entity: a.entity,
      entityId: a.entityId,
      createdAt: a.createdAt,
    })),
  };
}

export async function occupancyRate(ctx: ServiceContext, dateKeyValue: string): Promise<number> {
  const { getAvailabilityGrid } = await import("./availability");
  const grid = await getAvailabilityGrid(ctx, { fromDateKey: dateKeyValue, days: 1 });
  if (grid.resources.length === 0) return 0;
  const used = grid.resources.filter((r) => grid.cells[`${r.id}:${dateKeyValue}`]?.status !== "free");
  return Math.round((used.length / grid.resources.length) * 100);
}
