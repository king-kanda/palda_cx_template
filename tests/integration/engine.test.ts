import { and, eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { closeDb, getDb, loadEnv, schema, withTenant } from "../../packages/db/src/index";
import { passwordVerify } from "../../packages/integrations/src/index";
import {
  authenticatePlatformAdmin,
  createEngineCustomer,
  createPlatformAdmin,
  findAccountsByEmail,
  getEngineCustomer,
  getSettings,
  readinessOf,
  reindexLogins,
  resetOwnerPassword,
  rolloutCustomer,
  setCustomerStatus,
  startImpersonation,
  staffPrincipal,
  systemPrincipal,
  updateAgentProfile,
  updateBusinessProfile,
  withPrincipal,
  type OnboardingInput,
} from "../../packages/services/src/index";
import { getPreset } from "../../packages/verticals/src/index";
import { loadAgentConfig } from "../../apps/agent-service/src/agent-config";

loadEnv();

const enabled = Boolean(process.env.DATABASE_URL);
const stamp = Date.now();
const tenantIds: string[] = [];
const adminEmails: string[] = [];

const PIXEL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

function customerInput(label: string): OnboardingInput {
  const preset = getPreset("cleaning");
  return {
    vertical: "cleaning",
    businessName: `Engine ${label} ${stamp}`,
    location: "Kilimani, Nairobi",
    description: "",
    reviewLink: "",
    agent: { name: "Zuri", tone: "warm and brisk", notes: "Never offer a discount.", avatar: PIXEL },
    resources: preset.starterResources.map((r) => ({ name: r.name, kind: r.kind as "staff" })),
    offerings: preset.offerings.map((o) => ({
      name: o.name,
      resourceKind: o.resourceKind as "staff",
      durationMin: o.durationMin,
      basePriceKes: o.basePriceKes,
      bufferBeforeMin: o.bufferBeforeMin ?? 0,
    })),
    workingHours: Object.fromEntries(
      Object.entries(preset.defaults.workingHours).map(([d, h]) => [d, h ?? null]),
    ) as OnboardingInput["workingHours"],
    depositPct: 0,
    cancellationNoticeHours: 24,
    owner: { name: "Amina Owner", email: `owner-${label}-${stamp}@example.test` },
  };
}

/**
 * The Engine: Palda staff set a customer up (agent, business, team), roll them out, and the customer can then sign in.
 * Customers never register themselves.
 */
describe.skipIf(!enabled)("engine: set up and roll out a customer (needs Postgres)", () => {
  let adminId = "";
  let tenantId = "";
  let ownerId = "";
  let ownerEmail = "";
  let slug = "";

  it("Palda admins sign in with email and password; wrong, unknown and deactivated logins are refused", async () => {
    const email = `admin-${stamp}@palda.test`;
    adminEmails.push(email);
    const admin = await createPlatformAdmin({ email: email.toUpperCase(), name: "Test Admin", password: "correct-horse-battery" });
    adminId = admin.id;
    expect((await authenticatePlatformAdmin(email, "correct-horse-battery"))?.id).toBe(adminId);
    expect((await authenticatePlatformAdmin(email.toUpperCase(), "correct-horse-battery"))?.id).toBe(adminId);
    expect(await authenticatePlatformAdmin(email, "wrong-password")).toBeNull();
    expect(await authenticatePlatformAdmin(`nobody-${stamp}@palda.test`, "correct-horse-battery")).toBeNull();
    await expect(createPlatformAdmin({ email, name: "x", password: "short" })).rejects.toThrow(/at least 8/);

    await getDb().update(schema.platformAdmins).set({ active: false }).where(eq(schema.platformAdmins.id, adminId));
    expect(await authenticatePlatformAdmin(email, "correct-horse-battery")).toBeNull();
    await getDb().update(schema.platformAdmins).set({ active: true }).where(eq(schema.platformAdmins.id, adminId));
  });

  it("creates a customer in setup: agent profile saved, no demo data, and the owner cannot sign in yet", async () => {
    const result = await createEngineCustomer(adminId, customerInput("a"));
    tenantId = result.tenantId;
    ownerId = result.ownerId;
    ownerEmail = result.ownerEmail;
    slug = result.slug;
    tenantIds.push(tenantId);

    expect(result.status).toBe("setup");
    const customer = await getEngineCustomer(tenantId);
    expect(customer.status).toBe("setup");
    expect(customer.agent).toMatchObject({ name: "Zuri", tone: "warm and brisk", notes: "Never offer a discount.", avatar: PIXEL });
    expect(customer.counts).toMatchObject({ bookings: 0, customers: 0 });
    expect(customer.counts.resources).toBeGreaterThan(0);
    expect(customer.counts.offerings).toBeGreaterThan(0);

    // The owner exists with a password nobody knows; the account is not live, so sign-in must refuse it.
    const accounts = await findAccountsByEmail(ownerEmail);
    expect(accounts).toHaveLength(1);
    expect(accounts[0]!.tenant.status).toBe("setup");
    expect(passwordVerify("test-password-1234", accounts[0]!.user.passwordHash)).toBe(false);

    // Setting up is audited as the admin.
    const audits = await getDb().query.auditLog.findMany({ where: eq(schema.auditLog.tenantId, tenantId) });
    expect(audits.some((a) => a.action === "engine.customer_created" && a.actor === `engine:${adminId}`)).toBe(true);
  });

  it("the agent's name, voice, notes and the vertical's own rules reach the live agent prompt", async () => {
    const config = await loadAgentConfig(tenantId, "wambo");
    expect(config.persona).toContain("You are Zuri, the booking concierge for Engine a");
    expect(config.persona).toContain("Your voice for this business: warm and brisk.");
    expect(config.persona).toContain("Never offer a discount.");
    expect(config.persona).toContain("full address"); // the cleaning preset's own instruction
    expect(config.persona).not.toContain("You are Wambo");
    // Staff and digest agents are not renamed.
    expect((await loadAgentConfig(tenantId, "admin")).persona).toContain("You are Wambo Admin");
  });

  it("edits the agent profile: renames, keeps the picture unless told otherwise, and can remove it", async () => {
    await updateAgentProfile(adminId, tenantId, { name: "Amani", tone: "", notes: "" });
    let customer = await getEngineCustomer(tenantId);
    expect(customer.agent.name).toBe("Amani");
    expect(customer.agent.avatar).toBe(PIXEL); // undefined = unchanged
    expect((await loadAgentConfig(tenantId, "wambo")).persona).toContain("You are Amani,");

    await updateAgentProfile(adminId, tenantId, { name: "Amani", avatar: null });
    customer = await getEngineCustomer(tenantId);
    expect(customer.agent.avatar).toBeNull();
    expect(readinessOf(customer).find((c) => c.key === "avatar")?.ok).toBe(false);

    await expect(updateAgentProfile(adminId, tenantId, { name: "A" })).rejects.toThrow(/name/i);
    await expect(updateAgentProfile(adminId, tenantId, { name: "Zuri", avatar: "https://evil.example/x.png" })).rejects.toThrow();
    await updateAgentProfile(adminId, tenantId, { name: "Zuri", avatar: PIXEL, tone: "warm and brisk", notes: "Never offer a discount." });
  });

  it("edits the business: name, hours, review link, policies and the location FAQ", async () => {
    const before = await getEngineCustomer(tenantId);
    const hours = Object.fromEntries(
      Object.entries(before.business.workingHours).map(([d, h]) => [d, h ?? null]),
    ) as Parameters<typeof updateBusinessProfile>[2]["workingHours"];
    hours["0"] = { open: "10:00", close: "14:00" };

    await updateBusinessProfile(adminId, tenantId, {
      name: `Engine a ${stamp} Renamed`,
      location: "Lavington, Nairobi",
      description: "Family-run cleaners.",
      reviewLink: "https://g.page/r/engine-a/review",
      workingHours: hours,
      depositPct: 20,
      cancellationNoticeHours: 48,
    });

    const settings = await withPrincipal(staffPrincipal(tenantId, ownerId, "owner"), (ctx) => getSettings(ctx));
    expect(settings.tenant.name).toBe(`Engine a ${stamp} Renamed`);
    expect(settings.reviewLink).toBe("https://g.page/r/engine-a/review");
    expect(settings.depositPct).toBe(20);
    expect(settings.cancellationNoticeHours).toBe(48);
    expect(settings.workingHours[0]).toEqual({ open: "10:00", close: "14:00" });
    expect(settings.businessFacts).toBe("Family-run cleaners.");
    expect(settings.faq.find((f) => f.q === "Where are you located?")?.a).toBe("We are in Lavington, Nairobi.");

    hours["1"] = { open: "18:00", close: "09:00" };
    await expect(
      updateBusinessProfile(adminId, tenantId, {
        name: "x y",
        location: "",
        description: "",
        reviewLink: "",
        workingHours: hours,
        depositPct: 0,
        cancellationNoticeHours: 24,
      }),
    ).rejects.toThrow(/closing time/i);
  });

  it("refuses to roll out until the required items are done, and names what is missing", async () => {
    const { tenantId: bareId } = await createEngineCustomer(adminId, customerInput("bare"));
    tenantIds.push(bareId);
    await withTenant(bareId, (tx) => tx.delete(schema.resources).where(eq(schema.resources.tenantId, bareId)));
    const bare = await getEngineCustomer(bareId);
    expect(readinessOf(bare).filter((c) => c.required && !c.ok).map((c) => c.key)).toEqual(["team"]);
    await expect(rolloutCustomer(adminId, bareId)).rejects.toThrow(/team or spaces added/i);
    expect((await getEngineCustomer(bareId)).status).toBe("setup");
  });

  it("rolls out: goes live, issues a working one-time password, and then the owner can be found by email", async () => {
    const credentials = await rolloutCustomer(adminId, tenantId);
    expect(credentials.email).toBe(ownerEmail);
    expect(credentials.password).toMatch(/^[a-zA-Z2-9]{4}-[a-zA-Z2-9]{4}-[a-zA-Z2-9]{4}$/);

    expect((await getEngineCustomer(tenantId)).status).toBe("active");
    const [account] = await findAccountsByEmail(ownerEmail);
    expect(account!.tenant.status).toBe("active");
    expect(passwordVerify(credentials.password, account!.user.passwordHash)).toBe(true);
    // Stored hashed, never readable.
    expect(account!.user.passwordHash).not.toContain(credentials.password);

    await expect(rolloutCustomer(adminId, tenantId)).rejects.toThrow(/already live/i);

    const audits = await getDb().query.auditLog.findMany({ where: eq(schema.auditLog.tenantId, tenantId) });
    expect(audits.some((a) => a.action === "engine.rolled_out" && a.actor === `engine:${adminId}`)).toBe(true);
    // The audit trail records that a password was issued, never the password itself.
    expect(JSON.stringify(audits)).not.toContain(credentials.password);
  });

  it("resets the owner's password: the new one works and the old one stops working", async () => {
    const first = await getDb().query.users.findFirst({ where: eq(schema.users.id, ownerId) });
    const next = await resetOwnerPassword(adminId, tenantId);
    const after = await findAccountsByEmail(ownerEmail);
    expect(passwordVerify(next.password, after[0]!.user.passwordHash)).toBe(true);
    expect(after[0]!.user.passwordHash).not.toBe(first!.passwordHash);
  });

  it("suspends and reactivates, but won't skip the rollout checks to go live", async () => {
    await setCustomerStatus(adminId, tenantId, "suspended");
    expect((await findAccountsByEmail(ownerEmail))[0]!.tenant.status).toBe("suspended");
    await setCustomerStatus(adminId, tenantId, "active");
    expect((await getEngineCustomer(tenantId)).status).toBe("active");

    const { tenantId: freshId } = await createEngineCustomer(adminId, customerInput("fresh"));
    tenantIds.push(freshId);
    await expect(setCustomerStatus(adminId, freshId, "active")).rejects.toThrow(/roll the customer out first/i);
  });

  it("lets an admin act as the owner to finish setup, and records it", async () => {
    const target = await startImpersonation(adminId, tenantId);
    expect(target).toMatchObject({ tenantId, userId: ownerId, email: ownerEmail, tenantSlug: slug });
    const audit = await getDb().query.auditLog.findFirst({
      where: and(eq(schema.auditLog.tenantId, tenantId), eq(schema.auditLog.action, "engine.impersonation_started")),
    });
    expect(audit?.actor).toBe(`engine:${adminId}`);
  });
});

describe.skipIf(!enabled)("email login index stays in sync by itself (needs Postgres)", () => {
  it("follows users: added, renamed and removed", async () => {
    const { tenantId } = await createEngineCustomer(
      (await createPlatformAdmin({ email: `idx-admin-${stamp}@palda.test`, name: "Idx", password: "correct-horse-battery" })).id,
      customerInput("idx"),
    );
    tenantIds.push(tenantId);
    adminEmails.push(`idx-admin-${stamp}@palda.test`);
    const email = `owner-idx-${stamp}@example.test`;
    const renamed = `renamed-idx-${stamp}@example.test`;

    expect((await findAccountsByEmail(email))[0]?.tenant.id).toBe(tenantId);

    const user = (await getDb().query.users.findFirst({ where: eq(schema.users.tenantId, tenantId) }))!;
    await getDb().update(schema.users).set({ email: renamed }).where(eq(schema.users.id, user.id));
    expect(await findAccountsByEmail(email)).toHaveLength(0);
    expect((await findAccountsByEmail(renamed))[0]?.tenant.id).toBe(tenantId);

    // Mixed-case is normalised by the trigger too.
    await getDb().update(schema.users).set({ email: renamed.toUpperCase() }).where(eq(schema.users.id, user.id));
    expect((await findAccountsByEmail(renamed))[0]?.tenant.id).toBe(tenantId);

    await getDb().delete(schema.users).where(eq(schema.users.id, user.id));
    expect(await findAccountsByEmail(renamed)).toHaveLength(0);
  });

  it("can be rebuilt from the users table", async () => {
    const { tenantId } = await createEngineCustomer(
      (await getDb().query.platformAdmins.findFirst())!.id,
      customerInput("reindex"),
    );
    tenantIds.push(tenantId);
    const email = `owner-reindex-${stamp}@example.test`;
    await getDb().delete(schema.loginIndex).where(eq(schema.loginIndex.tenantId, tenantId));
    expect(await findAccountsByEmail(email)).toHaveLength(0);

    const result = await reindexLogins();
    expect(result.entries).toBeGreaterThan(0);
    expect((await findAccountsByEmail(email))[0]?.tenant.id).toBe(tenantId);
  });
});

afterAll(async () => {
  if (!enabled) return;
  for (const id of tenantIds) await getDb().delete(schema.tenants).where(eq(schema.tenants.id, id));
  for (const email of adminEmails) await getDb().delete(schema.platformAdmins).where(eq(schema.platformAdmins.email, email.toLowerCase()));
  void systemPrincipal;
  await closeDb();
});
