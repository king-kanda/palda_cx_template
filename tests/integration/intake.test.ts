import { and, eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { closeDb, getDb, loadEnv, schema } from "../../packages/db/src/index";
import {
  getIntakeForm,
  seedDemoTenant,
  sendIntakeForm,
  submitIntakeForm,
  systemPrincipal,
  withPrincipal,
} from "../../packages/services/src/index";

loadEnv();

const enabled = Boolean(process.env.DATABASE_URL);

const answers = {
  topic: "Q1 strategy workshop",
  attendees: "8 leaders",
  goals: "Agree the top three priorities for the quarter",
  notes: "Confidential: acquisition plans and board timing",
};

/**
 * Consultancy intake gate. The link sent by `intake.send_form` must resolve to
 * a public form, and answers must be stored encrypted, audited without content
 * and alerted to staff without content.
 */
describe.skipIf(!enabled)("consultancy intake forms (needs Postgres)", () => {
  const slug = `intake-${Date.now()}`;
  let tenantId = "";
  let customerId = "";
  let bookingId = "";

  const system = () => systemPrincipal(tenantId, "intake-test");

  it("seeds a consultancy tenant and sends an intake link", async () => {
    const seeded = await seedDemoTenant({
      slug,
      name: "Intake Test Consultancy",
      vertical: "consultancy",
      ownerEmail: `owner-${slug}@example.test`,
      ownerPassword: "test-password-1234",
      staffEmail: `staff-${slug}@example.test`,
      staffPassword: "test-password-1234",
      reset: true,
    });
    tenantId = seeded.tenantId;

    const booking = await getDb().query.bookings.findFirst({
      where: and(
        eq(schema.bookings.tenantId, tenantId),
        eq(schema.bookings.status, "confirmed"),
      ),
    });
    expect(booking).toBeTruthy();
    customerId = booking!.customerId;
    bookingId = booking!.id;

    const sent = await withPrincipal(system(), (ctx) => sendIntakeForm(ctx, bookingId));
    expect(sent.intakeUrl).toMatch(new RegExp(`/intake/${slug}/${bookingId}$`));
    expect(sent.sent).toBe(true);

    const view = await withPrincipal(system(), (ctx) => getIntakeForm(ctx, bookingId));
    expect(view.submittedAt).toBeNull();
    expect(view.answers.topic).toBe("");
    expect(view.businessName).toBe("Intake Test Consultancy");
  });

  it("stores answers encrypted, audits the fact and updates in place", async () => {
    await withPrincipal(system(), (ctx) =>
      submitIntakeForm(ctx, bookingId, { ...answers, consented: true }),
    );

    const row = await getDb().query.customerSensitive.findFirst({
      where: eq(schema.customerSensitive.customerId, customerId),
    });
    expect(row).toBeTruthy();
    expect(row!.dataEncrypted).not.toContain("acquisition");

    const view = await withPrincipal(system(), (ctx) => getIntakeForm(ctx, bookingId));
    expect(view.submittedAt).toBeInstanceOf(Date);
    expect(view.answers).toMatchObject({
      topic: answers.topic,
      attendees: answers.attendees,
      goals: answers.goals,
      notes: answers.notes,
    });

    await withPrincipal(system(), (ctx) =>
      submitIntakeForm(ctx, bookingId, {
        ...answers,
        topic: "Revised topic",
        consented: true,
      }),
    );
    const rows = await getDb().query.customerSensitive.findMany({
      where: eq(schema.customerSensitive.customerId, customerId),
    });
    expect(rows).toHaveLength(1);

    const second = await withPrincipal(system(), (ctx) => getIntakeForm(ctx, bookingId));
    expect(second.answers.topic).toBe("Revised topic");

    const audit = await getDb().query.auditLog.findFirst({
      where: and(
        eq(schema.auditLog.tenantId, tenantId),
        eq(schema.auditLog.action, "booking.intake_submitted"),
      ),
    });
    expect(audit).toBeTruthy();
    expect(JSON.stringify(audit!.diff)).not.toContain("acquisition");

    const alert = await getDb().query.integrationsLog.findFirst({
      where: and(
        eq(schema.integrationsLog.tenantId, tenantId),
        eq(schema.integrationsLog.kind, "staff_alert"),
      ),
    });
    expect(alert).toBeTruthy();
    expect(JSON.stringify(alert!.request)).not.toContain("acquisition");
  });

  it("refuses a submission without consent or for a cancelled booking", async () => {
    await expect(
      withPrincipal(system(), (ctx) =>
        submitIntakeForm(ctx, bookingId, { ...answers, consented: false }),
      ),
    ).rejects.toThrow(/confirm/i);

    await getDb()
      .update(schema.bookings)
      .set({ status: "cancelled" })
      .where(eq(schema.bookings.id, bookingId));

    await expect(
      withPrincipal(system(), (ctx) =>
        submitIntakeForm(ctx, bookingId, { ...answers, consented: true }),
      ),
    ).rejects.toThrow(/cancelled/i);
  });

  afterAll(async () => {
    if (!enabled || !tenantId) return;
    await getDb().delete(schema.tenants).where(eq(schema.tenants.id, tenantId));
    await closeDb();
  });
});
