import { and, asc, desc, eq, gte, ilike, inArray, lte, or, sql } from "drizzle-orm";
import { schema } from "@garden/db";
import type { Addon, Booking, Customer, Offering, Resource } from "@garden/db";
import { z } from "zod";
import {
  audit,
  getSettings,
  withPrincipal,
  type ServiceContext,
  type TenantSettings,
} from "./context";
import { conflictsFor, checkWindow, expandResourceIds } from "./availability";
import { getQuote, quoteAddonSchema } from "./pricing";
import { cancelReminders, scheduleForBooking } from "./reminders";
import { requestApproval } from "./approvals";
import { upsertCustomerByPhone } from "./customers";
import { baseVars, sendProactive } from "./notify";
import { createMeetingLink } from "@garden/integrations";
import {
  addMinutes,
  dateKey,
  formatNairobi,
  formatNairobiDateTime,
  formatNairobiTime,
  nairobiTime,
} from "./tz";
import {
  ForbiddenError,
  NotFoundError,
  PolicyError,
  SlotUnavailableError,
  ValidationError,
  requireStaff,
  type Principal,
} from "./types";

export const createBookingSchema = z.object({
  customerId: z.string().uuid().optional(),
  customer: z
    .object({
      name: z.string().min(2).max(120),
      phone: z.string().min(9).max(20),
      email: z.string().email().optional(),
      language: z.string().max(8).optional(),
    })
    .optional(),
  offeringId: z.string().uuid(),
  resourceIds: z.array(z.string().uuid()).min(1).max(4).optional(),
  startsAt: z.string(),
  endsAt: z.string().optional(),
  partySize: z.number().int().min(1).max(5000).default(1),
  addons: z.array(quoteAddonSchema).max(20).default([]),
  notes: z.string().max(2000).optional(),
  attributes: z.record(z.unknown()).default({}),
  status: z.enum(["inquiry", "hold", "confirmed"]).optional(),
  source: z.enum(["whatsapp", "staff", "web", "internal"]).optional(),
  idempotencyKey: z.string().max(200).optional(),
});
export type CreateBookingInput = z.input<typeof createBookingSchema>;

export type EnrichedBooking = {
  booking: Booking;
  customer: Customer;
  offering: Offering;
  resources: Resource[];
  addons: { description: string; qty: number; unitPriceKes: number }[];
};

function isExclusionViolation(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { code?: string; message?: string; constraint?: string };
  return (
    e.code === "23P01" ||
    e.constraint === "resource_occupancy_no_overlap" ||
    (typeof e.message === "string" && e.message.includes("resource_occupancy_no_overlap"))
  );
}

async function loadScopedBooking(
  ctx: ServiceContext,
  id: string,
): Promise<Booking> {
  const booking = await ctx.db.query.bookings.findFirst({
    where: and(eq(schema.bookings.id, id), eq(schema.bookings.tenantId, ctx.tenantId)),
  });
  if (!booking) throw new NotFoundError("Booking", id);
  if (ctx.principal.type === "customer" && booking.customerId !== ctx.principal.customerId) {
    throw new ForbiddenError("You can only access your own bookings.");
  }
  return booking;
}

async function resourcesForBooking(ctx: ServiceContext, bookingId: string) {
  const rows = await ctx.db
    .select({ resource: schema.resources, role: schema.bookingResources.role })
    .from(schema.bookingResources)
    .innerJoin(schema.resources, eq(schema.bookingResources.resourceId, schema.resources.id))
    .where(eq(schema.bookingResources.bookingId, bookingId));
  return rows;
}

export async function enrichBooking(ctx: ServiceContext, booking: Booking): Promise<EnrichedBooking> {
  const customer = await ctx.db.query.customers.findFirst({
    where: eq(schema.customers.id, booking.customerId),
  });
  const offering = await ctx.db.query.offerings.findFirst({
    where: eq(schema.offerings.id, booking.offeringId),
  });
  const resourceRows = await resourcesForBooking(ctx, booking.id);
  const items = await ctx.db.query.bookingItems.findMany({
    where: eq(schema.bookingItems.bookingId, booking.id),
  });
  if (!customer || !offering) throw new NotFoundError("Booking relations", booking.id);
  return {
    booking,
    customer,
    offering,
    resources: resourceRows.map((r) => r.resource),
    addons: items.map((i) => ({ description: i.description, qty: i.qty, unitPriceKes: i.unitPriceKes })),
  };
}

