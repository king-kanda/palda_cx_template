import { z } from "zod";
import * as svc from "@garden/services";
import type { ServiceContext } from "@garden/services";
import type { Principal } from "@garden/services";

export type ToolTier = "read" | "write-safe" | "write-sensitive" | "escalate";
export type ToolPrincipalType = Principal["type"];

export type ToolDef<S extends z.ZodTypeAny = z.ZodTypeAny> = {
  name: string;
  group: string;
  description: string;
  tier: ToolTier;
  principalTypes: ToolPrincipalType[];
  scopes: string[];
  input: S;
  handler: (ctx: ServiceContext, args: z.infer<S>) => Promise<unknown>;
};

export type AnyToolDef = ToolDef<z.ZodTypeAny>;

function defineTool<S extends z.ZodTypeAny>(def: ToolDef<S>): AnyToolDef {
  return def as unknown as AnyToolDef;
}

const iso = z.string().min(10).max(40);
const uuid = z.string().uuid();

/* ───────────────────────────── helpers ───────────────────────────── */

async function resolveOfferingId(
  ctx: ServiceContext,
  args: { offeringId?: string; offering?: string },
): Promise<string> {
  if (args.offeringId) return args.offeringId;
  if (!args.offering) throw new svc.ValidationError("Provide offeringId or offering name.");
  const offerings = await svc.listAllOfferings(ctx);
  const needle = args.offering.trim().toLowerCase();
  const found =
    offerings.find((o) => o.name.toLowerCase() === needle) ??
    offerings.find((o) => o.name.toLowerCase().includes(needle));
  if (!found) {
    throw new svc.ValidationError(
      `Unknown offering "${args.offering}". Available: ${offerings.map((o) => o.name).join(", ")}`,
    );
  }
  return found.id;
}

async function resolveAddons(
  ctx: ServiceContext,
  addons: { addonId?: string; name?: string; qty: number }[] | undefined,
): Promise<{ addonId: string; qty: number }[]> {
  if (!addons?.length) return [];
  const all = await svc.listAllAddons(ctx);
  return addons.map((entry) => {
    if (entry.addonId) return { addonId: entry.addonId, qty: entry.qty };
    const needle = (entry.name ?? "").trim().toLowerCase();
    const found = all.find((a) => a.name.toLowerCase() === needle) ?? all.find((a) => a.name.toLowerCase().includes(needle));
    if (!found) {
      throw new svc.ValidationError(
        `Unknown add-on "${entry.name}". Available: ${all.map((a) => a.name).join(", ")}`,
      );
    }
    return { addonId: found.id, qty: entry.qty };
  });
}

async function resolveCustomerId(ctx: ServiceContext, explicit?: string): Promise<string> {
  if (ctx.principal.type === "customer") return ctx.principal.customerId;
  if (!explicit) throw new svc.ValidationError("customerId is required.");
  return explicit;
}

function bookingSummary(b: { booking: svc.EnrichedBooking["booking"]; customer: { name: string }; offering: { name: string }; resources: { name: string }[] }) {
  return {
    id: b.booking.id,
    status: b.booking.status,
    customer: b.customer.name,
    offering: b.offering.name,
    startsAt: b.booking.startsAt.toISOString(),
    endsAt: b.booking.endsAt.toISOString(),
    partySize: b.booking.partySize,
    resources: b.resources.map((r) => r.name),
    totalKes: b.booking.totalKes,
    depositRequiredKes: b.booking.depositRequiredKes,
    currency: "KES",
  };
}

/* ───────────────────────────── knowledge ─────────────────────────── */

const knowledgeTools: AnyToolDef[] = [
  defineTool({
    name: "knowledge.get_business_info",
    group: "knowledge",
    description:
      "Business facts, FAQ, opening hours, policies, packages/prices, spaces and add-ons. Always use this instead of inventing facts.",
    tier: "read",
    principalTypes: ["customer", "staff", "system"],
    scopes: ["knowledge:read"],
    input: z.object({ topic: z.string().max(80).optional() }).strict(),
    async handler(ctx, args) {
      const info = await svc.getBusinessInfo(ctx, args.topic);
      return info;
    },
  }),
  defineTool({
    name: "catalogue.list",
    group: "catalogue",
    description: "List active resources, offerings and add-ons with ids and KES prices.",
    tier: "read",
    principalTypes: ["customer", "staff", "system"],
    scopes: ["knowledge:read"],
    input: z.object({}).strict(),
    async handler(ctx) {
      const [resources, offerings, addons] = await Promise.all([
        svc.listResources(ctx),
        svc.listAllOfferings(ctx),
        svc.listAllAddons(ctx),
      ]);
      return {
        resources: resources.map((r) => ({ id: r.id, name: r.name, kind: r.kind, capacity: r.capacity })),
        offerings: offerings.map((o) => ({
          id: o.id,
          name: o.name,
          durationMin: o.durationMin,
          priceKes: o.basePriceKes,
        })),
        addons: addons.map((a) => ({ id: a.id, name: a.name, priceKes: a.priceKes, unit: a.unit })),
      };
    },
  }),
];

/* ───────────────────────────── bookings ──────────────────────────── */

