import { and, eq, inArray, lt, sql } from "drizzle-orm";
import { schema } from "@garden/db";
import type { VerticalId } from "@garden/verticals";
import { audit, withPrincipal, type ServiceContext } from "./context";
import { cancelBookingInternal, confirmBooking, createBooking, markCompleted } from "./bookings";
import { generateInvoice } from "./invoices";
import { recordPayment } from "./payments";
import { recordReview } from "./reviews";
import { createExpense } from "./expenses";
import { createHandoff } from "./handoffs";
import { requestApproval } from "./approvals";
import { seedDemoTenant } from "./seed";
import { addDays, dateKey, nairobiTime } from "./tz";
import { staffPrincipal, systemPrincipal } from "./types";

/**
 * Showcase data: a business that looks like it has been running for a year. Builds on `seedDemoTenant` (setup, team, services,
 * a few bookings) and adds 12 months of completed and paid bookings (busier towards today), upcoming bookings, more customers,
 * WhatsApp chats in every state, reviews, expenses, an unmatched M-Pesa payment and a pending approval.
 *
 * Everything goes through the same service functions as the app (so prices, invoices and the double-booking constraint are
 * real); only timestamps are moved into the past afterwards. Deterministic: the same business always gets the same data.
 * Customer emails use example.com, and no business here has a WhatsApp number connected, so nothing is ever sent to anyone.
 */

export type ShowcaseBusiness = {
  slug: string;
  name: string;
  vertical: VerticalId;
  agentName: string;
  ownerName: string;
  ownerEmail: string;
  staffEmail: string;
};

export const SHOWCASE_BUSINESSES: ShowcaseBusiness[] = [
  {
    slug: "palda",
    name: "Palda Gardens",
    vertical: "venue",
    agentName: "Waridi",
    ownerName: "Amani Otieno",
    ownerEmail: "owner@paldagardens.co.ke",
    staffEmail: "frontdesk@paldagardens.co.ke",
  },
  {
    slug: "tabasamu-dental",
    name: "Tabasamu Dental Clinic",
    vertical: "dental",
    agentName: "Neema",
    ownerName: "Dr. Wanjiru Kamau",
    ownerEmail: "owner@tabasamudental.co.ke",
    staffEmail: "reception@tabasamudental.co.ke",
  },
  {
    slug: "safi-cleaners",
    name: "Safi Home & Office Cleaners",
    vertical: "cleaning",
    agentName: "Zuri",
    ownerName: "Kevin Mwangi",
    ownerEmail: "owner@saficleaners.co.ke",
    staffEmail: "ops@saficleaners.co.ke",
  },
];

/* ───────────────────────────── deterministic randomness ───────────────────────────── */

function rng(seed: string) {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
  let a = (h = Math.imul(h ^ (h >>> 16), 2246822507)) >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Rand = ReturnType<typeof rng>;
const pick = <T>(r: Rand, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]!;
function weighted<T>(r: Rand, xs: readonly (readonly [T, number])[]): T {
  const total = xs.reduce((n, [, w]) => n + w, 0);
  let x = r() * total;
  for (const [v, w] of xs) {
    x -= w;
    if (x <= 0) return v;
  }
  return xs[xs.length - 1]![0];
}
const poisson = (r: Rand, mean: number) => {
  const l = Math.exp(-mean);
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= r();
  } while (p > l);
  return k - 1;
};

/* ───────────────────────────── people ───────────────────────────── */

const FIRST = [
  "Achieng", "Baraka", "Cheruiyot", "Dorcas", "Edwin", "Fatuma", "George", "Halima", "Ian", "Jackline", "Kipchoge", "Lilian",
  "Moses", "Njeri", "Otieno", "Purity", "Rashid", "Sharon", "Tom", "Wairimu", "Yusuf", "Zipporah", "Brenda", "Collins",
  "Diana", "Eric", "Gladys", "Hassan", "Irene", "Joseph", "Kevin", "Mercy",
] as const;
const LAST = [
  "Odhiambo", "Kiptoo", "Mwangi", "Wekesa", "Nyambura", "Abdi", "Kamau", "Atieno", "Mutiso", "Chebet", "Omondi", "Wanjala",
  "Karanja", "Muthoni", "Ouma", "Kiprono", "Njoroge", "Akinyi", "Barasa", "Gitau",
] as const;

