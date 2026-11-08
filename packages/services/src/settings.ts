import { and, asc, eq } from "drizzle-orm";
import { schema } from "@garden/db";
import type { Addon, Offering, Resource } from "@garden/db";
import { z } from "zod";
import { audit, getSettings, type ServiceContext } from "./context";
import { kes, requireOwner, requireStaff, NotFoundError, ValidationError } from "./types";

export const resourceInputSchema = z.object({
  kind: z.enum(["space", "staff", "room", "equipment"]),
  name: z.string().min(2).max(120),
  capacity: z.number().int().positive().max(100000).nullable().optional(),
  parentResourceId: z.string().uuid().nullable().optional(),
  attributes: z.record(z.unknown()).default({}),
  sortOrder: z.number().int().default(0),
});

export const offeringInputSchema = z.object({
  name: z.string().min(2).max(120),
  resourceKind: z.enum(["space", "staff", "room", "equipment"]),
  durationMin: z.number().int().min(5).max(1440 * 3),
  bufferBeforeMin: z.number().int().min(0).max(240).default(0),
  bufferAfterMin: z.number().int().min(0).max(240).default(0),
  basePriceKes: z.number().int().min(0).max(100_000_000),
  depositPct: z.number().int().min(0).max(100).nullable().optional(),
  attributes: z.record(z.unknown()).default({}),
});

export const addonInputSchema = z.object({
  name: z.string().min(2).max(120),
  priceKes: z.number().int().min(0).max(10_000_000),
  unit: z.string().min(1).max(40).default("each"),
});

export async function listResources(ctx: ServiceContext, kind?: string): Promise<Resource[]> {
  return ctx.db.query.resources.findMany({
    where: and(
      eq(schema.resources.tenantId, ctx.tenantId),
      kind ? eq(schema.resources.kind, kind) : undefined,
      eq(schema.resources.active, true),
    ),
    orderBy: [asc(schema.resources.sortOrder), asc(schema.resources.name)],
  });
}

export async function listAllOfferings(ctx: ServiceContext): Promise<Offering[]> {
  return ctx.db.query.offerings.findMany({
    where: and(eq(schema.offerings.tenantId, ctx.tenantId), eq(schema.offerings.active, true)),
    orderBy: asc(schema.offerings.basePriceKes),
  });
}

export async function listAllAddons(ctx: ServiceContext): Promise<Addon[]> {
  return ctx.db.query.addons.findMany({
    where: and(eq(schema.addons.tenantId, ctx.tenantId), eq(schema.addons.active, true)),
    orderBy: asc(schema.addons.name),
  });
}

export async function createResource(ctx: ServiceContext, input: z.infer<typeof resourceInputSchema>) {
  requireStaff(ctx.principal);
  const data = resourceInputSchema.parse(input);
  const [resource] = await ctx.db
    .insert(schema.resources)
    .values({ tenantId: ctx.tenantId, ...data, capacity: data.capacity ?? null })
    .returning();
  await audit(ctx, "resource.created", "resource", resource!.id, { name: data.name });
  return resource!;
}

export async function updateResource(
  ctx: ServiceContext,
  id: string,
  input: Partial<z.infer<typeof resourceInputSchema>> & { active?: boolean },
) {
  requireStaff(ctx.principal);
  const [resource] = await ctx.db
    .update(schema.resources)
    .set(input)
    .where(and(eq(schema.resources.id, id), eq(schema.resources.tenantId, ctx.tenantId)))
    .returning();
  if (!resource) throw new NotFoundError("Resource", id);
  await audit(ctx, "resource.updated", "resource", id, input as Record<string, unknown>);
  return resource;
}

export async function createOffering(ctx: ServiceContext, input: z.infer<typeof offeringInputSchema>) {
  requireStaff(ctx.principal);
  const data = offeringInputSchema.parse(input);
  const [offering] = await ctx.db
    .insert(schema.offerings)
    .values({ tenantId: ctx.tenantId, ...data, depositPct: data.depositPct ?? null })
    .returning();
  await audit(ctx, "offering.created", "offering", offering!.id, { name: data.name });
  return offering!;
}

export async function updateOffering(
  ctx: ServiceContext,
  id: string,
  input: Partial<z.infer<typeof offeringInputSchema>> & { active?: boolean },
) {
  requireStaff(ctx.principal);
  const [offering] = await ctx.db
    .update(schema.offerings)
    .set(input)
    .where(and(eq(schema.offerings.id, id), eq(schema.offerings.tenantId, ctx.tenantId)))
    .returning();
  if (!offering) throw new NotFoundError("Offering", id);
  await audit(ctx, "offering.updated", "offering", id, input as Record<string, unknown>);
  return offering;
}

export async function createAddon(ctx: ServiceContext, input: z.infer<typeof addonInputSchema>) {
  requireStaff(ctx.principal);
  const data = addonInputSchema.parse(input);
  const [addon] = await ctx.db
    .insert(schema.addons)
    .values({ tenantId: ctx.tenantId, ...data })
    .returning();
  await audit(ctx, "addon.created", "addon", addon!.id, { name: data.name });
  return addon!;
}