async function resolveCustomer(
  ctx: ServiceContext,
  input: z.infer<typeof createBookingSchema>,
): Promise<Customer> {
  if (ctx.principal.type === "customer") {
    const customer = await ctx.db.query.customers.findFirst({
      where: and(
        eq(schema.customers.id, ctx.principal.customerId),
        eq(schema.customers.tenantId, ctx.tenantId),
      ),
    });
    if (!customer) throw new NotFoundError("Customer", ctx.principal.customerId);
    return customer;
  }
  if (input.customerId) {
    const customer = await ctx.db.query.customers.findFirst({
      where: and(eq(schema.customers.id, input.customerId), eq(schema.customers.tenantId, ctx.tenantId)),
    });
    if (!customer) throw new NotFoundError("Customer", input.customerId);
    return customer;
  }
  if (input.customer) {
    return upsertCustomerByPhone(ctx, {
      name: input.customer.name,
      phone: input.customer.phone,
      email: input.customer.email ?? null,
      language: input.customer.language,
    });
  }
  throw new ValidationError("Provide customerId or customer details.");
}

async function validateAttributes(
  settings: TenantSettings,
  attributes: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const schemaForVertical = settings.preset.attributes.booking;
  const parsed = schemaForVertical.safeParse(attributes);
  if (parsed.success) return parsed.data as Record<string, unknown>;
  // Attribute validation is strict for defined fields; surface a helpful error.
  const messages = parsed.error.issues.map((i) => `${i.path.join(".") || "attributes"}: ${i.message}`);
  throw new ValidationError(`Invalid booking attributes — ${messages.join("; ")}`, parsed.error.flatten());
}

async function assertResources(
  ctx: ServiceContext,
  offering: Offering,
  resourceIds: string[],
  partySize: number,
): Promise<Resource[]> {
  const resources = await ctx.db.query.resources.findMany({
    where: and(
      eq(schema.resources.tenantId, ctx.tenantId),
      inArray(schema.resources.id, resourceIds),
      eq(schema.resources.active, true),
    ),
  });
  if (resources.length !== resourceIds.length) {
    throw new ValidationError("One or more selected resources do not exist.");
  }
  for (const r of resources) {
    const kindOk =
      r.kind === offering.resourceKind ||
      (offering.resourceKind === "space" && r.kind === "space") ||
      r.kind === "room" ||
      r.kind === "equipment";
    if (!kindOk) throw new ValidationError(`Resource ${r.name} cannot be used for ${offering.name}.`);
    if (r.capacity && partySize > r.capacity) {
      throw new ValidationError(
        `${r.name} holds ${r.capacity} guests; you selected ${partySize}.`,
      );
    }
  }
  return resources;
}

async function autoSelectResource(
  ctx: ServiceContext,
  offering: Offering,
  startsAt: Date,
  endsAt: Date,
  partySize: number,
): Promise<string> {
  const options = await checkWindow(ctx, {
    resourceKind: offering.resourceKind,
    startsAt,
    endsAt,
    partySize,
    bufferBeforeMin: offering.bufferBeforeMin,
    bufferAfterMin: offering.bufferAfterMin,
  });
  const free = options.find(
    (o) => o.status === "free" && (!o.parentId || o.status === "free") && (!o.capacity || partySize <= o.capacity),
  );
  if (!free) throw new SlotUnavailableError("No space is free for that date. Try another date.");
  return free.resourceId;
}

async function writeOccupancy(
  ctx: ServiceContext,
  booking: Booking,
  resourceIds: string[],
  offering: Offering,
): Promise<void> {
  const expanded = await expandResourceIds(ctx, resourceIds);
  const rows = expanded.map((resourceId) => ({
    tenantId: ctx.tenantId,
    resourceId,
    bookingId: booking.id,
    kind: "booking",
    startsAt: addMinutes(booking.startsAt, -offering.bufferBeforeMin),
    endsAt: addMinutes(booking.endsAt, offering.bufferAfterMin),
    status: "active",
  }));
  try {
    await ctx.db.insert(schema.resourceOccupancy).values(rows);
  } catch (error) {
    if (isExclusionViolation(error)) {
      throw new SlotUnavailableError(
        "That space was just booked for the selected time. Please pick another slot.",
      );
    }
    throw error;
  }
}