const bookingTools: AnyToolDef[] = [
  defineTool({
    name: "bookings.check_availability",
    group: "bookings",
    description:
      "Check which spaces/staff are free for a specific date and time window. Returns a status per resource: free, hold, booked or blocked.",
    tier: "read",
    principalTypes: ["customer", "staff", "system"],
    scopes: ["bookings:read_own", "bookings:read"],
    input: z
      .object({
        offeringId: uuid.optional(),
        offering: z.string().max(120).optional(),
        startsAt: iso,
        endsAt: iso.optional(),
        partySize: z.number().int().min(1).max(5000).optional(),
        resourceId: uuid.optional(),
      })
      .strict(),
    async handler(ctx, args) {
      const offeringId = await resolveOfferingId(ctx, args);
      const offering = await ctx.db.query.offerings.findFirst({
        where: (o, { and, eq }) => and(eq(o.id, offeringId), eq(o.tenantId, ctx.tenantId)),
      });
      if (!offering) throw new svc.NotFoundError("Offering", offeringId);
      const startsAt = new Date(args.startsAt);
      const endsAt = args.endsAt ? new Date(args.endsAt) : svc.addMinutes(startsAt, offering.durationMin);
      const resources = await svc.checkWindow(ctx, {
        resourceKind: offering.resourceKind,
        startsAt,
        endsAt,
        partySize: args.partySize,
        resourceIds: args.resourceId ? [args.resourceId] : undefined,
        bufferBeforeMin: offering.bufferBeforeMin,
        bufferAfterMin: offering.bufferAfterMin,
      });
      return {
        offering: offering.name,
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
        resources: resources.map((r) => ({
          resourceId: r.resourceId,
          name: r.name,
          status: r.status,
          capacity: r.capacity,
        })),
      };
    },
  }),
  defineTool({
    name: "bookings.get_quote",
    group: "bookings",
    description:
      "Server-side priced quote in KES (base + add-ons + tax, deposit). Never compute prices yourself.",
    tier: "read",
    principalTypes: ["customer", "staff", "system"],
    scopes: ["bookings:read_own", "bookings:read"],
    input: z
      .object({
        offeringId: uuid.optional(),
        offering: z.string().max(120).optional(),
        addons: z
          .array(
            z
              .object({
                addonId: uuid.optional(),
                name: z.string().max(120).optional(),
                qty: z.number().int().min(1).max(200).default(1),
              })
              .strict(),
          )
          .max(20)
          .optional(),
        discountKes: z.number().int().min(0).optional(),
      })
      .strict(),
    async handler(ctx, args) {
      const offeringId = await resolveOfferingId(ctx, args);
      const addons = await resolveAddons(ctx, args.addons);
      return svc.getQuote(ctx, { offeringId, addons, discountKes: args.discountKes });
    },
  }),
  defineTool({
    name: "bookings.get_customer_bookings",
    group: "bookings",
    description: "The current customer's own upcoming and past bookings. Scoped by their WhatsApp number.",
    tier: "read",
    principalTypes: ["customer"],
    scopes: ["bookings:read_own"],
    input: z.object({}).strict(),
    async handler(ctx) {
      const rows = await svc.listBookings(ctx, { customerId: ctx.principal.type === "customer" ? ctx.principal.customerId : undefined });
      return rows.map((r) => ({
        id: r.booking.id,
        status: r.booking.status,
        offering: r.offering.name,
        startsAt: r.booking.startsAt.toISOString(),
        endsAt: r.booking.endsAt.toISOString(),
        partySize: r.booking.partySize,
        totalKes: r.booking.totalKes,
        resources: r.resources.map((x) => x.name),
      }));
    },
  }),
  defineTool({
    name: "bookings.get",
    group: "bookings",
    description: "Full detail for one booking (customer sees only their own).",
    tier: "read",
    principalTypes: ["customer", "staff", "system"],
    scopes: ["bookings:read_own", "bookings:read"],
    input: z.object({ bookingId: uuid }).strict(),
    async handler(ctx, args) {
      const detail = await svc.getBookingDetail(ctx, args.bookingId);
      return {
        ...bookingSummary(detail),
        addons: detail.addons,
        invoices: detail.invoices.map((i) => ({ id: i.id, number: i.number, kind: i.kind, status: i.status, balanceKes: i.balanceKes })),
        paidKes: detail.paidKes,
        balanceKes: detail.balanceKes,
        notes: detail.booking.notes,
      };
    },
  }),
  defineTool({
    name: "bookings.create_hold",
    group: "bookings",
    description:
      "Create a hold for a specific space and time. Idempotent and auto-expiring. Returns the booking with server-priced totals. Customer identity comes from context for customer principals; staff must pass customerId.",
    tier: "write-safe",
    principalTypes: ["customer", "staff", "system"],
    scopes: ["bookings:write_own", "bookings:write"],
    input: z
      .object({
        customerId: uuid.optional(),
        offeringId: uuid.optional(),
        offering: z.string().max(120).optional(),
        resourceId: uuid.optional(),
        resourceIds: z.array(uuid).min(1).max(4).optional(),
        startsAt: iso,
        endsAt: iso.optional(),
        partySize: z.number().int().min(1).max(5000).default(1),
        addons: z
          .array(
            z
              .object({
                addonId: uuid.optional(),
                name: z.string().max(120).optional(),
                qty: z.number().int().min(1).max(200).default(1),
              })
              .strict(),
          )
          .max(20)
          .optional(),
        notes: z.string().max(2000).optional(),
        attributes: z.record(z.unknown()).optional(),
        idempotencyKey: z.string().min(6).max(200).optional(),
      })
      .strict(),
    async handler(ctx, args) {
      const customerId = await resolveCustomerId(ctx, args.customerId);
      const offeringId = await resolveOfferingId(ctx, args);
      const addons = await resolveAddons(ctx, args.addons);
      const settings = await svc.getSettings(ctx);
      const attributes: Record<string, unknown> = { ...(args.attributes ?? {}) };
      if (settings.vertical === "venue" && !attributes.eventType) attributes.eventType = "other";
      const created = await svc.createBooking(ctx, {
        customerId,
        offeringId,
        resourceIds: args.resourceIds ?? (args.resourceId ? [args.resourceId] : undefined),
        startsAt: args.startsAt,
        endsAt: args.endsAt,
        partySize: args.partySize,
        addons,
        notes: args.notes,
        attributes,
        status: "hold",
        source: ctx.principal.type === "customer" ? "whatsapp" : "internal",
        idempotencyKey: args.idempotencyKey,
      });
      return bookingSummary(created);
    },
  }),
  defineTool({
    name: "bookings.list",
    group: "bookings",
    description: "List bookings with filters (staff/ops). Not available to customers.",
    tier: "read",
    principalTypes: ["staff", "system"],
    scopes: ["bookings:read"],
    input: z
      .object({
        status: z.array(z.enum(["inquiry", "hold", "confirmed", "completed", "cancelled", "no_show"])).optional(),
        from: iso.optional(),
        to: iso.optional(),
        search: z.string().max(80).optional(),
        customerId: uuid.optional(),
        limit: z.number().int().min(1).max(200).optional(),
      })
      .strict(),
    async handler(ctx, args) {
      const rows = await svc.listBookings(ctx, args);
      return rows.map((r) => ({
        id: r.booking.id,
        status: r.booking.status,
        customer: r.customer.name,
        offering: r.offering.name,
        startsAt: r.booking.startsAt.toISOString(),
        partySize: r.booking.partySize,
        totalKes: r.booking.totalKes,
        resources: r.resources.map((x) => x.name),
      }));
    },
  }),
  defineTool({
    name: "bookings.confirm",
    group: "bookings",
    description: "Confirm a held booking (staff/ops only).",
    tier: "write-safe",
    principalTypes: ["staff", "system"],
    scopes: ["bookings:write"],
    input: z.object({ bookingId: uuid }).strict(),
    async handler(ctx, args) {
      const booking = await svc.confirmBooking(ctx, args.bookingId);
      return { id: booking.id, status: booking.status };
    },
  }),
  defineTool({
    name: "bookings.cancel",
    group: "bookings",
    description:
      "Cancel a booking. For customers this respects the cancellation policy; outside policy it creates an approval request instead of executing.",
    tier: "write-safe",
    principalTypes: ["customer", "staff", "system"],
    scopes: ["bookings:write_own", "bookings:write"],
    input: z.object({ bookingId: uuid, reason: z.string().min(3).max(500) }).strict(),
    async handler(ctx, args) {
      const result = await svc.cancelBooking(ctx, args.bookingId, args.reason);
      if (result.status === "requires_approval") {
        return {
          status: "requires_approval",
          approvalId: result.approvalId,
          message: "The cancellation is outside the policy window. A team member must approve it.",
        };
      }
      return { status: result.booking.status, bookingId: result.booking.id };
    },
  }),
  defineTool({
    name: "bookings.reschedule",
    group: "bookings",
    description:
      "Move a booking to a new date/time. Customers inside the notice window get an approval request instead of an immediate change.",
    tier: "write-safe",
    principalTypes: ["customer", "staff", "system"],
    scopes: ["bookings:write_own", "bookings:write"],
    input: z
      .object({
        bookingId: uuid,
        startsAt: iso,
        endsAt: iso.optional(),
        resourceIds: z.array(uuid).min(1).max(4).optional(),
        reason: z.string().max(500).optional(),
      })
      .strict(),
    async handler(ctx, args) {
      const result = await svc.rescheduleBooking(ctx, args.bookingId, args);
      if ("requires_approval" in result) {
        return { status: "requires_approval", approvalId: result.approvalId };
      }
      return { status: result.status, bookingId: result.id, startsAt: result.startsAt.toISOString() };
    },
  }),
  defineTool({
    name: "bookings.request_change",
    group: "bookings",
    description:
      "Customer-facing change request: type is 'reschedule' or 'cancel'. The service returns whether it was executed or needs human approval.",
    tier: "write-safe",
    principalTypes: ["customer"],
    scopes: ["bookings:write_own"],
    input: z
      .object({
        bookingId: uuid,
        type: z.enum(["reschedule", "cancel"]),
        details: z
          .object({
            startsAt: iso.optional(),
            endsAt: iso.optional(),
            reason: z.string().max(500).optional(),
          })
          .strict()
          .optional(),
      })
      .strict(),
    async handler(ctx, args) {
      if (args.type === "cancel") {
        return svc.cancelBooking(ctx, args.bookingId, args.details?.reason ?? "Customer requested cancellation");
      }
      if (!args.details?.startsAt) throw new svc.ValidationError("startsAt is required for a reschedule.");
      return svc.rescheduleBooking(ctx, args.bookingId, {
        startsAt: args.details.startsAt,
        endsAt: args.details.endsAt,
        reason: args.details.reason,
      });
    },
  }),
  defineTool({
    name: "bookings.apply_discount",
    group: "bookings",
    description: "Apply a discount (owner only, sensitive write).",
    tier: "write-sensitive",
    principalTypes: ["staff"],
    scopes: ["bookings:write"],
    input: z
      .object({ bookingId: uuid, discountKes: z.number().int().min(0), reason: z.string().min(3).max(500) })
      .strict(),
    async handler(ctx, args) {
      const booking = await svc.applyDiscount(ctx, args.bookingId, args.discountKes, args.reason);
      return { id: booking.id, discountKes: booking.discountKes, totalKes: booking.totalKes };
    },
  }),
  defineTool({
    name: "bookings.mark_completed",
    group: "bookings",
    description: "Mark a confirmed booking as completed after the event (staff/ops).",
    tier: "write-safe",
    principalTypes: ["staff", "system"],
    scopes: ["bookings:write"],
    input: z.object({ bookingId: uuid }).strict(),
    async handler(ctx, args) {
      const booking = await svc.markCompleted(ctx, args.bookingId);
      return { id: booking.id, status: booking.status };
    },
  }),
];

