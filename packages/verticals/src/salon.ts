import { z } from "zod";
import { WEEKDAYS_MON_FRI, type Preset } from "./types";

export const salonPreset: Preset = {
  id: "salon",
  version: "1.0.0",
  title: "Salon & spa",
  bookingMode: "slot",
  labels: {
    resource: "Stylist",
    resources: "Stylists",
    offering: "Service",
    offerings: "Services",
    customer: "Client",
    customers: "Clients",
    staff: "Team",
    booking: "Appointment",
    bookings: "Appointments",
    partySize: "People",
    extras: "Add-ons",
  },
  resourceKinds: ["staff", "equipment"],
  sensitiveData: false,
  defaults: {
    depositPct: 0,
    taxPct: 0,
    holdHours: 2,
    cancellationNoticeHours: 12,
    workingHours: WEEKDAYS_MON_FRI,
    slotIntervalMin: 30,
  },
  attributes: {
    resource: z.object({ station: z.string().max(80).optional() }).strict(),
    offering: z.object({ category: z.string().max(80).optional() }).strict(),
    booking: z.object({ stylistPreference: z.string().max(120).optional() }).strict(),
    customer: z.object({ preferredStylist: z.string().max(120).optional() }).strict(),
  },
  offerings: [
    { name: "Wash & Blow Dry", durationMin: 45, basePriceKes: 1500, resourceKind: "staff" },
    { name: "Braiding", durationMin: 180, basePriceKes: 4500, resourceKind: "staff" },
    { name: "Relaxer & Treatment", durationMin: 120, basePriceKes: 3500, resourceKind: "staff" },
    { name: "Manicure & Pedicure", durationMin: 90, basePriceKes: 2500, resourceKind: "staff" },
  ],
  reminders: [
    { kind: "appointment_minus_1d", offsetHours: -24, template: "reminder_1d" },
    { kind: "rebook_in_5w", offsetHours: 840, template: "rebook_nudge" },
  ],
  templates: {
    booking_confirmed:
      "Hi {{customer_name}}, your {{offering}} with {{resource_name}} is booked for {{date}} at {{time}}. See you at {{business_name}}!",
    reminder_1d: "Hi {{customer_name}}, a reminder of your {{offering}} tomorrow at {{time}}. Reply to reschedule.",
    rebook_nudge: "Hi {{customer_name}}, it's been a few weeks since your last visit. Ready for a refresh? Book your next visit.",
    payment_received: "Asante {{customer_name}}! Payment of KES {{amount}} received.",
    quote_nudge:
      "Hi {{customer_name}}, just checking in on your {{offering}} quote for {{date}} (KES {{amount}}). Would you like to book it?",
  },
  faq: [
    { q: "Do you take walk-ins?", a: "Yes, subject to stylist availability. Booking ahead is recommended." },
    { q: "What is your cancellation policy?", a: "Please give at least 12 hours notice." },
  ],
  businessFacts: "A unisex salon in Nairobi offering hair, nails and grooming services.",
  agent: {
    name: "Wambo",
    personaExtras:
      "Book short appointments. Always confirm the stylist and the start time. Ask whether the client has a preferred stylist.",
    toolExtras: ["walkins.join_queue"],
  },
  opsDigestHints: ["Tomorrow's schedule by stylist", "No-show risk and unfilled gaps"],
};