async function releaseOccupancy(ctx: ServiceContext, bookingId: string): Promise<void> {
  await ctx.db
    .update(schema.resourceOccupancy)
    .set({ status: "released" })
    .where(
      and(
        eq(schema.resourceOccupancy.tenantId, ctx.tenantId),
        eq(schema.resourceOccupancy.bookingId, bookingId),
        eq(schema.resourceOccupancy.status, "active"),
      ),
    );
}

export async function createBooking(
  ctx: ServiceContext,
  rawInput: CreateBookingInput,
): Promise<EnrichedBooking> {
  const input = createBookingSchema.parse(rawInput);
  const settings = await getSettings(ctx);
  const isCustomer = ctx.principal.type === "customer";

  if (input.idempotencyKey) {
    const existing = await ctx.db.query.idempotencyKeys.findFirst({
      where: and(
        eq(schema.idempotencyKeys.tenantId, ctx.tenantId),
        eq(schema.idempotencyKeys.key, input.idempotencyKey),
        eq(schema.idempotencyKeys.tool, "bookings.create"),
      ),
    });
    if (existing) {
      const bookingId = String((existing.result as Record<string, unknown>).bookingId ?? "");
      const booking = await loadScopedBooking(ctx, bookingId);
      return enrichBooking(ctx, booking);
    }
  }

  const customer = await resolveCustomer(ctx, input);
  const offering = await ctx.db.query.offerings.findFirst({
    where: and(eq(schema.offerings.id, input.offeringId), eq(schema.offerings.tenantId, ctx.tenantId)),
  });
  if (!offering || !offering.active) throw new NotFoundError("Offering", input.offeringId);

  const startsAt = new Date(input.startsAt);
  if (Number.isNaN(startsAt.getTime())) throw new ValidationError("Invalid start time.");
  const endsAt = input.endsAt
    ? new Date(input.endsAt)
    : addMinutes(startsAt, offering.durationMin);
  if (Number.isNaN(endsAt.getTime()) || endsAt <= startsAt) {
    throw new ValidationError("End time must be after the start time.");
  }
  if (endsAt.getTime() - startsAt.getTime() > 3 * 24 * 3_600_000) {
    throw new ValidationError("Bookings cannot exceed 3 days.");
  }

  const attributes = await validateAttributes(settings, input.attributes);

  let resourceIds = input.resourceIds ?? [];
  if (resourceIds.length === 0) {
    const auto = await autoSelectResource(ctx, offering, startsAt, endsAt, input.partySize);
    resourceIds = [auto];
  }
  const resources = await assertResources(ctx, offering, resourceIds, input.partySize);

  const conflicts = await conflictsFor(ctx, {
    resourceIds,
    startsAt,
    endsAt,
    bufferBeforeMin: offering.bufferBeforeMin,
    bufferAfterMin: offering.bufferAfterMin,
  });
  if (conflicts.length > 0) {
    throw new SlotUnavailableError(
      "That space is already booked or blocked for the selected time. Pick another date or space.",
    );
  }

  const quote = await getQuote(ctx, { offeringId: offering.id, addons: input.addons });

  const requestedStatus = input.status ?? "hold";
  const status = isCustomer ? (requestedStatus === "confirmed" ? "hold" : requestedStatus) : requestedStatus;
  const source = isCustomer ? "whatsapp" : (input.source ?? "staff");

  const [booking] = await ctx.db
    .insert(schema.bookings)
    .values({
      tenantId: ctx.tenantId,
      customerId: customer.id,
      offeringId: offering.id,
      startsAt,
      endsAt,
      partySize: input.partySize,
      status,
      source,
      holdExpiresAt: status === "hold" ? addMinutes(new Date(), settings.holdHours * 60) : null,
      subtotalKes: quote.subtotalKes,
      discountKes: quote.discountKes,
      taxKes: quote.taxKes,
      totalKes: quote.totalKes,
      depositRequiredKes: quote.depositRequiredKes,
      attributes,
      notes: input.notes ?? null,
      createdBy:
        ctx.principal.type === "staff"
          ? `staff:${ctx.principal.userId}`
          : ctx.principal.type === "customer"
            ? `customer:${ctx.principal.customerId}`
            : `system:${ctx.principal.label ?? "agent"}`,
    })
    .returning();
  if (!booking) throw new Error("Booking insert returned no row.");

  await ctx.db.insert(schema.bookingResources).values(
    resources.map((r, index) => ({
      tenantId: ctx.tenantId,
      bookingId: booking.id,
      resourceId: r.id,
      role: index === 0 ? "primary" : "secondary",
    })),
  );

  if (quote.addonItems.length > 0) {
    await ctx.db.insert(schema.bookingItems).values(
      quote.addonItems.map((item) => ({
        tenantId: ctx.tenantId,
        bookingId: booking.id,
        addonId: item.addonId,
        description: item.name,
        qty: item.qty,
        unitPriceKes: item.unitPriceKes,
      })),
    );
  }

  await writeOccupancy(ctx, booking, resources.map((r) => r.id), offering);
  await scheduleForBooking(ctx, booking.id);

  if (isCustomer) {
    const conversation = await ctx.db.query.conversations.findFirst({
      where: and(
        eq(schema.conversations.tenantId, ctx.tenantId),
        eq(schema.conversations.customerId, customer.id),
      ),
    });
    if (conversation) {
      await ctx.db
        .update(schema.conversations)
        .set({ agentState: status === "confirmed" ? "confirmed" : "held" })
        .where(eq(schema.conversations.id, conversation.id));
    }
  }

  if (input.idempotencyKey) {
    await ctx.db
      .insert(schema.idempotencyKeys)
      .values({
        tenantId: ctx.tenantId,
        key: input.idempotencyKey,
        tool: "bookings.create",
        result: { bookingId: booking.id },
      })
      .onConflictDoNothing();
  }

  await audit(ctx, "booking.created", "booking", booking.id, {
    status,
    totalKes: booking.totalKes,
    resourceIds,
  });

  return enrichBooking(ctx, booking);
}