/* ───────────────────────────── per-business shape ───────────────────────────── */

type Shape = {
  /** Mean bookings per day of week (Sun..Sat) at today's volume. */
  perDay: [number, number, number, number, number, number, number];
  offerings: readonly (readonly [string, number])[];
  /** Start times per offering (resources are picked to avoid clashes). */
  times: (offering: string) => string[];
  resources: string[];
  attributes: (r: Rand, offering: string) => Record<string, unknown>;
  partySize: (r: Rand, offering: string) => number;
  expenses: { category: "staff" | "utilities" | "decor" | "maintenance" | "marketing" | "supplies"; vendor: string; min: number; max: number }[];
};

const AREAS = ["Kilimani", "Westlands", "Lavington", "Karen", "Kileleshwa", "South B", "Syokimau", "Runda", "Parklands", "Langata"];

function shapeOf(vertical: VerticalId): Shape {
  switch (vertical) {
    case "venue":
      return {
        perDay: [1.1, 0.15, 0.15, 0.2, 0.35, 0.7, 1.6],
        offerings: [["Full Day", 3], ["Evening Event", 3], ["Half Day", 2], ["Photoshoot", 2], ["Corporate Day", 1.5]],
        times: (o) => (o === "Evening Event" ? ["16:00"] : o === "Photoshoot" ? ["10:00", "14:00"] : o === "Half Day" ? ["08:00", "13:00"] : ["08:00"]),
        resources: ["Main Lawn", "Gazebo", "Picnic Area"],
        attributes: (r, o) => ({
          eventType:
            o === "Corporate Day" ? "corporate" : o === "Photoshoot" ? "photoshoot" : pick(r, ["wedding", "birthday", "corporate", "picnic", "other"] as const),
        }),
        partySize: (r, o) => (o === "Photoshoot" ? 4 + Math.floor(r() * 8) : 40 + Math.floor(r() * 220)),
        expenses: [
          { category: "staff", vendor: "Grounds & event crew", min: 60000, max: 85000 },
          { category: "utilities", vendor: "Kenya Power", min: 9000, max: 16000 },
          { category: "maintenance", vendor: "Green Thumb Landscaping", min: 12000, max: 30000 },
          { category: "decor", vendor: "Bloom Decor Ltd", min: 8000, max: 25000 },
          { category: "marketing", vendor: "Meta ads", min: 5000, max: 12000 },
        ],
      };
    case "dental":
      return {
        perDay: [0, 3, 3.2, 3.2, 3.2, 3.5, 2],
        offerings: [["Consultation", 5], ["Scaling & Polishing", 4], ["Filling", 3], ["Root Canal", 1]],
        times: () => ["08:30", "09:30", "10:30", "11:30", "14:00", "15:00", "16:00"],
        resources: ["Dr. Otieno", "Dr. Wanjiru"],
        attributes: () => ({}),
        partySize: () => 1,
        expenses: [
          { category: "staff", vendor: "Nurses & reception", min: 140000, max: 160000 },
          { category: "supplies", vendor: "Dentmed Supplies", min: 25000, max: 60000 },
          { category: "utilities", vendor: "Kenya Power", min: 7000, max: 11000 },
          { category: "maintenance", vendor: "Equipment servicing", min: 5000, max: 18000 },
          { category: "marketing", vendor: "Google ads", min: 4000, max: 9000 },
        ],
      };
    default:
      return {
        perDay: [0.2, 2.3, 2.4, 2.5, 2.4, 2.7, 2],
        offerings: [["Standard Home Clean", 5], ["Deep Clean", 3], ["Office Clean", 2], ["Sofa & Carpet Cleaning", 2], ["Move-in / Move-out Clean", 1]],
        times: () => ["08:00", "14:30"],
        resources: ["Crew A", "Crew B", "Crew C"],
        attributes: (r, o) => {
          const area = pick(r, AREAS);
          const office = o === "Office Clean";
          return {
            address: office ? `${2 + Math.floor(r() * 9)}th Floor, ${area} Business Centre` : `House ${1 + Math.floor(r() * 40)}, ${area}`,
            area,
            propertyType: office ? "office" : pick(r, ["apartment", "house"] as const),
            frequency: office ? "weekly" : pick(r, ["one_off", "one_off", "weekly", "biweekly"] as const),
          };
        },
        partySize: (r, o) => (o === "Deep Clean" || o === "Move-in / Move-out Clean" ? 3 : o === "Office Clean" ? 4 : 2),
        expenses: [
          { category: "staff", vendor: "Cleaning crew wages", min: 120000, max: 150000 },
          { category: "supplies", vendor: "Chemicals & equipment", min: 15000, max: 32000 },
          { category: "maintenance", vendor: "Van fuel & service", min: 18000, max: 30000 },
          { category: "marketing", vendor: "Meta ads", min: 5000, max: 10000 },
        ],
      };
  }
}

