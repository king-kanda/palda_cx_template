import { and, eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { closeDb, getDb, loadEnv, schema } from "../../packages/db/src/index";
import {
  createBookingFor,
  createPlatformAdmin,
  completeOAuthConnection,
  customerPrincipal,
  decideApproval,
  disconnectApp,
  listAppConnections,
  publishAgentOverride,
  saveOdooConnection,
  seedDemoTenant,
  staffPrincipal,
  withPrincipal,
} from "../../packages/services/src/index";
import { applyPlatformSettings } from "../../packages/integrations/src/index";
import { addDays, dateKey, nairobiTime } from "../../packages/services/src/tz";
import { callTool, executeApprovedAction } from "../../packages/mcp-server/src/index";
import { loadAgentConfig } from "../../apps/agent-service/src/agent-config";

loadEnv();
process.env.WHATSAPP_MODE = "mock";

const enabled = Boolean(process.env.DATABASE_URL);

/**
 * Apps a business connects (Google, Zoho, Odoo), end to end in mock mode: the owner connects, the Palda team switches tools on,
 * the agent can use them only for the customer it serves, sensitive ones wait for approval, and disconnecting removes access.
 */
describe.skipIf(!enabled)("app connections and app tools (needs Postgres)", () => {
  const stamp = Date.now();
  let tenantA = "";
  let tenantB = "";
  let adminId = "";
  const people: { id: string; phone: string; bookingId: string }[] = [];

  const owner = () => staffPrincipal(tenantA, "conn-owner", "owner");
  const staff = () => staffPrincipal(tenantA, "conn-staff", "staff");
  const as = (i: number) => customerPrincipal({ tenantId: tenantA, customerId: people[i]!.id, phoneE164: people[i]!.phone });

  it("seeds two businesses, two customers with bookings", async () => {
    applyPlatformSettings({}); // mock mode
    const seed = (slug: string) =>
      seedDemoTenant({
        slug,
        name: slug,
        vertical: "venue",
        ownerEmail: `${slug}-owner@example.test`,
        ownerPassword: "test-password-1234",
        staffEmail: `${slug}-staff@example.test`,
        staffPassword: "test-password-1234",
        reset: true,
      });
    tenantA = (await seed(`conn-a-${stamp}`)).tenantId;
    tenantB = (await seed(`conn-b-${stamp}`)).tenantId;
    adminId = (await createPlatformAdmin({ email: `conn-admin-${stamp}@palda.test`, name: "Admin", password: "correct-horse-battery" })).id;

    const db = getDb();
    const offering = await db.query.offerings.findFirst({ where: (o, { and, eq }) => and(eq(o.tenantId, tenantA), eq(o.active, true)) });
    const resource = await db.query.resources.findFirst({ where: (r, { and, eq }) => and(eq(r.tenantId, tenantA), eq(r.active, true), eq(r.kind, "space")) });
    const customers = await db.query.customers.findMany({ where: (c, { eq }) => eq(c.tenantId, tenantA), limit: 2 });
    for (const [i, c] of customers.entries()) {
      const day = addDays(dateKey(new Date()), 320 + i * 3);
      const created = await createBookingFor(owner(), {
        customerId: c.id,
        offeringId: offering!.id,
        resourceIds: [resource!.id],
        startsAt: nairobiTime(day, "10:00").toISOString(),
        endsAt: nairobiTime(day, "14:00").toISOString(),
        partySize: 5,
        status: "hold",
        source: "staff",
        attributes: { eventType: "corporate" },
      });
      people.push({ id: c.id, phone: c.phoneE164, bookingId: created.booking.id });
    }
    expect(people.length).toBe(2);
  });

  it("only the owner can connect an app; the tokens are stored encrypted and per business", async () => {
    await expect(
      withPrincipal(staff(), (ctx) => completeOAuthConnection(ctx, "zoho_books", { code: "mock-code", redirectUri: "https://x/cb" })),
    ).rejects.toThrow(/owner/i);

    const view = await withPrincipal(owner(), (ctx) => completeOAuthConnection(ctx, "zoho_books", { code: "mock-code", redirectUri: "https://x/cb" }));
    expect(view.status).toBe("connected");
    expect(view.mock).toBe(true);
    expect(view.account).toBeTruthy();

    const row = await getDb().query.tenantIntegrations.findFirst({
      where: and(eq(schema.tenantIntegrations.tenantId, tenantA), eq(schema.tenantIntegrations.kind, "zoho_books")),
    });
    expect(row!.configEncrypted).not.toContain("mock_access");
    expect(JSON.stringify(row!.meta)).not.toContain("mock_access");

    const a = await listAppConnections(tenantA);
    expect(a.find((c) => c.id === "zoho_books")!.status).toBe("connected");
    expect(a.find((c) => c.id === "google_workspace")!.status).toBe("not_connected");
    const b = await listAppConnections(tenantB);
    expect(b.every((c) => c.status === "not_connected")).toBe(true);
  });

  it("app tools stay off until the Palda team switches them on, and need the app connected", async () => {
    expect((await loadAgentConfig(tenantA, "wambo")).toolPolicy.blockedTools).toContain("zohobooks.my_balance");

    await publishAgentOverride(adminId, tenantA, "wambo", {
      toolPolicy: { blockedTools: [], enabledIntegrationTools: ["zohobooks.my_balance", "zohobooks.invoice_booking", "odoo.my_invoices"] },
    });
    const cfg = await loadAgentConfig(tenantA, "wambo");
    expect(cfg.toolPolicy.blockedTools).not.toContain("zohobooks.my_balance");
    expect(cfg.toolPolicy.blockedTools).not.toContain("zohobooks.invoice_booking");
    // Switched on, but Odoo isn't connected: still not offered.
    expect(cfg.toolPolicy.blockedTools).toContain("odoo.my_invoices");
    // Never switched on.
    expect(cfg.toolPolicy.blockedTools).toContain("zohobooks.my_invoices");

    // Another business is unaffected.
    expect((await loadAgentConfig(tenantB, "wambo")).toolPolicy.blockedTools).toContain("zohobooks.my_balance");
  });

  it("the customer gets their own balance; a business without the app gets NOT_CONNECTED", async () => {
    const out = await callTool(as(0), "zohobooks.my_balance", {});
    expect(out.ok).toBe(true);
    expect(out.result).toMatchObject({ found: true, balanceKes: 5000, openInvoices: 1 });

    const other = await callTool(
      customerPrincipal({ tenantId: tenantB, customerId: people[0]!.id, phoneE164: people[0]!.phone }),
      "zohobooks.my_balance",
      {},
    );
    expect(other.ok).toBe(false);
  });

  it("a customer can't ask for an approval about someone else's booking", async () => {
    const out = await callTool(as(1), "zohobooks.invoice_booking", { bookingId: people[0]!.bookingId });
    expect(out.ok).toBe(false);
    const pending = await getDb().query.approvals.findMany({ where: eq(schema.approvals.tenantId, tenantA) });
    expect(pending.filter((p) => JSON.stringify(p.payload).includes(people[0]!.bookingId))).toHaveLength(0);
  });

  it("a sensitive app tool waits for approval, then runs once when the owner approves", async () => {
    const out = await callTool(as(0), "zohobooks.invoice_booking", { bookingId: people[0]!.bookingId });
    expect(out.ok).toBe(true);
    const approvalId = out.pendingApproval!.approvalId;

    await withPrincipal(owner(), (ctx) => decideApproval(ctx, approvalId, "approved"));
    const done = await executeApprovedAction(owner(), approvalId);
    expect(done.executed).toBe(true);
    expect(done.result).toMatchObject({ created: true, status: "draft" });
    const row = await getDb().query.approvals.findFirst({ where: eq(schema.approvals.id, approvalId) });
    expect(row!.status).toBe("executed");
  });

  it("Odoo is connected by the Palda team with a key, after checks", async () => {
    await expect(
      saveOdooConnection(adminId, tenantA, { url: "https://10.0.0.5", db: "demo", username: "bot@example.com", apiKey: "a-long-api-key" }),
    ).rejects.toThrow();
    await expect(saveOdooConnection(adminId, tenantA, { url: "https://odoo.example.com", db: "demo", username: "bot@example.com", apiKey: "" })).rejects.toThrow(
      /API key/,
    );
    const view = await saveOdooConnection(adminId, tenantA, {
      url: "https://odoo.example.com/web",
      db: "demo",
      username: "bot@example.com",
      apiKey: "a-long-api-key",
    });
    expect(view.status).toBe("connected");
    expect((await loadAgentConfig(tenantA, "wambo")).toolPolicy.blockedTools).not.toContain("odoo.my_invoices");
    const out = await callTool(as(0), "odoo.my_invoices", {});
    expect(out.ok).toBe(true);
    expect((out.result as { totalBalanceKes: number }).totalBalanceKes).toBe(12000);
  });

  it("a connection that stops working is marked and its tools are withdrawn", async () => {
    const row = await getDb().query.tenantIntegrations.findFirst({
      where: and(eq(schema.tenantIntegrations.tenantId, tenantA), eq(schema.tenantIntegrations.kind, "odoo")),
    });
    await getDb()
      .update(schema.tenantIntegrations)
      .set({ meta: { ...(row!.meta as Record<string, unknown>), status: "attention", lastError: "key revoked" } })
      .where(eq(schema.tenantIntegrations.id, row!.id));
    expect((await loadAgentConfig(tenantA, "wambo")).toolPolicy.blockedTools).toContain("odoo.my_invoices");
    const out = await callTool(as(0), "odoo.my_invoices", {});
    expect(out.ok).toBe(false);
    expect(out.error?.code).toBe("APP_ERROR");
  });

  it("disconnecting removes access straight away", async () => {
    await withPrincipal(owner(), (ctx) => disconnectApp(ctx, "zoho_books"));
    expect((await listAppConnections(tenantA)).find((c) => c.id === "zoho_books")!.status).toBe("not_connected");
    expect((await loadAgentConfig(tenantA, "wambo")).toolPolicy.blockedTools).toContain("zohobooks.my_balance");
    const out = await callTool(as(0), "zohobooks.my_balance", {});
    expect(out.ok).toBe(false);
    expect(out.error?.code).toBe("NOT_CONNECTED");
    // An owner can't remove what the Palda team manages from their app.
    await expect(withPrincipal(owner(), (ctx) => disconnectApp(ctx, "odoo"))).rejects.toThrow();
  });

  afterAll(async () => {
    const db = getDb();
    for (const id of [tenantA, tenantB].filter(Boolean)) await db.delete(schema.tenants).where(eq(schema.tenants.id, id));
    if (adminId) await db.delete(schema.platformAdmins).where(eq(schema.platformAdmins.id, adminId));
    await closeDb();
  });
});
