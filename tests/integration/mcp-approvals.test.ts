import { and, eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { closeDb, getDb, loadEnv, schema } from "../../packages/db/src/index";
import {
  createBookingFor,
  customerPrincipal,
  recordPayment,
  seedDemoTenant,
  staffPrincipal,
  withPrincipal,
  type ServiceContext,
} from "../../packages/services/src/index";
import { addDays, dateKey, nairobiTime } from "../../packages/services/src/tz";
import { callTool } from "../../packages/mcp-server/src/index";

loadEnv();

const enabled = Boolean(process.env.DATABASE_URL);

/**
 * MCP gate (Phase 3). Needs a real Postgres with migrations:
 *   pnpm db:migrate
 *   pnpm test:integration
 *
 * Covers the security-critical MCP paths: tenant isolation, principal/scope
 * rejection, customer sensitive writes becoming approvals, owner-only decision,
 * exactly-once execution, written-tool idempotency and rejection.
 */
describe.skipIf(!enabled)("MCP dispatch: tenancy, scopes and approvals (needs Postgres)", () => {
  const stamp = Date.now();
  let tenantA = "";
  let tenantB = "";
  let offeringId = "";
  let resourceId = "";
  let customerId = "";
  let customerPhone = "";
  let bookingId = "";
  let approvalId = "";

  const ownerA = () => staffPrincipal(tenantA, "mcp-owner-a", "owner");
  const staffA = () => staffPrincipal(tenantA, "mcp-staff-a", "staff");
  const ownerB = () => staffPrincipal(tenantB, "mcp-owner-b", "owner");
  const customerA = () =>
    customerPrincipal({ tenantId: tenantA, customerId, phoneE164: customerPhone });
  const asOwner = <T>(fn: (ctx: ServiceContext) => Promise<T>): Promise<T> =>
    withPrincipal(ownerA(), fn);

  it("seeds two isolated tenants", async () => {
    const a = await seedDemoTenant({
      slug: `mcp-a-${stamp}`,
      name: "MCP Tenant A",
      vertical: "venue",
      ownerEmail: `owner-a-${stamp}@example.test`,
      ownerPassword: "test-password-1234",
      staffEmail: `staff-a-${stamp}@example.test`,
      staffPassword: "test-password-1234",
      reset: true,
    });
    const b = await seedDemoTenant({
      slug: `mcp-b-${stamp}`,
      name: "MCP Tenant B",
      vertical: "salon",
      ownerEmail: `owner-b-${stamp}@example.test`,
      ownerPassword: "test-password-1234",
      staffEmail: `staff-b-${stamp}@example.test`,
      staffPassword: "test-password-1234",
      reset: true,
    });
    tenantA = a.tenantId;
    tenantB = b.tenantId;
    expect(tenantA).not.toBe(tenantB);

    const db = getDb();
    const offering = await db.query.offerings.findFirst({
      where: (o, { and, eq }) => and(eq(o.tenantId, tenantA), eq(o.active, true)),
    });
    const resource = await db.query.resources.findFirst({
      where: (r, { and, eq }) =>
        and(eq(r.tenantId, tenantA), eq(r.active, true), eq(r.kind, "space")),
    });
    const customer = await db.query.customers.findFirst({
      where: (c, { eq }) => eq(c.tenantId, tenantA),
    });
    expect(offering && resource && customer).toBeTruthy();
    offeringId = offering!.id;
    resourceId = resource!.id;
    customerId = customer!.id;
    customerPhone = customer!.phoneE164;
  });

  it("creates a paid booking to refund against", async () => {
    const startKey = addDays(dateKey(new Date()), 210);
    const created = await createBookingFor(ownerA(), {
      customerId,
      offeringId,
      resourceIds: [resourceId],
      startsAt: nairobiTime(startKey, "10:00").toISOString(),
      endsAt: nairobiTime(startKey, "14:00").toISOString(),
      partySize: 5,
      status: "hold",
      source: "staff",
      attributes: { eventType: "corporate" },
    });
    bookingId = created.booking.id;
    await asOwner((ctx) =>
      recordPayment(ctx, {
        bookingId,
        method: "cash",
        amountKes: 5_000,
        notifyCustomer: false,
      }),
    );
  });

  it("rejects staff-only tools for a customer principal", async () => {
    const outcome = await callTool(customerA(), "bookings.list", {});
    expect(outcome.ok).toBe(false);
    expect(outcome.error?.code).toBe("FORBIDDEN");
  });

  it("turns a customer refund into a pending approval without moving money", async () => {
    const outcome = await callTool(customerA(), "payments.refund", {
      bookingId,
      amountKes: 1_000,
      reason: "Event cancelled before the notice window",
    });

    expect(outcome.ok).toBe(true);
    expect(outcome.pendingApproval?.kind).toBe("refund");
    approvalId = outcome.pendingApproval!.approvalId;

    const result = outcome.result as { status: string; requested: { amountKes: number } };
    expect(result.status).toBe("pending_approval");
    expect(result.requested.amountKes).toBe(1_000);

    const refunds = await asOwner((ctx) =>
      ctx.db.query.payments.findMany({
        where: (p, { and, eq }) =>
          and(eq(p.tenantId, tenantA), eq(p.bookingId, bookingId), eq(p.method, "refund")),
      }),
    );
    expect(refunds).toHaveLength(0);
  });

  it("blocks a non-owner from deciding a refund approval", async () => {
    const outcome = await callTool(staffA(), "approvals.decide", {
      approvalId,
      decision: "approved",
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.error?.code).toBe("FORBIDDEN");
  });

  it("does not let another tenant decide the approval", async () => {
    const outcome = await callTool(ownerB(), "approvals.decide", {
      approvalId,
      decision: "approved",
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.error?.code).toBe("NOT_FOUND");
  });

  it("does not let another tenant read the booking", async () => {
    const outcome = await callTool(ownerB(), "bookings.get", { bookingId });
    expect(outcome.ok).toBe(false);
    expect(outcome.error?.code).toBe("NOT_FOUND");
  });

  it("lets the owner approve and executes the refund exactly once", async () => {
    const outcome = await callTool(ownerA(), "approvals.decide", {
      approvalId,
      decision: "approved",
    });
    expect(outcome.ok).toBe(true);
    const result = outcome.result as {
      status: string;
      execution: { executed: boolean; result: Record<string, unknown> };
    };
    expect(result.status).toBe("approved");
    expect(result.execution.executed).toBe(true);
    expect(result.execution.result.amountKes).toBe(1_000);

    const refunds = await asOwner((ctx) =>
      ctx.db.query.payments.findMany({
        where: (p, { and, eq }) =>
          and(eq(p.tenantId, tenantA), eq(p.bookingId, bookingId), eq(p.method, "refund")),
      }),
    );
    expect(refunds).toHaveLength(1);
    expect(refunds[0]!.amountKes).toBe(1_000);

    const approval = await asOwner((ctx) =>
      ctx.db.query.approvals.findFirst({ where: (a, { eq }) => eq(a.id, approvalId) }),
    );
    expect(approval?.status).toBe("executed");

    // A second decision must conflict, not refund twice.
    const again = await callTool(ownerA(), "approvals.decide", {
      approvalId,
      decision: "approved",
    });
    expect(again.ok).toBe(false);
    expect(again.error?.code).toBe("CONFLICT");

    const after = await asOwner((ctx) =>
      ctx.db.query.payments.findMany({
        where: (p, { and, eq }) =>
          and(eq(p.tenantId, tenantA), eq(p.bookingId, bookingId), eq(p.method, "refund")),
      }),
    );
    expect(after).toHaveLength(1);
  });

  it("records a rejection without executing anything", async () => {
    const requested = await callTool(customerA(), "payments.refund", {
      bookingId,
      amountKes: 500,
      reason: "Changed my mind",
    });
    const id = requested.pendingApproval!.approvalId;

    const decided = await callTool(ownerA(), "approvals.decide", {
      approvalId: id,
      decision: "rejected",
    });
    expect(decided.ok).toBe(true);
    const result = decided.result as { status: string; execution?: unknown };
    expect(result.status).toBe("rejected");
    expect(result.execution).toBeUndefined();

    const refunds = await asOwner((ctx) =>
      ctx.db.query.payments.findMany({
        where: (p, { and, eq }) =>
          and(eq(p.tenantId, tenantA), eq(p.bookingId, bookingId), eq(p.method, "refund")),
      }),
    );
    expect(refunds).toHaveLength(1); // still only the executed refund above
  });

  it("deduplicates a written tool call by idempotency key", async () => {
    const startsAt = nairobiTime(addDays(dateKey(new Date()), 300), "10:00").toISOString();
    const args = {
      customerId,
      offeringId,
      resourceId,
      startsAt,
      partySize: 3,
      idempotencyKey: `mcp-idem-${stamp}`,
    };

    const first = await callTool(ownerA(), "bookings.create_hold", args);
    expect(first.ok, JSON.stringify(first.error)).toBe(true);
    const second = await callTool(ownerA(), "bookings.create_hold", args);
    expect(second.ok, JSON.stringify(second.error)).toBe(true);

    const firstId = (first.result as { id: string }).id;
    const secondId = (second.result as { id: string }).id;
    expect(secondId).toBe(firstId);

    const rows = await asOwner((ctx) =>
      ctx.db.query.bookings.findMany({
        where: (b, { and, eq }) => and(eq(b.tenantId, tenantA), eq(b.id, firstId)),
      }),
    );
    expect(rows).toHaveLength(1);
  });

  afterAll(async () => {
    if (!enabled) return;
    const db = getDb();
    for (const id of [tenantA, tenantB]) {
      if (id) await db.delete(schema.tenants).where(eq(schema.tenants.id, id));
    }
    await closeDb();
  });
});
