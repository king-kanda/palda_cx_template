import { and, asc, count, desc, eq } from "drizzle-orm";
import { getDb, schema, withTenant } from "@garden/db";
import { passwordHash } from "@garden/integrations";
import { getPreset, type WorkingHours } from "@garden/verticals";
import { z } from "zod";
import { generateTempPassword } from "./accounts";
import { brandSchema, checkBrandColors, type BrandInput } from "./brand";
import { agentProfileSchema, createBusiness, type OnboardingInput, type OnboardingResult } from "./onboarding";
import { NotFoundError, ValidationError } from "./types";

/**
 * The Engine: the Palda team's internal back office. Staff set a customer up (vertical, agent name and picture, services,
 * hours), check it, then roll it out. Customers never register themselves. Every write here is audited as `engine:<adminId>`.
 *
 * Writes go straight to the customer's tenant context rather than through the owner-only settings services, because
 * the person acting is a platform admin, not that customer's owner.
 */

export type CustomerStatus = "setup" | "active" | "suspended";

export type ReadinessCheck = {
  key: string;
  label: string;
  ok: boolean;
  /** Required checks must pass before rollout; optional ones only warn. */
  required: boolean;
  hint: string;
};

export type CustomerSummary = {
  id: string;
  slug: string;
  name: string;
  vertical: string;
  verticalTitle: string;
  status: CustomerStatus;
  createdAt: Date;
  owner: { id: string; name: string; email: string } | null;
  counts: { resources: number; offerings: number; bookings: number; customers: number };
  agent: { name: string; tone: string; notes: string; intro: "name" | "none"; avatar: string | null };
  whatsappConnected: boolean;
  business: {
    location: string;
    description: string;
    reviewLink: string;
    workingHours: WorkingHours;
    depositPct: number;
    cancellationNoticeHours: number;
  };
};

const actor = (adminId: string) => `engine:${adminId}`;

function asStatus(value: string): CustomerStatus {
  return value === "active" || value === "suspended" ? value : "setup";
}

async function summarise(tenant: typeof schema.tenants.$inferSelect): Promise<CustomerSummary> {
  const preset = getPreset(tenant.vertical);
  return withTenant(tenant.id, async (tx) => {
    const [owner, configRows, resources, offerings, bookings, customers, whatsapp] = await Promise.all([
      tx.query.users.findFirst({
        where: and(eq(schema.users.tenantId, tenant.id), eq(schema.users.role, "owner")),
        orderBy: asc(schema.users.createdAt),
      }),
      tx.query.tenantConfig.findMany({ where: eq(schema.tenantConfig.tenantId, tenant.id) }),
      tx.select({ n: count() }).from(schema.resources).where(and(eq(schema.resources.tenantId, tenant.id), eq(schema.resources.active, true))),
      tx.select({ n: count() }).from(schema.offerings).where(and(eq(schema.offerings.tenantId, tenant.id), eq(schema.offerings.active, true))),
      tx.select({ n: count() }).from(schema.bookings).where(eq(schema.bookings.tenantId, tenant.id)),
      tx.select({ n: count() }).from(schema.customers).where(eq(schema.customers.tenantId, tenant.id)),
      tx.query.tenantIntegrations.findFirst({
        where: and(eq(schema.tenantIntegrations.tenantId, tenant.id), eq(schema.tenantIntegrations.kind, "whatsapp")),
        columns: { id: true, meta: true },
      }),
    ]);
    const cfg = new Map(configRows.map((r) => [r.key, r.value as Record<string, unknown>]));
    const business = cfg.get("business") ?? {};
    const brand = cfg.get("brand") ?? {};
    const policies = cfg.get("policies") ?? {};
    const avatar = typeof brand.agentAvatar === "string" && brand.agentAvatar.startsWith("data:image/") ? brand.agentAvatar : null;
    return {
      id: tenant.id,
      slug: tenant.slug,
      name: tenant.name,
      vertical: tenant.vertical,
      verticalTitle: preset.title,
      status: asStatus(tenant.status),
      createdAt: tenant.createdAt,
      owner: owner ? { id: owner.id, name: owner.name, email: owner.email } : null,
      counts: {
        resources: resources[0]?.n ?? 0,
        offerings: offerings[0]?.n ?? 0,
        bookings: bookings[0]?.n ?? 0,
        customers: customers[0]?.n ?? 0,
      },
      agent: {
        name: typeof brand.agentName === "string" && brand.agentName ? brand.agentName : preset.agent.name,
        tone: typeof brand.tone === "string" ? brand.tone : "",
        notes: typeof brand.agentNotes === "string" ? brand.agentNotes : "",
        intro: brand.agentIntro === "none" ? "none" : "name",
        avatar,
      },
      whatsappConnected: Boolean(whatsapp) && whatsapp?.meta?.status !== "disconnected",
      business: {
        location: typeof business.location === "string" ? business.location : "",
        description: typeof business.facts === "string" ? business.facts : preset.businessFacts,
        reviewLink: typeof business.reviewLink === "string" ? business.reviewLink : "",
        workingHours: (business.workingHours as WorkingHours | undefined) ?? preset.defaults.workingHours,
        depositPct: typeof policies.depositPct === "number" ? policies.depositPct : preset.defaults.depositPct,
        cancellationNoticeHours:
          typeof policies.cancellationNoticeHours === "number"
            ? policies.cancellationNoticeHours
            : preset.defaults.cancellationNoticeHours,
      },
    };
  });
}

