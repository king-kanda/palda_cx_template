import { and, eq, gte, lte } from "drizzle-orm";
import { schema } from "@garden/db";
import type { Booking, Customer, Offering } from "@garden/db";
import { createMeetingLink, intakeFormLink } from "@garden/integrations";
import { audit, getSettings, type ServiceContext } from "./context";
import { upsertCustomerByPhone } from "./customers";
import { createBooking } from "./bookings";
import { baseVars, sendProactive } from "./notify";
import { dateKey, endOfNairobiDay, formatNairobi, startOfNairobiDay } from "./tz";
import { NotFoundError, ValidationError } from "./types";

/**
 * Vertical extras that the presets advertise as `toolExtras`.
 *
 * These are intentionally thin: they reuse bookings, notifications and
 * reminders rather than adding vertical-specific core logic. A venue simply
 * never calls them.
 */

function requireStaffOrSystem(ctx: ServiceContext): void {
  if (ctx.principal.type === "customer") {
    throw new ValidationError("This action is only available to staff.");
  }
}

async function loadBooking(ctx: ServiceContext, bookingId: string): Promise<Booking> {
  const booking = await ctx.db.query.bookings.findFirst({
    where: and(eq(schema.bookings.id, bookingId), eq(schema.bookings.tenantId, ctx.tenantId)),
  });
  if (!booking) throw new NotFoundError("Booking", bookingId);
  return booking;
}

async function bookingContext(
  ctx: ServiceContext,
  booking: Booking,
): Promise<{ customer: Customer; offering: Offering | null }> {
  const customer = await ctx.db.query.customers.findFirst({
    where: and(
      eq(schema.customers.id, booking.customerId),
      eq(schema.customers.tenantId, ctx.tenantId),
    ),
  });
  if (!customer) throw new NotFoundError("Customer", booking.customerId);
  const offering = await ctx.db.query.offerings.findFirst({
    where: eq(schema.offerings.id, booking.offeringId),
  });
  return { customer, offering: offering ?? null };
}

function attributeOf(booking: Booking, key: string): string | null {
  const attributes = booking.attributes as Record<string, unknown>;
  const value = attributes?.[key];
  return typeof value === "string" && value ? value : null;
}

/** Creates (or reuses) a meeting link and stores it on the booking. */
export async function attachMeetingLink(
  ctx: ServiceContext,
  bookingId: string,
): Promise<{ bookingId: string; meetingUrl: string; created: boolean }> {
  requireStaffOrSystem(ctx);
  const booking = await loadBooking(ctx, bookingId);
  const existing = attributeOf(booking, "meetingUrl");
  if (existing) return { bookingId, meetingUrl: existing, created: false };

  const { customer, offering } = await bookingContext(ctx, booking);
  const meetingUrl = createMeetingLink({
    topic: `${offering?.name ?? "Session"} - ${customer.name}`,
    startsAt: booking.startsAt,
  });

  await ctx.db
    .update(schema.bookings)
    .set({
      attributes: { ...(booking.attributes as Record<string, unknown>), meetingUrl },
      updatedAt: new Date(),
    })
    .where(eq(schema.bookings.id, booking.id));
  await audit(ctx, "booking.meeting_link_created", "booking", booking.id, { meetingUrl });
  return { bookingId, meetingUrl, created: true };
}

/** Sends the consultancy intake form for a booking. */
export async function sendIntakeForm(
  ctx: ServiceContext,
  bookingId: string,
): Promise<{ bookingId: string; intakeUrl: string; sent: boolean }> {
  requireStaffOrSystem(ctx);
  const booking = await loadBooking(ctx, bookingId);
  const { customer, offering } = await bookingContext(ctx, booking);
  const settings = await getSettings(ctx);
  const intakeUrl = intakeFormLink(booking.id);

  await ctx.db
    .update(schema.bookings)
    .set({
      attributes: { ...(booking.attributes as Record<string, unknown>), intakeUrl },
      updatedAt: new Date(),
    })
    .where(eq(schema.bookings.id, booking.id));

  const result = await sendProactive(ctx, {
    customer,
    templateName: "intake_form",
    body:
      "Hi {{customer_name}}, please complete this short intake form before your {{offering}} on {{date}}: {{intake_url}}",
    vars: {
      ...baseVars(settings.tenant.name, customer),
      offering: offering?.name ?? "session",
      date: formatNairobi(booking.startsAt),
      intake_url: intakeUrl,
    },
    language: customer.language,
  });
  await audit(ctx, "booking.intake_form_sent", "booking", booking.id, { intakeUrl });
  return { bookingId, intakeUrl, sent: result.sent };
}

