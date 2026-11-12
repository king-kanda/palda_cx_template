import { and, eq, gte, lte } from "drizzle-orm";
import { schema } from "@garden/db";
import type { Booking, Customer, Offering } from "@garden/db";
import { createMeetingLink, decryptJson, encryptJson, intakeFormLink } from "@garden/integrations";
import { audit, getSettings, type ServiceContext } from "./context";
import { upsertCustomerByPhone } from "./customers";
import { createBooking } from "./bookings";
import { baseVars, sendProactive, sendStaffAlert } from "./notify";
import { dateKey, endOfNairobiDay, formatNairobi, startOfNairobiDay } from "./tz";
import { ForbiddenError, NotFoundError, ValidationError } from "./types";

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
  const intakeUrl = intakeFormLink(settings.tenant.slug, booking.id);

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

/* ----- Consultancy intake forms ----- */

export type IntakeAnswers = {
  topic: string;
  attendees: string;
  goals: string;
  notes: string;
};

export type IntakeFormView = {
  bookingId: string;
  businessName: string;
  offeringName: string;
  startsAt: Date;
  customerName: string;
  submittedAt: Date | null;
  answers: IntakeAnswers;
  cancelled: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function cleanLine(value: unknown, max: number): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function cleanBlock(value: unknown, max: number): string {
  return String(value ?? "")
    .replace(/\r\n/g, "\n")
    .trim()
    .slice(0, max);
}

/**
 * Intake answers are confidential, so they live encrypted in
 * `customer_sensitive` (never in booking attributes, prompts or logs).
 */
async function readSensitive(
  ctx: ServiceContext,
  customerId: string,
): Promise<{ row: typeof schema.customerSensitive.$inferSelect | null; data: Record<string, unknown> }> {
  const row = await ctx.db.query.customerSensitive.findFirst({
    where: and(
      eq(schema.customerSensitive.tenantId, ctx.tenantId),
      eq(schema.customerSensitive.customerId, customerId),
    ),
  });
  if (!row) return { row: null, data: {} };
  try {
    const data = decryptJson<Record<string, unknown>>(row.dataEncrypted);
    return { row, data: isRecord(data) ? data : {} };
  } catch {
    // A rotated ENCRYPTION_KEY must not break the public form; staff can still
    // see that a submission happened from the audit log.
    return { row, data: {} };
  }
}

function intakeEntry(data: Record<string, unknown>, bookingId: string): Record<string, unknown> {
  const intake = isRecord(data.intake) ? data.intake : {};
  return isRecord(intake[bookingId]) ? (intake[bookingId] as Record<string, unknown>) : {};
}

/** Public-safe view for `/intake/<tenant>/<bookingId>`: no phone, price or internal ids. */
export async function getIntakeForm(
  ctx: ServiceContext,
  bookingId: string,
): Promise<IntakeFormView> {
  const booking = await loadBooking(ctx, bookingId);
  const settings = await getSettings(ctx);
  const { customer, offering } = await bookingContext(ctx, booking);
  const { data } = await readSensitive(ctx, booking.customerId);
  const entry = intakeEntry(data, booking.id);
  const submittedAt =
    typeof entry.submittedAt === "string" && !Number.isNaN(new Date(entry.submittedAt).getTime())
      ? new Date(entry.submittedAt)
      : null;

  return {
    bookingId: booking.id,
    businessName: settings.tenant.name,
    offeringName: offering?.name ?? "Session",
    startsAt: booking.startsAt,
    customerName: customer.name,
    submittedAt,
    answers: {
      topic: cleanLine(entry.topic, 160),
      attendees: cleanLine(entry.attendees, 200),
      goals: cleanBlock(entry.goals, 1000),
      notes: cleanBlock(entry.notes, 2000),
    },
    cancelled: booking.status === "cancelled",
  };
}

/** Stores one intake submission per booking, encrypted, and alerts staff. */
export async function submitIntakeForm(
  ctx: ServiceContext,
  bookingId: string,
  input: IntakeAnswers & { consented: boolean },
): Promise<IntakeFormView> {
  const booking = await loadBooking(ctx, bookingId);
  if (ctx.principal.type === "customer" && booking.customerId !== ctx.principal.customerId) {
    throw new ForbiddenError("You can only complete the intake form for your own booking.");
  }
  if (booking.status === "cancelled") {
    throw new ValidationError("This booking was cancelled. Ask the business for a new intake link.");
  }
  if (!input.consented) {
    throw new ValidationError("Please confirm the business may use these answers to prepare for the session.");
  }

  const answers: IntakeAnswers = {
    topic: cleanLine(input.topic, 160),
    attendees: cleanLine(input.attendees, 200),
    goals: cleanBlock(input.goals, 1000),
    notes: cleanBlock(input.notes, 2000),
  };
  if (answers.topic.length < 3) {
    throw new ValidationError("Tell us the main topic in a few words.");
  }

  const { row, data } = await readSensitive(ctx, booking.customerId);
  const intake = isRecord(data.intake) ? data.intake : {};
  const updated = {
    ...data,
    intake: {
      ...intake,
      [booking.id]: { ...answers, submittedAt: new Date().toISOString() },
    },
  };

  await ctx.db
    .insert(schema.customerSensitive)
    .values({
      customerId: booking.customerId,
      tenantId: ctx.tenantId,
      dataEncrypted: encryptJson(updated),
      consentAt: row?.consentAt ?? new Date(),
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: schema.customerSensitive.customerId,
      set: {
        dataEncrypted: encryptJson(updated),
        consentAt: row?.consentAt ?? new Date(),
        updatedAt: new Date(),
      },
    });

  // Confidentially: audit the fact, never the answers, and alert staff without
  // copying the content into the staff channel.
  await audit(ctx, "booking.intake_submitted", "booking", booking.id, {
    fields: ["topic", "attendees", "goals", "notes"],
  });
  await sendStaffAlert(
    ctx,
    `Intake form received for ${booking.id} on ${formatNairobi(booking.startsAt)}.`,
  );
  return getIntakeForm(ctx, bookingId);
}