export async function listEngineCustomers(): Promise<CustomerSummary[]> {
  const tenants = await getDb().query.tenants.findMany({ orderBy: desc(schema.tenants.createdAt), limit: 1000 });
  const out: CustomerSummary[] = [];
  const BATCH = 6;
  for (let i = 0; i < tenants.length; i += BATCH) {
    out.push(...(await Promise.all(tenants.slice(i, i + BATCH).map(summarise))));
  }
  return out;
}

export async function getEngineCustomer(tenantId: string): Promise<CustomerSummary> {
  const tenant = await getDb().query.tenants.findFirst({ where: eq(schema.tenants.id, tenantId) });
  if (!tenant) throw new NotFoundError("Customer", tenantId);
  return summarise(tenant);
}

export function readinessOf(customer: CustomerSummary): ReadinessCheck[] {
  const open = Object.values(customer.business.workingHours).some((d) => d !== null && d !== undefined);
  return [
    {
      key: "owner",
      label: "Customer's login is set up",
      ok: Boolean(customer.owner?.email),
      required: true,
      hint: "Add the owner's name and email.",
    },
    {
      key: "team",
      label: "Team or spaces added",
      ok: customer.counts.resources > 0,
      required: true,
      hint: "Open the customer's app and add who or what can be booked in Settings.",
    },
    {
      key: "services",
      label: "Services and prices added",
      ok: customer.counts.offerings > 0,
      required: true,
      hint: "Open the customer's app and add at least one service in Settings.",
    },
    {
      key: "hours",
      label: "Opening hours set",
      ok: open,
      required: true,
      hint: "Set at least one open day under Business.",
    },
    {
      key: "agent",
      label: "Agent named",
      ok: customer.agent.name.trim().length >= 2,
      required: true,
      hint: "Give the agent a name customers will see.",
    },
    {
      key: "avatar",
      label: "Agent picture",
      ok: Boolean(customer.agent.avatar),
      required: false,
      hint: "Upload a square picture. It shows in the customer's app.",
    },
    {
      key: "review",
      label: "Review link",
      ok: Boolean(customer.business.reviewLink),
      required: false,
      hint: "Without it, happy customers aren't sent to leave a public review.",
    },
    {
      key: "whatsapp",
      label: "WhatsApp number connected",
      ok: customer.whatsappConnected,
      required: false,
      hint: "Until a number is connected the agent can't receive customer messages.",
    },
  ];
}

/* ───────────────────────────── Create ───────────────────────────── */

export async function createEngineCustomer(adminId: string, input: OnboardingInput): Promise<OnboardingResult> {
  const result = await createBusiness({ ...input, status: "setup", owner: { ...input.owner, password: undefined } });
  await withTenant(result.tenantId, (tx) =>
    tx.insert(schema.auditLog).values({
      tenantId: result.tenantId,
      actor: actor(adminId),
      action: "engine.customer_created",
      entity: "tenant",
      entityId: result.tenantId,
      diff: { vertical: result.vertical },
    }),
  );
  return result;
}

/* ───────────────────────────── Edit ───────────────────────────── */