/* ───────────────────────────── customers ─────────────────────────── */

const customerTools: AnyToolDef[] = [
  defineTool({
    name: "customers.get",
    group: "customers",
    description: "Customer profile (customer sees self only).",
    tier: "read",
    principalTypes: ["customer", "staff", "system"],
    scopes: ["customers:read", "bookings:read_own"],
    input: z.object({ customerId: uuid.optional() }).strict(),
    async handler(ctx, args) {
      const id = await resolveCustomerId(ctx, args.customerId);
      const profile = await svc.getCustomerProfile(ctx, id);
      return {
        id: profile.customer.id,
        name: profile.customer.name,
        phone: profile.customer.phoneE164,
        email: profile.customer.email,
        language: profile.customer.language,
        tags: profile.customer.tags,
        notes: profile.customer.notes,
        lifetimeValueKes: profile.lifetimeValueKes,
        bookings: profile.bookings.map((b) => ({
          id: b.booking.id,
          offering: b.offering.name,
          startsAt: b.booking.startsAt.toISOString(),
          status: b.booking.status,
          totalKes: b.booking.totalKes,
        })),
      };
    },
  }),
  defineTool({
    name: "customers.list",
    group: "customers",
    description: "Search customers by name or phone (staff/ops).",
    tier: "read",
    principalTypes: ["staff", "system"],
    scopes: ["customers:read"],
    input: z.object({ search: z.string().max(80).optional(), tag: z.string().max(40).optional() }).strict(),
    async handler(ctx, args) {
      const rows = await svc.listCustomers(ctx, args);
      return rows.map((r) => ({
        id: r.customer.id,
        name: r.customer.name,
        phone: r.customer.phoneE164,
        tags: r.customer.tags,
        bookings: r.bookingCount,
        lifetimeValueKes: r.lifetimeValueKes,
      }));
    },
  }),
  defineTool({
    name: "customers.upsert",
    group: "customers",
    description: "Create or update a customer by phone (staff/ops).",
    tier: "write-safe",
    principalTypes: ["staff", "system"],
    scopes: ["customers:read"],
    input: z
      .object({
        name: z.string().min(2).max(120),
        phone: z.string().min(9).max(20),
        email: z.string().email().optional(),
        language: z.string().max(8).optional(),
        tags: z.array(z.string().max(30)).max(20).optional(),
        notes: z.string().max(2000).optional(),
      })
      .strict(),
    async handler(ctx, args) {
      const customer = await svc.upsertCustomerByPhone(ctx, args);
      return { id: customer.id, name: customer.name, phone: customer.phoneE164 };
    },
  }),
  defineTool({
    name: "customers.add_note",
    group: "customers",
    description: "Append an internal note to a customer profile (staff/ops).",
    tier: "write-safe",
    principalTypes: ["staff", "system"],
    scopes: ["customers:read"],
    input: z.object({ customerId: uuid, note: z.string().min(2).max(2000) }).strict(),
    async handler(ctx, args) {
      await svc.addNote(ctx, args.customerId, args.note);
      return { ok: true };
    },
  }),
  defineTool({
    name: "customers.log_complaint",
    group: "customers",
    description:
      "Log a complaint, escalate to a human and stop the agent. Never promise compensation.",
    tier: "write-safe",
    principalTypes: ["customer", "staff", "system"],
    scopes: ["handoff:create"],
    input: z
      .object({
        summary: z.string().min(5).max(1000),
        severity: z.enum(["low", "normal", "high", "urgent"]).optional(),
        customerId: uuid.optional(),
        conversationId: uuid.optional(),
      })
      .strict(),
    async handler(ctx, args) {
      const customerId = await resolveCustomerId(ctx, args.customerId);
      return svc.logComplaint(ctx, {
        customerId,
        summary: args.summary,
        severity: args.severity,
        conversationId: args.conversationId,
      });
    },
  }),
  defineTool({
    name: "customers.sensitive.get",
    group: "customers",
    description:
      "Read encrypted sensitive fields (dental/consultancy). Staff only; never exposed to the customer agent.",
    tier: "read",
    principalTypes: ["staff"],
    scopes: ["customers:read"],
    input: z.object({ customerId: uuid }).strict(),
    async handler(ctx, args) {
      const data = await svc.getSensitiveData(ctx, args.customerId);
      return { customerId: args.customerId, data };
    },
  }),
];

