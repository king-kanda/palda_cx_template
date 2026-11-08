import { and, eq } from "drizzle-orm";
import { schema, withTenant, type DbOrTx } from "@garden/db";
import { getPreset, type Preset, type WorkingHours } from "@garden/verticals";
import { actorOf, NotFoundError, type Principal } from "./types";

export type ServiceContext = {
  db: DbOrTx;
  principal: Principal;
  tenantId: string;
};

export async function withPrincipal<T>(
  principal: Principal,
  fn: (ctx: ServiceContext) => Promise<T>,
): Promise<T> {
  if (!principal.tenantId) throw new Error("Principal is missing a tenant.");
  return withTenant(principal.tenantId, (tx) =>
    fn({ db: tx as DbOrTx, principal, tenantId: principal.tenantId }),
  );
}

export async function audit(
  ctx: ServiceContext,
  action: string,
  entity: string,
  entityId?: string | null,
  diff?: Record<string, unknown>,
): Promise<void> {
  await ctx.db.insert(schema.auditLog).values({
    tenantId: ctx.tenantId,
    actor: actorOf(ctx.principal),
    action,
    entity,
    entityId: entityId ?? null,
    diff: diff ?? null,
  });
}

export type TenantSettings = {
  tenant: typeof schema.tenants.$inferSelect;
  preset: Preset;
  vertical: string;
  depositPct: number;
  taxPct: number;
  holdHours: number;
  cancellationNoticeHours: number;
  workingHours: WorkingHours;
  slotIntervalMin: number;
  reviewLink: string;
  managerPhone: string | null;
  arrivalTime: string;
  businessFacts: string;
  faq: { q: string; a: string }[];
  labels: Preset["labels"];
  agentName: string;
};

function asNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function asString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

export async function getSettings(ctx: ServiceContext): Promise<TenantSettings> {
  const tenant = await ctx.db.query.tenants.findFirst({
    where: eq(schema.tenants.id, ctx.tenantId),
  });
  if (!tenant) throw new NotFoundError("Tenant", ctx.tenantId);

  const verticalRow = await ctx.db.query.tenantVertical.findFirst({
    where: eq(schema.tenantVertical.tenantId, ctx.tenantId),
  });
  const vertical = verticalRow?.vertical ?? tenant.vertical;
  const preset = getPreset(vertical);

  const configRows = await ctx.db.query.tenantConfig.findMany({
    where: eq(schema.tenantConfig.tenantId, ctx.tenantId),
  });
  const cfg = new Map<string, unknown>(configRows.map((r) => [r.key, r.value]));
  const policy = (cfg.get("policies") as Record<string, unknown> | undefined) ?? {};
  const business = (cfg.get("business") as Record<string, unknown> | undefined) ?? {};
  const brand = (cfg.get("brand") as Record<string, unknown> | undefined) ?? {};

  const faq = Array.isArray(business.faq)
    ? (business.faq as { q: string; a: string }[])
    : preset.faq;

  return {
    tenant,
    preset,
    vertical,
    depositPct: asNumber(policy.depositPct, preset.defaults.depositPct),
    taxPct: asNumber(policy.taxPct, preset.defaults.taxPct),
    holdHours: asNumber(policy.holdHours, preset.defaults.holdHours),
    cancellationNoticeHours: asNumber(
      policy.cancellationNoticeHours,
      preset.defaults.cancellationNoticeHours,
    ),
    workingHours: (business.workingHours as WorkingHours | undefined) ?? preset.defaults.workingHours,
    slotIntervalMin: asNumber(business.slotIntervalMin, preset.defaults.slotIntervalMin),
    reviewLink: asString(business.reviewLink, "https://g.page/r/palda-gardens/review"),
    managerPhone: (business.managerPhone as string | undefined) ?? process.env.WHATSAPP_MANAGER_PHONE ?? null,
    arrivalTime: asString(business.arrivalTime, "10:00"),
    businessFacts: asString(business.facts, preset.businessFacts),
    faq,
    labels: preset.labels,
    agentName: asString(brand.agentName, preset.agent.name),
  };
}

export async function getTenantBySlug(slug: string) {
  const { getDb } = await import("@garden/db");
  return getDb().query.tenants.findFirst({ where: eq(schema.tenants.slug, slug) });
}

export async function tenantIdBySlug(slug: string): Promise<string> {
  const tenant = await getTenantBySlug(slug);
  if (!tenant) throw new NotFoundError("Tenant", slug);
  return tenant.id;
}

export async function findUserByEmail(tenantId: string, email: string) {
  const { getDb } = await import("@garden/db");
  const db = getDb();
  return db.query.users.findFirst({
    where: and(eq(schema.users.tenantId, tenantId), eq(schema.users.email, email.toLowerCase())),
  });
}