export async function confirmBooking(ctx: ServiceContext, id: string) {
  const booking = await loadScopedBooking(ctx, id);
  if (!["hold", "inquiry"].includes(booking.status)) return booking;
  const [updated] = await ctx.db
    .update(schema.bookings)
    .set({ status: "confirmed", holdExpiresAt: null, updatedAt: new Date() })
    .where(eq(schema.bookings.id, id))
    .returning();
  await cancelReminders(ctx, id, ["hold_nudge", "deposit_due"]);
  const conversation = await ctx.db.query.conversations.findFirst({
    where: and(
      eq(schema.conversations.tenantId, ctx.tenantId),
      eq(schema.conversations.customerId, booking.customerId),
    ),
  });
  if (conversation) {
    await ctx.db
      .update(schema.conversations)
      .set({ agentState: "confirmed" })
      .where(eq(schema.conversations.id, conversation.id));
  }

  // Consultancy: a link is created and sent the moment a session is confirmed
  // (PLAN.md Phase 9 acceptance criterion).
  const settings = await getSettings(ctx);
  const attributes = (updated!.attributes ?? {}) as Record<string, unknown>;
  if (settings.vertical === "consultancy" && typeof attributes.meetingUrl !== "string") {
    const customer = await ctx.db.query.customers.findFirst({
      where: eq(schema.customers.id, updated!.customerId),
    });
    const offering = await ctx.db.query.offerings.findFirst({
      where: eq(schema.offerings.id, updated!.offeringId),
    });
    if (customer) {
      const meetingUrl = createMeetingLink({
        topic: `${offering?.name ?? "Session"} - ${customer.name}`,
        startsAt: updated!.startsAt,
      });
      await ctx.db
        .update(schema.bookings)
        .set({ attributes: { ...attributes, meetingUrl }, updatedAt: new Date() })
        .where(eq(schema.bookings.id, id));
      const template =
        settings.preset.templates.booking_confirmed ??
        "Hi {{customer_name}}, your {{offering}} is confirmed for {{date}} at {{time}}. {{meeting_line}}";
      await sendProactive(ctx, {
        customer,
        templateName: "booking_confirmed",
        body: template,
        vars: {
          ...baseVars(settings.tenant.name, customer),
          offering: offering?.name ?? "session",
          date: formatNairobi(updated!.startsAt),
          time: formatNairobiTime(updated!.startsAt),
          meeting_line: `Join here: ${meetingUrl}`,
        },
        language: customer.language,
      });
      await audit(ctx, "booking.meeting_link_created", "booking", id, { meetingUrl });
      return { ...updated!, attributes: { ...attributes, meetingUrl } };
    }
  }

  await audit(ctx, "booking.confirmed", "booking", id);
  return updated!;
}