/* ───────────────────────── invoices & payments ───────────────────── */

const moneyTools: AnyToolDef[] = [
  defineTool({
    name: "invoices.list",
    group: "invoices",
    description: "List invoices with status and balances (staff/ops).",
    tier: "read",
    principalTypes: ["staff", "system"],
    scopes: ["invoices:read"],
    input: z
      .object({
        status: z.array(z.enum(["draft", "sent", "partial", "paid", "overdue", "void"])).optional(),
        search: z.string().max(80).optional(),
      })
      .strict(),
    async handler(ctx) {
      const rows = await svc.listInvoices(ctx);
      return rows.map((r) => ({
        id: r.invoice.id,
        number: r.invoice.number,
        customer: r.customer.name,
        kind: r.invoice.kind,
        status: r.invoice.status,
        totalKes: r.invoice.totalKes,
        balanceKes: r.invoice.balanceKes,
        dueAt: r.invoice.dueAt?.toISOString() ?? null,
      }));
    },
  }),
  defineTool({
    name: "invoices.generate",
    group: "invoices",
    description: "Generate a deposit, balance or full invoice for a booking (staff/ops).",
    tier: "write-safe",
    principalTypes: ["staff", "system"],
    scopes: ["invoices:write"],
    input: z
      .object({
        bookingId: uuid,
        kind: z.enum(["deposit", "balance", "full"]),
        dueInDays: z.number().int().min(0).max(90).optional(),
      })
      .strict(),
    async handler(ctx, args) {
      const invoice = await svc.generateInvoice(ctx, args);
      return {
        id: invoice.id,
        number: invoice.number,
        kind: invoice.kind,
        totalKes: invoice.totalKes,
        balanceKes: invoice.balanceKes,
        status: invoice.status,
      };
    },
  }),
  defineTool({
    name: "invoices.send",
    group: "invoices",
    description: "Send an invoice to the customer over WhatsApp (staff/ops).",
    tier: "write-safe",
    principalTypes: ["staff", "system"],
    scopes: ["invoices:write"],
    input: z.object({ invoiceId: uuid }).strict(),
    async handler(ctx, args) {
      const invoice = await svc.sendInvoice(ctx, args.invoiceId);
      return { id: invoice.id, status: invoice.status, number: invoice.number };
    },
  }),
  defineTool({
    name: "invoices.get",
    group: "invoices",
    description: "Invoice detail with payments (staff/ops).",
    tier: "read",
    principalTypes: ["staff", "system"],
    scopes: ["invoices:read"],
    input: z.object({ invoiceId: uuid }).strict(),
    async handler(ctx, args) {
      const detail = await svc.getInvoiceDetail(ctx, args.invoiceId);
      return {
        id: detail.invoice.id,
        number: detail.invoice.number,
        status: detail.invoice.status,
        totalKes: detail.invoice.totalKes,
        balanceKes: detail.invoice.balanceKes,
        customer: detail.customer.name,
        bookingId: detail.booking.id,
        payments: detail.payments.map((p) => ({
          id: p.id,
          method: p.method,
          amountKes: p.amountKes,
          status: p.status,
          receipt: p.mpesaReceipt,
        })),
      };
    },
  }),
  defineTool({
    name: "payments.request",
    group: "payments",
    description:
      "Send an M-Pesa STK push / payment request for a booking. For customers the phone is always their verified WhatsApp number.",
    tier: "write-safe",
    principalTypes: ["customer", "staff", "system"],
    scopes: ["payments:request_own", "payments:write"],
    input: z
      .object({
        bookingId: uuid,
        invoiceId: uuid.optional(),
        amountKes: z.number().int().min(1).max(2_000_000).optional(),
        phone: z.string().min(9).max(20).optional(),
        idempotencyKey: z.string().min(6).max(200).optional(),
      })
      .strict(),
    async handler(ctx, args) {
      const result = await svc.initiateStk(ctx, args);
      return {
        paymentId: result.payment.id,
        status: result.payment.status,
        amountKes: result.payment.amountKes,
        customerMessage: result.customerMessage,
        mocked: result.mocked,
      };
    },
  }),
  defineTool({
    name: "payments.record_manual",
    group: "payments",
    description: "Record a cash, bank or M-Pesa payment against a booking (staff/ops).",
    tier: "write-safe",
    principalTypes: ["staff", "system"],
    scopes: ["payments:write"],
    input: z
      .object({
        bookingId: uuid,
        invoiceId: uuid.optional(),
        method: z.enum(["cash", "bank", "mpesa", "card"]),
        amountKes: z.number().int().min(1).max(5_000_000),
        mpesaReceipt: z.string().max(40).optional(),
        phone: z.string().max(20).optional(),
      })
      .strict(),
    async handler(ctx, args) {
      const payment = await svc.recordPayment(ctx, {
        ...args,
        receivedAt: new Date(),
        notifyCustomer: false,
      });
      return { paymentId: payment.id, status: payment.status, amountKes: payment.amountKes };
    },
  }),
  defineTool({
    name: "payments.list",
    group: "payments",
    description: "Recent payments, optionally for one booking (staff/ops).",
    tier: "read",
    principalTypes: ["staff", "system"],
    scopes: ["payments:read"],
    input: z.object({ bookingId: uuid.optional() }).strict(),
    async handler(ctx, args) {
      const rows = await svc.listPayments(ctx, args);
      return rows.map((p) => ({
        id: p.id,
        bookingId: p.bookingId,
        method: p.method,
        amountKes: p.amountKes,
        status: p.status,
        receipt: p.mpesaReceipt,
        receivedAt: p.receivedAt?.toISOString() ?? null,
      }));
    },
  }),
  defineTool({
    name: "payments.list_unmatched",
    group: "payments",
    description: "M-Pesa receipts not matched to a booking (reconciliation queue).",
    tier: "read",
    principalTypes: ["staff", "system"],
    scopes: ["payments:read"],
    input: z.object({}).strict(),
    async handler(ctx) {
      const rows = await svc.listUnmatchedPayments(ctx);
      return rows.map((p) => ({
        id: p.id,
        amountKes: p.amountKes,
        receipt: p.mpesaReceipt,
        phone: p.phone,
        receivedAt: p.receivedAt?.toISOString() ?? null,
      }));
    },
  }),
  defineTool({
    name: "payments.match_unmatched",
    group: "payments",
    description: "Attach an unmatched M-Pesa receipt to a booking (staff/ops).",
    tier: "write-safe",
    principalTypes: ["staff", "system"],
    scopes: ["payments:write"],
    input: z.object({ paymentId: uuid, bookingId: uuid, invoiceId: uuid.optional() }).strict(),
    async handler(ctx, args) {
      const payment = await svc.matchUnmatchedPayment(ctx, args.paymentId, args);
      return { paymentId: payment.id, bookingId: payment.bookingId };
    },
  }),
  defineTool({
    name: "payments.refund",
    group: "payments",
    description:
      "Refund money. Sensitive: customer/system requests become approvals; only an owner executes.",
    tier: "write-sensitive",
    principalTypes: ["customer", "staff", "system"],
    scopes: ["payments:write", "payments:request_own"],
    input: z
      .object({
        bookingId: uuid,
        amountKes: z.number().int().min(1).max(1_000_000),
        reason: z.string().min(3).max(500),
      })
      .strict(),
    async handler(ctx, args) {
      const payment = await svc.recordRefund(ctx, args);
      return { paymentId: payment.id, amountKes: payment.amountKes, status: payment.status };
    },
  }),
];

