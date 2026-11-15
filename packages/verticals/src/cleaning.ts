import { z } from "zod";
import { WEEKDAYS_MON_SAT_EARLY, type Preset } from "./types";

const propertyTypes = ["apartment", "house", "office", "other"] as const;
const frequencies = ["one_off", "weekly", "biweekly", "monthly"] as const;

/**
 * Cleaning & home services: crews visit the customer's address.
 * Travel time is modelled as a buffer before each job; the address is captured per booking.
 * Not modelled yet: routing, zone pricing and dispatch (a field-service layer would add those).
 */
export const cleaningPreset: Preset = {
  id: "cleaning",
  version: "1.0.0",
  title: "Cleaning & home services",
  tagline: "Home and office cleaning: crews, visit addresses, travel buffers, rebook and review nudges.",
  bookingMode: "slot",
  labels: {
    resource: "Cleaner",
    resources: "Cleaners",
    offering: "Service",
    offerings: "Services",
    customer: "Client",
    customers: "Clients",
    staff: "Team",
    booking: "Job",
    bookings: "Jobs",
    partySize: "Rooms",
    extras: "Add-ons",
  },
  resourceKinds: ["staff"],
  sensitiveData: false,
  defaults: {
    depositPct: 0,
    taxPct: 0,
    holdHours: 4,
    cancellationNoticeHours: 24,
    workingHours: WEEKDAYS_MON_SAT_EARLY,
    slotIntervalMin: 60,
  },
  attributes: {
    resource: z.object({ zone: z.string().max(120).optional(), vehicle: z.string().max(80).optional() }).strict(),
    offering: z.object({ description: z.string().max(500).optional() }).strict(),
    booking: z
      .object({
        address: z.string().min(3).max(200).optional(),
        area: z.string().max(80).optional(),
        propertyType: z.enum(propertyTypes).optional(),
        accessNotes: z.string().max(500).optional(),
        frequency: z.enum(frequencies).optional(),
      })
      .strict(),
    customer: z.object({ homeArea: z.string().max(80).optional() }).strict(),
  },
  offerings: [
    {
      name: "Standard Home Clean",
      durationMin: 180,
      basePriceKes: 3500,
      bufferBeforeMin: 30,
      resourceKind: "staff",
      attributes: { description: "Dusting, floors, kitchen and bathrooms for up to 2 bedrooms." },
    },
    {
      name: "Deep Clean",
      durationMin: 300,
      basePriceKes: 7500,
      bufferBeforeMin: 30,
      resourceKind: "staff",
      attributes: { description: "Top-to-bottom clean including inside cupboards, appliances' exteriors and grout." },
    },
    {
      name: "Move-in / Move-out Clean",
      durationMin: 360,
      basePriceKes: 9000,
      bufferBeforeMin: 30,
      resourceKind: "staff",
      attributes: { description: "Empty-property clean for handover or arrival." },
    },
    {
      name: "Office Clean",
      durationMin: 240,
      basePriceKes: 6000,
      bufferBeforeMin: 30,
      resourceKind: "staff",
      attributes: { description: "Desks, floors, kitchenette and washrooms." },
    },
    {
      name: "Sofa & Carpet Cleaning",
      durationMin: 150,
      basePriceKes: 4500,
      bufferBeforeMin: 30,
      resourceKind: "staff",
      attributes: { description: "Shampoo and extraction for sofas and carpets." },
    },
  ],
  bookingFields: [
    {
      key: "address",
      label: "Visit address",
      type: "text",
      required: true,
      placeholder: "Building / street, house or apartment number",
    },
    { key: "area", label: "Area / estate", type: "text", placeholder: "e.g. Kilimani" },
    {
      key: "propertyType",
      label: "Property type",
      type: "select",
      defaultValue: "apartment",
      options: [
        { value: "apartment", label: "Apartment" },
        { value: "house", label: "House" },
        { value: "office", label: "Office" },
        { value: "other", label: "Other" },
      ],
    },
    {
      key: "frequency",
      label: "Frequency",
      type: "select",
      defaultValue: "one_off",
      options: [
        { value: "one_off", label: "One-off" },
        { value: "weekly", label: "Weekly" },
        { value: "biweekly", label: "Every 2 weeks" },
        { value: "monthly", label: "Monthly" },
      ],
    },
    {
      key: "accessNotes",
      label: "Access notes",
      type: "textarea",
      placeholder: "Gate code, who lets us in, parking, pets…",
    },
  ],
  starterResources: [
    { name: "Crew A", kind: "staff" },
    { name: "Crew B", kind: "staff" },
  ],
  addons: [
    { name: "Inside oven", priceKes: 1000, unit: "each" },
    { name: "Inside fridge", priceKes: 800, unit: "each" },
    { name: "Interior windows", priceKes: 1200, unit: "each" },
    { name: "Balcony", priceKes: 600, unit: "each" },
    { name: "Laundry & ironing (per load)", priceKes: 1000, unit: "load" },
    { name: "Extra bedroom", priceKes: 700, unit: "room" },
  ],
  reminders: [
    { kind: "visit_minus_1d", offsetHours: -24, template: "reminder_1d" },
    { kind: "review_request", offsetHours: 3, template: "thank_you_review" },
    { kind: "rebook_in_2w", offsetHours: 336, template: "rebook_nudge" },
  ],
  templates: {
    booking_confirmed:
      "Hi {{customer_name}}, your {{offering}} is booked for {{date}} at {{time}} at {{address}}. See you then!",
    reminder_1d:
      "Hi {{customer_name}}, a reminder: your {{offering}} is tomorrow at {{time}} at {{address}}. Reply here to reschedule or share access details.",
    thank_you_review:
      "Hi {{customer_name}}, thanks for choosing {{business_name}}! How was your clean? Reply with a rating from 1 to 5, or leave a review: {{review_link}}",
    rebook_nudge:
      "Hi {{customer_name}}, it's been two weeks since your last clean with {{business_name}}. Want to book your next one?",
    payment_received: "Asante {{customer_name}}! Payment of KES {{amount}} received.",
    quote_nudge:
      "Hi {{customer_name}}, just checking in on your {{offering}} quote for {{date}} (KES {{amount}}). Would you like to book it?",
  },
  faq: [
    { q: "Do you bring your own supplies?", a: "Yes. Our crews bring cleaning products and equipment. We only need water and electricity." },
    { q: "How long does a clean take?", a: "A standard home clean takes about 3 hours; a deep clean about 5. Larger homes take longer.", needsReview: true },
    { q: "What is your cancellation policy?", a: "Please give at least 24 hours notice to reschedule or cancel without charge." },
    { q: "Do I need to be home?", a: "No, as long as we can get in. Share any gate codes or key arrangements when you book." },
  ],
  businessFacts:
    "A home and office cleaning service in Nairobi. Crews visit your address with their own supplies and equipment. Services include standard and deep cleans, move-in and move-out cleans, office cleaning, and sofa and carpet cleaning.",
  agent: {
    name: "Wambo",
    personaExtras:
      "You book cleaning visits at the customer's address. Before holding a slot, collect the service type, property type and number of rooms, the full address and estate, the preferred date and time, and any access notes (gate, keys, pets). Quote only from tools; the price depends on the service and add-ons. Never promise a specific cleaner or an arrival time beyond the booked slot. Damage claims, missed visits and complaints go to a human via handoff. If the area is outside what the business serves, hand off rather than guess.",
    toolExtras: [],
  },
  opsDigestHints: ["Tomorrow's jobs by crew with addresses", "Jobs missing an address or access notes"],
};
