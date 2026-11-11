import { and, eq, inArray, sql } from "drizzle-orm";
import { closeDb, getDb, loadEnv, schema } from "../packages/db/src/index";
import type { Payment } from "../packages/db/src/index";
import {
  createBooking,
  handleStkCallback,
  initiateStk,
  netPaidForBooking,
  staffPrincipal,
  systemPrincipal,
  withPrincipal,
} from "../packages/services/src/index";
import { addDays, dateKey, nairobiTime } from "../packages/services/src/tz";

/**
 * Phase 2 smoke / acceptance harness for M-Pesa.
 *
 *   MPESA_MODE=mock  pnpm smoke:mpesa --mock     # offline dry run, no STK prompt
 *   MPESA_MODE=tuma  pnpm smoke:mpesa --phone 2547... --amount 1
 *
 * Real mode sends one STK push to the phone, waits for the provider callback to
 * reach the running web app, then replays the callback and asserts exactly one
 * payment. The booking is created on a far-future date under the demo tenant and
 * removed afterwards unless --keep is passed.
 *
 * The callback URL must resolve to the web app and to the same tenant, i.e.
 * https://<host>/api/mpesa/callback?tenant=palda (or omit ?tenant and set
 * DEFAULT_TENANT_SLUG=palda).
 */

type Args = {
  mock: boolean;
  keep: boolean;
  phone: string | null;
  amount: number | null;
  waitSeconds: number;
  tenant: string;
};