/* ───────────────────── approvals / reminders / reviews ───────────── */

const workflowTools: AnyToolDef[] = [
  defineTool({
    name: "approvals.list",
    group: "approvals",
    description: "Approval queue (pending, approved, rejected, executed).",
    tier: "read",
    principalTypes: ["staff", "system"],
    scopes: ["approvals:read"],
    input: z
      .object({ status: z.enum(["pending", "approved", "rejected", "expired", "executed"]).optional() })
      .strict(),
    async handler(ctx, args) {
      const rows = await svc.listApprovals(ctx, args);
      return rows.map((a) => ({
        id: a.id,
        kind: a.kind,
        status: a.status,
        requestedBy: a.requestedBy,
        payload: a.payload,
        title: svc.approvalTitle(a.kind, a.payload),
        expiresAt: a.expiresAt.toISOString(),
        createdAt: a.createdAt.toISOString(),
      }));
    },
  }),
  defineTool({
    name: "approvals.request",
    group: "approvals",
    description: "Create a pending approval for a sensitive action (staff/ops proposal).",
    tier: "escalate",
    principalTypes: ["staff", "system"],
    scopes: ["approvals:read"],
    input: z
      .object({
        kind: z.enum(["refund", "discount", "cancel_outside_policy", "bulk_send", "override_price", "other"]),
        payload: z.record(z.unknown()),
        conversationId: uuid.optional(),
        expiresInHours: z.number().int().min(1).max(168).optional(),
      })
      .strict(),
    async handler(ctx, args) {
      const approval = await svc.requestApproval(ctx, args);
      return { approvalId: approval.id, status: approval.status };
    },
  }),
  defineTool({
    name: "approvals.decide",
    group: "approvals",
    description:
      "Approve or reject a pending request (staff only). Approved actions execute exactly once.",
    tier: "write-sensitive",
    principalTypes: ["staff"],
    scopes: ["approvals:read"],
    input: z.object({ approvalId: uuid, decision: z.enum(["approved", "rejected"]) }).strict(),
    async handler(ctx, args) {
      const approval = await svc.decideApproval(ctx, args.approvalId, args.decision);
      if (args.decision === "rejected") return { approvalId: approval.id, status: approval.status };
      const execution = await svc.executeApproval(ctx, args.approvalId);
      return { approvalId: approval.id, status: "approved", execution };
    },
  }),
  defineTool({
    name: "reminders.list",
    group: "reminders",
    description: "Reminders scheduled for a booking (staff/ops).",
    tier: "read",
    principalTypes: ["staff", "system"],
    scopes: ["reminders:write"],
    input: z.object({ bookingId: uuid }).strict(),
    async handler(ctx, args) {
      const rows = await svc.listReminders(ctx, args.bookingId);
      return rows.map((r) => ({ kind: r.kind, sendAt: r.sendAt.toISOString(), status: r.status, template: r.template }));
    },
  }),
  defineTool({
    name: "reminders.schedule",
    group: "reminders",
    description: "(Re)build the reminder schedule for a booking (staff/ops).",
    tier: "write-safe",
    principalTypes: ["staff", "system"],
    scopes: ["reminders:write"],
    input: z.object({ bookingId: uuid }).strict(),
    async handler(ctx, args) {
      const rows = await svc.scheduleForBooking(ctx, args.bookingId);
      return { scheduled: rows.length, reminders: rows.map((r) => ({ kind: r.kind, sendAt: r.sendAt.toISOString() })) };
    },
  }),
  defineTool({
    name: "reviews.request",
    group: "reviews",
    description: "Send a post-event review request (staff/ops).",
    tier: "write-safe",
    principalTypes: ["staff", "system"],
    scopes: ["reviews:write_own", "reviews:write"],
    input: z.object({ bookingId: uuid }).strict(),
    async handler(ctx, args) {
      const review = await svc.requestReview(ctx, args.bookingId);
      return { reviewId: review.id, requestedAt: review.requestedAt?.toISOString() ?? null };
    },
  }),
  defineTool({
    name: "reviews.record",
    group: "reviews",
    description: "Record a customer rating 1-5. Low scores open a human handoff.",
    tier: "write-safe",
    principalTypes: ["customer", "staff", "system"],
    scopes: ["reviews:write_own", "reviews:write"],
    input: z
      .object({
        bookingId: uuid,
        rating: z.number().int().min(1).max(5),
        comment: z.string().max(2000).optional(),
      })
      .strict(),
    async handler(ctx, args) {
      const result = await svc.recordReview(ctx, args);
      return { reviewId: result.review.id, rating: result.review.rating, handoffId: result.handoffId ?? null };
    },
  }),
  defineTool({
    name: "handoffs.create",
    group: "handoffs",
    description:
      "Escalate to a human and stop the agent on this conversation. Use for complaints, harm, ambiguity or when asked for a person.",
    tier: "escalate",
    principalTypes: ["customer", "staff", "system"],
    scopes: ["handoff:create", "handoffs:create"],
    input: z
      .object({
        reason: z.string().min(4).max(1000),
        priority: z.enum(["low", "normal", "high", "urgent"]).optional(),
        conversationId: uuid.optional(),
        customerId: uuid.optional(),
      })
      .strict(),
    async handler(ctx, args) {
      let conversationId = args.conversationId;
      if (!conversationId) {
        const customerId = await resolveCustomerId(ctx, args.customerId);
        const conversation = await svc.ensureConversation(ctx, customerId);
        conversationId = conversation.id;
      }
      const handoff = await svc.createHandoff(ctx, {
        conversationId,
        reason: args.reason,
        priority: args.priority,
      });
      return { handoffId: handoff.id, status: handoff.status };
    },
  }),
  defineTool({
    name: "handoffs.list",
    group: "handoffs",
    description: "Human handoff queue (staff/ops).",
    tier: "read",
    principalTypes: ["staff", "system"],
    scopes: ["approvals:read"],
    input: z.object({ status: z.enum(["open", "assigned", "resolved"]).optional() }).strict(),
    async handler(ctx, args) {
      const rows = await svc.listHandoffs(ctx, args);
      return rows.map((r) => ({
        id: r.handoff.id,
        customer: r.customer.name,
        phone: r.customer.phoneE164,
        reason: r.handoff.reason,
        priority: r.handoff.priority,
        status: r.handoff.status,
        createdAt: r.handoff.createdAt.toISOString(),
      }));
    },
  }),
];

