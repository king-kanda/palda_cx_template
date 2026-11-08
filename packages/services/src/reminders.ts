import { and, asc, eq, inArray, lte } from "drizzle-orm";
import { schema } from "@garden/db";
import type { Booking, Customer, Offering } from "@garden/db";
import { getSettings, type ServiceContext } from "./context";
import { addMinutes, formatNairobi, formatNairobiTime, isPast, nairobiTime, dateKey } from "./tz";
import { renderTemplate, sendProactive, templateParams, baseVars } from "./notify";
import { kes } from "./types";

export type ReminderDTO = typeof schema.reminders.$inferSelect;

const RESEND_GUARD_KINDS = new Set(["hold_nudge", "deposit_due"]);

export async function cancelReminders(
  ctx: ServiceContext,
  bookingId: string,
  kinds?: string[],
): Promise<void> {
  const conditions = [
    eq(schema.reminders.tenantId, ctx.tenantId),
    eq(schema.reminders.bookingId, bookingId),
    eq(schema.reminders.status, "pending"),
  ];
  if (kinds?.length) conditions.push(inArray(schema.reminders.kind, kinds));
  await ctx.db
    .update(schema.reminders)
    .set({ status: "cancelled" })
    .where(and(...conditions));
}

export async function scheduleForBooking(ctx: ServiceContext, bookingId: string): Promise<ReminderDTO[]> {
  const booking = await ctx.db.query.bookings.findFirst({
    where: and(eq(schema.bookings.id, bookingId), eq(schema.bookings.tenantId, ctx.tenantId)),
  });
  if (!booking) return [];
  if (["cancelled", "completed", "no_show"].includes(booking.status)) return [];

  const offering = await ctx.db.query.offerings.findFirst({
    where: eq(schema.offerings.id, booking.offeringId),
  });
  const customer = await ctx.db.query.customers.findFirst({
    where: eq(schema.customers.id, booking.customerId),
  });
  if (!offering || !customer) return [];

  const settings = await getSettings(ctx);
  const now = new Date();

  // Rebuilding is idempotent: drop pending rows owned by this booking first.
  await ctx.db
    .update(schema.reminders)
    .set({ status: "cancelled" })
    .where(
      and(
        eq(schema.reminders.tenantId, ctx.tenantId),
        eq(schema.reminders.bookingId, bookingId),
        eq(schema.reminders.status, "pending"),
      ),
    );

  const rows: (typeof schema.reminders.$inferInsert)[] = [];

  if (booking.depositRequiredKes > 0 && booking.status === "hold") {
    rows.push({
      tenantId: ctx.tenantId,
      bookingId,
      kind: "deposit_due",
      sendAt: addMinutes(now, 15),
      template: "deposit_request",
      channel: "whatsapp",
    });
  }

  for (const rule of settings.preset.reminders) {
    const base = RESEND_GUARD_KINDS.has(rule.kind) ? booking.createdAt : booking.startsAt;
    const sendAt = addMinutes(base, rule.offsetHours * 60);
    if (sendAt.getTime() <= now.getTime()) continue;
    rows.push({
      tenantId: ctx.tenantId,
      bookingId,
      kind: rule.kind,
      sendAt,
      template: rule.template,
      channel: rule.channel ?? "whatsapp",
    });
  }

  if (rows.length === 0) return [];
  const inserted = await ctx.db.insert(schema.reminders).values(rows).returning();
  return inserted;
}

export function reminderVars(
  booking: Booking,
  customer: Customer,
  offering: Offering,
  businessName: string,
  settings: Awaited<ReturnType<typeof getSettings>>,
): Record<string, string | number> {
  const balance = Math.max(
    0,
    booking.totalKes - booking.depositRequiredKes,
  );
  return {
    ...baseVars(businessName, customer),
    date: formatNairobi(booking.startsAt),
    time: formatNairobiTime(booking.startsAt),
    amount: kes(booking.status === "hold" ? booking.depositRequiredKes : balance),
    offering: offering.name,
    arrival_time: settings.arrivalTime,
    review_link: settings.reviewLink,
    meeting_line: (booking.attributes as Record<string, unknown>)?.meetingUrl
      ? `Join here: ${String((booking.attributes as Record<string, unknown>).meetingUrl)}`
      : "",
  };
}