/* ───────────────────────────── chats ───────────────────────────── */

type Line = { from: "customer" | "agent" | "staff"; text: string; minutesAgo: number; tools?: boolean };
type Chat = { state: "open" | "waiting_human"; handler: "wambo" | "human"; lines: Line[]; handoff?: string };

function chatsFor(vertical: VerticalId, agent: string): Chat[] {
  const day = 24 * 60;
  switch (vertical) {
    case "venue":
      return [
        { state: "open", handler: "wambo", lines: [
          { from: "customer", text: "Hi, is the Main Lawn free on the last Saturday of next month? About 150 guests, wedding reception.", minutesAgo: 95 },
          { from: "agent", text: `Hi! I'm ${agent} from Palda Gardens. The Main Lawn is free that Saturday. A full day is KES 45,000 and the deposit holds the date. Shall I put a hold on it for you?`, minutesAgo: 93, tools: true },
          { from: "customer", text: "Yes please, and can we bring our own caterer?", minutesAgo: 12 },
        ] },
        { state: "waiting_human", handler: "wambo", handoff: "Asks for a 20% discount on a corporate booking for 300 people.", lines: [
          { from: "customer", text: "We're planning our company end-year party for 300 staff. Can you do 20% off the Corporate Day?", minutesAgo: 240 },
          { from: "agent", text: "Thanks for thinking of us! Discounts are decided by the team, so I've passed your request on. Someone will get back to you today.", minutesAgo: 238 },
        ] },
        { state: "open", handler: "human", lines: [
          { from: "customer", text: "Habari, tunaweza kuja kuangalia bustani Jumamosi asubuhi?", minutesAgo: day + 300 },
          { from: "agent", text: "Habari! Ndio, karibu sana. Saa nne asubuhi ingekufaa?", minutesAgo: day + 298, tools: true },
          { from: "customer", text: "Sawa, tutakuja watu watatu.", minutesAgo: day + 120 },
          { from: "staff", text: "Karibu! I'll meet you at the gate myself at 10:00. Amani", minutesAgo: day + 60 },
        ] },
        { state: "open", handler: "wambo", lines: [
          { from: "customer", text: "Do you allow photoshoots at the gazebo on weekdays?", minutesAgo: 2 * day },
          { from: "agent", text: "Yes! A photoshoot slot is 3 hours for KES 12,000, Monday to Saturday. Which day were you thinking of?", minutesAgo: 2 * day - 2, tools: true },
          { from: "customer", text: "Thursday at 10 works. Thank you!", minutesAgo: 2 * day - 30 },
          { from: "agent", text: "Done, Thursday 10:00 is on hold for you. I've sent the payment link for the deposit.", minutesAgo: 2 * day - 31, tools: true },
        ] },
        { state: "open", handler: "wambo", lines: [
          { from: "customer", text: "Hello, what time can our decorators start setting up on the wedding day?", minutesAgo: 25 },
        ] },
      ];
    case "dental":
      return [
        { state: "open", handler: "wambo", lines: [
          { from: "customer", text: "Hello, I have a toothache since yesterday. Can I see a dentist today?", minutesAgo: 70 },
          { from: "agent", text: `Sorry to hear that. I'm ${agent} from Tabasamu Dental. Dr. Otieno has 15:00 today for a consultation (KES 2,000). Shall I book it?`, minutesAgo: 69, tools: true },
          { from: "customer", text: "Yes please", minutesAgo: 66 },
          { from: "agent", text: "Booked for 15:00 today with Dr. Otieno. Please come 10 minutes early. Get well soon!", minutesAgo: 65, tools: true },
        ] },
        { state: "waiting_human", handler: "wambo", handoff: "Wants to know if NHIF/SHA covers a root canal; needs the front desk.", lines: [
          { from: "customer", text: "Does SHA cover root canal treatment at your clinic?", minutesAgo: 180 },
          { from: "agent", text: "Good question. Insurance cover depends on your scheme, so I've asked our front desk to check and reply to you here.", minutesAgo: 178 },
        ] },
        { state: "open", handler: "wambo", lines: [
          { from: "customer", text: "Naweza kupanga kusafishwa meno Jumamosi?", minutesAgo: day + 200 },
          { from: "agent", text: "Ndio! Dr. Wanjiru ana nafasi Jumamosi saa tatu na nusu asubuhi. Nikuwekee?", minutesAgo: day + 199, tools: true },
          { from: "customer", text: "Asante, niwekee.", minutesAgo: day + 150 },
          { from: "agent", text: "Umepangiwa Jumamosi saa 3:30 asubuhi na Dr. Wanjiru. Karibu!", minutesAgo: day + 149, tools: true },
        ] },
        { state: "open", handler: "human", lines: [
          { from: "customer", text: "I need a receipt for my last visit for my employer.", minutesAgo: 2 * day },
          { from: "staff", text: "Hi! I've emailed the receipt to the address on your file. Let us know if you need anything else.", minutesAgo: 2 * day - 40 },
        ] },
        { state: "open", handler: "wambo", lines: [
          { from: "customer", text: "Are you open on Sunday?", minutesAgo: 8 },
        ] },
      ];
    default:
      return [
        { state: "open", handler: "wambo", lines: [
          { from: "customer", text: "Hi, how much is a deep clean for a 3-bedroom house in Lavington?", minutesAgo: 50 },
          { from: "agent", text: `Hi! I'm ${agent} from Safi Cleaners. A deep clean is KES 7,500 (about 5 hours, 3 cleaners). Crew B is free Thursday from 8:00. Shall I hold it?`, minutesAgo: 49, tools: true },
          { from: "customer", text: "Thursday works. Please hold it.", minutesAgo: 15 },
        ] },
        { state: "waiting_human", handler: "wambo", handoff: "Says a vase was broken during yesterday's clean and wants compensation.", lines: [
          { from: "customer", text: "Your team broke a vase during the clean yesterday. What will you do about it?", minutesAgo: 300 },
          { from: "agent", text: "I'm really sorry about that. I've passed this to the manager, who will call you today to sort it out.", minutesAgo: 298 },
        ] },
        { state: "open", handler: "wambo", lines: [
          { from: "customer", text: "We need our office in Westlands cleaned every Friday evening. Do you do contracts?", minutesAgo: day + 400 },
          { from: "agent", text: "Yes, we do weekly office cleans. An office clean is KES 6,000 per visit. Shall I set up Fridays from 14:30?", minutesAgo: day + 398, tools: true },
          { from: "customer", text: "Yes, starting next week.", minutesAgo: day + 380 },
          { from: "agent", text: "All set: every Friday at 14:30 with Crew A, starting next week. I'll remind you the day before.", minutesAgo: day + 379, tools: true },
        ] },
        { state: "open", handler: "human", lines: [
          { from: "customer", text: "Can the crew bring their own ladder? We have high windows.", minutesAgo: 2 * day },
          { from: "staff", text: "Yes, they'll bring a 3-step ladder and extension poles. Kevin", minutesAgo: 2 * day - 20 },
        ] },
        { state: "open", handler: "wambo", lines: [
          { from: "customer", text: "Hello, do you clean carpets on Saturday?", minutesAgo: 18 },
        ] },
      ];
  }
}