/* ───────────────────── reports / blocks / messages ───────────────── */

const opsTools: AnyToolDef[] = [
  defineTool({
    name: "reports.dashboard",
    group: "reports",
    description: "KPIs, next 7 days and the needs-a-human count (staff/ops).",
    tier: "read",
    principalTypes: ["staff", "system"],
    scopes: ["reports:read"],
    input: z.object({}).strict(),
    async handler(ctx) {
      const data = await svc.getDashboard(ctx);
      return {
        kpis: data.kpis,
        next7Days: data.next7Days.map((n) => ({
          customer: n.customer.name,
          offering: n.offering.name,
          startsAt: n.booking.startsAt.toISOString(),
          status: n.booking.status,
          resources: n.resources,
        })),
        revenueSeries: data.revenueSeries,
      };
    },
  }),
  defineTool({
    name: "reports.daily_digest",
    group: "reports",
    description: "Daily ops digest text: today's events, unpaid balances, handoffs and reconciliation.",
    tier: "read",
    principalTypes: ["staff", "system"],
    scopes: ["reports:read"],
    input: z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }).strict(),
    async handler(ctx, args) {
      const digest = await svc.buildDailyDigest(ctx, args.date);
      return digest;
    },
  }),
  defineTool({
    name: "blocks.list",
    group: "blocks",
    description: "Manual unavailability blocks (staff/ops).",
    tier: "read",
    principalTypes: ["staff", "system"],
    scopes: ["bookings:read"],
    input: z.object({ from: iso.optional(), to: iso.optional() }).strict(),
    async handler(ctx, args) {
      const rows = await svc.listBlocks(ctx, {
        from: args.from ? new Date(args.from) : undefined,
        to: args.to ? new Date(args.to) : undefined,
      });
      return rows.map((b) => ({
        id: b.id,
        resourceId: b.resourceId,
        startsAt: b.startsAt.toISOString(),
        endsAt: b.endsAt.toISOString(),
        reason: b.reason,
      }));
    },
  }),
  defineTool({
    name: "blocks.create",
    group: "blocks",
    description: "Block a resource for maintenance or private use (staff only).",
    tier: "write-safe",
    principalTypes: ["staff"],
    scopes: ["bookings:write"],
    input: z
      .object({ resourceId: uuid, startsAt: iso, endsAt: iso, reason: z.string().max(300).optional() })
      .strict(),
    async handler(ctx, args) {
      const block = await svc.createBlock(ctx, args);
      return { id: block.id };
    },
  }),
  defineTool({
    name: "blocks.delete",
    group: "blocks",
    description: "Remove a block (staff only).",
    tier: "write-safe",
    principalTypes: ["staff"],
    scopes: ["bookings:write"],
    input: z.object({ blockId: uuid }).strict(),
    async handler(ctx, args) {
      await svc.deleteBlock(ctx, args.blockId);
      return { ok: true };
    },
  }),
  defineTool({
    name: "conversations.list",
    group: "conversations",
    description: "Conversations inbox with handler/state (staff/ops).",
    tier: "read",
    principalTypes: ["staff", "system"],
    scopes: ["messages:send"],
    input: z.object({}).strict(),
    async handler(ctx) {
      const rows = await svc.listConversations(ctx);
      return rows.map((r) => ({
        id: r.conversation.id,
        customer: r.customer.name,
        phone: r.customer.phoneE164,
        handler: r.conversation.handler,
        state: r.conversation.state,
        lastMessage: r.lastMessage?.body ?? null,
        lastInboundAt: r.conversation.lastInboundAt?.toISOString() ?? null,
      }));
    },
  }),
  defineTool({
    name: "conversations.thread",
    group: "conversations",
    description: "Read a conversation thread (customer sees own only).",
    tier: "read",
    principalTypes: ["customer", "staff", "system"],
    scopes: ["messages:send", "bookings:read_own"],
    input: z.object({ conversationId: uuid.optional(), limit: z.number().int().min(1).max(100).optional() }).strict(),
    async handler(ctx, args) {
      let conversationId = args.conversationId;
      if (!conversationId) {
        if (ctx.principal.type !== "customer") throw new svc.ValidationError("conversationId is required.");
        const conversation = await svc.ensureConversation(ctx, ctx.principal.customerId);
        conversationId = conversation.id;
      }
      const thread = await svc.getConversationThread(ctx, conversationId, args.limit ?? 40);
      return {
        id: thread.conversation.id,
        handler: thread.conversation.handler,
        state: thread.conversation.state,
        messages: thread.messages.map((m) => ({
          direction: m.direction,
          body: m.body,
          at: m.createdAt.toISOString(),
        })),
      };
    },
  }),
  defineTool({
    name: "messages.send",
    group: "messages",
    description: "Send a WhatsApp message to the customer on a conversation (staff/ops).",
    tier: "write-sensitive",
    principalTypes: ["staff", "system"],
    scopes: ["messages:send"],
    input: z.object({ conversationId: uuid, text: z.string().min(1).max(4000) }).strict(),
    async handler(ctx, args) {
      await svc.sendStaffMessage(ctx, args);
      return { ok: true };
    },
  }),
];

