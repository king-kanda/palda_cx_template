import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@garden/db";
import { passwordHash } from "@garden/integrations";
import { getPreset, type VerticalId } from "@garden/verticals";
import { withPrincipal } from "./context";
import { createBooking, confirmBooking, markCompleted, cancelBookingInternal } from "./bookings";
import { generateInvoice, recalculateInvoices } from "./invoices";
import { recordPayment } from "./payments";
import { recordReview } from "./reviews";
import { logComplaint } from "./customers";
import { createBlock } from "./blocks";
import { addDays, dateKey, nairobiTime } from "./tz";
import { systemPrincipal } from "./types";
import { audit } from "./context";

export type SeedOptions = {
  slug: string;
  name: string;
  vertical: VerticalId;
  ownerEmail: string;
  ownerPassword: string;
  ownerName?: string;
  staffEmail?: string;
  staffPassword?: string;
  reset?: boolean;
};

const CUSTOMERS = [
  { name: "Wanjiku Kamau", phone: "+254712345678", tags: ["wedding", "vip"], language: "en" },
  { name: "Brian Ochieng", phone: "+254723456789", tags: ["corporate"], language: "en" },
  { name: "Aisha Mohamed", phone: "+254734567890", tags: ["repeat"], language: "sw" },
  { name: "Peter Njoroge", phone: "+254745678901", tags: ["corporate", "repeat"], language: "en" },
  { name: "Grace Wambui", phone: "+254756789012", tags: ["birthday"], language: "en" },
  { name: "David Mutua", phone: "+254767890123", tags: ["picnic"], language: "en" },
  { name: "Faith Chebet", phone: "+254778901234", tags: ["wedding"], language: "en" },
  { name: "Samuel Kariuki", phone: "+254789012345", tags: [], language: "sw" },
];

type ResourceSeed = { name: string; kind: string; capacity?: number; parent?: string; sort?: number; attributes?: Record<string, unknown> };

function resourcesFor(vertical: VerticalId): ResourceSeed[] {
  switch (vertical) {
    case "venue":
      return [
        { name: "Whole Garden", kind: "space", capacity: 500, sort: 0, attributes: { description: "The entire 1.5-acre garden", indoor: false } },
        { name: "Main Lawn", kind: "space", capacity: 300, parent: "Whole Garden", sort: 1, attributes: { description: "Large open lawn for ceremonies and receptions", indoor: false } },
        { name: "Gazebo", kind: "space", capacity: 80, parent: "Whole Garden", sort: 2, attributes: { description: "Covered gazebo for intimate events", covered: true } },
        { name: "Picnic Area", kind: "space", capacity: 150, parent: "Whole Garden", sort: 3, attributes: { description: "Shaded picnic grounds under acacia trees", indoor: false } },
        { name: "Sound System", kind: "equipment", capacity: 1, sort: 10 },
      ];
    case "salon":
      return [
        { name: "Zawadi", kind: "staff", sort: 0, attributes: { station: "Chair 1" } },
        { name: "Amina", kind: "staff", sort: 1, attributes: { station: "Chair 2" } },
        { name: "Brian", kind: "staff", sort: 2, attributes: { station: "Chair 3" } },
      ];
    case "dental":
      return [
        { name: "Dr. Otieno", kind: "staff", sort: 0 },
        { name: "Dr. Wanjiru", kind: "staff", sort: 1 },
        { name: "Chair 1", kind: "room", sort: 10, attributes: { roomNumber: "1" } },
        { name: "Chair 2", kind: "room", sort: 11, attributes: { roomNumber: "2" } },
      ];
    case "consultancy":
      return [
        { name: "Grace Mwangi", kind: "staff", sort: 0, attributes: { expertise: "Strategy & growth" } },
        { name: "Peter Kariuki", kind: "staff", sort: 1, attributes: { expertise: "Finance & operations" } },
      ];
  }
}

type BookingSeed = {
  customer: number;
  offering: string;
  resource: string;
  offsetDays: number;
  time: string;
  status: "hold" | "confirmed" | "completed" | "cancelled";
  pay: "none" | "deposit" | "full";
  partySize: number;
  eventType?: string;
  notes?: string;
};

