import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, getDb, loadEnv, schema } from "../../packages/db/src/index";
import { seedDemoTenant } from "../../packages/services/src/index";
import { app } from "../../apps/agent-service/src/app";

loadEnv();

const enabled = Boolean(process.env.DATABASE_URL);
const SECRET = "itest-internal-secret";

/**
 * The v1 staff channel is web chat. These tests drive the internal Hono routes
 * the web app calls, with the real database and the offline model:
 *   - `/internal/*` requires the shared secret
 *   - a staff chat turn is persisted with the staff principal
 *   - a staff user from another tenant is rejected
 *   - the digest endpoint delivers a staff alert
 */
describe.skipIf(!enabled)("agent-service internal staff routes (needs Postgres)", () => {
  const slug = `itest-internal-${Date.now()}`;
  const otherSlug = `itest-internal-other-${Date.now()}`;
  let tenantId = "";
  let ownerId = "";
  let otherUserId = "";

  async function post(path: string, body: unknown, secret?: string) {
    return app.request(path, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(secret === undefined ? {} : { "x-internal-secret": secret }),
      },
      body: JSON.stringify(body),
    });
  }

  beforeAll(async () => {
    process.env.INTERNAL_SECRET = SECRET;
    process.env.WAMBO_MODEL = "mock";
    delete process.env.OPENROUTER_API_KEY;

    const first = await seedDemoTenant({
      slug,
      name: "Internal Test Gardens",
      vertical: "venue",
      ownerEmail: `owner-${slug}@example.test`,
      ownerPassword: "test-password-1234",
      staffEmail: `staff-${slug}@example.test`,
      staffPassword: "test-password-1234",
      reset: true,
    });
    tenantId = first.tenantId;

    const second = await seedDemoTenant({
      slug: otherSlug,
      name: "Other Tenant Gardens",
      vertical: "venue",
      ownerEmail: `owner-${otherSlug}@example.test`,
      ownerPassword: "test-password-1234",
      staffEmail: `staff-${otherSlug}@example.test`,
      staffPassword: "test-password-1234",
      reset: true,
    });

    const db = getDb();
    const owner = await db.query.users.findFirst({
      where: and(eq(schema.users.tenantId, tenantId), eq(schema.users.role, "owner")),
    });
    const other = await db.query.users.findFirst({
      where: and(eq(schema.users.tenantId, second.tenantId), eq(schema.users.role, "owner")),
    });
    expect(owner && other).toBeTruthy();
    ownerId = owner!.id;
    otherUserId = other!.id;
  });

  afterAll(async () => {
    await closeDb();
  });

  it("rejects an internal call without the shared secret", async () => {
    const response = await post("/internal/chat", {
      tenantSlug: slug,
      userId: ownerId,
      userText: "hello",
    });
    expect(response.status).toBe(401);

    const wrong = await post(
      "/internal/chat",
      { tenantSlug: slug, userId: ownerId, userText: "hello" },
      "wrong-secret",
    );
    expect(wrong.status).toBe(401);
  });

  it("runs a staff chat turn and logs it under the staff principal", async () => {
    const response = await post(
      "/internal/chat",
      { tenantSlug: slug, userId: ownerId, userText: "Show me today's bookings" },
      SECRET,
    );
    expect(response.status).toBe(200);
    const json = (await response.json()) as { ok: boolean; text?: string };
    expect(json.ok).toBe(true);
    expect(json.text?.length).toBeGreaterThan(0);

    const runs = await getDb().query.agentRuns.findMany({
      where: and(
        eq(schema.agentRuns.tenantId, tenantId),
        eq(schema.agentRuns.agentId, "admin"),
        eq(schema.agentRuns.trigger, "staff"),
      ),
    });
    expect(runs.length).toBeGreaterThanOrEqual(1);
    expect(runs.at(-1)!.principalType).toBe("staff");
    expect(runs.at(-1)!.principalId).toBe(ownerId);
  });

  it("does not accept a staff user from another tenant", async () => {
    const response = await post(
      "/internal/chat",
      { tenantSlug: slug, userId: otherUserId, userText: "hello" },
      SECRET,
    );
    expect(response.status).toBe(404);
  });

  it("runs the ops watch and delivers its report to staff", async () => {
    const response = await post("/internal/ops", { tenantSlug: slug, event: "ops.scan" }, SECRET);
    expect(response.status).toBe(200);
    const json = (await response.json()) as { ok: boolean; text?: string };
    expect(json.ok).toBe(true);
    expect(json.text?.length).toBeGreaterThan(0);

    const runs = await getDb().query.agentRuns.findMany({
      where: and(
        eq(schema.agentRuns.tenantId, tenantId),
        eq(schema.agentRuns.agentId, "ops"),
      ),
    });
    expect(runs.length).toBeGreaterThanOrEqual(1);
    expect(runs.at(-1)!.principalType).toBe("system");
    expect(runs.at(-1)!.trigger).toBe("scheduled");
  });

  it("delivers the daily digest as a staff alert", async () => {
    const response = await post("/internal/digest", { tenantSlug: slug }, SECRET);
    expect(response.status).toBe(200);
    const json = (await response.json()) as { ok: boolean; text?: string };
    expect(json.ok).toBe(true);
    expect(json.text?.length).toBeGreaterThan(0);

    const alerts = await getDb().query.integrationsLog.findMany({
      where: and(
        eq(schema.integrationsLog.tenantId, tenantId),
        eq(schema.integrationsLog.kind, "staff_alert"),
      ),
    });
    expect(alerts.some((row) => (row.request as { body?: string })?.body === json.text)).toBe(true);
  });
});
