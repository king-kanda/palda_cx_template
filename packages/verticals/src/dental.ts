import { z } from "zod";
import { WEEKDAYS_MON_FRI, type Preset } from "./types";

export const dentalPreset: Preset = {
  id: "dental",
  version: "1.0.0",
  title: "Dental clinic",
  bookingMode: "slot",
  labels: {
    resource: "Dentist",
    resources: "Dentists",
    offering: "Treatment",
    offerings: "Treatments",
    customer: "Patient",
    customers: "Patients",
    staff: "Team",
    booking: "Appointment",
    bookings: "Appointments",
    partySize: "Patients",
    extras: "Extras",
  },
  resourceKinds: ["staff", "room"],
  sensitiveData: true,
  defaults: {
    depositPct: 0,
    taxPct: 0,
    holdHours: 2,
    cancellationNoticeHours: 24,
    workingHours: WEEKDAYS_MON_FRI,
    slotIntervalMin: 15,
  },
  attributes: {
    resource: z.object({ roomNumber: z.string().max(20).optional() }).strict(),
    offering: z
      .object({ isNewPatient: z.boolean().optional(), recallMonths: z.number().int().optional() })
      .strict(),
    booking: z.object({ chairId: z.string().uuid().optional(), isRecall: z.boolean().optional() }).strict(),
    customer: z.object({ }).strict(),
  },
  offerings: [
    { name: "Consultation", durationMin: 30, basePriceKes: 2000, resourceKind: "staff" },
    { name: "Scaling & Polishing", durationMin: 45, basePriceKes: 3500, resourceKind: "staff" },
    { name: "Filling", durationMin: 45, basePriceKes: 5000, resourceKind: "staff" },
    { name: "Root Canal", durationMin: 90, basePriceKes: 15000, resourceKind: "staff" },
  ],
  reminders: [
    { kind: "appointment_minus_1d", offsetHours: -24, template: "reminder_1d" },
    { kind: "recall_6m", offsetHours: 4320, template: "recall" },
  ],
  templates: {
    booking_confirmed:
      "Hi {{customer_name}}, your appointment for {{offering}} is booked for {{date}} at {{time}} with {{resource_name}}. Please arrive 10 minutes early.",
    reminder_1d:
      "Hi {{customer_name}}, a reminder of your appointment tomorrow at {{time}}. Reply to reschedule (24 hours notice required).",
    recall: "Hi {{customer_name}}, it's time for your 6-month dental check-up. Reply BOOK to schedule.",
    quote_nudge:
      "Hi {{customer_name}}, just checking in on your {{offering}} quote for {{date}} (KES {{amount}}). Would you like to book it?",
  },
  faq: [
    { q: "Where are you located?", a: "We are on Ngong Road, Nairobi." },
    { q: "What should I bring?", a: "Your ID and any previous dental records." },
  ],
  businessFacts: "A dental clinic in Nairobi focused on preventive and restorative care.",
  agent: {
    name: "Wambo",
    personaExtras:
      "You handle scheduling only. Never give clinical advice, diagnose, or discuss treatment details. Any clinical question goes to a staff member via handoff. Be extra careful with patient privacy.",
    toolExtras: ["recalls.schedule"],
  },
  opsDigestHints: ["Tomorrow's schedule by dentist and chair", "No-show risks"],
};