function bookingsFor(vertical: VerticalId): BookingSeed[] {
  switch (vertical) {
    case "venue":
      return [
        { customer: 0, offering: "Full Day", resource: "Whole Garden", offsetDays: -20, time: "09:00", status: "completed", pay: "full", partySize: 180, eventType: "wedding" },
        { customer: 2, offering: "Evening Event", resource: "Gazebo", offsetDays: -8, time: "16:00", status: "completed", pay: "full", partySize: 60, eventType: "birthday" },
        { customer: 1, offering: "Evening Event", resource: "Gazebo", offsetDays: -12, time: "16:00", status: "cancelled", pay: "none", partySize: 50, eventType: "corporate" },
        { customer: 3, offering: "Corporate Day", resource: "Whole Garden", offsetDays: 2, time: "08:00", status: "confirmed", pay: "deposit", partySize: 220, eventType: "corporate" },
        { customer: 0, offering: "Full Day", resource: "Main Lawn", offsetDays: 4, time: "09:00", status: "confirmed", pay: "deposit", partySize: 150, eventType: "wedding" },
        { customer: 4, offering: "Evening Event", resource: "Gazebo", offsetDays: 7, time: "16:00", status: "hold", pay: "none", partySize: 45, eventType: "birthday" },
        { customer: 5, offering: "Half Day", resource: "Picnic Area", offsetDays: 9, time: "09:00", status: "confirmed", pay: "deposit", partySize: 80, eventType: "picnic" },
        { customer: 6, offering: "Full Day", resource: "Whole Garden", offsetDays: 14, time: "09:00", status: "confirmed", pay: "deposit", partySize: 260, eventType: "wedding" },
        { customer: 7, offering: "Half Day", resource: "Main Lawn", offsetDays: 18, time: "08:00", status: "hold", pay: "none", partySize: 120, eventType: "other" },
        { customer: 2, offering: "Photoshoot", resource: "Picnic Area", offsetDays: 24, time: "10:00", status: "confirmed", pay: "deposit", partySize: 8, eventType: "photoshoot" },
      ];
    case "salon":
      return [
        { customer: 2, offering: "Wash & Blow Dry", resource: "Zawadi", offsetDays: 1, time: "10:00", status: "confirmed", pay: "none", partySize: 1 },
        { customer: 4, offering: "Braiding", resource: "Amina", offsetDays: 1, time: "11:30", status: "confirmed", pay: "none", partySize: 1 },
        { customer: 5, offering: "Manicure & Pedicure", resource: "Brian", offsetDays: 3, time: "14:00", status: "hold", pay: "none", partySize: 1 },
      ];
    case "dental":
      return [
        { customer: 0, offering: "Consultation", resource: "Dr. Otieno", offsetDays: 1, time: "09:00", status: "confirmed", pay: "none", partySize: 1 },
        { customer: 3, offering: "Scaling & Polishing", resource: "Dr. Wanjiru", offsetDays: 2, time: "10:00", status: "confirmed", pay: "none", partySize: 1 },
      ];
    case "consultancy":
      return [
        { customer: 1, offering: "Strategy Session", resource: "Grace Mwangi", offsetDays: 2, time: "10:00", status: "confirmed", pay: "deposit", partySize: 2 },
        { customer: 3, offering: "Discovery Call", resource: "Peter Kariuki", offsetDays: 5, time: "14:00", status: "hold", pay: "none", partySize: 1 },
      ];
  }
}

