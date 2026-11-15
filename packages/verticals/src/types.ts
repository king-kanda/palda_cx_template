import type { z } from "zod";

export const VERTICAL_IDS = ["venue", "salon", "dental", "consultancy", "cleaning"] as const;
export type VerticalId = (typeof VERTICAL_IDS)[number];

export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;
export type DayHours = { open: string; close: string } | null;
export type WorkingHours = Record<Weekday, DayHours>;

export type VerticalLabels = {
  resource: string;
  resources: string;
  offering: string;
  offerings: string;
  customer: string;
  customers: string;
  staff: string;
  booking: string;
  bookings: string;
  partySize: string;
  extras: string;
};

export type ReminderRule = {
  kind: string;
  /** hours relative to the event start; negative = before, positive = after */
  offsetHours: number;
  template: string;
  channel?: "whatsapp" | "web";
};

export type PreviewOffering = {
  name: string;
  durationMin: number;
  basePriceKes: number;
  depositPct?: number;
  /** Minutes blocked before the slot (e.g. travel time to a customer's address). */
  bufferBeforeMin?: number;
  /** Minutes blocked after the slot (e.g. cleanup or travel home). */
  bufferAfterMin?: number;
  resourceKind: string;
  attributes?: Record<string, unknown>;
};

/** A resource (staff member, room, space) a new business starts with. Names are generic and editable. */
export type StarterResource = {
  name: string;
  kind: string;
  capacity?: number;
  attributes?: Record<string, unknown>;
};

export type StarterAddon = { name: string; priceKes: number; unit: string };

/**
 * A vertical-specific question asked when staff create a booking, stored in `booking.attributes[key]`.
 * Keys must be accepted by `preset.attributes.booking` (enforced by a unit test).
 */
export type BookingField = {
  key: string;
  label: string;
  type: "text" | "textarea" | "select" | "number";
  required?: boolean;
  placeholder?: string;
  options?: { value: string; label: string }[];
  defaultValue?: string;
};

export type Preset = {
  id: VerticalId;
  version: string;
  title: string;
  /** One-line pitch shown on the onboarding "what kind of business" step. */
  tagline: string;
  bookingMode: "range" | "slot";
  labels: VerticalLabels;
  resourceKinds: string[];
  sensitiveData: boolean;
  defaults: {
    depositPct: number;
    taxPct: number;
    holdHours: number;
    cancellationNoticeHours: number;
    workingHours: WorkingHours;
    slotIntervalMin: number;
  };
  attributes: {
    resource: z.ZodTypeAny;
    offering: z.ZodTypeAny;
    booking: z.ZodTypeAny;
    customer: z.ZodTypeAny;
  };
  offerings: PreviewOffering[];
  /** Questions staff answer per booking (shown in the new-booking form and booking views). */
  bookingFields: BookingField[];
  starterResources: StarterResource[];
  addons: StarterAddon[];
  reminders: ReminderRule[];
  templates: Record<string, string>;
  faq: { q: string; a: string; needsReview?: boolean }[];
  businessFacts: string;
  agent: {
    name: string;
    personaExtras: string;
    toolExtras: string[];
  };
  opsDigestHints: string[];
};

export const ALL_DAYS: WorkingHours = {
  0: { open: "08:00", close: "22:00" },
  1: { open: "08:00", close: "22:00" },
  2: { open: "08:00", close: "22:00" },
  3: { open: "08:00", close: "22:00" },
  4: { open: "08:00", close: "22:00" },
  5: { open: "08:00", close: "22:00" },
  6: { open: "08:00", close: "22:00" },
};

export const WEEKDAYS_MON_FRI: WorkingHours = {
  0: null,
  1: { open: "09:00", close: "18:00" },
  2: { open: "09:00", close: "18:00" },
  3: { open: "09:00", close: "18:00" },
  4: { open: "09:00", close: "18:00" },
  5: { open: "09:00", close: "18:00" },
  6: { open: "09:00", close: "14:00" },
};

export const WEEKDAYS_MON_SAT_EARLY: WorkingHours = {
  0: null,
  1: { open: "07:30", close: "18:00" },
  2: { open: "07:30", close: "18:00" },
  3: { open: "07:30", close: "18:00" },
  4: { open: "07:30", close: "18:00" },
  5: { open: "07:30", close: "18:00" },
  6: { open: "08:00", close: "16:00" },
};

/** Human-readable "Label: value" rows for a booking's vertical-specific attributes. */
export function describeBookingAttributes(
  fields: BookingField[],
  attributes: Record<string, unknown> | null | undefined,
): { key: string; label: string; value: string }[] {
  const source = attributes ?? {};
  return fields
    .map((field) => {
      const raw = source[field.key];
      if (raw === undefined || raw === null || raw === "") return null;
      const text = String(raw);
      const option = field.options?.find((o) => o.value === text);
      return { key: field.key, label: field.label, value: option?.label ?? text };
    })
    .filter((row): row is { key: string; label: string; value: string } => row !== null);
}
