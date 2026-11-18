import { createHmac } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { closeDb, getDb, loadEnv, schema } from "../../packages/db/src/index";
import {
  createBooking,
  getInvoiceDetail,
  getPaymentSettings,
  handleStkCallback,
  handlePaystackWebhook,
  handlePesapalIpn,
  movePaymentProvider,
  paymentLinkForInvoice,
  payFromButton,
  requestPayment,
  savePaymentProvider,
  seedDemoTenant,
  sendPaymentOptions,
  setPaymentProviderEnabled,
  staffPrincipal,
  systemPrincipal,
  withPrincipal,
} from "../../packages/services/src/index";
import { addDays, dateKey, nairobiTime } from "../../packages/services/src/tz";

loadEnv();

const enabled = Boolean(process.env.DATABASE_URL);

/**
 * Payment providers per business: Tuma, Paystack and Pesapal side by side, tried in order with fallback. The three gateways are
 * stubbed at `fetch`, so this proves our requests, our matching of what comes back, and the money rules, not the gateways.
 * Mode is switched off "mock" for the whole file so the real request paths run.
 */
describe.skipIf(!enabled)("payment providers (needs Postgres)", () => {
  const slug = `payprov-${Date.now()}`;
  const PS_SECRET = "sk_test_providers";
  let tenantId = "";
  let offeringId = "";
  let resourceId = "";
  let customerId = "";
  let customerPhone = "";
  let dayOffset = 300;
  const saved = { ...process.env };

  // What each stubbed gateway should do next.
  const gateway = { paystackFails: false, tumaFails: false, pesapalFails: false, pesapalStatus: 1, pesapalAmount: 0 };
  const calls: { url: string; body: unknown }[] = [];

  const owner = () => staffPrincipal(tenantId, "pp-owner", "owner");
  const staff = () => staffPrincipal(tenantId, "pp-staff", "staff");
  const system = () => systemPrincipal(tenantId, "webhook");

  function stubGateways(): void {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: { body?: string }) => {
        const u = String(url);
        const body = init?.body ? JSON.parse(init.body) : null;
        calls.push({ url: u, body });
        const ok = (json: unknown) => ({ ok: true, status: 200, json: async () => json }) as Response;
        const bad = (json: unknown) => ({ ok: false, status: 400, json: async () => json }) as Response;
        const exp = Date.now() + 300_000;

        if (u.includes("api.tuma.co.ke/auth/token")) return ok({ success: true, data: { token: `tuma.${Buffer.from(JSON.stringify({ exp: Math.floor(exp / 1000) })).toString("base64url")}.sig` } });
        if (u.includes("api.tuma.co.ke/payment/stk-push")) {
          if (gateway.tumaFails) return bad({ success: false, message: "Tuma is down" });
          return ok({ success: true, data: { checkout_request_id: `ws_CO_${calls.length}`, merchant_request_id: "m", customer_message: "Tuma prompt sent" } });
        }
        if (u.endsWith("api.paystack.co/balance")) return ok({ status: true, data: [] });
        if (u.endsWith("api.paystack.co/charge")) {
          if (gateway.paystackFails) return bad({ status: false, message: "Paystack is down" });
          return ok({ status: true, data: { status: "pay_offline", reference: body.reference, display_text: "Paystack prompt" } });
        }
        if (u.endsWith("api.paystack.co/transaction/initialize")) {
          if (gateway.paystackFails) return bad({ status: false, message: "Paystack is down" });
          return ok({ status: true, data: { authorization_url: `https://checkout.paystack.com/${body.reference}`, reference: body.reference } });
        }
        if (u.includes("cybqa.pesapal.com") && u.endsWith("/api/Auth/RequestToken")) return ok({ token: "pp", expiryDate: new Date(exp).toISOString() });
        if (u.endsWith("/api/URLSetup/RegisterIPN")) return ok({ ipn_id: "ipn-1" });
        if (u.endsWith("/api/Transactions/SubmitOrderRequest")) {
          if (gateway.pesapalFails) return bad({ error: { message: "Pesapal is down" } });
          return ok({ order_tracking_id: `trk-${body.id}`, redirect_url: `https://pay.pesapal.com/pay/${body.id}` });
        }
        if (u.includes("/api/Transactions/GetTransactionStatus")) {
          const trk = new URL(u).searchParams.get("orderTrackingId") ?? "";
          return ok({
            status_code: gateway.pesapalStatus,
            payment_status_description: gateway.pesapalStatus === 1 ? "Completed" : "Pending",
            amount: gateway.pesapalAmount,
            currency: "KES",
            confirmation_code: "PESA123",
            payment_method: "Visa",
            merchant_reference: trk.replace(/^trk-/, ""),
          });
        }
        throw new Error(`unexpected fetch ${u}`);
      }),
    );
  }

  const sign = (body: string) => createHmac("sha512", PS_SECRET).update(body).digest("hex");

  async function newBooking(): Promise<string> {
    dayOffset += 3;
    const startKey = addDays(dateKey(new Date()), dayOffset);
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
    return created.booking.id;
  }

  const paymentRow = (id: string) => getDb().query.payments.findFirst({ where: eq(schema.payments.id, id) });
  const bookingRow = (id: string) => getDb().query.bookings.findFirst({ where: eq(schema.bookings.id, id) });

  beforeAll(async () => {
    process.env.MPESA_MODE = "tuma"; // real request paths, stubbed at fetch
    process.env.APP_URL = "https://app.example.test";
    stubGateways();
    const seeded = await seedDemoTenant({
      slug,
      name: "Provider Test Gardens",
      vertical: "venue",
      ownerEmail: `owner-${slug}@example.test`,
      ownerPassword: "test-password-1234",
      staffEmail: `staff-${slug}@example.test`,
      staffPassword: "test-password-1234",
      reset: true,
    });
    tenantId = seeded.tenantId;
    const db = getDb();
    offeringId = (await db.query.offerings.findFirst({ where: (o, { and, eq }) => and(eq(o.tenantId, tenantId), eq(o.active, true)) }))!.id;
    resourceId = (await db.query.resources.findFirst({ where: (r, { and, eq }) => and(eq(r.tenantId, tenantId), eq(r.active, true), eq(r.kind, "space")) }))!.id;
    const customer = (await db.query.customers.findFirst({ where: (c, { eq }) => eq(c.tenantId, tenantId) }))!;
    customerId = customer.id;
    customerPhone = customer.phoneE164;
  });

  afterAll(async () => {
    vi.unstubAllGlobals();
    process.env = { ...saved };
    await closeDb();
  });

  it("refuses to ask for payment when a business has connected nothing (it never borrows the platform's account)", async () => {
    const bookingId = await newBooking();
    await expect(withPrincipal(owner(), (ctx) => requestPayment(ctx, { bookingId, mode: "stk" }))).rejects.toThrow(/No M-Pesa prompt provider/);
    await expect(withPrincipal(owner(), (ctx) => requestPayment(ctx, { bookingId, mode: "link" }))).rejects.toThrow(/No payment link provider/);
  });

  it("only the owner can connect a provider, and a bad Paystack key is refused", async () => {
    await expect(withPrincipal(staff(), (ctx) => savePaymentProvider(ctx, { provider: "paystack", secretKey: PS_SECRET }))).rejects.toThrow(/Owner/);
    await expect(withPrincipal(owner(), (ctx) => savePaymentProvider(ctx, { provider: "paystack", secretKey: "not-a-key" }))).rejects.toThrow(/Paystack secret key/);
  });

  it("connects all three, in the order added, never shows the keys, and can reorder and switch off", async () => {
    await withPrincipal(owner(), (ctx) => savePaymentProvider(ctx, { provider: "tuma", email: "pay@biz.test", apiKey: "tuma-secret-key-1234" }));
    await withPrincipal(owner(), (ctx) => savePaymentProvider(ctx, { provider: "paystack", secretKey: PS_SECRET }));
    await withPrincipal(owner(), (ctx) => savePaymentProvider(ctx, { provider: "pesapal", consumerKey: "ck_live_1234", consumerSecret: "cs-secret", environment: "sandbox" }));

    let view = await withPrincipal(owner(), (ctx) => getPaymentSettings(ctx));
    expect(view.source).toBe("business");
    expect(view.providers.filter((p) => p.enabled).sort((a, b) => a.position! - b.position!).map((p) => p.id)).toEqual(["tuma", "paystack", "pesapal"]);
    const json = JSON.stringify(view);
    expect(json).not.toContain("tuma-secret-key-1234");
    expect(json).not.toContain(PS_SECRET);
    expect(json).not.toContain("cs-secret");
    expect(view.providers.find((p) => p.id === "paystack")!.hint).toBe("…ders");

    // The stored row is encrypted.
    const stored = await getDb().query.tenantIntegrations.findFirst({
      where: and(eq(schema.tenantIntegrations.tenantId, tenantId), eq(schema.tenantIntegrations.kind, "payments")),
    });
    expect(stored!.configEncrypted).not.toContain(PS_SECRET);

    // Paystack first, Tuma second, then switch Pesapal off and back on.
    await withPrincipal(owner(), (ctx) => movePaymentProvider(ctx, "paystack", -1));
    await withPrincipal(owner(), (ctx) => setPaymentProviderEnabled(ctx, "pesapal", false));
    view = await withPrincipal(owner(), (ctx) => getPaymentSettings(ctx));
    expect(view.providers.filter((p) => p.enabled).sort((a, b) => a.position! - b.position!).map((p) => p.id)).toEqual(["paystack", "tuma"]);
    await withPrincipal(owner(), (ctx) => setPaymentProviderEnabled(ctx, "pesapal", true));
  });

  it("uses the first provider that can do it: Paystack prompts via the Charge API", async () => {
    const bookingId = await newBooking();
    const r = await withPrincipal(owner(), (ctx) => requestPayment(ctx, { bookingId, mode: "stk" }));
    expect(r.provider).toBe("paystack");
    expect(r.fallbacks).toEqual([]);
    expect(r.payment).toMatchObject({ method: "mpesa", provider: "paystack", status: "pending", phone: customerPhone });
    const charge = calls.filter((c) => c.url.endsWith("api.paystack.co/charge")).pop()!;
    expect(charge.body).toMatchObject({ currency: "KES", amount: r.payment.amountKes * 100 });
  });

  it("falls back to the next provider when the first is down, and keeps the failed attempt on record", async () => {
    gateway.paystackFails = true;
    try {
      const bookingId = await newBooking();
      const r = await withPrincipal(owner(), (ctx) => requestPayment(ctx, { bookingId, mode: "stk" }));
      expect(r.provider).toBe("tuma");
      expect(r.customerMessage).toBe("Tuma prompt sent");
      expect(r.fallbacks).toEqual([{ provider: "paystack", error: "Paystack is down" }]);

      const rows = await getDb().query.payments.findMany({ where: eq(schema.payments.bookingId, bookingId) });
      expect(rows.map((p) => `${p.provider}:${p.status}`).sort()).toEqual(["paystack:failed", "tuma:pending"]);

      // Tuma's own callback still settles the fallback payment.
      const paid = await withPrincipal(system(), (ctx) =>
        handleStkCallback(ctx, {
          result_code: 0,
          status: "completed",
          checkout_request_id: r.payment.mpesaCheckoutRequestId,
          mpesa_receipt_number: "TUMA1",
          amount: r.payment.amountKes,
        }),
      );
      expect(paid).toMatchObject({ status: "succeeded", provider: "tuma", mpesaReceipt: "TUMA1" });
      expect((await bookingRow(bookingId))!.status).toBe("confirmed");
    } finally {
      gateway.paystackFails = false;
    }
  });

  it("reports every failure when no provider works", async () => {
    gateway.paystackFails = gateway.tumaFails = true;
    try {
      const bookingId = await newBooking();
      await expect(withPrincipal(owner(), (ctx) => requestPayment(ctx, { bookingId, mode: "stk" }))).rejects.toThrow(/Every payment provider failed.*Paystack.*Tuma/);
      // The error rolls the attempt rows back, so what survives is the integrations log entry saying why.
      expect(await getDb().query.payments.findMany({ where: eq(schema.payments.bookingId, bookingId) })).toHaveLength(0);
      const log = await getDb().query.integrationsLog.findMany({ where: and(eq(schema.integrationsLog.tenantId, tenantId), eq(schema.integrationsLog.kind, "payments")) });
      const entry = log.find((l) => (l.request as { bookingId?: string }).bookingId === bookingId)!;
      expect(entry.ok).toBe(false);
      expect(entry.error).toMatch(/paystack: Paystack is down; tuma: Tuma is down/);
    } finally {
      gateway.paystackFails = gateway.tumaFails = false;
    }
  });

  it("settles a Paystack M-Pesa payment from a signed webhook, once, and rejects a forged one", async () => {
    const bookingId = await newBooking();
    const r = await withPrincipal(owner(), (ctx) => requestPayment(ctx, { bookingId, mode: "stk" }));
    const ref = r.payment.providerRef!;
    const body = JSON.stringify({
      event: "charge.success",
      data: { id: 777, reference: ref, status: "success", amount: r.payment.amountKes * 100, currency: "KES", channel: "mobile_money", gateway_response: "Success" },
    });

    await expect(withPrincipal(system(), (ctx) => handlePaystackWebhook(ctx, body, "bad-signature"))).rejects.toThrow(/signature/i);
    await expect(withPrincipal(system(), (ctx) => handlePaystackWebhook(ctx, body, null))).rejects.toThrow(/signature/i);
    expect((await paymentRow(r.payment.id))!.status).toBe("pending");

    const paid = await withPrincipal(system(), (ctx) => handlePaystackWebhook(ctx, body, sign(body)));
    expect(paid).toMatchObject({ status: "succeeded", method: "mpesa", mpesaReceipt: "PSK777" });
    expect((await bookingRow(bookingId))!.status).toBe("confirmed");

    // A repeated delivery changes nothing.
    await withPrincipal(system(), (ctx) => handlePaystackWebhook(ctx, body, sign(body)));
    const audits = await getDb().query.auditLog.findMany({ where: and(eq(schema.auditLog.tenantId, tenantId), eq(schema.auditLog.entityId, r.payment.id), eq(schema.auditLog.action, "payment.mpesa_callback")) });
    expect(audits).toHaveLength(1);
  });

  it("marks a Paystack payment failed on charge.failed and ignores events it does not use", async () => {
    const bookingId = await newBooking();
    const r = await withPrincipal(owner(), (ctx) => requestPayment(ctx, { bookingId, mode: "stk" }));
    const body = JSON.stringify({ event: "charge.failed", data: { reference: r.payment.providerRef, gateway_response: "Declined" } });
    await withPrincipal(system(), (ctx) => handlePaystackWebhook(ctx, body, sign(body)));
    expect((await paymentRow(r.payment.id))!.status).toBe("failed");

    const other = JSON.stringify({ event: "transfer.success", data: { reference: "x" } });
    expect(await withPrincipal(system(), (ctx) => handlePaystackWebhook(ctx, other, sign(other)))).toBeNull();
  });

  it("does not settle a payment the business never made, and does not cross businesses", async () => {
    const body = JSON.stringify({ event: "charge.success", data: { id: 1, reference: "NOPE", status: "success", amount: 100, currency: "KES", channel: "card" } });
    expect(await withPrincipal(system(), (ctx) => handlePaystackWebhook(ctx, body, sign(body)))).toBeNull();
    const log = await getDb().query.integrationsLog.findMany({ where: and(eq(schema.integrationsLog.tenantId, tenantId), eq(schema.integrationsLog.kind, "paystack")) });
    expect(log.some((l) => l.error === "Unknown payment reference")).toBe(true);
  });

  it("does not book a success in another currency as KES", async () => {
    const bookingId = await newBooking();
    const r = await withPrincipal(owner(), (ctx) => requestPayment(ctx, { bookingId, mode: "stk" }));
    const body = JSON.stringify({ event: "charge.success", data: { id: 5, reference: r.payment.providerRef, status: "success", amount: 5000, currency: "USD", channel: "card" } });
    await withPrincipal(system(), (ctx) => handlePaystackWebhook(ctx, body, sign(body)));
    expect((await paymentRow(r.payment.id))!.status).toBe("pending");
    expect((await bookingRow(bookingId))!.status).toBe("hold");
  });

  it("makes a Paystack card link first, and falls back to Pesapal when Paystack is down", async () => {
    const a = await newBooking();
    const first = await withPrincipal(owner(), (ctx) => requestPayment(ctx, { bookingId: a, mode: "link" }));
    expect(first.provider).toBe("paystack");
    expect(first.payment).toMatchObject({ method: "card", status: "pending" });
    expect(first.url).toBe(`https://checkout.paystack.com/${first.payment.providerRef}`);

    gateway.paystackFails = true;
    try {
      const b = await newBooking();
      const second = await withPrincipal(owner(), (ctx) => requestPayment(ctx, { bookingId: b, mode: "link" }));
      expect(second.provider).toBe("pesapal");
      expect(second.url).toBe(`https://pay.pesapal.com/pay/${second.payment.providerRef}`);
      expect(second.fallbacks).toEqual([{ provider: "paystack", error: "Paystack is down" }]);
    } finally {
      gateway.paystackFails = false;
    }
  });

  it("confirms a Pesapal payment only after reading its status back from Pesapal", async () => {
    gateway.paystackFails = true; // so the link comes from Pesapal
    let invoiceId = "";
    let paymentId = "";
    let ref = "";
    let bookingId = "";
    let amount = 0;
    try {
      bookingId = await newBooking();
      const r = await withPrincipal(owner(), (ctx) => requestPayment(ctx, { bookingId, mode: "link" }));
      expect(r.provider).toBe("pesapal");
      invoiceId = r.payment.invoiceId!;
      paymentId = r.payment.id;
      ref = r.payment.providerRef!;
      amount = r.payment.amountKes;
    } finally {
      gateway.paystackFails = false;
    }

    // Still open at Pesapal: nothing happens.
    gateway.pesapalStatus = 0;
    await withPrincipal(system(), (ctx) => handlePesapalIpn(ctx, new URLSearchParams({ OrderTrackingId: `trk-${ref}`, OrderMerchantReference: ref })));
    expect((await paymentRow(paymentId))!.status).toBe("pending");

    // A notification that names a different reference than Pesapal reports is rejected.
    gateway.pesapalStatus = 1;
    gateway.pesapalAmount = amount;
    await expect(
      withPrincipal(system(), (ctx) => handlePesapalIpn(ctx, new URLSearchParams({ OrderTrackingId: "trk-someone-elses", OrderMerchantReference: ref }))),
    ).rejects.toThrow(/mismatch/i);
    expect((await paymentRow(paymentId))!.status).toBe("pending");

    // Paid at Pesapal: settled, as a card payment, and the booking is confirmed.
    const paid = await withPrincipal(system(), (ctx) => handlePesapalIpn(ctx, new URLSearchParams({ OrderTrackingId: `trk-${ref}`, OrderMerchantReference: ref })));
    expect(paid).toMatchObject({ status: "succeeded", method: "card", mpesaReceipt: "PESA123", amountKes: amount });
    expect((await bookingRow(bookingId))!.status).toBe("confirmed");
    const detail = await withPrincipal(owner(), (ctx) => getInvoiceDetail(ctx, invoiceId));
    expect(detail.invoice.balanceKes).toBe(0);

    // An unknown reference is logged, not guessed at.
    expect(await withPrincipal(system(), (ctx) => handlePesapalIpn(ctx, new URLSearchParams({ OrderTrackingId: "trk-zzz", OrderMerchantReference: "zzz" })))).toBeNull();
  });

  it("sends one WhatsApp message with an M-Pesa button and a pay link, and the link opens a fresh payment", async () => {
    const bookingId = await newBooking();
    const sent = await withPrincipal(owner(), (ctx) => sendPaymentOptions(ctx, { bookingId }));
    expect(sent.kind).toBe("options");
    expect(sent.sent).toBe(true);
    expect(sent.payUrl).toMatch(new RegExp(`^https://app\\.example\\.test/pay/${slug}/[0-9a-f-]{36}$`));
    const invoiceId = sent.payUrl!.split("/").pop()!;

    const link = await withPrincipal(system(), (ctx) => paymentLinkForInvoice(ctx, invoiceId));
    expect(link.paid).toBe(false);
    expect(link.url).toContain("checkout.paystack.com");
    // Opening it again within minutes reuses the same payment instead of piling up rows.
    const again = await withPrincipal(system(), (ctx) => paymentLinkForInvoice(ctx, invoiceId));
    expect(again.url).toBe(link.url);
    const pendingLinks = await getDb().query.payments.findMany({ where: and(eq(schema.payments.invoiceId, invoiceId), eq(schema.payments.method, "card")) });
    expect(pendingLinks).toHaveLength(1);
  });

  it("answers the Pay with M-Pesa button: prompt to their own number only, link if the prompt cannot be sent", async () => {
    const bookingId = await newBooking();
    const sent = await withPrincipal(owner(), (ctx) => sendPaymentOptions(ctx, { bookingId }));
    const invoiceId = sent.payUrl!.split("/").pop()!;

    // Someone else's number cannot start a prompt from this invoice.
    const stranger = await withPrincipal(system(), (ctx) => payFromButton(ctx, { invoiceId, fromPhone: "+254700000001" }));
    expect(stranger.ok).toBe(false);
    expect(stranger.reply).toMatch(/isn't linked to this number/);
    expect(await getDb().query.payments.findMany({ where: and(eq(schema.payments.invoiceId, invoiceId), eq(schema.payments.method, "mpesa")) })).toHaveLength(0);

    // A made-up id is refused cleanly.
    expect((await withPrincipal(system(), (ctx) => payFromButton(ctx, { invoiceId: "not-an-id", fromPhone: customerPhone }))).ok).toBe(false);

    const ok = await withPrincipal(system(), (ctx) => payFromButton(ctx, { invoiceId, fromPhone: customerPhone }));
    expect(ok.ok).toBe(true);
    expect(ok.reply).toMatch(/M-Pesa prompt/);
    const prompt = (await getDb().query.payments.findMany({ where: and(eq(schema.payments.invoiceId, invoiceId), eq(schema.payments.method, "mpesa")) }))[0]!;
    expect(prompt).toMatchObject({ provider: "paystack", phone: customerPhone });

    // Every prompt provider down: the customer gets the link instead of silence.
    gateway.paystackFails = false;
    gateway.tumaFails = true;
    const down = await newBooking();
    const sent2 = await withPrincipal(owner(), (ctx) => sendPaymentOptions(ctx, { bookingId: down }));
    const invoice2 = sent2.payUrl!.split("/").pop()!;
    gateway.paystackFails = true;
    try {
      const fallback = await withPrincipal(system(), (ctx) => payFromButton(ctx, { invoiceId: invoice2, fromPhone: customerPhone }));
      expect(fallback.ok).toBe(true);
      expect(fallback.reply).toMatch(/pay here instead: https:\/\/pay\.pesapal\.com\//);
    } finally {
      gateway.paystackFails = false;
      gateway.tumaFails = false;
    }
  });
});
