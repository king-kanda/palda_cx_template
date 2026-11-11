import { and, eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { closeDb, getDb, loadEnv, schema } from "../../packages/db/src/index";
import {
  createBooking,
  handleC2BCallback,
  handleStkCallback,
  initiateStk,
  netPaidForBooking,
  recordPayment,
  recordRefund,
  seedDemoTenant,
  staffPrincipal,
  systemPrincipal,
  withPrincipal,
} from "../../packages/services/src/index";
import { addDays, dateKey, nairobiTime } from "../../packages/services/src/tz";

loadEnv();

const enabled = Boolean(process.env.DATABASE_URL);
const inMockMode = (process.env.MPESA_MODE ?? "mock") === "mock";

/**
 * Money gate (Phase 2, mock half). Needs a real Postgres with migrations:
 *   pnpm db:migrate
 *   MPESA_MODE=mock pnpm test:integration
 *
 * Covers the STK lifecycle (pending -> success -> duplicate replay), the failed
 * callback path, C2B confirmation idempotency, invoice recalculation, deposit
 * auto-confirmation, refunds and the owner-only refund rule. The Daraja sandbox
 * half of the gate still needs real credentials.
 */
describe.skipIf(!enabled || !inMockMode)("money: mock M-Pesa lifecycle (needs Postgres)", () => {
  const slug = `money-${Date.now()}`;
  let tenantId = "";
  let offeringId = "";
  let resourceId = "";
  let customerId = "";
  let customerPhone = "";
  let bookingId = "";
  let paymentId = "";
  let checkoutRequestId = "";
  let invoiceNumber = "";

  const owner = () => staffPrincipal(tenantId, "money-owner", "owner");
  const staff = () => staffPrincipal(tenantId, "money-staff", "staff");
  const callbackPrincipal = () => systemPrincipal(tenantId, "mpesa-callback");

  it("seeds a tenant and opens a hold with an invoice", async () => {
    const seeded = await seedDemoTenant({
      slug,
      name: "Money Test Gardens",
      vertical: "venue",
      ownerEmail: `owner-${slug}@example.test`,
      ownerPassword: "test-password-1234",
      staffEmail: `staff-${slug}@example.test`,
      staffPassword: "test-password-1234",
      reset: true,
    });
    tenantId = seeded.tenantId;

    const db = getDb();
    const offering = await db.query.offerings.findFirst({
      where: (o, { and, eq }) => and(eq(o.tenantId, tenantId), eq(o.active, true)),
    });
    const resource = await db.query.resources.findFirst({
      where: (r, { and, eq }) =>
        and(eq(r.tenantId, tenantId), eq(r.active, true), eq(r.kind, "space")),
    });
    const customer = await db.query.customers.findFirst({
      where: (c, { eq }) => eq(c.tenantId, tenantId),
    });
    expect(offering).toBeTruthy();
    expect(resource).toBeTruthy();
    expect(customer).toBeTruthy();
    offeringId = offering!.id;
    resourceId = resource!.id;
    customerId = customer!.id;
    customerPhone = customer!.phoneE164;

    const startKey = addDays(dateKey(new Date()), 250);
    const created = await withPrincipal(owner(), (ctx) =>
      createBooking(ctx, {
        customerId,
        offeringId,
        resourceIds: [resourceId],
        startsAt: nairobiTime(startKey, "10:00").toISOString(),
        endsAt: nairobiTime(startKey, "14:00").toISOString(),
        partySize: 6,
        status: "hold",
        source: "staff",
        attributes: { eventType: "corporate" },
      }),
    );
    bookingId = created.booking.id;

    expect(created.booking.status).toBe("hold");
    expect(created.booking.depositRequiredKes).toBeGreaterThan(0);
    expect(created.booking.depositRequiredKes).toBeLessThanOrEqual(created.booking.totalKes);
  });

  it("creates a pending STK payment and an invoice", async () => {
    const started = await withPrincipal(owner(), (ctx) =>
      initiateStk(ctx, { bookingId }),
    );

    expect(started.mocked).toBe(true);
    expect(started.payment.status).toBe("pending");
    expect(started.payment.method).toBe("mpesa");
    expect(started.payment.amountKes).toBeGreaterThan(0);
    expect(started.payment.mpesaCheckoutRequestId).toBeTruthy();
    paymentId = started.payment.id;
    checkoutRequestId = started.payment.mpesaCheckoutRequestId!;

    const invoice = await withPrincipal(owner(), (ctx) =>
      ctx.db.query.invoices.findFirst({
        where: (i, { and, eq }) =>
          and(eq(i.tenantId, tenantId), eq(i.bookingId, bookingId), eq(i.kind, "deposit")),
      }),
    );
    expect(invoice).toBeTruthy();
    expect(invoice!.totalKes).toBe(started.payment.amountKes);
    invoiceNumber = invoice!.number;
  });

  it("applies a success callback once and auto-confirms the deposit", async () => {
    const amount = await withPrincipal(owner(), (ctx) =>
      ctx.db.query.payments
        .findFirst({ where: (p, { eq }) => eq(p.id, paymentId) })
        .then((p) => p!.amountKes),
    );
    const receipt = `TEST${Date.now().toString().slice(-8)}`;
    const payload = {
      Body: {
        stkCallback: {
          MerchantRequestID: `mr-${checkoutRequestId.slice(-8)}`,
          CheckoutRequestID: checkoutRequestId,
          ResultCode: 0,
          ResultDesc: "The service request is processed successfully.",
          CallbackMetadata: {
            Item: [
              { Name: "Amount", Value: amount },
              { Name: "MpesaReceiptNumber", Value: receipt },
              { Name: "PhoneNumber", Value: customerPhone.replace(/^\+/, "") },
            ],
          },
        },
      },
    };

    const paid = await withPrincipal(callbackPrincipal(), (ctx) =>
      handleStkCallback(ctx, payload),
    );
    expect(paid).toBeTruthy();
    expect(paid!.id).toBe(paymentId);
    expect(paid!.status).toBe("succeeded");
    expect(paid!.mpesaReceipt).toBe(receipt);
    expect(paid!.amountKes).toBe(amount);

    const net = await withPrincipal(owner(), (ctx) => netPaidForBooking(ctx, bookingId));
    expect(net).toBe(amount);

    const booking = await withPrincipal(owner(), (ctx) =>
      ctx.db.query.bookings.findFirst({ where: (b, { eq }) => eq(b.id, bookingId) }),
    );
    expect(booking?.status).toBe("confirmed");

    const invoice = await withPrincipal(owner(), (ctx) =>
      ctx.db.query.invoices.findFirst({
        where: (i, { and, eq }) =>
          and(eq(i.tenantId, tenantId), eq(i.number, invoiceNumber)),
      }),
    );
    expect(invoice?.status).toBe("paid");
    expect(invoice?.balanceKes).toBe(0);

    // Daraja retries callbacks. A replay must be a no-op, not a second payment.
    const replay = await withPrincipal(callbackPrincipal(), (ctx) =>
      handleStkCallback(ctx, payload),
    );
    expect(replay?.id).toBe(paymentId);
    expect(replay?.status).toBe("succeeded");

    const rows = await withPrincipal(owner(), (ctx) =>
      ctx.db.query.payments.findMany({
        where: (p, { and, eq }) =>
          and(eq(p.tenantId, tenantId), eq(p.mpesaCheckoutRequestId, checkoutRequestId)),
      }),
    );
    expect(rows).toHaveLength(1);
    expect(await withPrincipal(owner(), (ctx) => netPaidForBooking(ctx, bookingId))).toBe(amount);
  });

  it("marks a cancelled STK callback as failed without touching the booking", async () => {
    const startKey = addDays(dateKey(new Date()), 260);
    const booking = await withPrincipal(owner(), (ctx) =>
      createBooking(ctx, {
        customerId,
        offeringId,
        resourceIds: [resourceId],
        startsAt: nairobiTime(startKey, "10:00").toISOString(),
        endsAt: nairobiTime(startKey, "13:00").toISOString(),
        partySize: 4,
        status: "hold",
        source: "staff",
        attributes: { eventType: "birthday" },
      }),
    );
    const started = await withPrincipal(owner(), (ctx) =>
      initiateStk(ctx, { bookingId: booking.booking.id }),
    );

    const failed = await withPrincipal(callbackPrincipal(), (ctx) =>
      handleStkCallback(ctx, {
        Body: {
          stkCallback: {
            CheckoutRequestID: started.payment.mpesaCheckoutRequestId,
            ResultCode: 1032,
            ResultDesc: "Request cancelled by user",
          },
        },
      }),
    );
    expect(failed?.status).toBe("failed");
    expect(failed?.mpesaReceipt).toBeNull();

    const after = await withPrincipal(owner(), (ctx) =>
      ctx.db.query.bookings.findFirst({
        where: (b, { eq }) => eq(b.id, booking.booking.id),
      }),
    );
    expect(after?.status).toBe("hold");
    expect(await withPrincipal(owner(), (ctx) => netPaidForBooking(ctx, booking.booking.id))).toBe(0);
  });

  it("accepts a Tuma-shaped success callback through the same route parser", async () => {
    const startKey = addDays(dateKey(new Date()), 270);
    const booking = await withPrincipal(owner(), (ctx) =>
      createBooking(ctx, {
        customerId,
        offeringId,
        resourceIds: [resourceId],
        startsAt: nairobiTime(startKey, "10:00").toISOString(),
        endsAt: nairobiTime(startKey, "13:00").toISOString(),
        partySize: 4,
        status: "hold",
        source: "staff",
        attributes: { eventType: "birthday" },
      }),
    );
    const started = await withPrincipal(owner(), (ctx) =>
      initiateStk(ctx, { bookingId: booking.booking.id }),
    );
    const receipt = `TUMA${Date.now().toString().slice(-8)}`;
    const payload = {
      result_code: 0,
      status: "completed",
      merchant_request_id: `mr-${started.payment.id.slice(-8)}`,
      checkout_request_id: started.payment.mpesaCheckoutRequestId,
      mpesa_receipt_number: receipt,
      amount: started.payment.amountKes,
      phone: customerPhone.replace(/^\+/, ""),
      timestamp: new Date().toISOString(),
      result_desc: "Payment successful",
    };

    const paid = await withPrincipal(callbackPrincipal(), (ctx) =>
      handleStkCallback(ctx, payload),
    );
    expect(paid?.status).toBe("succeeded");
    expect(paid?.mpesaReceipt).toBe(receipt);
    expect(paid?.amountKes).toBe(started.payment.amountKes);

    const replay = await withPrincipal(callbackPrincipal(), (ctx) =>
      handleStkCallback(ctx, payload),
    );
    expect(replay?.id).toBe(paid?.id);

    const rows = await withPrincipal(owner(), (ctx) =>
      ctx.db.query.payments.findMany({
        where: (p, { and, eq }) =>
          and(eq(p.tenantId, tenantId), eq(p.mpesaReceipt, receipt)),
      }),
    );
    expect(rows).toHaveLength(1);
  });

  it("accepts a C2B confirmation once and ignores the duplicate receipt", async () => {
    const transId = `TESTC2B${Date.now().toString().slice(-8)}`;
    const payload = {
      TransID: transId,
      TransAmount: 750,
      MSISDN: customerPhone.replace(/^\+/, ""),
      BillRefNumber: invoiceNumber,
      BusinessShortCode: "174379",
    };

    const first = await withPrincipal(callbackPrincipal(), (ctx) =>
      handleC2BCallback(ctx, payload),
    );
    expect(first.mpesaReceipt).toBe(transId);
    expect(first.amountKes).toBe(750);
    expect(first.status).toBe("succeeded");

    const replay = await withPrincipal(callbackPrincipal(), (ctx) =>
      handleC2BCallback(ctx, payload),
    );
    expect(replay.id).toBe(first.id);

    const rows = await withPrincipal(owner(), (ctx) =>
      ctx.db.query.payments.findMany({
        where: (p, { and, eq }) =>
          and(eq(p.tenantId, tenantId), eq(p.mpesaReceipt, transId)),
      }),
    );
    expect(rows).toHaveLength(1);
  });

  it("enforces owner-only, in-range refunds and reduces net paid", async () => {
    const before = await withPrincipal(owner(), (ctx) => netPaidForBooking(ctx, bookingId));

    await expect(
      withPrincipal(staff(), (ctx) =>
        recordRefund(ctx, { bookingId, amountKes: 100, reason: "staff attempt" }),
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    await expect(
      withPrincipal(owner(), (ctx) =>
        recordRefund(ctx, {
          bookingId,
          amountKes: before + 1,
          reason: "over refund",
        }),
      ),
    ).rejects.toMatchObject({ code: "POLICY" });

    // A plain owner payment without customer notification keeps the test quiet.
    const manual = await withPrincipal(owner(), (ctx) =>
      recordPayment(ctx, {
        bookingId,
        method: "cash",
        amountKes: 400,
        notifyCustomer: false,
      }),
    );
    expect(manual.status).toBe("succeeded");

    const refund = await withPrincipal(owner(), (ctx) =>
      recordRefund(ctx, { bookingId, amountKes: 300, reason: "partial refund" }),
    );
    expect(refund.method).toBe("refund");
    expect(refund.amountKes).toBe(300);

    const after = await withPrincipal(owner(), (ctx) => netPaidForBooking(ctx, bookingId));
    expect(after).toBe(before + 400 - 300);
  });

  afterAll(async () => {
    if (!enabled || !tenantId) return;
    await getDb().delete(schema.tenants).where(eq(schema.tenants.id, tenantId));
    await closeDb();
  });
});