async function mergeConfig(
  tx: Parameters<Parameters<typeof withTenant>[1]>[0],
  tenantId: string,
  key: "brand" | "business" | "policies",
  patch: Record<string, unknown>,
): Promise<void> {
  const existing = await tx.query.tenantConfig.findFirst({
    where: and(eq(schema.tenantConfig.tenantId, tenantId), eq(schema.tenantConfig.key, key)),
  });
  const merged: Record<string, unknown> = { ...((existing?.value as Record<string, unknown>) ?? {}), ...patch };
  for (const k of Object.keys(merged)) if (merged[k] === undefined) delete merged[k];
  await tx
    .insert(schema.tenantConfig)
    .values({ tenantId, key, value: merged, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: [schema.tenantConfig.tenantId, schema.tenantConfig.key],
      set: { value: merged, updatedAt: new Date() },
    });
}

async function audit(
  tx: Parameters<Parameters<typeof withTenant>[1]>[0],
  adminId: string,
  tenantId: string,
  action: string,
  diff?: Record<string, unknown>,
) {
  await tx.insert(schema.auditLog).values({
    tenantId,
    actor: actor(adminId),
    action,
    entity: "tenant",
    entityId: tenantId,
    diff: diff ?? null,
  });
}

async function requireTenant(tenantId: string) {
  const tenant = await getDb().query.tenants.findFirst({ where: eq(schema.tenants.id, tenantId) });
  if (!tenant) throw new NotFoundError("Customer", tenantId);
  return tenant;
}

/** `avatar`: a data URL to set it, `null` to remove it, `undefined` to leave it as it is. */
export async function updateAgentProfile(adminId: string, tenantId: string, raw: z.input<typeof agentProfileSchema>) {
  const parsed = agentProfileSchema.safeParse(raw);
  if (!parsed.success) throw new ValidationError(parsed.error.issues[0]?.message ?? "Invalid agent details");
  const agent = parsed.data;
  await requireTenant(tenantId);
  await withTenant(tenantId, async (tx) => {
    await mergeConfig(tx, tenantId, "brand", {
      agentName: agent.name,
      tone: agent.tone,
      agentNotes: agent.notes,
      agentIntro: agent.intro,
      ...(agent.avatar === undefined ? {} : { agentAvatar: agent.avatar ?? undefined }),
    });
    await audit(tx, adminId, tenantId, "engine.agent_updated", {
      name: agent.name,
      avatar: agent.avatar === undefined ? "unchanged" : agent.avatar ? "set" : "removed",
    });
  });
}

const dayHours = z
  .object({ open: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/), close: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/) })
  .refine((d) => d.close > d.open, { message: "Closing time must be after opening time" })
  .nullable();

export const businessProfileSchema = z.object({
  name: z.string().trim().min(2, "Enter the business name").max(120),
  location: z.string().trim().max(160).default(""),
  description: z.string().trim().max(600).default(""),
  reviewLink: z.union([z.literal(""), z.string().trim().url("Enter a full link starting with https://").max(300)]).default(""),
  workingHours: z.object({ "0": dayHours, "1": dayHours, "2": dayHours, "3": dayHours, "4": dayHours, "5": dayHours, "6": dayHours }),
  depositPct: z.number().int().min(0).max(100),
  cancellationNoticeHours: z.number().int().min(0).max(720),
});

export async function updateBusinessProfile(adminId: string, tenantId: string, raw: z.input<typeof businessProfileSchema>) {
  const parsed = businessProfileSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new ValidationError(`${issue?.path.length ? `${issue.path.join(".")}: ` : ""}${issue?.message ?? "Invalid details"}`);
  }
  const b = parsed.data;
  const tenant = await requireTenant(tenantId);
  const preset = getPreset(tenant.vertical);
  const workingHours = Object.fromEntries(Object.entries(b.workingHours).map(([k, v]) => [Number(k), v])) as WorkingHours;
  const opens = Object.values(workingHours).filter((d): d is { open: string; close: string } => d !== null).map((d) => d.open).sort();
  const facts = b.description || `${b.name} is a ${preset.title.toLowerCase()}${b.location ? ` in ${b.location}` : ""}.`;

  await withTenant(tenantId, async (tx) => {
    await tx.update(schema.tenants).set({ name: b.name }).where(eq(schema.tenants.id, tenantId));
    const existing = await tx.query.tenantConfig.findFirst({
      where: and(eq(schema.tenantConfig.tenantId, tenantId), eq(schema.tenantConfig.key, "business")),
    });
    const faq = (((existing?.value as Record<string, unknown> | undefined)?.faq as { q: string; a: string }[] | undefined) ?? []).filter(
      (f) => f.q !== "Where are you located?",
    );
    if (b.location) faq.unshift({ q: "Where are you located?", a: `We are in ${b.location}.` });
    await mergeConfig(tx, tenantId, "business", {
      workingHours,
      arrivalTime: opens[0] ?? "09:00",
      facts,
      faq,
      location: b.location || undefined,
      reviewLink: b.reviewLink || undefined,
    });
    await mergeConfig(tx, tenantId, "policies", {
      depositPct: b.depositPct,
      cancellationNoticeHours: b.cancellationNoticeHours,
    });
    await audit(tx, adminId, tenantId, "engine.business_updated", { name: b.name });
  });
}