export async function cancelBookingInternal(
  ctx: ServiceContext,
  id: string,
  reason: string,
): Promise<Booking> {
  const booking = await loadScopedBooking(ctx, id);
  if (["cancelled", "completed", "no_show"].includes(booking.status)) return booking;
  const [updated] = await ctx.db
    .update(schema.bookings)
    .set({ status: "cancelled", holdExpiresAt: null, updatedAt: new Date(), notes: booking.notes })
    .where(eq(schema.bookings.id, id))
    .returning();
  await releaseOccupancy(ctx, id);
  await cancelReminders(ctx, id);
  await audit(ctx, "booking.cancelled", "booking", id, { reason });
  return updated!;
}

export type CancellationResult =
  | { status: "cancelled"; booking: Booking }
  | { status: "requires_approval"; approvalId: string };

export async function cancelBooking(
  ctx: ServiceContext,
  id: string,
  reason: string,
): Promise<CancellationResult> {
  const booking = await loadScopedBooking(ctx, id);
  const settings = await getSettings(ctx);
  if (ctx.principal.type === "customer") {
    const noticeHours = (booking.startsAt.getTime() - Date.now()) / 3_600_000;
    if (noticeHours < settings.cancellationNoticeHours) {
      const approval = await requestApproval(ctx, {
        kind: "cancel_outside_policy",
        payload: { bookingId: id, reason, requestedBy: `customer:${ctx.principal.customerId}` },
      });
      return { status: "requires_approval", approvalId: approval.id };
    }
  }
  return { status: "cancelled", booking: await cancelBookingInternal(ctx, id, reason) };
}

async function rescheduleInternal(
  ctx: ServiceContext,
  id: string,
  startsAt: Date,
  endsAt: Date,
  resourceIds?: string[],
): Promise<Booking> {
  const booking = await loadScopedBooking(ctx, id);
  if (["cancelled", "completed"].includes(booking.status)) {
    throw new PolicyError("This booking can no longer be changed.");
  }
  const offering = await ctx.db.query.offerings.findFirst({
    where: eq(schema.offerings.id, booking.offeringId),
  });
  if (!offering) throw new NotFoundError("Offering", booking.offeringId);
  const current = await resourcesForBooking(ctx, id);
  const targetIds = resourceIds ?? current.map((r) => r.resource.id);
  if (targetIds.length === 0) throw new ValidationError("Select at least one resource.");

  const conflicts = await conflictsFor(ctx, {
    resourceIds: targetIds,
    startsAt,
    endsAt,
    bufferBeforeMin: offering.bufferBeforeMin,
    bufferAfterMin: offering.bufferAfterMin,
    ignoreBookingId: id,
  });
  if (conflicts.length > 0) {
    throw new SlotUnavailableError("That slot is not free. Pick another time.");
  }
  await releaseOccupancy(ctx, id);
  const [updated] = await ctx.db
    .update(schema.bookings)
    .set({ startsAt, endsAt, updatedAt: new Date() })
    .where(eq(schema.bookings.id, id))
    .returning();
  await writeOccupancy(ctx, updated!, targetIds, offering);
  await scheduleForBooking(ctx, id);
  await audit(ctx, "booking.rescheduled", "booking", id, {
    startsAt: startsAt.toISOString(),
  });
  return updated!;
}