/**
 * Schedules a recall reminder relative to the booking's end. Dental uses this
 * for the six-month check-up; the reminder template comes from the preset.
 */
export async function scheduleRecall(
  ctx: ServiceContext,
  input: { bookingId: string; months?: number },
): Promise<{ bookingId: string; kind: string; sendAt: Date }> {
  requireStaffOrSystem(ctx);
  const months = input.months ?? 6;
  if (!Number.isInteger(months) || months < 1 || months > 24) {
    throw new ValidationError("months must be a whole number between 1 and 24.");
  }
  const booking = await loadBooking(ctx, input.bookingId);
  const settings = await getSettings(ctx);
  const template = settings.preset.templates.recall ? "recall" : "reminder_1d";
  const sendAt = new Date(booking.endsAt.getTime() + months * 30 * 24 * 60 * 60 * 1000);
  const kind = `recall_${months}m`;

  const [row] = await ctx.db
    .insert(schema.reminders)
    .values({
      tenantId: ctx.tenantId,
      bookingId: booking.id,
      kind,
      sendAt,
      template,
      channel: "whatsapp",
    })
    .returning();
  await audit(ctx, "booking.recall_scheduled", "booking", booking.id, { kind, sendAt });
  return { bookingId: booking.id, kind, sendAt: row!.sendAt };
}

const WALK_IN_OFFERING_ATTR = "walkIn";

/**
 * Adds a walk-in to today's queue. A walk-in is an inquiry booking against the
 * requested offering/resource, so staff see it in the same list and the
 * database still prevents double-booking the stylist.
 */
export async function joinWalkInQueue(
  ctx: ServiceContext,
  input: { name: string; phone: string; offeringId: string; resourceId?: string },
): Promise<{ bookingId: string; position: number; startsAt: Date }> {
  requireStaffOrSystem(ctx);
  const offering = await ctx.db.query.offerings.findFirst({
    where: and(
      eq(schema.offerings.id, input.offeringId),
      eq(schema.offerings.tenantId, ctx.tenantId),
      eq(schema.offerings.active, true),
    ),
  });
  if (!offering) throw new NotFoundError("Offering", input.offeringId);

  const resource = input.resourceId
    ? await ctx.db.query.resources.findFirst({
        where: and(
          eq(schema.resources.id, input.resourceId),
          eq(schema.resources.tenantId, ctx.tenantId),
          eq(schema.resources.active, true),
        ),
      })
    : await ctx.db.query.resources.findFirst({
        where: and(
          eq(schema.resources.tenantId, ctx.tenantId),
          eq(schema.resources.kind, offering.resourceKind),
          eq(schema.resources.active, true),
        ),
        orderBy: (r, { asc }) => [asc(r.name)],
      });
  if (!resource) throw new ValidationError("No active resource is available for this service.");

  const customer = await upsertCustomerByPhone(ctx, {
    name: input.name,
    phone: input.phone,
    tags: ["walk-in"],
  });

  const startsAt = new Date();
  const endsAt = new Date(startsAt.getTime() + offering.durationMin * 60_000);
  const created = await createBooking(ctx, {
    customerId: customer.id,
    offeringId: offering.id,
    resourceIds: [resource.id],
    startsAt: startsAt.toISOString(),
    endsAt: endsAt.toISOString(),
    partySize: 1,
    status: "inquiry",
    source: "internal",
    attributes: { [WALK_IN_OFFERING_ATTR]: true },
    notes: "Walk-in queue",
  });

  const dayStart = startOfNairobiDay(dateKey(startsAt));
  const dayEnd = endOfNairobiDay(dateKey(startsAt));
  const waiting = await ctx.db.query.bookings.findMany({
    where: and(
      eq(schema.bookings.tenantId, ctx.tenantId),
      eq(schema.bookings.status, "inquiry"),
      gte(schema.bookings.createdAt, dayStart),
      lte(schema.bookings.createdAt, dayEnd),
    ),
    columns: { id: true, createdAt: true },
    orderBy: (b, { asc }) => [asc(b.createdAt)],
  });
  const ahead = waiting.filter(
    (row) => row.createdAt.getTime() <= dayEnd.getTime() && row.id !== created.booking.id,
  );

  return {
    bookingId: created.booking.id,
    position: ahead.length + 1,
    startsAt,
  };
}