/* ───────────────────────────── Rollout ───────────────────────────── */

export type Credentials = { name: string; email: string; password: string };

async function issuePassword(adminId: string, tenantId: string, action: string): Promise<Credentials> {
  const customer = await getEngineCustomer(tenantId);
  if (!customer.owner) throw new ValidationError("This customer has no owner account yet.");
  const password = generateTempPassword();
  await withTenant(tenantId, async (tx) => {
    await tx.update(schema.users).set({ passwordHash: passwordHash(password) }).where(eq(schema.users.id, customer.owner!.id));
    await audit(tx, adminId, tenantId, action, { owner: customer.owner!.email });
  });
  return { name: customer.owner.name, email: customer.owner.email, password };
}

/**
 * Rolls a customer out: checks every required item, switches the account to live and issues the owner's first password.
 * The password is returned once and never stored in readable form, so hand it over straight away (or reset it later).
 */
export async function rolloutCustomer(adminId: string, tenantId: string): Promise<Credentials> {
  const customer = await getEngineCustomer(tenantId);
  if (customer.status === "active") throw new ValidationError("This customer is already live. Use reset password instead.");
  const missing = readinessOf(customer).filter((c) => c.required && !c.ok);
  if (missing.length > 0) {
    throw new ValidationError(`Not ready to roll out yet: ${missing.map((m) => m.label.toLowerCase()).join(", ")}.`);
  }
  const credentials = await issuePassword(adminId, tenantId, "engine.owner_password_issued");
  await withTenant(tenantId, async (tx) => {
    await tx.update(schema.tenants).set({ status: "active" }).where(eq(schema.tenants.id, tenantId));
    await audit(tx, adminId, tenantId, "engine.rolled_out", {
      optionalMissing: readinessOf(customer).filter((c) => !c.required && !c.ok).map((c) => c.key),
    });
  });
  return credentials;
}

export async function resetOwnerPassword(adminId: string, tenantId: string): Promise<Credentials> {
  return issuePassword(adminId, tenantId, "engine.owner_password_reset");
}

export async function setCustomerStatus(adminId: string, tenantId: string, next: CustomerStatus): Promise<void> {
  const customer = await getEngineCustomer(tenantId);
  if (customer.status === next) return;
  if (next === "active" && customer.status === "setup") {
    throw new ValidationError("Roll the customer out first. That checks everything and issues their password.");
  }
  await withTenant(tenantId, async (tx) => {
    await tx.update(schema.tenants).set({ status: next }).where(eq(schema.tenants.id, tenantId));
    await audit(tx, adminId, tenantId, "engine.status_changed", { from: customer.status, to: next });
  });
}

/** The owner account an admin may act as while setting a customer up. Returns what the session needs. */
export async function startImpersonation(adminId: string, tenantId: string) {
  const customer = await getEngineCustomer(tenantId);
  if (!customer.owner) throw new ValidationError("This customer has no owner account yet.");
  await withTenant(tenantId, (tx) => audit(tx, adminId, tenantId, "engine.impersonation_started", { as: customer.owner!.email }));
  return {
    tenantId,
    tenantSlug: customer.slug,
    userId: customer.owner.id,
    email: customer.owner.email,
    name: customer.owner.name,
  };
}

