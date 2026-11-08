import { describe, expect, it } from "vitest";
import {
  PRESETS,
  getPreset,
  VERTICAL_IDS,
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
