import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { closeDb, getDb, loadEnv, schema } from "../../packages/db/src/index";
import {
  CUSTOMER_SCOPES,
  createBookingFor,
  customerPrincipal,
  seedDemoTenant,
  staffPrincipal,
} from "../../packages/services/src/index";
import { addDays, dateKey, nairobiTime } from "../../packages/services/src/tz";
import { callTool, visibleTools } from "../../packages/mcp-server/src/index";

loadEnv();
process.env.WHATSAPP_MODE = "mock";

const enabled = Boolean(process.env.DATABASE_URL);

/**
 * The customer-facing agent may create and send invoices, but only for the customer it is talking to. Anything else must look
 * like it does not exist. These tests use two customers of the SAME business (the hard case) and a second business.
 */
describe.skipIf(!enabled)("customer-facing invoices (needs Postgres)", () => {
  const stamp = Date.now();
  let tenantA = "";
  let tenantB = "";
  let offeringId = "";
  let resourceId = "";
  const people: { id: string; phone: string; bookingId: string }[] = [];
  let invoiceIdForOne = "";
  let tenantBCustomer = { id: "", phone: "" };

  const owner = () => staffPrincipal(tenantA, "inv-owner", "owner");
  const as = (i: number) => customerPrincipal({ tenantId: tenantA, customerId: people[i]!.id, phoneE164: people[i]!.phone });

  it("seeds two businesses with customers and a booking each for two customers", async () => {
    const a = await seedDemoTenant({
      slug: `inv-a-${stamp}`,
      name: "Invoice A",
      vertical: "venue",
      ownerEmail: `owner-a-${stamp}@example.test`,
      ownerPassword: "test-password-1234",
      staffEmail: `staff-a-${stamp}@example.test`,
      staffPassword: "test-password-1234",
      reset: true,
    });
    const b = await seedDemoTenant({
      slug: `inv-b-${stamp}`,
      name: "Invoice B",
      vertical: "venue",
      ownerEmail: `owner-b-${stamp}@example.test`,
      ownerPassword: "test-password-1234",
      staffEmail: `staff-b-${stamp}@example.test`,
      staffPassword: "test-password-1234",
      reset: true,
    });
    tenantA = a.tenantId;
    tenantB = b.tenantId;

    const db = getDb();
    const offering = await db.query.offerings.findFirst({ where: (o, { and, eq }) => and(eq(o.tenantId, tenantA), eq(o.active, true)) });
    const resources = await db.query.resources.findMany({
      where: (r, { and, eq }) => and(eq(r.tenantId, tenantA), eq(r.active, true), eq(r.kind, "space")),
    });
    const customers = await db.query.customers.findMany({ where: (c, { eq }) => eq(c.tenantId, tenantA), limit: 2 });
    const bCustomer = await db.query.customers.findFirst({ where: (c, { eq }) => eq(c.tenantId, tenantB) });
    expect(offering && resources.length >= 1 && customers.length >= 2 && bCustomer).toBeTruthy();
    offeringId = offering!.id;
    resourceId = resources[0]!.id;
    tenantBCustomer = { id: bCustomer!.id, phone: bCustomer!.phoneE164 };

    for (const [i, c] of customers.entries()) {
      const startKey = addDays(dateKey(new Date()), 300 + i * 3);
      const created = await createBookingFor(owner(), {
        customerId: c.id,
        offeringId,
        resourceIds: [resourceId],
        startsAt: nairobiTime(startKey, "10:00").toISOString(),
        endsAt: nairobiTime(startKey, "14:00").toISOString(),
        partySize: 5,
        status: "hold",
        source: "staff",
        attributes: { eventType: "corporate" },
      });
      people.push({ id: c.id, phone: c.phoneE164, bookingId: created.booking.id });
    }
  });

  it("the customer-facing agent is offered the invoice tools", () => {
    const names = visibleTools(as(0)).map((t) => t.name);
    for (const n of ["invoices.generate", "invoices.send", "invoices.get", "invoices.list"]) expect(names).toContain(n);
    expect(CUSTOMER_SCOPES).toContain("invoices:write_own");
  });

  it("generates and sends an invoice for the customer's own booking; the amount comes from the server", async () => {
    const out = await callTool(as(0), "invoices.generate", { bookingId: people[0]!.bookingId, kind: "deposit" });
    expect(out.ok).toBe(true);
    const inv = out.result as { id: string; totalKes: number; status: string };
    expect(inv.totalKes).toBeGreaterThan(0);
    expect(inv.status).toBe("draft");
    invoiceIdForOne = inv.id;

    // Asking again returns the same open invoice instead of creating a duplicate.
    const again = await callTool(as(0), "invoices.generate", { bookingId: people[0]!.bookingId, kind: "deposit" });
    expect((again.result as { id: string }).id).toBe(inv.id);

    const sent = await callTool(as(0), "invoices.send", { invoiceId: inv.id });
    expect(sent.ok).toBe(true);
    expect((sent.result as { status: string }).status).toBe("sent");
  });

  it("a customer cannot choose the amount or the due date (unknown inputs are rejected)", async () => {
    const withAmount = await callTool(as(0), "invoices.generate", { bookingId: people[0]!.bookingId, kind: "full", totalKes: 1 });
    expect(withAmount.ok).toBe(false);
  });

  it("another customer of the same business cannot generate, send, read or list this invoice", async () => {
    const gen = await callTool(as(1), "invoices.generate", { bookingId: people[0]!.bookingId, kind: "full" });
    expect(gen.ok).toBe(false);
    expect(gen.error?.code).toBe("NOT_FOUND");

    const send = await callTool(as(1), "invoices.send", { invoiceId: invoiceIdForOne });
    expect(send.ok).toBe(false);
    expect(send.error?.code).toBe("NOT_FOUND");

    const get = await callTool(as(1), "invoices.get", { invoiceId: invoiceIdForOne });
    expect(get.ok).toBe(false);
    expect(get.error?.code).toBe("NOT_FOUND");

    const list = await callTool(as(1), "invoices.list", {});
    expect(list.ok).toBe(true);
    expect((list.result as { id: string }[]).map((r) => r.id)).not.toContain(invoiceIdForOne);

    // Nothing was created for the other customer's booking by that attempt
    const rows = await getDb().query.invoices.findMany({ where: eq(schema.invoices.bookingId, people[0]!.bookingId) });
    expect(rows.map((r) => r.kind)).toEqual(["deposit"]);
  });

  it("the owner of the invoice can read and list it", async () => {
    const get = await callTool(as(0), "invoices.get", { invoiceId: invoiceIdForOne });
    expect(get.ok).toBe(true);
    const list = await callTool(as(0), "invoices.list", {});
    const ids = (list.result as { id: string }[]).map((r) => r.id);
    expect(ids).toContain(invoiceIdForOne);
    // every invoice returned belongs to this customer's own bookings
    const own = await getDb().query.bookings.findMany({ where: eq(schema.bookings.customerId, people[0]!.id) });
    const mine = await getDb().query.invoices.findMany({ where: (i, { inArray }) => inArray(i.bookingId, own.map((b) => b.id)) });
    expect(ids.sort()).toEqual(mine.map((i) => i.id).sort());
  });

  it("a customer of another business cannot reach it either", async () => {
    const stranger = customerPrincipal({ tenantId: tenantB, customerId: tenantBCustomer.id, phoneE164: tenantBCustomer.phone });
    for (const [tool, args] of [
      ["invoices.generate", { bookingId: people[0]!.bookingId, kind: "full" }],
      ["invoices.send", { invoiceId: invoiceIdForOne }],
      ["invoices.get", { invoiceId: invoiceIdForOne }],
    ] as const) {
      const out = await callTool(stranger, tool, args);
      expect(out.ok).toBe(false);
      expect(out.error?.code).toBe("NOT_FOUND");
    }
  });

  it("staff behaviour is unchanged: staff can list every invoice and choose a due date", async () => {
    const staff = staffPrincipal(tenantA, "inv-staff", "staff");
    const gen = await callTool(staff, "invoices.generate", { bookingId: people[1]!.bookingId, kind: "deposit", dueInDays: 10 });
    expect(gen.ok).toBe(true);
    const all = await callTool(staff, "invoices.list", {});
    const allIds = (all.result as { id: string }[]).map((r) => r.id);
    expect(allIds).toContain(invoiceIdForOne);
    expect(allIds.length).toBeGreaterThan(2);
  });

  afterAll(async () => {
    for (const id of [tenantA, tenantB].filter(Boolean)) await getDb().delete(schema.tenants).where(eq(schema.tenants.id, id));
    await closeDb();
  });
});