/** Team, services and add-ons, for the Engine's read-only summary of a customer. */
export async function getCustomerLists(tenantId: string) {
  return withTenant(tenantId, async (tx) => {
    const [team, services, addons] = await Promise.all([
      tx.query.resources.findMany({
        where: and(eq(schema.resources.tenantId, tenantId), eq(schema.resources.active, true)),
        orderBy: asc(schema.resources.sortOrder),
      }),
      tx.query.offerings.findMany({
        where: and(eq(schema.offerings.tenantId, tenantId), eq(schema.offerings.active, true)),
        orderBy: asc(schema.offerings.basePriceKes),
      }),
      tx.query.addons.findMany({
        where: and(eq(schema.addons.tenantId, tenantId), eq(schema.addons.active, true)),
        orderBy: asc(schema.addons.name),
      }),
    ]);
    return { team, services, addons };
  });
}

/** Everyone who can sign in to a customer's app (never their password hashes). */
export async function getCustomerPeople(tenantId: string) {
  return withTenant(tenantId, async (tx) => {
    const users = await tx.query.users.findMany({
      where: eq(schema.users.tenantId, tenantId),
      orderBy: asc(schema.users.createdAt),
      columns: { id: true, name: true, email: true, role: true, active: true, createdAt: true },
    });
    return users;
  });
}

/* ───────────────────────────── Per-customer agent controls ─────────────────────────────
 * What the agent may do for ONE customer is stored as immutable versions (`agent_versions`) plus a pointer to the live one
 * (`agent_pointers`). Publishing adds a version and moves the pointer; rolling back moves it again. Nothing is edited in place,
 * so every change is reviewable and reversible. The agent service resolves the pointer on each run (agent-config.ts).
 */

export const agentOverrideSchema = z
  .object({
    toolPolicy: z
      .object({
        /** Extra tools to switch off for this customer. The shipped safety blocks always stay on (enforced when the config is loaded). */
        blockedTools: z.array(z.string().trim().min(1).max(64)).max(200).default([]),
        maxToolCalls: z.number().int().min(1).max(12).optional(),
      })
      .strict(),
  })
  .strict();

export type AgentOverride = z.infer<typeof agentOverrideSchema>;

export type AgentVersionInfo = {
  id: string;
  version: number;
  status: string;
  createdAt: Date;
  live: boolean;
  override: AgentOverride | null;
};

export async function getAgentControl(tenantId: string, agentId: string) {
  await requireTenant(tenantId);
  return withTenant(tenantId, async (tx) => {
    const [rows, pointer] = await Promise.all([
      tx.query.agentVersions.findMany({
        where: and(eq(schema.agentVersions.tenantId, tenantId), eq(schema.agentVersions.agentId, agentId)),
        orderBy: desc(schema.agentVersions.version),
        limit: 20,
      }),
      tx.query.agentPointers.findFirst({
        where: and(
          eq(schema.agentPointers.tenantId, tenantId),
          eq(schema.agentPointers.agentId, agentId),
          eq(schema.agentPointers.environment, "production"),
        ),
      }),
    ]);
    const versions: AgentVersionInfo[] = rows.map((r) => {
      const parsed = agentOverrideSchema.safeParse(r.config);
      return {
        id: r.id,
        version: r.version,
        status: r.status,
        createdAt: r.createdAt,
        live: pointer?.versionId === r.id,
        override: parsed.success ? parsed.data : null,
      };
    });
    return { live: versions.find((v) => v.live) ?? null, versions };
  });
}

export async function publishAgentOverride(adminId: string, tenantId: string, agentId: string, raw: unknown, note = "") {
  const parsed = agentOverrideSchema.safeParse(raw);
  if (!parsed.success) throw new ValidationError(parsed.error.issues[0]?.message ?? "Invalid agent settings");
  await requireTenant(tenantId);
  return withTenant(tenantId, async (tx) => {
    const latest = await tx.query.agentVersions.findFirst({
      where: and(eq(schema.agentVersions.tenantId, tenantId), eq(schema.agentVersions.agentId, agentId)),
      orderBy: desc(schema.agentVersions.version),
    });
    const version = Math.max(2, (latest?.version ?? 1) + 1);
    // Whatever was live is retired; the new version goes live in the same transaction as the pointer move.
    await tx
      .update(schema.agentVersions)
      .set({ status: "retired" })
      .where(
        and(
          eq(schema.agentVersions.tenantId, tenantId),
          eq(schema.agentVersions.agentId, agentId),
          eq(schema.agentVersions.status, "live"),
        ),
      );
    const [created] = await tx
      .insert(schema.agentVersions)
      .values({ tenantId, agentId, version, config: parsed.data as Record<string, unknown>, status: "live" })
      .returning();
    await tx
      .insert(schema.agentPointers)
      .values({ tenantId, agentId, environment: "production", versionId: created!.id, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: [schema.agentPointers.tenantId, schema.agentPointers.agentId, schema.agentPointers.environment],
        set: { versionId: created!.id, updatedAt: new Date() },
      });
    await audit(tx, adminId, tenantId, "engine.agent_published", {
      agentId,
      version,
      blockedTools: parsed.data.toolPolicy.blockedTools,
      maxToolCalls: parsed.data.toolPolicy.maxToolCalls ?? null,
      note: note.slice(0, 200),
    });
    return { version };
  });
}