function parseArgs(argv: string[]): Args {
  const args: Args = {
    mock: false,
    keep: false,
    phone: process.env.MPESA_SMOKE_PHONE ?? null,
    amount: null,
    waitSeconds: 120,
    tenant: process.env.DEFAULT_TENANT_SLUG ?? "palda",
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    const next = () => {
      const value = argv[i + 1];
      if (!value || value.startsWith("--")) throw new Error(`${arg} needs a value`);
      i += 1;
      return value;
    };
    if (arg === "--mock") args.mock = true;
    else if (arg === "--keep") args.keep = true;
    else if (arg === "--phone") args.phone = next();
    else if (arg === "--tenant") args.tenant = next();
    else if (arg === "--amount") args.amount = Number(next());
    else if (arg === "--wait") args.waitSeconds = Number(next());
    else if (arg === "--help" || arg === "-h") {
      console.log(
        [
          "Usage: pnpm smoke:mpesa [--mock] [--phone 2547...] [--amount 1]",
          "                      [--wait 120] [--tenant palda] [--keep]",
          "",
          "  --mock    offline dry run (MPESA_MODE must be mock)",
          "  --keep    keep the smoke booking/payment/audit rows",
        ].join("\n"),
      );
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (args.amount !== null && (!Number.isFinite(args.amount) || args.amount <= 0)) {
    throw new Error("--amount must be a positive integer (KES)");
  }
  return args;
}

function normalisePhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.startsWith("254")) return digits;
  if (digits.startsWith("0")) return `254${digits.slice(1)}`;
  if (digits.length === 9 && digits.startsWith("7")) return `254${digits}`;
  return digits;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function nairobiHhMm(hour: number, minute: number): string {
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

const mode = (): string => (process.env.MPESA_MODE ?? "mock").toLowerCase();

const callbackUrl = (): string | undefined =>
  process.env.TUMA_CALLBACK_URL || process.env.MPESA_CALLBACK_URL;

const owner = (tenantId: string) => staffPrincipal(tenantId, "mpesa-smoke", "owner");
const callbackPrincipal = (tenantId: string) =>
  systemPrincipal(tenantId, "mpesa-smoke-callback");

/** Real Tuma flow needs a phone and a public HTTPS callback that reaches this tenant. */
function preflight(args: Args, tenantSlug: string): void {
  if (mode() === "mock") {
    if (!args.mock) {
      throw new Error(
        "MPESA_MODE=mock. Pass --mock for an offline dry run, or set MPESA_MODE=tuma with TUMA_EMAIL/TUMA_API_KEY for the real gate.",
      );
    }
    console.log("Mode: mock (offline dry run — no STK prompt is sent)");
    return;
  }

  if (!args.phone) {
    throw new Error(
      "Real mode needs the phone that will approve the STK prompt: --phone 2547XXXXXXXX (or MPESA_SMOKE_PHONE).",
    );
  }
  const phone = normalisePhone(args.phone);
  if (!/^254\d{9}$/.test(phone)) {
    throw new Error(`--phone must be a Kenyan number in the form 2547XXXXXXXX (got ${args.phone}).`);
  }

  const url = callbackUrl();
  if (!url) throw new Error("Set TUMA_CALLBACK_URL (or MPESA_CALLBACK_URL) to the public callback URL.");
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Callback URL is not a valid URL: ${url}`);
  }
  if (parsed.protocol !== "https:") {
    throw new Error(`Callback URL must be public https:// — got ${url}`);
  }
  if (["localhost", "127.0.0.1", "::1"].includes(parsed.hostname)) {
    throw new Error(`Callback URL points at localhost; the provider cannot reach it: ${url}`);
  }
  const callbackTenant = parsed.searchParams.get("tenant");
  if (callbackTenant && callbackTenant !== tenantSlug) {
    throw new Error(
      `Callback URL selects tenant "${callbackTenant}" but the smoke run uses "${tenantSlug}". Align them or omit ?tenant (DEFAULT_TENANT_SLUG applies).`,
    );
  }
  console.log(`Mode: ${mode()}`);
  console.log(`Callback: ${url}`);
  if ((args.amount ?? 1) > 100) {
    console.log(
      "Note: Tuma sandbox accounts reject amounts above KES 100. Pass --amount 1 unless this account is live.",
    );
  }
}

function darajaPayload(payment: Payment, phone: string, receipt: string): Record<string, unknown> {
  return {
    Body: {
      stkCallback: {
        MerchantRequestID: payment.mpesaCheckoutRequestId ?? payment.id,
        CheckoutRequestID: payment.mpesaCheckoutRequestId,
        ResultCode: 0,
        ResultDesc: "The service request is processed successfully.",
        CallbackMetadata: {
          Item: [
            { Name: "Amount", Value: payment.amountKes },
            { Name: "MpesaReceiptNumber", Value: receipt },
            { Name: "PhoneNumber", Value: normalisePhone(phone) },
          ],
        },
      },
    },
  };
}

function tumaPayload(payment: Payment, phone: string, receipt: string): Record<string, unknown> {
  return {
    result_code: 0,
    status: "completed",
    merchant_request_id: payment.mpesaCheckoutRequestId ?? payment.id,
    checkout_request_id: payment.mpesaCheckoutRequestId,
    mpesa_receipt_number: receipt,
    amount: payment.amountKes,
    phone: normalisePhone(phone),
    timestamp: new Date().toISOString(),
    result_desc: "Payment successful",
  };
}

function providerPayload(payment: Payment, phone: string, receipt: string): Record<string, unknown> {
  return mode() === "tuma" ? tumaPayload(payment, phone, receipt) : darajaPayload(payment, phone, receipt);
}

async function findPayment(tenantId: string, paymentId: string): Promise<Payment> {
  const payment = await withPrincipal(owner(tenantId), (ctx) =>
    ctx.db.query.payments.findFirst({ where: eq(schema.payments.id, paymentId) }),
  );
  if (!payment) throw new Error(`Payment ${paymentId} disappeared`);
  return payment;
}

async function waitForCallback(
  tenantId: string,
  paymentId: string,
  waitSeconds: number,
): Promise<Payment> {
  const deadline = Date.now() + waitSeconds * 1000;
  process.stdout.write("Waiting for the provider callback");
  while (Date.now() < deadline) {
    const payment = await findPayment(tenantId, paymentId);
    if (payment.status !== "pending") {
      process.stdout.write("\n");
      return payment;
    }
    process.stdout.write(".");
    await sleep(3000);
  }
  process.stdout.write("\n");
  throw new Error(
    `No callback within ${waitSeconds}s. Check: (1) the web app is running, (2) ${callbackUrl()} reaches it over HTTPS, (3) the callback's tenant matches "${tenantId}".`,
  );
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  const realMode = mode() !== "mock";
  preflight(args, args.tenant);

  const db = getDb();
  const tenant = await db.query.tenants.findFirst({
    where: eq(schema.tenants.slug, args.tenant),
  });
  if (!tenant) {
    throw new Error(`Tenant "${args.tenant}" not found. Run pnpm db:seed (or pass --tenant).`);
  }

  const offering = await db.query.offerings.findFirst({
    where: and(eq(schema.offerings.tenantId, tenant.id), eq(schema.offerings.active, true)),
  });
  const resource = await db.query.resources.findFirst({
    where: and(
      eq(schema.resources.tenantId, tenant.id),
      eq(schema.resources.active, true),
      eq(schema.resources.kind, "space"),
    ),
  });
  const customer = await db.query.customers.findFirst({
    where: eq(schema.customers.tenantId, tenant.id),
  });
  if (!offering || !resource || !customer) {
    throw new Error(`Tenant "${args.tenant}" has no active offering/space/customer to book against.`);
  }

  const phone = normalisePhone(args.phone ?? customer.phoneE164);
  if (!/^254\d{9}$/.test(phone)) {
    throw new Error(`Customer phone "${phone}" is not a usable Kenyan number; pass --phone.`);
  }
  const amount = args.amount ?? 1;

  // Far-future starts keep the smoke away from seeded bookings; retry once if
  // the random slot happens to collide on the exclusion constraint.
  let bookingId = "";
  for (let attempt = 0; attempt < 5 && !bookingId; attempt += 1) {
    const startKey = addDays(dateKey(new Date()), 400 + Math.floor(Math.random() * 30));
    const hour = 10 + Math.floor(Math.random() * 5);
    const minute = Math.floor(Math.random() * 60);
    try {
      const created = await withPrincipal(owner(tenant.id), (ctx) =>
        createBooking(ctx, {
          customerId: customer.id,
          offeringId: offering.id,
          resourceIds: [resource.id],
          startsAt: nairobiTime(startKey, nairobiHhMm(hour, minute)).toISOString(),
          endsAt: nairobiTime(startKey, nairobiHhMm(hour + 2, minute)).toISOString(),
          partySize: 4,
          status: "hold",
          source: "staff",
          attributes: { eventType: "other" },
        }),
      );
      bookingId = created.booking.id;
      console.log(
        `Booking: ${bookingId} (${startKey} ${nairobiHhMm(hour, minute)} Nairobi, deposit KES ${created.booking.depositRequiredKes})`,
      );
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code !== "SLOT_UNAVAILABLE" || attempt === 4) throw error;
    }
  }

  let paymentId = "";
  let checkoutRequestId = "";
  let passed = false;
  try {
    const started = await withPrincipal(owner(tenant.id), (ctx) =>
      initiateStk(ctx, { bookingId, phone, amountKes: amount }),
    );
    paymentId = started.payment.id;
    checkoutRequestId = started.payment.mpesaCheckoutRequestId ?? "";
    console.log(`STK: KES ${amount} to +${phone} — ${started.mocked ? "mock" : "sent"}`);
    console.log(`Checkout: ${checkoutRequestId}`);
    console.log(`Payment: ${paymentId}`);
    if (realMode) {
      console.log("Enter your M-Pesa PIN. Do not cancel three times — Tuma can block the number.");
    }

    // In mock mode no provider calls us, so drive the same service path a real
    // callback would use.
    if (!realMode) {
      const payload = providerPayload(started.payment, phone, `SMOKE${Date.now().toString().slice(-9)}`);
      await withPrincipal(callbackPrincipal(tenant.id), (ctx) => handleStkCallback(ctx, payload));
    }

    const settled = realMode
      ? await waitForCallback(tenant.id, paymentId, args.waitSeconds)
      : await findPayment(tenant.id, paymentId);

    if (settled.status !== "succeeded") {
      throw new Error(
        `Payment ${settled.id} ended "${settled.status}" instead of succeeded. Reason: ${JSON.stringify(settled.rawPayload)}`,
      );
    }
    console.log(`PASS  payment succeeded (receipt ${settled.mpesaReceipt ?? "none"}, KES ${settled.amountKes})`);

    // Replay exactly what the provider sent. A second call must not create a
    // second payment or change the net.
    const raw = settled.rawPayload as Record<string, unknown> | null;
    const replayPayload =
      realMode && raw && typeof raw === "object" && !("simulated" in raw) && !("mocked" in raw)
        ? raw
        : providerPayload(settled, phone, settled.mpesaReceipt ?? `SMOKE${Date.now()}`);
    const replay = await withPrincipal(callbackPrincipal(tenant.id), (ctx) =>
      handleStkCallback(ctx, replayPayload),
    );
    if (!replay || replay.id !== settled.id) {
      throw new Error(`Replay returned ${replay?.id ?? "null"} instead of payment ${settled.id}.`);
    }

    const rows = await withPrincipal(owner(tenant.id), (ctx) =>
      ctx.db.query.payments.findMany({
        where: and(
          eq(schema.payments.tenantId, tenant.id),
          eq(schema.payments.mpesaCheckoutRequestId, checkoutRequestId),
        ),
      }),
    );
    if (rows.length !== 1) throw new Error(`Expected 1 payment for ${checkoutRequestId}, found ${rows.length}.`);

    const net = await withPrincipal(owner(tenant.id), (ctx) => netPaidForBooking(ctx, bookingId));
    if (net !== settled.amountKes) {
      throw new Error(`Net paid is KES ${net}, expected KES ${settled.amountKes} after replay.`);
    }
    console.log(`PASS  replay was idempotent (1 payment, net KES ${net})`);

    const [auditCount] = await withPrincipal(owner(tenant.id), (ctx) =>
      ctx.db
        .select({ n: sql<number>`count(*)::int` })
        .from(schema.auditLog)
        .where(
          and(
            eq(schema.auditLog.tenantId, tenant.id),
            eq(schema.auditLog.action, "payment.mpesa_callback"),
            eq(schema.auditLog.entityId, settled.id),
          ),
        ),
    );
    if ((auditCount?.n ?? 0) !== 1) {
      throw new Error(`Expected 1 payment.mpesa_callback audit row, found ${auditCount?.n ?? 0}.`);
    }
    console.log("PASS  exactly one payment.mpesa_callback audit row");

    const booking = await withPrincipal(owner(tenant.id), (ctx) =>
      ctx.db.query.bookings.findFirst({ where: eq(schema.bookings.id, bookingId) }),
    );
    if (!booking) throw new Error(`Booking ${bookingId} disappeared during the smoke run.`);
    const expectedStatus = net >= booking.depositRequiredKes ? "confirmed" : "hold";
    if (booking.status !== expectedStatus) {
      throw new Error(`Booking status is "${booking.status}", expected "${expectedStatus}".`);
    }
    console.log(`PASS  booking stayed consistent (${booking.status})`);

    console.log(`\nResult: Phase 2 smoke PASSED in ${mode()} mode.`);
    passed = true;
    return 0;
  } finally {
    if (args.keep || !passed) {
      console.log(
        `\nKept booking ${bookingId || "(none)"} and payment ${paymentId || "(none)"} for inspection.`,
      );
    } else if (bookingId) {
      // Payments/invoices restrict booking deletion, so remove them first.
      // Audit rows for this run are evidence but belong to a smoke booking, so
      // they are removed with it (use --keep to preserve them).
      const auditIds = [bookingId, paymentId].filter(Boolean);
      await getDb()
        .delete(schema.auditLog)
        .where(and(eq(schema.auditLog.tenantId, tenant.id), inArray(schema.auditLog.entityId, auditIds)))
        .catch(() => undefined);
      await getDb()
        .delete(schema.payments)
        .where(and(eq(schema.payments.tenantId, tenant.id), eq(schema.payments.bookingId, bookingId)));
      await getDb()
        .delete(schema.invoices)
        .where(and(eq(schema.invoices.tenantId, tenant.id), eq(schema.invoices.bookingId, bookingId)))
        .catch(() => undefined);
      await getDb().delete(schema.bookings).where(eq(schema.bookings.id, bookingId));
      console.log("\nCleaned up the smoke booking and payment.");
    }
  }
}

try {
  loadEnv();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

main()
  .then(async (code) => {
    await closeDb();
    process.exit(code);
  })
  .catch(async (error) => {
    console.error(`\nFAIL  ${error instanceof Error ? error.message : String(error)}`);
    await closeDb();
    process.exit(1);
  });
