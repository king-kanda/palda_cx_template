import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, getDb, loadEnv, schema } from "../../packages/db/src/index";
import {
  buildDailyDigest,
  createBooking,
  dispatchDueReminders,
  dueReminders,
  generateInvoice,
  getSettings,
  listReminders,
  releaseExpiredHolds,
  scheduleForBooking,
  seedDemoTenant,
  sendInvoice,
  staffPrincipal,
  withPrincipal,
} from "../../packages/services/src/index";
import {
  addDays,
  dateKey,
  formatNairobi,
  nairobiTime,
} from "../../packages/services/src/tz";

loadEnv();

const enabled = Boolean(process.env.DATABASE_URL);

/**
 * Phase 3 acceptance: reminders fire at the right Nairobi times, and the
 * 07:00 digest is built from Nairobi-local days rather than UTC days.
 *
 * Needs a real Postgres with migrations applied (`pnpm db:migrate`).
 */
describe.skipIf(!enabled)("Nairobi reminders and daily digest (needs Postgres)", () => {
  const slug = `itest-reminders-${Date.now()}`;
  let tenantId = "";
  let offeringId = "";
  let resourceId = "";
  let customerId = "";
  let customerName = "";
  let bookingId = "";
  let startsAt = new Date();
  let startKey = "";

  const owner = () => staffPrincipal(tenantId, "seed", "owner");

  beforeAll(async () => {
    const result = await seedDemoTenant({
      slug,
      name: "Reminder Test Gardens",
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
    const resource = await db.query.resources.findFirst({
      where: (r, { and, eq }) => and(eq(r.tenantId, tenantId), eq(r.active, true)),
    });
    const customer = await db.query.customers.findFirst({
      where: (c, { eq }) => eq(c.tenantId, tenantId),
    });
    expect(offering && resource && customer).toBeTruthy();
    offeringId = offering!.id;
    resourceId = resource!.id;
    customerId = customer!.id;
    customerName = customer!.name;

    // Ten days out at 10:00 Nairobi: the -14d reminder is already in the past,
    // the -7d, -3d and -1d reminders are still schedulable.
    startKey = addDays(dateKey(new Date()), 10);
    startsAt = nairobiTime(startKey, "10:00");

    const created = await withPrincipal(owner(), (ctx) =>
      createBooking(ctx, {
        customerId,
        offeringId,
        resourceIds: [resourceId],
        startsAt: startsAt.toISOString(),
        endsAt: nairobiTime(startKey, "13:00").toISOString(),
        partySize: 4,
        status: "hold",
        source: "staff",
        attributes: { eventType: "birthday" },
      }),
    );
    bookingId = created.booking.id;
    expect(created.booking.depositRequiredKes).toBeGreaterThan(0);

    await withPrincipal(owner(), (ctx) =>
      generateInvoice(ctx, { bookingId, kind: "deposit" }),
    );
    await withPrincipal(owner(), (ctx) => scheduleForBooking(ctx, bookingId));
  });

  afterAll(async () => {
    await closeDb();
  });

  it("schedules every future venue reminder at its exact Nairobi-time offset", async () => {
    const rows = (
      await withPrincipal(owner(), (ctx) => listReminders(ctx, bookingId))
    ).filter((row) => row.status === "pending");
    const settings = await withPrincipal(owner(), (ctx) => getSettings(ctx));
    const booking = await withPrincipal(owner(), (ctx) =>
      ctx.db.query.bookings.findFirst({ where: eq(schema.bookings.id, bookingId) }),
    );
    expect(booking).toBeTruthy();

    const byKind = new Map(rows.map((row) => [row.kind, row]));
    // Hold nudge, deposit due, -7d, -3d (overdue warning), -1d, +1d thank-you
    // and +2d review request.
    expect([...byKind.keys()].sort()).toEqual(
      [
        "balance_overdue_3d",
        "deposit_due",
        "event_minus_1d",
        "event_minus_7d",
        "hold_nudge",
        "review_request",
        "thank_you",
      ].sort(),
    );
    // The -14d rule is skipped because that instant is already behind us.
    expect(byKind.has("event_minus_14d")).toBe(false);

    for (const rule of settings.preset.reminders) {
      const row = byKind.get(rule.kind);
      if (!row) continue;
      // deposit_due is emitted by the explicit +15-minute rule block above, not
      // by the offset-0 preset rule (which is already past at booking time).
      if (rule.kind === "deposit_due") continue;
      const base =
        rule.kind === "hold_nudge"
          ? booking!.createdAt
          : booking!.startsAt;
      expect(
        row.sendAt.getTime() - base.getTime(),
        `${rule.kind} should be ${rule.offsetHours}h from its base`,
      ).toBe(rule.offsetHours * 3_600_000);
      expect(row.sendAt.getTime()).toBeGreaterThan(Date.now());
      expect(row.status).toBe("pending");
    }

    // Deposit prompt is immediate-ish (+15 minutes), not next day.
    const deposit = byKind.get("deposit_due")!;
    expect(deposit.sendAt.getTime() - Date.now()).toBeLessThanOrEqual(16 * 60_000);
  });

  it("does not release a reminder before its send time and does at the boundary", async () => {
    const rows = (
      await withPrincipal(owner(), (ctx) => listReminders(ctx, bookingId))
    ).filter((row) => row.status === "pending");
    const target = rows.find((row) => row.kind === "event_minus_7d")!;

    const before = await withPrincipal(owner(), (ctx) =>
      dueReminders(ctx, { now: new Date(target.sendAt.getTime() - 1_000) }),
    );
    expect(before.some((row) => row.reminder.id === target.id)).toBe(false);

    const at = await withPrincipal(owner(), (ctx) =>
      dueReminders(ctx, { now: target.sendAt }),
    );
    expect(at.some((row) => row.reminder.id === target.id)).toBe(true);
  });

  it("dispatches due reminders in mock WhatsApp mode and renders Nairobi dates", async () => {
    const pending = (
      await withPrincipal(owner(), (ctx) => listReminders(ctx, bookingId))
    ).filter((row) => row.status === "pending");
    const pendingIds = new Set(pending.map((row) => row.id));
    const lastSendAt = Math.max(...pending.map((row) => row.sendAt.getTime()));

    // Other seeded bookings also have reminders, so this asserts the worker
    // sends at least ours; each row is checked below.
    const result = await withPrincipal(owner(), (ctx) =>
      dispatchDueReminders(ctx, { now: new Date(lastSendAt + 1_000) }),
    );
    expect(result.sent).toBeGreaterThanOrEqual(pending.length);
    expect(result.failed).toBe(0);

    const after = await withPrincipal(owner(), (ctx) => listReminders(ctx, bookingId));
    const ours = after.filter((row) => pendingIds.has(row.id));
    expect(ours).toHaveLength(pending.length);
    expect(ours.every((row) => row.status === "sent" && row.sentAt)).toBe(true);

    const logs = await withPrincipal(owner(), (ctx) =>
      ctx.db.query.integrationsLog.findMany({
        where: and(
          eq(schema.integrationsLog.tenantId, tenantId),
          eq(schema.integrationsLog.kind, "whatsapp"),
        ),
      }),
    );
    const depositLog = logs.find((log) => {
      const body = String((log.request as Record<string, unknown> | null)?.body ?? "");
      return body.includes(customerName) && body.includes("deposit");
    });
    expect(depositLog).toBeTruthy();
    const body = String((depositLog!.request as Record<string, unknown>).body);
    // 10:00 EAT on the event day, rendered from the UTC instant.
    expect(body).toContain(formatNairobi(startsAt));
    expect(body).toContain("KES");
    // The template owns the prefix; the variable must not add a second one.
    expect(body).not.toContain("KES KES");
  });

  it("releases an expired hold and cancels its pending reminders", async () => {
    const secondKey = addDays(dateKey(new Date()), 30);
    const created = await withPrincipal(owner(), (ctx) =>
      createBooking(ctx, {
        customerId,
        offeringId,
        resourceIds: [resourceId],
        startsAt: nairobiTime(secondKey, "10:00").toISOString(),
        endsAt: nairobiTime(secondKey, "13:00").toISOString(),
        partySize: 2,
        status: "hold",
        source: "staff",
        attributes: { eventType: "picnic" },
      }),
    );

    await withPrincipal(owner(), (ctx) =>
      ctx.db
        .update(schema.bookings)
        .set({ holdExpiresAt: new Date(Date.now() - 60_000) })
        .where(eq(schema.bookings.id, created.booking.id)),
    );

    const released = await withPrincipal(owner(), (ctx) =>
      releaseExpiredHolds(ctx, new Date()),
    );
    expect(released).toContain(created.booking.id);

    const booking = await withPrincipal(owner(), (ctx) =>
      ctx.db.query.bookings.findFirst({ where: eq(schema.bookings.id, created.booking.id) }),
    );
    expect(booking?.status).toBe("cancelled");

    const reminders = await withPrincipal(owner(), (ctx) =>
      listReminders(ctx, created.booking.id),
    );
    expect(reminders.every((row) => row.status === "cancelled")).toBe(true);
  });

  it("builds the 07:00 Nairobi digest from the Nairobi-local day", async () => {
    // 07:00 EAT is 04:00 UTC all year (Kenya has no DST).
    expect(nairobiTime(startKey, "07:00").toISOString()).toBe(`${startKey}T04:00:00.000Z`);

    // The digest lists sent/overdue invoices; a draft has not been billed yet.
    const invoice = await withPrincipal(owner(), (ctx) =>
      ctx.db.query.invoices.findFirst({
        where: and(
          eq(schema.invoices.tenantId, tenantId),
          eq(schema.invoices.bookingId, bookingId),
        ),
      }),
    );
    expect(invoice).toBeTruthy();
    await withPrincipal(owner(), (ctx) => sendInvoice(ctx, invoice!.id));

    const digest = await withPrincipal(owner(), (ctx) =>
      buildDailyDigest(ctx, startKey),
    );

    const entry = digest.today.find((row) => row.time === "10:00");
    expect(entry).toBeTruthy();
    expect(entry!.offering.length).toBeGreaterThan(0);
    expect(entry!.partySize).toBe(4);

    expect(digest.unpaid.some((row) => row.bookingId === bookingId)).toBe(true);
    expect(digest.text).toContain("daily digest");
    expect(digest.text).toContain("10:00");
  });
});
