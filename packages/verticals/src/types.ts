import type { z } from "zod";

export const VERTICAL_IDS = ["venue", "salon", "dental", "consultancy"] as const;
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
  resourceKind: string;
  attributes?: Record<string, unknown>;
};

export type Preset = {
  id: VerticalId;
  version: string;
  title: string;
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
  reminders: ReminderRule[];
  templates: Record<string, string>;
  faq: { q: string; a: string }[];
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