export async function rescheduleBooking(
  ctx: ServiceContext,
  id: string,
  input: { startsAt: string; endsAt?: string; resourceIds?: string[]; reason?: string },
): Promise<Booking | { requires_approval: true; approvalId: string }> {
  const booking = await loadScopedBooking(ctx, id);
  const offering = await ctx.db.query.offerings.findFirst({
    where: eq(schema.offerings.id, booking.offeringId),
  });
  if (!offering) throw new NotFoundError("Offering", booking.offeringId);
  const startsAt = new Date(input.startsAt);
  const endsAt = input.endsAt ? new Date(input.endsAt) : addMinutes(startsAt, offering.durationMin);
  if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime()) || endsAt <= startsAt) {
    throw new ValidationError("Invalid new time.");
  }
  if (ctx.principal.type === "customer") {
    const settings = await getSettings(ctx);
    const noticeHours = (booking.startsAt.getTime() - Date.now()) / 3_600_000;
    if (noticeHours < settings.cancellationNoticeHours) {
      const approval = await requestApproval(ctx, {
        kind: "other",
        payload: {
          tool: "bookings.reschedule",
          args: { bookingId: id, startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString() },
          reason: input.reason ?? "Customer requested reschedule inside notice window",
        },
      });
      return { requires_approval: true, approvalId: approval.id };
    }
  }
  return rescheduleInternal(ctx, id, startsAt, endsAt, input.resourceIds);
}

export async function applyDiscount(ctx: ServiceContext, id: string, discountKes: number, reason: string) {
  requireStaff(ctx.principal);
  if (ctx.principal.type === "staff" && ctx.principal.role !== "owner") {
    throw new ForbiddenError("Only an owner can apply discounts.");
  }
  const booking = await loadScopedBooking(ctx, id);
  if (discountKes < 0 || discountKes > booking.subtotalKes) {
    throw new ValidationError("Discount must be between 0 and the subtotal.");
  }
  const quote = await getQuote(ctx, {
    offeringId: booking.offeringId,
    discountKes,
  });
  const [updated] = await ctx.db
    .update(schema.bookings)
    .set({
      discountKes: discountKes,
      taxKes: quote.taxKes,
      totalKes: quote.totalKes,
      depositRequiredKes: quote.depositRequiredKes,
      updatedAt: new Date(),
    })
    .where(eq(schema.bookings.id, id))
    .returning();
  await audit(ctx, "booking.discount", "booking", id, { discountKes, reason });
  return updated!;
}

export async function markCompleted(ctx: ServiceContext, id: string) {
  const booking = await loadScopedBooking(ctx, id);
  if (booking.status !== "confirmed") throw new PolicyError("Only confirmed bookings can be completed.");
  const [updated] = await ctx.db
    .update(schema.bookings)
    .set({ status: "completed", updatedAt: new Date() })
    .where(eq(schema.bookings.id, id))
    .returning();
  await audit(ctx, "booking.completed", "booking", id);
  return updated!;
}

export type BookingListFilters = {
  status?: string[];
  from?: string;
  to?: string;
  resourceId?: string;
  search?: string;
  customerId?: string;
  limit?: number;
};

export async function listBookings(ctx: ServiceContext, filters: BookingListFilters = {}) {
  const conditions = [eq(schema.bookings.tenantId, ctx.tenantId)];
  if (filters.status?.length) conditions.push(inArray(schema.bookings.status, filters.status));
  if (filters.from) conditions.push(gte(schema.bookings.startsAt, new Date(filters.from)));
  if (filters.to) conditions.push(lte(schema.bookings.startsAt, new Date(filters.to)));
  if (filters.customerId) conditions.push(eq(schema.bookings.customerId, filters.customerId));
  if (ctx.principal.type === "customer") {
    conditions.push(eq(schema.bookings.customerId, ctx.principal.customerId));
  }
  if (filters.resourceId) {
    conditions.push(
      sql`exists (select 1 from ${schema.bookingResources} br where br.booking_id = ${schema.bookings.id} and br.resource_id = ${filters.resourceId})`,
    );
  }
  const search = filters.search?.trim();
  if (search) {
    conditions.push(
      or(
        ilike(schema.customers.name, `%${search}%`),
        ilike(schema.customers.phoneE164, `%${search}%`),
        ilike(schema.offerings.name, `%${search}%`),
      )!,
    );
  }

  const rows = await ctx.db
    .select({
      booking: schema.bookings,
      customer: schema.customers,
      offering: schema.offerings,
    })
    .from(schema.bookings)
    .innerJoin(schema.customers, eq(schema.bookings.customerId, schema.customers.id))
    .innerJoin(schema.offerings, eq(schema.bookings.offeringId, schema.offerings.id))
    .where(and(...conditions))
    .orderBy(desc(schema.bookings.startsAt))
    .limit(filters.limit ?? 200);

  const ids = rows.map((r) => r.booking.id);
  const resourceRows = ids.length
    ? await ctx.db
        .select({
          bookingId: schema.bookingResources.bookingId,
          name: schema.resources.name,
          resourceId: schema.resources.id,
        })
        .from(schema.bookingResources)
        .innerJoin(schema.resources, eq(schema.bookingResources.resourceId, schema.resources.id))
        .where(inArray(schema.bookingResources.bookingId, ids))
    : [];
  const byBooking = new Map<string, { id: string; name: string }[]>();
  for (const row of resourceRows) {
    const list = byBooking.get(row.bookingId) ?? [];
    list.push({ id: row.resourceId, name: row.name });
    byBooking.set(row.bookingId, list);
  }
  return rows.map((row) => ({
    ...row,
    resources: byBooking.get(row.booking.id) ?? [],
  }));
}