/* ───────────────────────────── the seeder ───────────────────────────── */

export type ShowcaseResult = {
  slug: string;
  name: string;
  tenantId: string;
  ownerEmail: string;
  staffEmail: string;
  counts: { customers: number; history: number; upcoming: number; payments: number; chats: number; reviews: number; expenses: number; skipped: number };
};

export async function seedShowcaseBusiness(
  business: ShowcaseBusiness,
  passwords: { owner: string; staff: string },
  options: { reset?: boolean; months?: number } = {},
): Promise<ShowcaseResult> {
  const base = await seedDemoTenant({
    slug: business.slug,
    name: business.name,
    vertical: business.vertical,
    ownerEmail: business.ownerEmail,
    ownerName: business.ownerName,
    ownerPassword: passwords.owner,
    staffEmail: business.staffEmail,
    staffPassword: passwords.staff,
    reset: options.reset,
  });
  const tenantId = base.tenantId;
  const r = rng(business.slug);
  const shape = shapeOf(business.vertical);
  const months = options.months ?? 12;
  const counts = { customers: 0, history: 0, upcoming: 0, payments: 0, chats: 0, reviews: 0, expenses: 0, skipped: 0 };

  return withPrincipal(systemPrincipal(tenantId, "seed"), async (ctx) => {
    const db = ctx.db;
    const ownerUser = await db.query.users.findFirst({ where: and(eq(schema.users.tenantId, tenantId), eq(schema.users.role, "owner")) });
    // Same transaction, different identity: the team and the assistant act in the business's activity feed.
    const ownerCtx: ServiceContext = { ...ctx, principal: staffPrincipal(tenantId, ownerUser!.id, "owner") };
    const agentCtx: ServiceContext = { ...ctx, principal: systemPrincipal(tenantId, "agent") };

    // The business's own assistant name.
    const brand = await db.query.tenantConfig.findFirst({ where: and(eq(schema.tenantConfig.tenantId, tenantId), eq(schema.tenantConfig.key, "brand")) });
    await db
      .update(schema.tenantConfig)
      .set({ value: { ...((brand?.value as Record<string, unknown>) ?? {}), agentName: business.agentName } })
      .where(and(eq(schema.tenantConfig.tenantId, tenantId), eq(schema.tenantConfig.key, "brand")));

    const offerings = new Map((await db.query.offerings.findMany({ where: eq(schema.offerings.tenantId, tenantId) })).map((o) => [o.name, o]));
    const resources = new Map((await db.query.resources.findMany({ where: eq(schema.resources.tenantId, tenantId) })).map((x) => [x.name, x.id]));

    // More customers: repeat clients come back, so a few are much more likely to be picked.
    const vIdx = ["venue", "dental", "cleaning"].indexOf(business.vertical) + 1;
    const customers: { id: string; phone: string }[] = (
      await db.query.customers.findMany({ where: eq(schema.customers.tenantId, tenantId) })
    ).map((c) => ({ id: c.id, phone: c.phoneE164 }));
    for (let i = 0; i < 32; i++) {
      const first = FIRST[(i * 7 + vIdx) % FIRST.length]!;
      const last = LAST[(i * 3 + vIdx * 5) % LAST.length]!;
      const phone = `+25411${String(1_000_000 + vIdx * 100_000 + i * 137).padStart(7, "0")}`;
      const [row] = await db
        .insert(schema.customers)
        .values({
          tenantId,
          name: `${first} ${last}`,
          phoneE164: phone,
          email: r() < 0.55 ? `${first}.${last}`.toLowerCase() + "@example.com" : null,
          language: r() < 0.25 ? "sw" : "en",
          tags: r() < 0.2 ? ["repeat"] : [],
        })
        .onConflictDoNothing()
        .returning();
      if (row) {
        customers.push({ id: row.id, phone: row.phoneE164 });
        counts.customers += 1;
      }
    }
    const customerFor = () => customers[r() < 0.35 ? Math.floor(r() * Math.min(10, customers.length)) : Math.floor(r() * customers.length)]!;

    const today = dateKey(new Date());
    const used = new Set<string>();
    type Made = { id: string; start: Date; customer: { id: string; phone: string } };

    const book = async (
      as: ServiceContext,
      dayOffset: number,
      source: "whatsapp" | "staff" | "web",
    ): Promise<Made | null> => {
      const offeringName = weighted(r, shape.offerings);
      const offering = offerings.get(offeringName);
      if (!offering) return null;
      const time = pick(r, shape.times(offeringName));
      const resourceName = shape.resources.find((name) => !used.has(`${dayOffset}|${name}|${time}`)) ?? null;
      if (!resourceName || !resources.has(resourceName)) return null;
      used.add(`${dayOffset}|${resourceName}|${time}`);
      const customer = customerFor();
      try {
        const created = await createBooking(as, {
          customerId: customer.id,
          offeringId: offering.id,
          resourceIds: [resources.get(resourceName)!],
          startsAt: nairobiTime(addDays(today, dayOffset), time).toISOString(),
          partySize: shape.partySize(r, offeringName),
          status: "hold",
          source,
          attributes: shape.attributes(r, offeringName),
        });
        return { id: created.booking.id, start: created.booking.startsAt, customer };
      } catch {
        counts.skipped += 1;
        return null;
      }
    };

    const method = () => weighted(r, [["mpesa", 78], ["cash", 8], ["bank", 10], ["card", 4]] as const);
    const receipt = () => `SH${Math.floor(r() * 36 ** 8).toString(36).toUpperCase().padStart(8, "0")}`;

    const payInFull = async (made: Made, when: Date) => {
      const invoice = await generateInvoice(ctx, { bookingId: made.id, kind: "full" });
      if (invoice.balanceKes <= 0) return;
      const m = method();
      const payment = await recordPayment(ctx, {
        bookingId: made.id,
        invoiceId: invoice.id,
        method: m,
        amountKes: invoice.balanceKes,
        mpesaReceipt: m === "mpesa" ? receipt() : null,
        phone: made.customer.phone,
        notifyCustomer: false,
      });
      counts.payments += 1;
      await db.update(schema.invoices).set({ createdAt: when }).where(eq(schema.invoices.id, invoice.id));
      await db.update(schema.payments).set({ receivedAt: when, createdAt: when }).where(eq(schema.payments.id, (payment as { id: string }).id));
    };

    /* History: completed (and a few cancelled) bookings over the past year, growing towards today. */
    const reviewText = {
      5: ["Wonderful, thank you!", "Excellent service, will be back.", "Very professional and on time.", "Highly recommend."],
      4: ["Good experience overall.", "Great, small delay at the start.", "Nice and friendly team."],
    } as const;
    for (let d = -months * 30; d <= -1; d++) {
      const date = new Date(`${addDays(today, d)}T12:00:00+03:00`);
      const ramp = 0.55 + 0.45 * (1 - Math.abs(d) / (months * 30));
      const n = poisson(r, shape.perDay[date.getUTCDay()]! * ramp);
      for (let k = 0; k < n; k++) {
        const source = weighted(r, [["whatsapp", 55], ["staff", 30], ["web", 15]] as const);
        const made = await book(ctx, d, source);
        if (!made) continue;
        counts.history += 1;
        const leadDays = 1 + Math.floor(r() * (business.vertical === "venue" ? 40 : 10));
        const createdAt = new Date(made.start.getTime() - leadDays * 86_400_000);
        if (r() < 0.07) {
          await cancelBookingInternal(ctx, made.id, pick(r, ["Customer changed plans", "Rescheduled to another month", "Weather"]));
        } else {
          await payInFull(made, new Date(Math.min(made.start.getTime(), Date.now() - 3_600_000)));
          const fresh = await db.query.bookings.findFirst({ where: eq(schema.bookings.id, made.id), columns: { status: true } });
          if (fresh?.status === "hold") await confirmBooking(ctx, made.id);
          await markCompleted(ctx, made.id);
          if (r() < 0.3) {
            const rating = r() < 0.72 ? 5 : 4;
            await recordReview(ctx, { bookingId: made.id, rating, comment: pick(r, reviewText[rating]) });
            await db
              .update(schema.reviews)
              .set({ receivedAt: new Date(made.start.getTime() + 86_400_000), requestedAt: made.start })
              .where(eq(schema.reviews.bookingId, made.id));
            counts.reviews += 1;
          }
        }
        await db.update(schema.bookings).set({ createdAt }).where(eq(schema.bookings.id, made.id));
      }
    }

    /* Upcoming: the next six weeks, booked by the team and by the assistant, some paid, some on hold. */
    let upcomingForApproval: string | null = null;
    {
      for (let d = 0; d <= 42; d++) {
        const date = new Date(`${addDays(today, d)}T12:00:00+03:00`);
        const n = poisson(r, shape.perDay[date.getUTCDay()]! * (d < 14 ? 0.9 : 0.5));
        for (let k = 0; k < n; k++) {
          const viaAgent = r() < 0.55;
          const made = viaAgent ? await book(agentCtx, d, "whatsapp") : await book(ownerCtx, d, r() < 0.8 ? "staff" : "web");
          if (!made) continue;
          counts.upcoming += 1;
          upcomingForApproval ??= made.id;
          const roll = r();
          if (roll < 0.45) {
            const kind = business.vertical === "venue" ? "deposit" : "full";
            const invoice = await generateInvoice(ctx, { bookingId: made.id, kind });
            if (invoice.balanceKes > 0) {
              const m = method();
              const payment = await recordPayment(ctx, {
                bookingId: made.id,
                invoiceId: invoice.id,
                method: m,
                amountKes: invoice.balanceKes,
                mpesaReceipt: m === "mpesa" ? receipt() : null,
                phone: made.customer.phone,
                notifyCustomer: false,
              });
              counts.payments += 1;
              const paidAt = new Date(Date.now() - Math.floor(r() * 6 * 86_400_000));
              await db.update(schema.payments).set({ receivedAt: paidAt, createdAt: paidAt }).where(eq(schema.payments.id, (payment as { id: string }).id));
            }
            const fresh = await db.query.bookings.findFirst({ where: eq(schema.bookings.id, made.id), columns: { status: true } });
            if (fresh?.status === "hold") await confirmBooking(ctx, made.id);
          } else if (roll < 0.62) {
            // Invoiced and sent, not paid yet: these make up "Outstanding".
            await confirmBooking(ctx, made.id);
            const invoice = await generateInvoice(ctx, { bookingId: made.id, kind: "full" });
            await db.update(schema.invoices).set({ status: "sent" }).where(eq(schema.invoices.id, invoice.id));
          } else if (roll < 0.8) {
            await confirmBooking(ctx, made.id);
          }
        }
      }

      /* Expenses: a normal month's running costs, every month. */
      for (let m = 0; m < months; m++) {
        for (const e of shape.expenses) {
          const dayInMonth = 1 + Math.floor(r() * 27);
          const when = new Date();
          when.setUTCMonth(when.getUTCMonth() - m, dayInMonth);
          if (when > new Date()) continue;
          const expense = await createExpense(ownerCtx, {
            category: e.category,
            amountKes: Math.round((e.min + r() * (e.max - e.min)) / 100) * 100,
            vendor: e.vendor,
            incurredOn: when.toISOString(),
          });
          // Recorded when it happened, so the activity feed isn't a year of expenses dated today.
          await db
            .update(schema.auditLog)
            .set({ createdAt: when })
            .where(and(eq(schema.auditLog.tenantId, tenantId), eq(schema.auditLog.entityId, (expense as { id: string }).id)));
          counts.expenses += 1;
        }
      }
    }

    /* Chats in every state: answered, waiting for a person, taken over by the team, and not answered yet. */
    const chatCustomers = customers.slice(customers.length - 12);
    for (const [i, chat] of chatsFor(business.vertical, business.agentName).entries()) {
      const customer = chatCustomers[i]!;
      const lastInbound = [...chat.lines].reverse().find((l) => l.from === "customer");
      const [conversation] = await db
        .insert(schema.conversations)
        .values({
          tenantId,
          customerId: customer.id,
          channel: "whatsapp",
          state: chat.state,
          handler: chat.handler,
          agentState: "new",
          lastInboundAt: lastInbound ? new Date(Date.now() - lastInbound.minutesAgo * 60_000) : null,
        })
        .onConflictDoNothing()
        .returning();
      if (!conversation) continue;
      await db.insert(schema.messages).values(
        chat.lines.map((l, n) => ({
          tenantId,
          conversationId: conversation.id,
          direction: l.from === "customer" ? "inbound" : "outbound",
          waMessageId: `showcase-${business.slug}-${i}-${n}`,
          type: "text",
          body: l.text,
          toolCalls: l.from === "staff" ? [{ staff: true }] : l.tools ? [{ tool: "bookings.check_availability" }] : null,
          createdAt: new Date(Date.now() - l.minutesAgo * 60_000),
        })),
      );
      if (chat.handoff) {
        await createHandoff(ctx, { conversationId: conversation.id, reason: chat.handoff, priority: "high", notifyCustomer: false });
        await db.update(schema.conversations).set({ state: "waiting_human" }).where(eq(schema.conversations.id, conversation.id));
      }
      counts.chats += 1;
    }

    /* Money that came in without a booking reference (the "Reconcile now" card). */
    const stranger = customers[3]!;
    await db.insert(schema.payments).values({
      tenantId,
      bookingId: null,
      accountRef: "SHUKRANI",
      method: "mpesa",
      amountKes: business.vertical === "venue" ? 12500 : business.vertical === "dental" ? 3500 : 4500,
      mpesaReceipt: receipt(),
      phone: stranger.phone,
      provider: "manual",
      status: "succeeded",
      receivedAt: new Date(Date.now() - 2 * 86_400_000),
    });

    /* One decision waiting for the owner. */
    if (upcomingForApproval) {
      await requestApproval(agentCtx, {
        kind: "discount",
        payload: { bookingId: upcomingForApproval, pct: 10, reason: "Returning customer asked for 10% off." },
        expiresInHours: 72,
      });
    }

    // Reminders for dates already gone would all fire at once on the next worker run; they belong to the past.
    await db
      .update(schema.reminders)
      .set({ status: "cancelled" })
      .where(and(eq(schema.reminders.tenantId, tenantId), eq(schema.reminders.status, "pending"), lt(schema.reminders.sendAt, new Date())));
    // Older review handoffs are long dealt with; keep only today's demo ones open.
    await db
      .update(schema.handoffs)
      .set({ status: "resolved", resolvedAt: new Date() })
      .where(
        and(
          eq(schema.handoffs.tenantId, tenantId),
          eq(schema.handoffs.status, "open"),
          sql`${schema.handoffs.reason} not in (${sql.join(
            chatsFor(business.vertical, business.agentName).filter((c) => c.handoff).map((c) => sql`${c.handoff!}`),
            sql`, `,
          )})`,
        ),
      );
    // Conversations whose handoff was just resolved go back to the assistant.
    const stillOpen = await db.query.handoffs.findMany({
      where: and(eq(schema.handoffs.tenantId, tenantId), eq(schema.handoffs.status, "open")),
      columns: { conversationId: true },
    });
    const keep = stillOpen.map((h) => h.conversationId);
    await db
      .update(schema.conversations)
      .set({ state: "open", handler: "wambo" })
      .where(
        and(
          eq(schema.conversations.tenantId, tenantId),
          eq(schema.conversations.state, "waiting_human"),
          keep.length ? sql`${schema.conversations.id} not in (${sql.join(keep.map((id) => sql`${id}`), sql`, `)})` : sql`true`,
        ),
      );
    // The history was written by the seeder; the activity feed should show what people did, not 500 seed entries.
    await db.delete(schema.auditLog).where(and(eq(schema.auditLog.tenantId, tenantId), inArray(schema.auditLog.actor, ["system:seed"])));
    await audit(ctx, "seed.completed", "tenant", tenantId, { showcase: true, ...counts });

    return { slug: business.slug, name: business.name, tenantId, ownerEmail: business.ownerEmail, staffEmail: business.staffEmail, counts };
  });
}
