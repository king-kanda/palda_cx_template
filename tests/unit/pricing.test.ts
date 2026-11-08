import { describe, expect, it } from "vitest";
import { computeQuote } from "../../packages/services/src/pricing";

const addon = (id: string, name: string, qty: number, unitPriceKes: number) => ({
  addonId: id,
  name,
  qty,
  unitPriceKes,
});

describe("computeQuote", () => {
  it("prices a base package with tax and deposit", () => {
    const quote = computeQuote({
      basePriceKes: 50_000,
      addons: [],
      taxPct: 16,
      depositPct: 30,
    });

    expect(quote.subtotalKes).toBe(50_000);
    expect(quote.taxKes).toBe(8_000);
    expect(quote.totalKes).toBe(58_000);
    expect(quote.depositRequiredKes).toBe(17_400);
  });

  it("adds add-on lines at their unit price", () => {
    const quote = computeQuote({
      basePriceKes: 40_000,
      addons: [addon("a1", "DJ", 1, 15_000), addon("a2", "Chairs", 20, 150)],
      taxPct: 0,
      depositPct: 50,
    });

    expect(quote.subtotalKes).toBe(58_000);
    expect(quote.totalKes).toBe(58_000);
    expect(quote.depositRequiredKes).toBe(29_000);
    expect(quote.addonItems).toHaveLength(2);
  });

  it("caps the discount at the subtotal and never goes negative", () => {
    const quote = computeQuote({
      basePriceKes: 10_000,
      addons: [],
      discountKes: 25_000,
      taxPct: 16,
      depositPct: 30,
    });

    expect(quote.discountKes).toBe(10_000);
    expect(quote.taxKes).toBe(0);
    expect(quote.totalKes).toBe(0);
    expect(quote.depositRequiredKes).toBe(0);
  });

  it("ignores a negative discount and honours a per-offering deposit override", () => {
    const quote = computeQuote({
      basePriceKes: 20_000,
      addons: [],
      discountKes: -5_000,
      taxPct: 0,
      depositPct: 30,
      depositPctOverride: 10,
    });

    expect(quote.discountKes).toBe(0);
    expect(quote.depositRequiredKes).toBe(2_000);
  });

  it("rounds tax to whole KES", () => {
    const quote = computeQuote({
      basePriceKes: 1_001,
      addons: [],
      taxPct: 16,
      depositPct: 0,
    });

    expect(quote.taxKes).toBe(160);
    expect(quote.totalKes).toBe(1_161);
    expect(Number.isInteger(quote.totalKes)).toBe(true);
  });
});