/** `versionId` null = go back to the shipped defaults (no override). */
export async function activateAgentVersion(adminId: string, tenantId: string, agentId: string, versionId: string | null) {
  await requireTenant(tenantId);
  await withTenant(tenantId, async (tx) => {
    const target = versionId
      ? await tx.query.agentVersions.findFirst({
          where: and(
            eq(schema.agentVersions.tenantId, tenantId),
            eq(schema.agentVersions.agentId, agentId),
            eq(schema.agentVersions.id, versionId),
          ),
        })
      : null;
    if (versionId && !target) throw new NotFoundError("Agent version", versionId);
    await tx
      .update(schema.agentVersions)
      .set({ status: "retired" })
      .where(
        and(
          eq(schema.agentVersions.tenantId, tenantId),
          eq(schema.agentVersions.agentId, agentId),
          eq(schema.agentVersions.status, "live"),
        ),
      );
    if (target) {
      await tx.update(schema.agentVersions).set({ status: "live" }).where(eq(schema.agentVersions.id, target.id));
      await tx
        .insert(schema.agentPointers)
        .values({ tenantId, agentId, environment: "production", versionId: target.id, updatedAt: new Date() })
        .onConflictDoUpdate({
          target: [schema.agentPointers.tenantId, schema.agentPointers.agentId, schema.agentPointers.environment],
          set: { versionId: target.id, updatedAt: new Date() },
        });
    } else {
      await tx
        .delete(schema.agentPointers)
        .where(and(eq(schema.agentPointers.tenantId, tenantId), eq(schema.agentPointers.agentId, agentId)));
    }
    await audit(tx, adminId, tenantId, "engine.agent_version_activated", {
      agentId,
      version: target?.version ?? "defaults",
    });
  });
}

/* ───────────────────────────── Business branding ───────────────────────────── */

/**
 * Saves a customer's branding: colours, logo, website, socials and contact details. Colours are checked for readable contrast
 * before anything is saved. The logo is only touched when one is supplied (null removes it).
 */
export async function updateBrand(adminId: string, tenantId: string, raw: BrandInput) {
  const parsed = brandSchema.safeParse(raw);
  if (!parsed.success) throw new ValidationError(parsed.error.issues[0]?.message ?? "Invalid branding");
  const b = parsed.data;
  const problems = checkBrandColors(b.primary, b.accent, b.sidebar);
  if (problems.length) throw new ValidationError(problems[0]!);
  await requireTenant(tenantId);
  await withTenant(tenantId, async (tx) => {
    await mergeConfig(tx, tenantId, "brand", {
      colors: { primary: b.primary.toUpperCase(), accent: b.accent.toUpperCase() },
      sidebar: b.sidebar ? b.sidebar.toUpperCase() : undefined,
      website: b.website,
      tagline: b.tagline,
      instagram: b.instagram,
      facebook: b.facebook,
      tiktok: b.tiktok,
      linkedin: b.linkedin,
      email: b.email,
      phone: b.phone,
      ...(b.logo === undefined ? {} : { logo: b.logo ?? undefined }),
    });
    await audit(tx, adminId, tenantId, "engine.brand_updated", {
      primary: b.primary,
      accent: b.accent,
      sidebar: b.sidebar || "default",
      logo: b.logo === undefined ? "unchanged" : b.logo ? "set" : "removed",
      website: Boolean(b.website),
    });
  });
}
