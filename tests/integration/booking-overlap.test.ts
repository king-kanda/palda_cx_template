import "dotenv/config";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { closeDb, schema, getDb } from "../../packages/db/src/index";
import {
  createBooking,
  getQuote,
  seedDemoTenant,
  staffPrincipal,
  withPrincipal,
} from "../../packages/services/src/index";
import { addDays, dateKey, nairobiTime } from "../../packages/services/src/tz";

const enabled = Boolean(process.env.DATABASE_URL);

/**
 * These tests need a real Postgres with migrations applied:
 *   docker compose up -d
 *   pnpm db:migrate
 *   pnpm test:integration
 *
 * They are skipped automatically when DATABASE_URL is absent so `pnpm test`
 * stays green on a fresh checkout.
 */
describe.skipIf(!enabled)("booking overlap prevention (needs Postgres)", () => {
  const slug = `itest-${Date.now()}`;
  let tenantId = "";
  let offeringId = "";
  let resourceId = "";
  let customerA = "";
  let customerB = "";

  it("seeds an isolated demo tenant", async () => {
    const result = await seedDemoTenant({
      slug,
      name: "Integration Test Gardens",
      vertical: "venue",
      ownerEmail: `owner-${slug}@example.test`,
      ownerPassword: "test-password-1234",
      staffEmail: `staff-${slug}@example.test`,
      staffPassword: "test-password-1234",
      reset: true,
    });
    tenantId = result.tenantId;

    const db = getDb();
    const offering = await db.query.offerings.findFirst({
      where: (o, { and, eq }) => and(eq(o.tenantId, tenantId), eq(o.active, true)),
      orderBy: (o, { asc }) => [asc(o.name)],
    });
    expect(offering).toBeTruthy();
    offeringId = offering!.id;

    const resource = await db.query.resources.findFirst({
      where: (r, { and, eq }) => and(eq(r.tenantId, tenantId), eq(r.active, true)),
    });
    expect(resource).toBeTruthy();
    resourceId = resource!.id;

    const staff = staffPrincipal(tenantId, "seed", "owner");
    const created = await withPrincipal(staff, async (ctx) => {
      const rows = await ctx.db.query.customers.findMany({
        where: (c, { eq }) => eq(c.tenantId, tenantId),
        limit: 2,
      });
      expect(rows.length).toBeGreaterThanOrEqual(2);
      return rows.slice(0, 2).map((row) => row.id);
    });
    customerA = created[0]!;
    customerB = created[1]!;
  });

  it("prices a quote with integer KES and a sane deposit", async () => {
    const staff = staffPrincipal(tenantId, "seed", "owner");
    const quote = await withPrincipal(staff, (ctx) => getQuote(ctx, { offeringId }));
    expect(Number.isInteger(quote.totalKes)).toBe(true);
    expect(quote.totalKes).toBeGreaterThan(0);
    expect(quote.depositRequiredKes).toBeGreaterThanOrEqual(0);
    expect(quote.depositRequiredKes).toBeLessThanOrEqual(quote.totalKes);
  });

  it("rejects a second booking for the same resource and time", async () => {
    const staff = staffPrincipal(tenantId, "seed", "owner");
    const startKey = addDays(dateKey(new Date()), 200);
    const startsAt = nairobiTime(startKey, "10:00").toISOString();
    const endsAt = nairobiTime(startKey, "14:00").toISOString();

    const first = await withPrincipal(staff, (ctx) =>
      createBooking(ctx, {
        customerId: customerA,
        offeringId,
        resourceIds: [resourceId],
        startsAt,
        endsAt,
        partySize: 20,
        status: "confirmed",
        source: "staff",
      }),
    );
    expect(first.booking.id).toBeTruthy();
    expect(first.booking.status).toBe("confirmed");

    let error: unknown;
    try {
      await withPrincipal(staff, (ctx) =>
        createBooking(ctx, {
          customerId: customerB,
          offeringId,
          resourceIds: [resourceId],
          startsAt,
          endsAt,
          partySize: 10,
          status: "confirmed",
          source: "staff",
        }),
      );
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeTruthy();
    expect((error as { code?: string }).code).toBe("SLOT_UNAVAILABLE");
  });

  afterAll(async () => {
    if (!enabled || !tenantId) return;
    // Cascades remove every row this test created.
    await getDb().delete(schema.tenants).where(eq(schema.tenants.id, tenantId));
    await closeDb();
  });
});
