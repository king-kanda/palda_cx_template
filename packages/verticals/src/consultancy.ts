import { z } from "zod";
import { WEEKDAYS_MON_FRI, type Preset } from "./types";

export const consultancyPreset: Preset = {
  id: "consultancy",
  version: "1.0.0",
  title: "Consultancy",
  bookingMode: "slot",
  labels: {
    resource: "Consultant",
    resources: "Consultants",
    offering: "Session type",
    offerings: "Sessions",
    customer: "Client",
    customers: "Clients",
    staff: "Team",
    booking: "Session",
    bookings: "Sessions",
    partySize: "Attendees",
    extras: "Extras",
  },
  resourceKinds: ["staff"],
  sensitiveData: true,
  defaults: {
    depositPct: 50,
    taxPct: 16,
    holdHours: 24,
    cancellationNoticeHours: 48,
    workingHours: WEEKDAYS_MON_FRI,
    slotIntervalMin: 30,
  },
  attributes: {
    resource: z.object({ expertise: z.string().max(200).optional() }).strict(),
    offering: z
      .object({ online: z.boolean().optional(), retainer: z.boolean().optional(), intakeForm: z.boolean().optional() })
      .strict(),
    booking: z
      .object({
        mode: z.enum(["online", "in_person"]).optional(),
        meetingUrl: z.string().url().optional(),
        topic: z.string().max(300).optional(),
      })
      .strict(),
    customer: z.object({ company: z.string().max(200).optional() }).strict(),
  },
  offerings: [
    { name: "Discovery Call", durationMin: 30, basePriceKes: 0, resourceKind: "staff" },
    { name: "Strategy Session", durationMin: 60, basePriceKes: 12000, resourceKind: "staff" },
    { name: "Half-Day Workshop", durationMin: 240, basePriceKes: 45000, resourceKind: "staff" },
    { name: "Monthly Retainer", durationMin: 60, basePriceKes: 80000, resourceKind: "staff" },
  ],
  reminders: [
    { kind: "session_minus_1d", offsetHours: -24, template: "reminder_1d" },
    { kind: "session_minus_1h", offsetHours: -1, template: "reminder_1h" },
  ],
  templates: {
    booking_confirmed:
      "Hi {{customer_name}}, your {{offering}} is confirmed for {{date}} at {{time}}. {{meeting_line}}",
    reminder_1d: "Hi {{customer_name}}, your {{offering}} is tomorrow at {{time}}. {{meeting_line}}",
    reminder_1h: "Hi {{customer_name}}, we're meeting in one hour. See you shortly.",
    payment_received: "Thank you {{customer_name}}, payment of KES {{amount}} received.",
  },
  faq: [
    { q: "Can sessions be online?", a: "Yes, we use Google Meet or Zoom. A link is sent on confirmation." },
    { q: "What is your cancellation policy?", a: "48 hours notice is required to reschedule without charge." },
  ],
  businessFacts: "A boutique business consultancy offering strategy sessions, workshops and retainers.",
  agent: {
    name: "Wambo",
    personaExtras:
      "You schedule sessions and share meeting links. Do not discuss confidential client topics over chat; collect only a short topic line. Send the intake form for workshops.",
    toolExtras: ["meetings.create_link", "intake.send_form"],
  },
  opsDigestHints: ["Tomorrow's sessions and meeting links", "Unpaid retainers"],
};
