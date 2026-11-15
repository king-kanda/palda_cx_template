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
    case "cleaning":
      return [
        { name: "Crew A", kind: "staff", sort: 0, attributes: { zone: "Kilimani, Kileleshwa, Westlands" } },
        { name: "Crew B", kind: "staff", sort: 1, attributes: { zone: "Lavington, Karen, Runda" } },
        { name: "Crew C", kind: "staff", sort: 2, attributes: { zone: "Syokimau, South B, Embakasi" } },
      ];
  }
}

/** Demo copy so each vertical's sample data reads naturally (no gazebo in a dental clinic). */
function demoCopy(vertical: VerticalId) {
  switch (vertical) {
    case "venue":
      return {
        location: "Karen, Nairobi",
        inbound: "Hi, is the gazebo free this Saturday for a birthday?",
        outbound: "Hi Grace! The gazebo is free from 4pm on Saturday. Would you like a quote for the evening package?",
        complaint: "Claims the sound system cut out halfway through the corporate event.",
        reviewGood: "Beautiful garden and great team!",
        reviewLow: "Lovely venue but the setup was late.",
      };
    case "salon":
      return {
        location: "Westlands, Nairobi",
        inbound: "Hi, do you have a slot for braids on Saturday morning?",
        outbound: "Hi Grace! Amina is free at 9am on Saturday for braiding (about 3 hours). Shall I book it?",
        complaint: "Says the colour came out lighter than agreed.",
        reviewGood: "Lovely service and my hair looks amazing!",
        reviewLow: "Great result but I waited 30 minutes past my appointment.",
      };
    case "dental":
      return {
        location: "Ngong Road, Nairobi",
        inbound: "Hello, I'd like to book a scaling and polishing this week.",
        outbound: "Hi Grace! Dr. Wanjiru has a slot on Thursday at 10:00. Shall I book it for you?",
        complaint: "Waited 40 minutes past the appointment time.",
        reviewGood: "Gentle, professional and on time.",
        reviewLow: "Good care but the wait was long.",
      };
    case "consultancy":
      return {
        location: "Upper Hill, Nairobi",
        inbound: "Hi, can we book a strategy session for next week?",
        outbound: "Hi Grace! Grace Mwangi has Tuesday at 10:00 free for a 60-minute strategy session. Shall I hold it?",
        complaint: "Says the meeting link arrived too late for the session.",
        reviewGood: "Practical, focused and worth every shilling.",
        reviewLow: "Useful content but the session started late.",
      };
    case "cleaning":
      return {
        location: "Kilimani, Nairobi",
        inbound: "Hi, do you have a crew free on Thursday morning for a deep clean in Kilimani?",
        outbound:
          "Hi Grace! Crew B is free from 8:00am on Thursday. A deep clean is KES 7,500 (about 5 hours). Please share your full address and I'll hold the slot.",
        complaint: "Says the kitchen wasn't cleaned properly and a plate was chipped during the visit.",
        reviewGood: "Spotless, and the crew was on time!",
        reviewLow: "Good clean but they arrived 40 minutes late.",
      };
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
  /** Vertical-specific booking attributes (validated by the preset's booking schema). */
  attributes?: Record<string, unknown>;
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
    case "cleaning": {
      const flat = (address: string, area: string, frequency = "one_off") => ({ address, area, propertyType: "apartment", frequency });
      const house = (address: string, area: string, frequency = "one_off") => ({ address, area, propertyType: "house", frequency });
      const office = (address: string, area: string, frequency = "weekly") => ({ address, area, propertyType: "office", frequency });
      return [
        { customer: 0, offering: "Standard Home Clean", resource: "Crew A", offsetDays: -14, time: "09:00", status: "completed", pay: "full", partySize: 2, attributes: flat("Apt 4B, Ngong Road Heights, Kilimani", "Kilimani", "biweekly") },
        { customer: 2, offering: "Deep Clean", resource: "Crew B", offsetDays: -9, time: "08:00", status: "completed", pay: "full", partySize: 3, attributes: house("House 12, Lavington Green", "Lavington") },
        { customer: 3, offering: "Office Clean", resource: "Crew A", offsetDays: -5, time: "14:00", status: "completed", pay: "full", partySize: 6, attributes: office("4th Floor, Delta Towers, Westlands", "Westlands") },
        { customer: 1, offering: "Sofa & Carpet Cleaning", resource: "Crew B", offsetDays: -3, time: "11:00", status: "cancelled", pay: "none", partySize: 1, attributes: flat("Apt 9A, Riverside Drive", "Riverside") },
        { customer: 0, offering: "Standard Home Clean", resource: "Crew A", offsetDays: 1, time: "09:00", status: "confirmed", pay: "none", partySize: 2, attributes: { ...flat("Apt 4B, Ngong Road Heights, Kilimani", "Kilimani", "biweekly"), accessNotes: "Concierge has the spare key." } },
        { customer: 4, offering: "Deep Clean", resource: "Crew B", offsetDays: 2, time: "08:00", status: "confirmed", pay: "none", partySize: 3, attributes: { ...house("House 7, Karen Brooks", "Karen"), accessNotes: "Two dogs, friendly. Gate code 4471." } },
        { customer: 3, offering: "Office Clean", resource: "Crew A", offsetDays: 3, time: "14:00", status: "confirmed", pay: "none", partySize: 6, attributes: office("4th Floor, Delta Towers, Westlands", "Westlands") },
        { customer: 5, offering: "Move-in / Move-out Clean", resource: "Crew C", offsetDays: 5, time: "08:00", status: "hold", pay: "none", partySize: 3, attributes: flat("Block C, Syokimau Estate", "Syokimau") },
        { customer: 6, offering: "Standard Home Clean", resource: "Crew A", offsetDays: 6, time: "10:00", status: "confirmed", pay: "none", partySize: 2, attributes: flat("Apt 12, Kileleshwa Gardens", "Kileleshwa", "weekly") },
        { customer: 7, offering: "Sofa & Carpet Cleaning", resource: "Crew B", offsetDays: 8, time: "13:00", status: "hold", pay: "none", partySize: 1, attributes: house("House 3, Runda Mimosa", "Runda") },
      ];
    }
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
  const demo = demoCopy(options.vertical);
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
        reviewLink: `https://g.page/r/${options.slug}/review`,
        arrivalTime: options.vertical === "venue" ? "10:00" : "09:45",
        facts: preset.businessFacts,
        faq: preset.faq.map(({ q, a }) => ({ q, a })),
        location: demo.location,
      },
    },
    {
      tenantId,
      key: "brand",
      value: { agentName: preset.agent.name, accent: "#1E4D3F" },
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
        bufferBeforeMin: offering.bufferBeforeMin ?? 0,
        bufferAfterMin: offering.bufferAfterMin ?? 0,
        attributes: offering.attributes ?? {},
      })
      .returning();
    offeringIds.set(offering.name, row!.id);
  }

  if (preset.addons.length > 0) {
    await db.insert(schema.addons).values(preset.addons.map((addon) => ({ tenantId, ...addon })));
  }

  const customerIds: string[] = [];
  const isVenue = options.vertical === "venue";
  const zeroDeposit = preset.defaults.depositPct === 0;
  for (const c of CUSTOMERS) {
    const [row] = await db
      .insert(schema.customers)
      .values({
        tenantId,
        name: c.name,
        phoneE164: c.phone,
        language: c.language,
        // Event-style tags (wedding, picnic…) only make sense for the venue demo.
        tags: isVenue ? c.tags : c.tags.filter((t) => ["repeat", "vip", "corporate"].includes(t)),
        attributes: isVenue ? { organisation: c.tags.includes("corporate") ? "Acme Kenya Ltd" : undefined } : {},
      })
      .returning();
    customerIds.push(row!.id);
  }

  const system = systemPrincipal(tenantId, "seed");

  const stats = { bookings: 0, invoices: 0, payments: 0, skipped: 0 };
  const skipReasons: string[] = [];
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
            options.vertical === "venue"
              ? { eventType: seed.eventType ?? "other" }
              : (seed.attributes ?? {}),
          notes: seed.notes,
        });
        stats.bookings += 1;
        createdBookingIds.push(created.booking.id);

        if (seed.status === "cancelled") {
          await cancelBookingInternal(ctx, created.booking.id, "Customer changed plans");
          continue;
        }

        if (seed.pay !== "none") {
          // A business with no deposit has nothing to invoice up front: bill the whole job at once.
          const deposit = await generateInvoice(ctx, {
            bookingId: created.booking.id,
            kind: zeroDeposit ? "full" : "deposit",
          });
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
          if (seed.pay === "full" && !zeroDeposit) {
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
      } catch (error) {
        stats.skipped += 1;
        skipReasons.push(`${seed.offering} / ${seed.resource} (${seed.offsetDays}d): ${error instanceof Error ? error.message : String(error)}`);
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
        body: demo.inbound,
        createdAt: new Date(Date.now() - 45 * 60_000),
      },
      {
        tenantId,
        conversationId: conversation!.id,
        direction: "outbound",
        waMessageId: "seed-out-1",
        type: "text",
        body: demo.outbound,
        createdAt: new Date(Date.now() - 40 * 60_000),
        toolCalls: [{ tool: "bookings.check_availability" }],
      },
    ]);

    await logComplaint(ctx, {
      customerId: customerIds[3]!,
      summary: demo.complaint,
      severity: "high",
    });

    // Reviews: one great, one low (creates a handoff)
    const completed = await ctx.db.query.bookings.findMany({
      where: and(eq(schema.bookings.tenantId, tenantId), eq(schema.bookings.status, "completed")),
      orderBy: (b, { asc }) => [asc(b.startsAt)],
    });
    if (completed[0]) {
      await recordReview(ctx, { bookingId: completed[0].id, rating: 5, comment: demo.reviewGood });
    }
    if (completed[1]) {
      await recordReview(ctx, {
        bookingId: completed[1].id,
        rating: 3,
        comment: demo.reviewLow,
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
      skipReasons,
    },
  };
}
