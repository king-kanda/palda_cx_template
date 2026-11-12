import { z } from "zod";
import { ALL_DAYS, type Preset } from "./types";

const eventTypes = [
  "wedding",
  "picnic",
  "corporate",
  "birthday",
  "photoshoot",
  "memorial",
  "other",
] as const;

export const venuePreset: Preset = {
  id: "venue",
  version: "1.0.0",
  title: "Event venue / garden",
  bookingMode: "range",
  labels: {
    resource: "Space",
    resources: "Spaces",
    offering: "Package",
    offerings: "Packages",
    customer: "Customer",
    customers: "Customers",
    staff: "Team",
    booking: "Booking",
    bookings: "Bookings",
    partySize: "Guests",
    extras: "Add-ons",
  },
  resourceKinds: ["space", "equipment"],
  sensitiveData: false,
  defaults: {
    depositPct: 30,
    taxPct: 0,
    holdHours: 24,
    cancellationNoticeHours: 72,
    workingHours: ALL_DAYS,
    slotIntervalMin: 60,
  },
  attributes: {
    resource: z
      .object({
        description: z.string().max(500).optional(),
        indoor: z.boolean().optional(),
        covered: z.boolean().optional(),
        minGuests: z.number().int().min(0).optional(),
      })
      .strict(),
    offering: z
      .object({
        included: z.array(z.string()).optional(),
        maxHours: z.number().int().positive().optional(),
      })
      .strict(),
    booking: z
      .object({
        eventType: z.enum(eventTypes),
        startTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
        endTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
        setupNotes: z.string().max(1000).optional(),
      })
      .strict(),
    customer: z.object({ organisation: z.string().max(200).optional() }).strict(),
  },
  offerings: [
    { name: "Full Day", durationMin: 600, basePriceKes: 45000, resourceKind: "space" },
    { name: "Half Day", durationMin: 300, basePriceKes: 25000, resourceKind: "space" },
    { name: "Evening Event", durationMin: 240, basePriceKes: 30000, resourceKind: "space" },
    { name: "Photoshoot", durationMin: 180, basePriceKes: 12000, resourceKind: "space" },
    { name: "Corporate Day", durationMin: 480, basePriceKes: 55000, resourceKind: "space" },
  ],
  reminders: [
    { kind: "hold_nudge", offsetHours: 12, template: "hold_nudge" },
    { kind: "deposit_due", offsetHours: 0, template: "deposit_request" },
    { kind: "event_minus_14d", offsetHours: -336, template: "balance_due" },
    { kind: "event_minus_7d", offsetHours: -168, template: "reminder_7d" },
    { kind: "balance_overdue_3d", offsetHours: -72, template: "balance_due" },
    { kind: "event_minus_1d", offsetHours: -24, template: "reminder_1d" },
    { kind: "thank_you", offsetHours: 24, template: "thank_you_review" },
    { kind: "review_request", offsetHours: 48, template: "thank_you_review" },
  ],
  templates: {
    booking_received:
      "Hi {{customer_name}}, your booking for {{date}} at {{business_name}} is reserved. We'll confirm once the deposit is received.",
    deposit_request:
      "Hi {{customer_name}}, to confirm your {{date}} booking at {{business_name}}, please pay a deposit of KES {{amount}}. Reply here if you need help.",
    payment_received:
      "Thank you {{customer_name}}! We've received KES {{amount}} and your booking for {{date}} is confirmed. 🎉",
    reminder_7d:
      "Hi {{customer_name}}, one week to your event at {{business_name}}! Let us know if you need anything changed.",
    reminder_1d:
      "Hi {{customer_name}}, see you tomorrow at {{business_name}}. Arrival from {{arrival_time}}; parking is on site. Karibu!",
    balance_due:
      "Hi {{customer_name}}, a friendly reminder that KES {{amount}} is outstanding on your booking for {{date}}.",
    thank_you_review:
      "Asante {{customer_name}} for celebrating with us! If you have a minute, we'd love a review: {{review_link}}",
    hold_nudge:
      "Hi {{customer_name}}, your hold for {{date}} at {{business_name}} expires soon. Would you like to confirm with a deposit?",
    quote_nudge:
      "Hi {{customer_name}}, just checking in on your {{offering}} quote for {{date}} (KES {{amount}}). Would you like to go ahead, or shall we adjust anything?",
  },
  faq: [
    { q: "Where are you located?", a: "We are in Karen, Nairobi. Exact directions are sent on booking." },
    { q: "What time does music stop?", a: "Music must stop by 10:00 PM out of respect for neighbours." },
    { q: "Can we bring our own alcohol?", a: "Yes, corkage applies. No hard liquor after 10:00 PM." },
    { q: "Is parking available?", a: "Yes, free parking for up to 80 cars." },
    { q: "Do you allow outside catering?", a: "Yes, with a catering levy of KES 10,000." },
  ],
  businessFacts:
    "Palda Gardens is a 1.5-acre event garden in Karen, Nairobi, hosting weddings, picnics, corporate events, birthdays and photoshoots. Maximum capacity 500 guests.",
  agent: {
    name: "Wambo",
    personaExtras:
      "You help guests plan events in a garden. Ask about event type early. Never promise decorations, catering or discounts that are not in the price list.",
    toolExtras: ["addons.quote", "blocks.create"],
  },
  opsDigestHints: ["Tomorrow's events and setup notes", "Unpaid balances for events in the next 14 days"],
};