export async function dueReminders(
  ctx: ServiceContext,
  input: { now?: Date; limit?: number } = {},
): Promise<
  {
    reminder: ReminderDTO;
    booking: Booking;
    customer: Customer;
    offering: Offering;
  }[]
> {
  const now = input.now ?? new Date();
  const rows = await ctx.db
    .select({
      reminder: schema.reminders,
      booking: schema.bookings,
      customer: schema.customers,
      offering: schema.offerings,
    })
    .from(schema.reminders)
    .innerJoin(schema.bookings, eq(schema.reminders.bookingId, schema.bookings.id))
    .innerJoin(schema.customers, eq(schema.bookings.customerId, schema.customers.id))
    .innerJoin(schema.offerings, eq(schema.bookings.offeringId, schema.offerings.id))
    .where(
      and(
        eq(schema.reminders.tenantId, ctx.tenantId),
        eq(schema.reminders.status, "pending"),
        lte(schema.reminders.sendAt, now),
      ),
    )
    .orderBy(asc(schema.reminders.sendAt))
    .limit(input.limit ?? 50);
  return rows;
}

/** Sends every reminder that is due for this tenant. Called by the worker. */
export async function dispatchDueReminders(
  ctx: ServiceContext,
  input: { now?: Date; limit?: number } = {},
): Promise<{ sent: number; failed: number }> {
  const settings = await getSettings(ctx);
  const due = await dueReminders(ctx, input);
  let sent = 0;
  let failed = 0;
  for (const row of due) {
    if (["cancelled", "completed", "no_show"].includes(row.booking.status)) {
      await ctx.db
        .update(schema.reminders)
        .set({ status: "cancelled" })
        .where(eq(schema.reminders.id, row.reminder.id));
      continue;
    }
    const template = settings.preset.templates[row.reminder.template];
    if (!template) {
      await ctx.db
        .update(schema.reminders)
        .set({ status: "failed" })
        .where(eq(schema.reminders.id, row.reminder.id));
      failed += 1;
      continue;
    }
    const vars = reminderVars(row.booking, row.customer, row.offering, settings.tenant.name, settings);
    const result = await sendProactive(ctx, {
      customer: row.customer,
      templateName: row.reminder.template,
      body: template,
      vars,
      language: row.customer.language,
    });
    await ctx.db
      .update(schema.reminders)
      .set({
        status: result.sent ? "sent" : "failed",
        sentAt: result.sent ? new Date() : null,
      })
      .where(eq(schema.reminders.id, row.reminder.id));
    if (result.sent) sent += 1;
    else failed += 1;
  }
  return { sent, failed };
}

export async function listReminders(ctx: ServiceContext, bookingId: string) {
  return ctx.db.query.reminders.findMany({
    where: and(eq(schema.reminders.tenantId, ctx.tenantId), eq(schema.reminders.bookingId, bookingId)),
    orderBy: asc(schema.reminders.sendAt),
  });
}

/** Releases expired holds: booking becomes cancelled and occupancy released. */
export async function releaseExpiredHolds(ctx: ServiceContext, now = new Date()): Promise<string[]> {
  const expired = await ctx.db.query.bookings.findMany({
    where: and(
      eq(schema.bookings.tenantId, ctx.tenantId),
      eq(schema.bookings.status, "hold"),
      lte(schema.bookings.holdExpiresAt, now),
    ),
    limit: 100,
  });
  const released: string[] = [];
  for (const booking of expired) {
    await ctx.db
      .update(schema.bookings)
      .set({ status: "cancelled", updatedAt: new Date() })
      .where(eq(schema.bookings.id, booking.id));
    await ctx.db
      .update(schema.resourceOccupancy)
      .set({ status: "released" })
      .where(
        and(
          eq(schema.resourceOccupancy.bookingId, booking.id),
          eq(schema.resourceOccupancy.status, "active"),
        ),
      );
    await cancelReminders(ctx, booking.id);
    released.push(booking.id);
  }
  return released;
}

/** Builds the rendered body for previews/tests. */
export function previewReminder(
  ruleTemplate: string,
  vars: Record<string, string | number>,
): { body: string; params: string[] } {
  return { body: renderTemplate(ruleTemplate, vars), params: templateParams(ruleTemplate, vars) };
}

export { dateKey, nairobiTime, isPast };
