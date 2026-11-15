import { describe, expect, it } from "vitest";
import {
  PRESETS,
  describeBookingAttributes,
  getPreset,
  VERTICAL_IDS,
  type BookingField,
} from "../../packages/verticals/src/index";

describe("vertical presets", () => {
  it("ships one complete preset per vertical", () => {
    expect(Object.keys(PRESETS).sort()).toEqual([...VERTICAL_IDS].sort());
  });

  it("has the labels, hours, offerings and templates the app relies on", () => {
    for (const id of VERTICAL_IDS) {
      const preset = getPreset(id);
      expect(preset.labels.booking.length).toBeGreaterThan(0);
      expect(preset.labels.resource.length).toBeGreaterThan(0);
      expect(preset.labels.offering.length).toBeGreaterThan(0);
      expect(preset.offerings.length).toBeGreaterThan(0);
      expect(Object.keys(preset.templates).length).toBeGreaterThan(0);
      expect(preset.faq.length).toBeGreaterThan(0);
      expect(preset.businessFacts.length).toBeGreaterThan(20);

      for (let weekday = 0; weekday <= 6; weekday += 1) {
        const hours = preset.defaults.workingHours[weekday as 0 | 1 | 2 | 3 | 4 | 5 | 6];
        if (hours) {
          expect(hours.open).toMatch(/^\d{2}:\d{2}$/);
          expect(hours.close).toMatch(/^\d{2}:\d{2}$/);
          expect(hours.close > hours.open).toBe(true);
        }
      }

      for (const offering of preset.offerings) {
        expect(offering.durationMin).toBeGreaterThan(0);
        expect(offering.basePriceKes).toBeGreaterThanOrEqual(0);
        expect(preset.resourceKinds).toContain(offering.resourceKind);
      }
      expect(preset.offerings.some((offering) => offering.basePriceKes > 0)).toBe(true);
    }
  });

  it("refuses an unknown vertical instead of silently guessing", () => {
    expect(() => getPreset("unknown-vertical")).toThrow(/Unknown vertical preset/);
  });
});

describe("booking fields (what staff are asked per booking)", () => {
  /** A value the form could plausibly submit for a field. */
  function sampleValue(field: BookingField): unknown {
    if (field.type === "select") return field.defaultValue ?? field.options?.[0]?.value;
    if (field.type === "number") return 2;
    return "Sample text for this field";
  }

  it("every field key and every select option is accepted by the preset's booking schema", () => {
    for (const id of VERTICAL_IDS) {
      const preset = getPreset(id);
      const attributes: Record<string, unknown> = {};
      for (const field of preset.bookingFields) attributes[field.key] = sampleValue(field);
      const result = preset.attributes.booking.safeParse(attributes);
      expect(result.success, `${id}: ${JSON.stringify(attributes)}`).toBe(true);

      for (const field of preset.bookingFields.filter((f) => f.type === "select")) {
        expect(field.options?.length ?? 0, `${id}.${field.key} needs options`).toBeGreaterThan(0);
        for (const option of field.options ?? []) {
          const parsed = preset.attributes.booking.safeParse({ ...attributes, [field.key]: option.value });
          expect(parsed.success, `${id}.${field.key}=${option.value}`).toBe(true);
        }
      }
    }
  });

  it("a preset that needs a field to book (venue) marks it required, so the form can't submit without it", () => {
    const venue = getPreset("venue");
    expect(venue.attributes.booking.safeParse({}).success).toBe(false);
    expect(venue.bookingFields.find((f) => f.key === "eventType")?.required).toBe(true);
  });

  it("rejects the old hard-coded eventType for verticals that don't define it (the bug this replaced)", () => {
    for (const id of VERTICAL_IDS.filter((v) => v !== "venue")) {
      expect(getPreset(id).attributes.booking.safeParse({ eventType: "wedding" }).success, id).toBe(false);
    }
  });

  it("describes only the filled-in fields, using option labels", () => {
    const cleaning = getPreset("cleaning");
    const rows = describeBookingAttributes(cleaning.bookingFields, {
      address: "Apt 4B, Kilimani",
      propertyType: "apartment",
      frequency: "biweekly",
      ignored: "x",
    });
    expect(rows.map((r) => r.label)).toEqual(["Visit address", "Property type", "Frequency"]);
    expect(rows.find((r) => r.key === "frequency")?.value).toBe("Every 2 weeks");
    expect(describeBookingAttributes(cleaning.bookingFields, null)).toEqual([]);
  });

  it("starter resources, add-ons and onboarding copy are usable for every vertical", () => {
    for (const id of VERTICAL_IDS) {
      const preset = getPreset(id);
      expect(preset.tagline.length, id).toBeGreaterThan(20);
      expect(preset.starterResources.length, id).toBeGreaterThan(0);
      for (const resource of preset.starterResources) {
        expect(preset.resourceKinds, `${id}.${resource.name}`).toContain(resource.kind);
      }
      for (const offering of preset.offerings) {
        expect(
          preset.starterResources.some((r) => r.kind === offering.resourceKind),
          `${id}: "${offering.name}" has no starter resource of kind ${offering.resourceKind}`,
        ).toBe(true);
      }
      for (const addon of preset.addons) expect(addon.priceKes).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("cleaning preset", () => {
  const cleaning = getPreset("cleaning");

  it("books at the customer's address with a travel buffer and a Mon-Sat week", () => {
    expect(cleaning.bookingFields.find((f) => f.key === "address")?.required).toBe(true);
    expect(cleaning.offerings.every((o) => (o.bufferBeforeMin ?? 0) > 0)).toBe(true);
    expect(cleaning.defaults.workingHours[0]).toBeNull();
    expect(cleaning.defaults.workingHours[1]).not.toBeNull();
  });

  it("only uses template variables the reminder engine can fill", () => {
    const supported = new Set([
      "customer_name",
      "business_name",
      "date",
      "time",
      "amount",
      "offering",
      "arrival_time",
      "review_link",
      "address",
      "meeting_line",
    ]);
    for (const [name, body] of Object.entries(cleaning.templates)) {
      for (const match of body.matchAll(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g)) {
        expect(supported.has(match[1]!), `${name} uses {{${match[1]}}}`).toBe(true);
      }
    }
    for (const rule of cleaning.reminders) {
      expect(cleaning.templates[rule.template], `reminder ${rule.kind}`).toBeTruthy();
    }
  });

  it("collects reviews: has the thank_you_review template the review request sends", () => {
    expect(cleaning.templates.thank_you_review).toContain("{{review_link}}");
  });
});