export async function seedDemoTenant(options: SeedOptions) {
  const db = getDb();
  const existing = await db.query.tenants.findFirst({ where: eq(schema.tenants.slug, options.slug) });
  if (existing && !options.reset) {
    throw new Error(
      `Tenant "${options.slug}" already exists. Re-run with --reset to wipe and reseed (dev only).`,
    );
  }
  if (existing && options.reset) {
    await db.delete(schema.tenants).where(eq(schema.tenants.id, existing.id));
  }

  const preset = getPreset(options.vertical);
  const [tenant] = await db
    .insert(schema.tenants)
    .values({
      slug: options.slug,
      name: options.name,
      vertical: options.vertical,
      timezone: "Africa/Nairobi",
      currency: "KES",
    })
    .returning();
  const tenantId = tenant!.id;

  await db.insert(schema.tenantVertical).values({
    tenantId,
    vertical: options.vertical,
    presetVersion: preset.version,
  });
  await db.insert(schema.tenantConfig).values([
    {
      tenantId,
      key: "policies",
      value: {
        depositPct: preset.defaults.depositPct,
        taxPct: preset.defaults.taxPct,
        holdHours: preset.defaults.holdHours,
        cancellationNoticeHours: preset.defaults.cancellationNoticeHours,
      },
    },
    {
      tenantId,
      key: "business",
      value: {
        workingHours: preset.defaults.workingHours,
        slotIntervalMin: preset.defaults.slotIntervalMin,
        reviewLink: "https://g.page/r/palda-gardens/review",
        arrivalTime: options.vertical === "venue" ? "10:00" : "09:45",
        facts: preset.businessFacts,
        faq: preset.faq,
        location: "Karen, Nairobi",
      },
    },
    {
      tenantId,
      key: "brand",
      value: { agentName: preset.agent.name, accent: "#C2410C" },
    },
  ]);

  const ownerId = crypto.randomUUID();
  const staffId = crypto.randomUUID();
  await db.insert(schema.users).values([
    {
      id: ownerId,
      tenantId,
      email: options.ownerEmail.toLowerCase(),
      name: options.ownerName ?? "Palda Owner",
      passwordHash: passwordHash(options.ownerPassword),
      role: "owner",
    },
    {
      id: staffId,
      tenantId,
      email: (options.staffEmail ?? "staff@palda.co.ke").toLowerCase(),
      name: "Front Desk",
      passwordHash: passwordHash(options.staffPassword ?? "staff1234"),
      role: "staff",
    },
  ]);

  // Resources (with parent links, inserted in order)
  const resourceIdByName = new Map<string, string>();
  for (const resource of resourcesFor(options.vertical)) {
    const [row] = await db
      .insert(schema.resources)
      .values({
        tenantId,
        kind: resource.kind,
        name: resource.name,
        capacity: resource.capacity ?? null,
        parentResourceId: resource.parent ? resourceIdByName.get(resource.parent) ?? null : null,
        attributes: resource.attributes ?? {},
        sortOrder: resource.sort ?? 0,
      })
      .returning();
    resourceIdByName.set(resource.name, row!.id);
  }

  const offeringIds = new Map<string, string>();
  for (const offering of preset.offerings) {
    const [row] = await db
      .insert(schema.offerings)
      .values({
        tenantId,
        name: offering.name,
        resourceKind: offering.resourceKind,
        durationMin: offering.durationMin,
        basePriceKes: offering.basePriceKes,
        depositPct: offering.depositPct ?? null,
        attributes: offering.attributes ?? {},
      })
      .returning();
    offeringIds.set(offering.name, row!.id);
  }

  if (options.vertical === "venue") {
    await db.insert(schema.addons).values([
      { tenantId, name: "Extra chairs (per 50)", priceKes: 5000, unit: "bundle" },
      { tenantId, name: "Tent (10x10m)", priceKes: 35000, unit: "each" },
      { tenantId, name: "Sound system", priceKes: 15000, unit: "each" },
      { tenantId, name: "Catering levy", priceKes: 10000, unit: "each" },
      { tenantId, name: "Decor package", priceKes: 25000, unit: "each" },
      { tenantId, name: "Security (per guard)", priceKes: 3000, unit: "guard" },
    ]);
  } else if (options.vertical === "salon") {
    await db.insert(schema.addons).values([
      { tenantId, name: "Deep conditioning", priceKes: 800, unit: "each" },
      { tenantId, name: "Scalp massage", priceKes: 500, unit: "each" },
    ]);
  }

  const customerIds: string[] = [];
  for (const c of CUSTOMERS) {
    const [row] = await db
      .insert(schema.customers)
      .values({
        tenantId,
        name: c.name,
        phoneE164: c.phone,
        language: c.language,
        tags: c.tags,
        attributes: { organisation: c.tags.includes("corporate") ? "Acme Kenya Ltd" : undefined },
      })
      .returning();
    customerIds.push(row!.id);
  }

  const system = systemPrincipal(tenantId, "seed");

  const stats = { bookings: 0, invoices: 0, payments: 0, skipped: 0 };
  const today = dateKey(new Date());
  const createdBookingIds: string[] = [];

  await withPrincipal(system, async (ctx) => {
    for (const seed of bookingsFor(options.vertical)) {
      const offeringId = offeringIds.get(seed.offering);
      const resourceId = resourceIdByName.get(seed.resource);
      if (!offeringId || !resourceId) continue;
      try {
        const created = await createBooking(ctx, {
          customerId: customerIds[seed.customer],
          offeringId,
          resourceIds: [resourceId],
          startsAt: nairobiTime(addDays(today, seed.offsetDays), seed.time).toISOString(),
          partySize: seed.partySize,
          status: "hold",
          source: "staff",
          attributes:
            options.vertical === "venue" ? { eventType: seed.eventType ?? "other" } : {},
          notes: seed.notes,
        });
        stats.bookings += 1;
        createdBookingIds.push(created.booking.id);

        if (seed.status === "cancelled") {
          await cancelBookingInternal(ctx, created.booking.id, "Customer changed plans");
          continue;
        }

        if (seed.pay !== "none") {
          const deposit = await generateInvoice(ctx, { bookingId: created.booking.id, kind: "deposit" });
          stats.invoices += 1;
          await recordPayment(ctx, {
            bookingId: created.booking.id,
            invoiceId: deposit.id,
            method: "mpesa",
            amountKes: deposit.totalKes,
            mpesaReceipt: `SEED${Date.now().toString().slice(-6)}${stats.payments}`,
            phone: CUSTOMERS[seed.customer]!.phone,
            notifyCustomer: false,
          });
          stats.payments += 1;
          await confirmBooking(ctx, created.booking.id);
        }

        if (seed.status === "confirmed") {
          const refreshed = await ctx.db.query.bookings.findFirst({
            where: eq(schema.bookings.id, created.booking.id),
          });
          if (refreshed?.status === "hold") await confirmBooking(ctx, created.booking.id);
        }

        if (seed.status === "completed") {
          if (seed.pay === "full") {
            const balance = await generateInvoice(ctx, { bookingId: created.booking.id, kind: "balance" });
            stats.invoices += 1;
            if (balance.balanceKes > 0) {
              await recordPayment(ctx, {
                bookingId: created.booking.id,
                invoiceId: balance.id,
                method: "mpesa",
                amountKes: balance.balanceKes,
                mpesaReceipt: `SEEDB${Date.now().toString().slice(-6)}${stats.payments}`,
                phone: CUSTOMERS[seed.customer]!.phone,
                notifyCustomer: false,
              });
              stats.payments += 1;
            }
          }
          await recalculateInvoices(ctx, created.booking.id);
          await markCompleted(ctx, created.booking.id);
        }
      } catch {
        stats.skipped += 1;
      }
    }

    // A maintenance block and a conversation with a handoff for the demo.
    if (options.vertical === "venue") {
      const gazebo = resourceIdByName.get("Gazebo");
      if (gazebo) {
        try {
          await createBlock(ctx, {
            resourceId: gazebo,
            startsAt: nairobiTime(addDays(today, 6), "08:00").toISOString(),
            endsAt: nairobiTime(addDays(today, 6), "12:00").toISOString(),
            reason: "Gazebo maintenance",
          });
        } catch {
          /* overlapping demo data is fine */
        }
      }
    }

    // Conversations
    const conversationCustomer = customerIds[4]!;
    const [conversation] = await ctx.db
      .insert(schema.conversations)
      .values({
        tenantId,
        customerId: conversationCustomer,
        channel: "whatsapp",
        state: "open",
        handler: "wambo",
        agentState: "quoted",
        lastInboundAt: new Date(Date.now() - 40 * 60_000),
      })
      .returning();
    await ctx.db.insert(schema.messages).values([
      {
        tenantId,
        conversationId: conversation!.id,
        direction: "inbound",
        waMessageId: "seed-in-1",
        type: "text",
        body: "Hi, is the gazebo free this Saturday for a birthday?",
        createdAt: new Date(Date.now() - 45 * 60_000),
      },
      {
        tenantId,
        conversationId: conversation!.id,
        direction: "outbound",
        waMessageId: "seed-out-1",
        type: "text",
        body: "Hi Grace! The gazebo is free from 4pm on Saturday. Would you like a quote for the evening package?",
        createdAt: new Date(Date.now() - 40 * 60_000),
        toolCalls: [{ tool: "bookings.check_availability" }],
      },
    ]);

    await logComplaint(ctx, {
      customerId: customerIds[3]!,
      summary: "Claims the sound system cut out halfway through the corporate event.",
      severity: "high",
    });

    // Reviews: one great, one low (creates a handoff)
    const completed = await ctx.db.query.bookings.findMany({
      where: and(eq(schema.bookings.tenantId, tenantId), eq(schema.bookings.status, "completed")),
      orderBy: (b, { asc }) => [asc(b.startsAt)],
    });
    if (completed[0]) {
      await recordReview(ctx, { bookingId: completed[0].id, rating: 5, comment: "Beautiful garden and great team!" });
    }
    if (completed[1]) {
      await recordReview(ctx, {
        bookingId: completed[1].id,
        rating: 3,
        comment: "Lovely venue but the setup was late.",
      });
    }

    await audit(ctx, "seed.completed", "tenant", tenantId, stats);
  });

  return {
    tenantId,
    slug: options.slug,
    vertical: options.vertical,
    ownerEmail: options.ownerEmail,
    counts: {
      ...stats,
      customers: customerIds.length,
      resources: resourceIdByName.size,
      offerings: offeringIds.size,
      completedBookingIds: createdBookingIds,
    },
  };
}
