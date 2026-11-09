import "dotenv/config";
import { and, eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { closeDb, schema, getDb } from "../../packages/db/src/index";
import {
  createBooking,
  eraseCustomerData,
  getQuote,
  getSensitiveData,
  recordInboundMessage,
  seedDemoTenant,
  setSensitiveData,
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

  it("erases customer PII but keeps the booking and audit trail", async () => {
    const owner = staffPrincipal(tenantId, "itest-owner", "owner");
    const staff = staffPrincipal(tenantId, "itest-staff", "staff");

    // Give the customer data worth erasing: a note, a sensitive record,
    // a conversation with a message, and free text on the booking.
    const booking = await withPrincipal(owner, (ctx) =>
      ctx.db.query.bookings.findFirst({
        where: (b, { and, eq }) => and(eq(b.tenantId, tenantId), eq(b.customerId, customerA)),
      }),
    );
    expect(booking).toBeTruthy();

    await withPrincipal(owner, (ctx) =>
      ctx.db
        .update(schema.bookings)
        .set({ notes: "VIP, allergic to lilies", attributes: { dietary: "vegan" } })
        .where(eq(schema.bookings.id, booking!.id)),
    );
    await withPrincipal(owner, (ctx) =>
      setSensitiveData(ctx, customerA, { idNumber: "12345678" }, new Date()),
    );
    await withPrincipal(owner, (ctx) =>
      recordInboundMessage(ctx, {
        customerId: customerA,
        waMessageId: `itest-${slug}-1`,
        text: "Please call me on my personal number.",
      }),
    );

    // A non-owner staff member cannot erase.
    await expect(
      withPrincipal(staff, (ctx) => eraseCustomerData(ctx, customerA)),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    await withPrincipal(owner, (ctx) => eraseCustomerData(ctx, customerA));

    const erased = await withPrincipal(owner, (ctx) =>
      ctx.db.query.customers.findFirst({
        where: (c, { and, eq }) => and(eq(c.id, customerA), eq(c.tenantId, tenantId)),
      }),
    );
    expect(erased?.name).toBe("Erased customer");
    expect(erased?.phoneE164.startsWith("erased:")).toBe(true);
    expect(erased?.email).toBeNull();
    expect(erased?.tags).toEqual([]);
    expect(erased?.notes).toBeNull();
    expect((erased?.attributes as Record<string, unknown>).erasedAt).toBeTruthy();

    expect(await withPrincipal(owner, (ctx) => getSensitiveData(ctx, customerA))).toBeNull();

    const conversations = await withPrincipal(owner, (ctx) =>
      ctx.db.query.conversations.findMany({
        where: (c, { and, eq }) => and(eq(c.tenantId, tenantId), eq(c.customerId, customerA)),
      }),
    );
    expect(conversations).toHaveLength(0);

    const clearedBooking = await withPrincipal(owner, (ctx) =>
      ctx.db.query.bookings.findFirst({ where: (b, { eq }) => eq(b.id, booking!.id) }),
    );
    expect(clearedBooking?.notes).toBeNull();
    expect(clearedBooking?.attributes).toEqual({});

    const auditRows = await withPrincipal(owner, (ctx) =>
      ctx.db.query.auditLog.findMany({
        where: (a, { and, eq }) =>
          and(eq(a.tenantId, tenantId), eq(a.action, "customer.erased")),
      }),
    );
    expect(auditRows.length).toBeGreaterThanOrEqual(1);
  });

  afterAll(async () => {
    if (!enabled || !tenantId) return;
    // Cascades remove every row this test created.
    await getDb().delete(schema.tenants).where(eq(schema.tenants.id, tenantId));
    await closeDb();
  });
});
