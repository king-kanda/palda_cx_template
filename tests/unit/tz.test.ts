import { describe, expect, it } from "vitest";
import {
  addDays,
  dateKey,
  formatNairobi,
  formatNairobiTime,
  monthBounds,
  nairobiTime,
  startOfNairobiDay,
} from "../../packages/services/src/tz";

describe("Nairobi time helpers", () => {
  it("turns a Nairobi wall-clock time into the correct UTC instant", () => {
    const instant = nairobiTime("2026-06-12", "14:30");
    expect(instant.toISOString()).toBe("2026-06-12T11:30:00.000Z");
  });

  it("renders a UTC instant back as a Nairobi date key", () => {
    // 21:30 UTC is 00:30 the next day in Nairobi.
    const lateUtc = new Date("2026-06-12T21:30:00.000Z");
    expect(dateKey(lateUtc)).toBe("2026-06-13");
  });

  it("starts a Nairobi day at 21:00 UTC the previous day", () => {
    expect(startOfNairobiDay("2026-01-01").toISOString()).toBe("2025-12-31T21:00:00.000Z");
  });

  it("adds days without drifting across a month boundary", () => {
    expect(addDays("2026-02-27", 2)).toBe("2026-03-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });

  it("builds month bounds as half-open Nairobi ranges", () => {
    const bounds = monthBounds("2026-02");
    expect(bounds.start.toISOString()).toBe("2026-01-31T21:00:00.000Z");
    expect(bounds.end.toISOString()).toBe("2026-02-28T21:00:00.000Z");
  });

  it("formats for humans in Africa/Nairobi", () => {
    const instant = new Date("2026-06-12T11:30:00.000Z");
    expect(formatNairobi(instant)).toBe("12 Jun 2026");
    expect(formatNairobiTime(instant)).toBe("14:30");
  });
});