export async function updateAddon(
  ctx: ServiceContext,
  id: string,
  input: Partial<z.infer<typeof addonInputSchema>> & { active?: boolean },
) {
  requireStaff(ctx.principal);
  const [addon] = await ctx.db
    .update(schema.addons)
    .set(input)
    .where(and(eq(schema.addons.id, id), eq(schema.addons.tenantId, ctx.tenantId)))
    .returning();
  if (!addon) throw new NotFoundError("Add-on", id);
  await audit(ctx, "addon.updated", "addon", id, input as Record<string, unknown>);
  return addon;
}

const CONFIG_KEYS = new Set(["policies", "business", "brand"]);

export async function getConfigMap(ctx: ServiceContext): Promise<Record<string, unknown>> {
  const rows = await ctx.db.query.tenantConfig.findMany({
    where: eq(schema.tenantConfig.tenantId, ctx.tenantId),
  });
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

export async function updateConfig(
  ctx: ServiceContext,
  key: string,
  patch: Record<string, unknown>,
): Promise<void> {
  requireOwner(ctx.principal);
  if (!CONFIG_KEYS.has(key)) throw new ValidationError(`Unknown settings group: ${key}`);
  const existing = await ctx.db.query.tenantConfig.findFirst({
    where: and(eq(schema.tenantConfig.tenantId, ctx.tenantId), eq(schema.tenantConfig.key, key)),
  });
  const merged = { ...((existing?.value as Record<string, unknown>) ?? {}), ...patch };
  await ctx.db
    .insert(schema.tenantConfig)
    .values({ tenantId: ctx.tenantId, key, value: merged, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: [schema.tenantConfig.tenantId, schema.tenantConfig.key],
      set: { value: merged, updatedAt: new Date() },
    });
  await audit(ctx, "config.updated", "tenant_config", key, patch);
}

export type BusinessInfo = {
  businessName: string;
  vertical: string;
  facts: string;
  faq: { q: string; a: string }[];
  hours: Record<string, { open: string; close: string } | null>;
  policies: { depositPct: number; taxPct: number; cancellationNoticeHours: number; holdHours: number };
  offerings: { name: string; durationMin: number; priceKes: number; description?: string }[];
  resources: { name: string; capacity: number | null; description?: string }[];
  addons: { name: string; priceKes: number; unit: string }[];
  reviewLink: string;
  asText: string;
};

/** Facts for the agent — never let the model invent prices or policies. */
export async function getBusinessInfo(ctx: ServiceContext, topic?: string): Promise<BusinessInfo> {
  const settings = await getSettings(ctx);
  const [offerings, resources, addons] = await Promise.all([
    listAllOfferings(ctx),
    listResources(ctx),
    listAllAddons(ctx),
  ]);
  const faq = topic
    ? settings.faq.filter(
        (f) =>
          f.q.toLowerCase().includes(topic.toLowerCase()) ||
          f.a.toLowerCase().includes(topic.toLowerCase()),
      )
    : settings.faq;

  const info: BusinessInfo = {
    businessName: settings.tenant.name,
    vertical: settings.vertical,
    facts: settings.businessFacts,
    faq,
    hours: Object.fromEntries(
      Object.entries(settings.workingHours).map(([day, hours]) => [day, hours ?? null]),
    ),
    policies: {
      depositPct: settings.depositPct,
      taxPct: settings.taxPct,
      cancellationNoticeHours: settings.cancellationNoticeHours,
      holdHours: settings.holdHours,
    },
    offerings: offerings.map((o) => ({
      name: o.name,
      durationMin: o.durationMin,
      priceKes: o.basePriceKes,
      description: (o.attributes as Record<string, unknown>).description as string | undefined,
    })),
    resources: resources.map((r) => ({
      name: r.name,
      capacity: r.capacity,
      description: (r.attributes as Record<string, unknown>).description as string | undefined,
    })),
    addons: addons.map((a) => ({ name: a.name, priceKes: a.priceKes, unit: a.unit })),
    reviewLink: settings.reviewLink,
    asText: "",
  };

  const lines = [
    `${info.businessName} (${info.vertical}).`,
    info.facts,
    `Deposit: ${info.policies.depositPct}%. Tax: ${info.policies.taxPct}%. Cancellation notice: ${info.policies.cancellationNoticeHours}h. Holds last ${info.policies.holdHours}h.`,
    `Offerings: ${info.offerings.map((o) => `${o.name} — ${kes(o.priceKes)} (${o.durationMin} min)`).join("; ")}.`,
    `Resources: ${info.resources.map((r) => `${r.name}${r.capacity ? ` (up to ${r.capacity})` : ""}`).join("; ")}.`,
    info.addons.length ? `Add-ons: ${info.addons.map((a) => `${a.name} — ${kes(a.priceKes)}/${a.unit}`).join("; ")}.` : "",
    ...faq.map((f) => `Q: ${f.q}\nA: ${f.a}`),
  ];
  info.asText = lines.filter(Boolean).join("\n");
  return info;
}
