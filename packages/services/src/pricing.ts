import { eq } from "drizzle-orm";
import { schema } from "@garden/db";
import { z } from "zod";
import { withPrincipal, type ServiceContext } from "./context";
import { NotFoundError, ValidationError, type Principal } from "./types";

export type QuoteAddonInput = { addonId: string; qty: number };

export const quoteAddonSchema = z.object({
  addonId: z.string().uuid(),
  qty: z.number().int().min(1).max(200),
});

export type Quote = {
  offeringId: string;
  offeringName: string;
  basePriceKes: number;
  addonItems: { addonId: string; name: string; qty: number; unitPriceKes: number }[];
  subtotalKes: number;
  discountKes: number;
  taxKes: number;
  totalKes: number;
  depositRequiredKes: number;
};

export function computeQuote(input: {
  basePriceKes: number;
  addons: { addonId: string; name: string; qty: number; unitPriceKes: number }[];
  discountKes?: number;
  taxPct: number;
  depositPct: number;
  depositPctOverride?: number | null;
}): Omit<Quote, "offeringId" | "offeringName"> & { offeringId: ""; offeringName: "" } {
  const addonTotal = input.addons.reduce((sum, a) => sum + a.qty * a.unitPriceKes, 0);
  const subtotal = Math.max(0, Math.round(input.basePriceKes + addonTotal));
  const discount = Math.min(subtotal, Math.max(0, Math.round(input.discountKes ?? 0)));
  const taxable = subtotal - discount;
  const tax = Math.round((taxable * Math.max(0, input.taxPct)) / 100);
  const total = taxable + tax;
  const pct = input.depositPctOverride ?? input.depositPct;
  const deposit = Math.min(total, Math.round((total * Math.max(0, Math.min(100, pct))) / 100));
  return {
    offeringId: "",
    offeringName: "",
    basePriceKes: input.basePriceKes,
    addonItems: input.addons,
    subtotalKes: subtotal,
    discountKes: discount,
    taxKes: tax,
    totalKes: total,
    depositRequiredKes: deposit,
  };
}

export async function getQuote(
  ctx: ServiceContext,
  input: { offeringId: string; addons?: QuoteAddonInput[]; discountKes?: number; taxPct?: number },
): Promise<Quote> {
  const offering = await ctx.db.query.offerings.findFirst({
    where: eq(schema.offerings.id, input.offeringId),
  });
  if (!offering || offering.tenantId !== ctx.tenantId || !offering.active) {
    throw new NotFoundError("Offering", input.offeringId);
  }

  const addonIds = (input.addons ?? []).map((a) => a.addonId);
  const addonRows = addonIds.length
    ? await ctx.db.query.addons.findMany({
        where: (a, { and, eq: eqOp, inArray }) =>
          and(eqOp(a.tenantId, ctx.tenantId), inArray(a.id, addonIds), eqOp(a.active, true)),
      })
    : [];

  const addonMap = new Map(addonRows.map((a) => [a.id, a]));
  const items = (input.addons ?? []).map((entry) => {
    const addon = addonMap.get(entry.addonId);
    if (!addon) throw new ValidationError(`Unknown add-on: ${entry.addonId}`);
    return {
      addonId: addon.id,
      name: addon.name,
      qty: entry.qty,
      unitPriceKes: addon.priceKes,
    };
  });

  const tenant = await ctx.db.query.tenants.findFirst({ where: eq(schema.tenants.id, ctx.tenantId) });
  const configRows = await ctx.db.query.tenantConfig.findMany({
    where: eq(schema.tenantConfig.tenantId, ctx.tenantId),
  });
  const policy = (configRows.find((r) => r.key === "policies")?.value ?? {}) as Record<string, unknown>;
  const verticalRow = await ctx.db.query.tenantVertical.findFirst({
    where: eq(schema.tenantVertical.tenantId, ctx.tenantId),
  });
  const { getPreset } = await import("@garden/verticals");
  const preset = getPreset(verticalRow?.vertical ?? tenant?.vertical ?? "venue");
  const taxPct = input.taxPct ?? (typeof policy.taxPct === "number" ? policy.taxPct : preset.defaults.taxPct);
  const depositPct =
    typeof policy.depositPct === "number" ? policy.depositPct : preset.defaults.depositPct;

  const quote = computeQuote({
    basePriceKes: offering.basePriceKes,
    addons: items,
    discountKes: input.discountKes,
    taxPct,
    depositPct,
    depositPctOverride: offering.depositPct,
  });
  return { ...quote, offeringId: offering.id, offeringName: offering.name };
}

export async function listOfferings(ctx: ServiceContext) {
  return ctx.db.query.offerings.findMany({
    where: (o, { and, eq: eqOp }) => and(eqOp(o.tenantId, ctx.tenantId), eqOp(o.active, true)),
    orderBy: (o, { asc }) => [asc(o.name)],
  });
}

export async function listAddons(ctx: ServiceContext) {
  return ctx.db.query.addons.findMany({
    where: (a, { and, eq: eqOp }) => and(eqOp(a.tenantId, ctx.tenantId), eqOp(a.active, true)),
    orderBy: (a, { asc }) => [asc(a.name)],
  });
}

export async function priceQuote(principal: Principal, input: Parameters<typeof getQuote>[1]) {
  return withPrincipal(principal, (ctx) => getQuote(ctx, input));
}