export async function getBookingDetail(ctx: ServiceContext, id: string) {
  const booking = await loadScopedBooking(ctx, id);
  const enriched = await enrichBooking(ctx, booking);
  const invoices = await ctx.db.query.invoices.findMany({
    where: and(eq(schema.invoices.tenantId, ctx.tenantId), eq(schema.invoices.bookingId, id)),
    orderBy: asc(schema.invoices.createdAt),
  });
  const payments = await ctx.db.query.payments.findMany({
    where: and(eq(schema.payments.tenantId, ctx.tenantId), eq(schema.payments.bookingId, id)),
    orderBy: desc(schema.payments.createdAt),
  });
  const reminders = await ctx.db.query.reminders.findMany({
    where: and(eq(schema.reminders.tenantId, ctx.tenantId), eq(schema.reminders.bookingId, id)),
    orderBy: asc(schema.reminders.sendAt),
  });
  const review = await ctx.db.query.reviews.findFirst({
    where: and(eq(schema.reviews.tenantId, ctx.tenantId), eq(schema.reviews.bookingId, id)),
  });
  const paidKes = payments
    .filter((p) => p.status === "succeeded")
    .reduce((sum, p) => sum + p.amountKes, 0);
  return { ...enriched, invoices, payments, reminders, review, paidKes, balanceKes: booking.totalKes - paidKes };
}

export async function upcomingForCustomer(ctx: ServiceContext, customerId: string, limit = 5) {
  return ctx.db.query.bookings.findMany({
    where: and(
      eq(schema.bookings.tenantId, ctx.tenantId),
      eq(schema.bookings.customerId, customerId),
      gte(schema.bookings.startsAt, new Date()),
      inArray(schema.bookings.status, ["hold", "confirmed"]),
    ),
    orderBy: asc(schema.bookings.startsAt),
    limit,
  });
}

/* ───────────────────────── Public wrappers ───────────────────────── */

export async function createBookingFor(principal: Principal, input: CreateBookingInput) {
  return withPrincipal(principal, (ctx) => createBooking(ctx, input));
}

export async function listBookingsFor(principal: Principal, filters: BookingListFilters = {}) {
  return withPrincipal(principal, (ctx) => listBookings(ctx, filters));
}

export async function getBookingFor(principal: Principal, id: string) {
  return withPrincipal(principal, (ctx) => getBookingDetail(ctx, id));
}

export async function confirmBookingFor(principal: Principal, id: string) {
  return withPrincipal(principal, (ctx) => confirmBooking(ctx, id));
}

export async function cancelBookingFor(principal: Principal, id: string, reason: string) {
  return withPrincipal(principal, (ctx) => cancelBooking(ctx, id, reason));
}

export async function rescheduleBookingFor(
  principal: Principal,
  id: string,
  input: { startsAt: string; endsAt?: string; resourceIds?: string[]; reason?: string },
) {
  return withPrincipal(principal, (ctx) => rescheduleBooking(ctx, id, input));
}

export async function applyDiscountFor(principal: Principal, id: string, discountKes: number, reason: string) {
  return withPrincipal(principal, (ctx) => applyDiscount(ctx, id, discountKes, reason));
}

export function bookingSummaryLine(booking: Booking, offering: Offering): string {
  return `${offering.name} · ${formatNairobiDateTime(booking.startsAt)} · ${booking.partySize} guests`;
}

export function bookingDateKey(booking: Booking): string {
  return dateKey(booking.startsAt);
}

export { nairobiTime, formatNairobi };