/* ─────────────────────── vertical extras (presets) ────────────────── */

/**
 * Tools that a vertical preset opts into via `agent.toolExtras`. They are
 * safe for venues to ignore: a venue agent is simply never granted them.
 */
const verticalTools: AnyToolDef[] = [
  defineTool({
    name: "addons.quote",
    group: "addons",
    description:
      "Price an offering together with add-ons (chairs, tents, sound, decor). Amounts come from the server.",
    tier: "read",
    principalTypes: ["customer", "staff", "system"],
    scopes: ["bookings:read_own", "bookings:read"],
    input: z
      .object({
        offeringId: uuid.optional(),
        offering: z.string().max(120).optional(),
        addons: z
          .array(
            z
              .object({
                addonId: uuid.optional(),
                name: z.string().max(120).optional(),
                qty: z.number().int().min(1).max(200).default(1),
              })
              .strict(),
          )
          .max(20)
          .optional(),
        discountKes: z.number().int().min(0).optional(),
      })
      .strict(),
    async handler(ctx, args) {
      const offeringId = await resolveOfferingId(ctx, args);
      const addons = await resolveAddons(ctx, args.addons);
      return svc.getQuote(ctx, { offeringId, addons, discountKes: args.discountKes });
    },
  }),
  defineTool({
    name: "meetings.create_link",
    group: "meetings",
    description:
      "Create and store a meeting link for an online session, and send it to the customer (consultancy).",
    tier: "write-safe",
    principalTypes: ["staff", "system"],
    scopes: ["bookings:write"],
    input: z.object({ bookingId: uuid }).strict(),
    async handler(ctx, args) {
      return svc.attachMeetingLink(ctx, args.bookingId);
    },
  }),
  defineTool({
    name: "intake.send_form",
    group: "intake",
    description: "Send the pre-session intake form link for a booking (consultancy).",
    tier: "write-safe",
    principalTypes: ["staff", "system"],
    scopes: ["bookings:write"],
    input: z.object({ bookingId: uuid }).strict(),
    async handler(ctx, args) {
      return svc.sendIntakeForm(ctx, args.bookingId);
    },
  }),
  defineTool({
    name: "recalls.schedule",
    group: "recalls",
    description:
      "Schedule a recall reminder after a completed appointment, e.g. a six-month dental check-up.",
    tier: "write-safe",
    principalTypes: ["staff", "system"],
    scopes: ["reminders:write"],
    input: z
      .object({ bookingId: uuid, months: z.number().int().min(1).max(24).optional() })
      .strict(),
    async handler(ctx, args) {
      return svc.scheduleRecall(ctx, args);
    },
  }),
  defineTool({
    name: "walkins.join_queue",
    group: "walkins",
    description:
      "Add a walk-in client to today's queue for a service and stylist (salon). Returns their position.",
    tier: "write-safe",
    principalTypes: ["staff", "system"],
    scopes: ["bookings:write"],
    input: z
      .object({
        name: z.string().min(2).max(120),
        phone: z.string().min(9).max(20),
        offeringId: uuid,
        resourceId: uuid.optional(),
      })
      .strict(),
    async handler(ctx, args) {
      return svc.joinWalkInQueue(ctx, args);
    },
  }),
];

export const TOOLS: AnyToolDef[] = [
  ...knowledgeTools,
  ...bookingTools,
  ...customerTools,
  ...moneyTools,
  ...workflowTools,
  ...opsTools,
  ...verticalTools,
];

export const TOOL_MAP = new Map(TOOLS.map((t) => [t.name, t]));

export const TOOL_GROUPS = [...new Set(TOOLS.map((t) => t.group))];
