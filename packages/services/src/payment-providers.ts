import { and, desc, eq, gte } from "drizzle-orm";
import { schema, withTenant } from "@garden/db";
import type { Booking, Customer, Invoice, Payment } from "@garden/db";
import {
  PAYMENT_PROVIDERS,
  PAY_BUTTON_PREFIX,
  PAY_TEMPLATE_LINK,
  PAY_TEMPLATE_OPTIONS,
  PaymentProviderError,
  createMessageTemplate,
  decryptJson,
  encryptJson,
  getMessageTemplateStatus,
  initiateStkPush,
  initiateTumaStk,
  mpesaMode,
  parsePaystackEvent,
  parsePesapalIpn,
  paystackChannel,
  paystackChargeMpesa,
  paystackCreateLink,
  payerEmail,
  pesapalCreateLink,
  pesapalToParsed,
  pesapalTransactionStatus,
  randomToken,
  verifyPaystackSignature,
  whatsappMode,
  type ParsedCallback,
  type PaymentProviderId,
  type PaystackCreds,
  type PesapalCreds,
  type TumaCreds,
} from "@garden/integrations";
import { audit, getSettings, type ServiceContext } from "./context";
import { generateInvoice } from "./invoices";
import { sendProactiveButtons, sendFreeform } from "./notify";
import { applySuccessfulCallback, scopedBooking } from "./payments";
import { getWhatsappConnection, getWhatsappCreds } from "./whatsapp-connect";
import { formatNairobi } from "./tz";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  PolicyError,
  ValidationError,
  requireOwner,
} from "./types";

/**
 * Payment providers, per business. A business enables any of Tuma, Paystack and Pesapal, puts them in order, and the first one
 * that can do what is asked is used. If it fails, the next one is tried (the fallback). Each attempt is its own payment row, so when a
 * later provider works the failed attempts stay on record. If every provider fails the error rolls the rows back, and the failure
 * is kept in the integrations log instead.
 *
 * Credentials are stored encrypted, one row per business in `tenant_integrations` (kind "payments"). A business with no row
 * uses the platform's own M-Pesa setup from the environment, but only in mock mode or for the default business, so one
 * business's customers never pay into another business's account.
 */

type StoredConfig = { tuma?: TumaCreds; paystack?: PaystackCreds; pesapal?: PesapalCreds };
type PaymentMeta = { enabled: PaymentProviderId[]; templates?: Record<string, string> };

const ALL: PaymentProviderId[] = ["tuma", "paystack", "pesapal"];
const isProvider = (v: unknown): v is PaymentProviderId => typeof v === "string" && (ALL as string[]).includes(v);

export type PaymentConfig = {
  /** In the order they are tried. */
  enabled: PaymentProviderId[];
  creds: StoredConfig;
  /** "platform": no business setup, the environment's M-Pesa account is used. */
  source: "business" | "platform" | "none";
  templates: Record<string, string>;
};

async function row(ctx: ServiceContext) {
  return ctx.db.query.tenantIntegrations.findFirst({
    where: and(eq(schema.tenantIntegrations.tenantId, ctx.tenantId), eq(schema.tenantIntegrations.kind, "payments")),
  });
}

export async function loadPaymentConfig(ctx: ServiceContext): Promise<PaymentConfig> {
  const r = await row(ctx);
  if (r) {
    let creds: StoredConfig = {};
    try {
      creds = decryptJson<StoredConfig>(r.configEncrypted);
    } catch {
      creds = {};
    }
    const meta = r.meta as Partial<PaymentMeta>;
    const enabled = (Array.isArray(meta.enabled) ? meta.enabled : []).filter(isProvider).filter((p) => Boolean(creds[p]));
    return { enabled, creds, source: "business", templates: meta.templates ?? {} };
  }
  const tenant = await ctx.db.query.tenants.findFirst({ where: eq(schema.tenants.id, ctx.tenantId) });
  const isDefault = tenant?.slug === (process.env.DEFAULT_TENANT_SLUG ?? "palda");
  if (mpesaMode() === "mock" || isDefault) return { enabled: ["tuma"], creds: {}, source: "platform", templates: {} };
  return { enabled: [], creds: {}, source: "none", templates: {} };
}

async function writeConfig(ctx: ServiceContext, creds: StoredConfig, meta: PaymentMeta): Promise<void> {
  await ctx.db
    .insert(schema.tenantIntegrations)
    .values({ tenantId: ctx.tenantId, kind: "payments", configEncrypted: encryptJson(creds), meta })
    .onConflictDoUpdate({
      target: [schema.tenantIntegrations.tenantId, schema.tenantIntegrations.kind],
      set: { configEncrypted: encryptJson(creds), meta },
    });
}

/* ───────────────────────────── what the settings page shows ───────────────────────────── */

export type ProviderView = {
  id: PaymentProviderId;
  label: string;
  blurb: string;
  stk: boolean;
  link: boolean;
  configured: boolean;
  enabled: boolean;
  /** 1 = tried first. */
  position: number | null;
  /** Last four characters of the main key, never the key. */
  hint: string | null;
  environment: string | null;
};

const tail = (v: string | undefined) => (v && v.length > 4 ? `…${v.slice(-4)}` : v ? "…" : null);

export async function getPaymentSettings(ctx: ServiceContext): Promise<{
  providers: ProviderView[];
  source: PaymentConfig["source"];
  templates: Record<string, string>;
}> {
  const cfg = await loadPaymentConfig(ctx);
  const providers = ALL.map((id): ProviderView => {
    const c = cfg.creds[id];
    const position = cfg.enabled.indexOf(id);
    const hint = id === "tuma" ? tail(cfg.creds.tuma?.apiKey) : id === "paystack" ? tail(cfg.creds.paystack?.secretKey) : tail(cfg.creds.pesapal?.consumerKey);
    return {
      id,
      ...PAYMENT_PROVIDERS[id],
      configured: Boolean(c) || (cfg.source === "platform" && id === "tuma"),
      enabled: position >= 0,
      position: position >= 0 ? position + 1 : null,
      hint,
      environment: id === "pesapal" ? (cfg.creds.pesapal?.environment ?? null) : null,
    };
  });
  return { providers, source: cfg.source, templates: cfg.templates };
}

/* ───────────────────────────── connecting a provider ───────────────────────────── */

export type ProviderCredentialsInput =
  | { provider: "tuma"; email: string; apiKey: string }
  | { provider: "paystack"; secretKey: string }
  | { provider: "pesapal"; consumerKey: string; consumerSecret: string; environment: "sandbox" | "live" };

/** Saves one provider's keys (owner only), checks them with the provider, and enables it at the end of the order. */
export async function savePaymentProvider(ctx: ServiceContext, input: ProviderCredentialsInput): Promise<void> {
  requireOwner(ctx.principal);
  const cfg = await loadPaymentConfig(ctx);
  const creds: StoredConfig = cfg.source === "business" ? { ...cfg.creds } : {};
  const need = (v: string, what: string) => {
    if (!v.trim()) throw new ValidationError(`${what} is required.`);
    return v.trim();
  };

  if (input.provider === "tuma") {
    creds.tuma = { email: need(input.email, "The Tuma email"), apiKey: need(input.apiKey, "The Tuma API key") };
  } else if (input.provider === "paystack") {
    const secretKey = need(input.secretKey, "The Paystack secret key");
    if (!/^sk_(test|live)_/.test(secretKey)) throw new ValidationError("That doesn't look like a Paystack secret key (it starts with sk_test_ or sk_live_).");
    creds.paystack = { secretKey };
  } else {
    creds.pesapal = {
      consumerKey: need(input.consumerKey, "The Pesapal consumer key"),
      consumerSecret: need(input.consumerSecret, "The Pesapal consumer secret"),
      environment: input.environment === "live" ? "live" : "sandbox",
    };
  }

  if (mpesaMode() !== "mock") {
    try {
      await checkCredentials(input.provider, creds);
    } catch (error) {
      throw new ValidationError(
        `${PAYMENT_PROVIDERS[input.provider].label} didn't accept those keys${error instanceof Error && error.message ? `: ${error.message}` : "."}`,
      );
    }
  }

  const enabled = cfg.source === "business" ? [...cfg.enabled] : [];
  if (!enabled.includes(input.provider)) enabled.push(input.provider);
  await writeConfig(ctx, creds, { enabled, templates: cfg.templates });
  await audit(ctx, "payments.provider_saved", "tenant_integration", null, { provider: input.provider });
}

async function checkCredentials(provider: PaymentProviderId, creds: StoredConfig): Promise<void> {
  if (provider === "tuma" && creds.tuma) {
    // A throwaway call that only proves the login works.
    await initiateTumaStk({ phone: "", amountKes: 1, description: "check" }, creds.tuma).catch((e) => {
      if (e instanceof Error && /credentials|authenticate|api key|unauthor/i.test(e.message)) throw e;
    });
  } else if (provider === "paystack" && creds.paystack) {
    const res = await fetch("https://api.paystack.co/balance", { headers: { Authorization: `Bearer ${creds.paystack.secretKey}` } });
    if (!res.ok) throw new Error("the secret key was rejected.");
  } else if (provider === "pesapal" && creds.pesapal) {
    await pesapalTransactionStatus(creds.pesapal, "00000000-0000-0000-0000-000000000000").catch((e) => {
      // A well-formed unknown id is an error from Pesapal, but only after the login worked.
      if (e instanceof PaymentProviderError && /consumer|credential|token|unauthor|sign in/i.test(e.message)) throw e;
    });
  }
}

async function mutateOrder(ctx: ServiceContext, change: (enabled: PaymentProviderId[]) => PaymentProviderId[]): Promise<void> {
  requireOwner(ctx.principal);
  const cfg = await loadPaymentConfig(ctx);
  if (cfg.source !== "business") throw new ValidationError("Connect a payment provider first.");
  await writeConfig(ctx, cfg.creds, { enabled: change([...cfg.enabled]), templates: cfg.templates });
}

export async function setPaymentProviderEnabled(ctx: ServiceContext, provider: PaymentProviderId, on: boolean): Promise<void> {
  const cfg = await loadPaymentConfig(ctx);
  if (on && !cfg.creds[provider]) throw new ValidationError("Add the keys for this provider first.");
  await mutateOrder(ctx, (e) => (on ? (e.includes(provider) ? e : [...e, provider]) : e.filter((p) => p !== provider)));
  await audit(ctx, on ? "payments.provider_enabled" : "payments.provider_disabled", "tenant_integration", null, { provider });
}

/** Moves a provider one place earlier (-1) or later (+1) in the order they are tried. */
export async function movePaymentProvider(ctx: ServiceContext, provider: PaymentProviderId, direction: -1 | 1): Promise<void> {
  await mutateOrder(ctx, (e) => {
    const i = e.indexOf(provider);
    const j = i + direction;
    if (i < 0 || j < 0 || j >= e.length) return e;
    [e[i], e[j]] = [e[j]!, e[i]!];
    return e;
  });
  await audit(ctx, "payments.provider_moved", "tenant_integration", null, { provider, direction });
}

export async function removePaymentProvider(ctx: ServiceContext, provider: PaymentProviderId): Promise<void> {
  requireOwner(ctx.principal);
  const cfg = await loadPaymentConfig(ctx);
  if (cfg.source !== "business") return;
  const creds = { ...cfg.creds };
  delete creds[provider];
  await writeConfig(ctx, creds, { enabled: cfg.enabled.filter((p) => p !== provider), templates: cfg.templates });
  await audit(ctx, "payments.provider_removed", "tenant_integration", null, { provider });
}

/* ───────────────────────────── asking a customer to pay ───────────────────────────── */

export type PaymentMode = "stk" | "link";

type Payable = { booking: Booking; customer: Customer; invoice: Invoice | null; amountKes: number };

async function resolvePayable(
  ctx: ServiceContext,
  input: { bookingId: string; invoiceId?: string; amountKes?: number },
): Promise<Payable> {
  const booking = await scopedBooking(ctx, input.bookingId);
  const customer = await ctx.db.query.customers.findFirst({ where: eq(schema.customers.id, booking.customerId) });
  if (!customer) throw new NotFoundError("Customer", booking.customerId);

  let invoice: Invoice | null = null;
  let amount = input.amountKes;
  if (input.invoiceId) {
    invoice =
      (await ctx.db.query.invoices.findFirst({
        where: and(eq(schema.invoices.id, input.invoiceId), eq(schema.invoices.tenantId, ctx.tenantId)),
      })) ?? null;
    if (!invoice) throw new NotFoundError("Invoice", input.invoiceId);
    if (!amount) amount = invoice.balanceKes;
  } else if (!amount) {
    invoice = await generateInvoice(ctx, { bookingId: booking.id, kind: "deposit" }).catch(() =>
      generateInvoice(ctx, { bookingId: booking.id, kind: "balance" }),
    );
    amount = invoice.balanceKes;
  }
  if (!amount || amount <= 0) throw new ValidationError("Nothing to pay on this booking.");
  return { booking, customer, invoice, amountKes: amount };
}

const appUrl = () => (process.env.APP_URL ?? "http://localhost:3000").replace(/\/+$/, "");

async function tenantSlug(ctx: ServiceContext): Promise<string> {
  const t = await ctx.db.query.tenants.findFirst({ where: eq(schema.tenants.id, ctx.tenantId) });
  if (!t) throw new NotFoundError("Business", ctx.tenantId);
  return t.slug;
}

/** Cheap read of what the enabled providers can do, to choose between WhatsApp message styles. */
export async function paymentCapabilities(ctx: ServiceContext): Promise<{ stk: boolean; link: boolean }> {
  const cfg = await loadPaymentConfig(ctx);
  return {
    stk: cfg.enabled.some((p) => PAYMENT_PROVIDERS[p].stk),
    link: cfg.enabled.some((p) => PAYMENT_PROVIDERS[p].link),
  };
}

export type PaymentRequestResult = {
  payment: Payment;
  provider: PaymentProviderId;
  customerMessage: string;
  /** Present for a link payment. */
  url: string | null;
  mocked: boolean;
  /** Providers that failed before this one worked, in order. Empty when the first choice succeeded. */
  fallbacks: { provider: PaymentProviderId; error: string }[];
};

/**
 * Starts a payment with the first provider that can do it, falling back down the business's list when one fails.
 * `stk` sends an M-Pesa prompt to the customer's phone; `link` makes a hosted page they pay on.
 */
export async function requestPayment(
  ctx: ServiceContext,
  input: {
    bookingId: string;
    invoiceId?: string;
    amountKes?: number;
    phone?: string;
    mode: PaymentMode;
    /** Force one provider (no fallback). */
    provider?: PaymentProviderId;
  },
): Promise<PaymentRequestResult> {
  const { booking, customer, invoice, amountKes } = await resolvePayable(ctx, input);
  const phone = input.phone ?? customer.phoneE164;
  if (input.mode === "stk" && ctx.principal.type === "customer" && phone !== ctx.principal.phoneE164) {
    throw new ForbiddenError("Payment requests can only go to your own WhatsApp number.");
  }

  const cfg = await loadPaymentConfig(ctx);
  const capable = cfg.enabled.filter((p) => PAYMENT_PROVIDERS[p][input.mode]);
  const candidates = input.provider ? capable.filter((p) => p === input.provider) : capable;
  if (candidates.length === 0) {
    throw new ValidationError(
      input.mode === "stk"
        ? "No M-Pesa prompt provider is set up. Connect Tuma or Paystack in Integrations."
        : "No payment link provider is set up. Connect Paystack or Pesapal in Integrations.",
    );
  }

  // Reuse a payment link made in the last 20 minutes for the same amount, so tapping the button twice does not pile up rows.
  if (input.mode === "link" && invoice) {
    const recent = await ctx.db.query.payments.findFirst({
      where: and(
        eq(schema.payments.tenantId, ctx.tenantId),
        eq(schema.payments.invoiceId, invoice.id),
        eq(schema.payments.status, "pending"),
        eq(schema.payments.amountKes, amountKes),
        gte(schema.payments.createdAt, new Date(Date.now() - 20 * 60_000)),
      ),
      orderBy: desc(schema.payments.createdAt),
    });
    if (recent?.checkoutUrl && recent.provider && candidates.includes(recent.provider as PaymentProviderId)) {
      return {
        payment: recent,
        provider: recent.provider as PaymentProviderId,
        customerMessage: "Here is your payment link.",
        url: recent.checkoutUrl,
        mocked: mpesaMode() === "mock",
        fallbacks: [],
      };
    }
  }

  const slug = await tenantSlug(ctx);
  const email = payerEmail(customer.email, phone);
  const fallbacks: PaymentRequestResult["fallbacks"] = [];
  const label = invoice ? invoice.number : `BK${booking.id.slice(-6)}`;

  for (const provider of candidates) {
    const reference = provider === "tuma" ? null : `${label}-${randomToken(5)}`.replace(/[^A-Za-z0-9_.-]/g, "");
    const [pending] = await ctx.db
      .insert(schema.payments)
      .values({
        tenantId: ctx.tenantId,
        bookingId: booking.id,
        invoiceId: invoice?.id ?? null,
        method: input.mode === "stk" ? "mpesa" : "card",
        provider,
        providerRef: reference,
        amountKes,
        phone,
        status: "pending",
      })
      .returning();

    try {
      let customerMessage = "";
      let url: string | null = null;
      let mocked = false;
      let providerRef = reference ?? "";
      let checkoutId: string | null = null;
      let extra: Record<string, unknown> = {};

      if (provider === "tuma") {
        const creds = cfg.creds.tuma
          ? { ...cfg.creds.tuma, callbackUrl: cfg.creds.tuma.callbackUrl || `${appUrl()}/api/mpesa/callback?tenant=${slug}` }
          : null;
        const stkInput = { phone, amountKes, accountRef: invoice ? `INV${invoice.id.slice(-6)}` : `BK${booking.id.slice(-6)}`, description: "Booking payment" };
        const stk = creds && mpesaMode() !== "mock" ? await initiateTumaStk(stkInput, creds) : await initiateStkPush(stkInput);
        customerMessage = stk.customerMessage;
        mocked = stk.mocked;
        providerRef = stk.checkoutRequestId;
        checkoutId = stk.checkoutRequestId;
        extra = { merchantRequestId: stk.merchantRequestId };
      } else if (provider === "paystack" && input.mode === "stk") {
        const r = await paystackChargeMpesa(cfg.creds.paystack!, { reference: reference!, amountKes, email, phone, metadata: { invoice: invoice?.number ?? null } });
        customerMessage = r.customerMessage;
        mocked = r.mocked;
        providerRef = r.reference;
      } else if (provider === "paystack") {
        const r = await paystackCreateLink(cfg.creds.paystack!, { reference: reference!, amountKes, email, metadata: { invoice: invoice?.number ?? null } });
        customerMessage = "Here is your payment link.";
        url = r.url;
        mocked = r.mocked;
        providerRef = r.reference;
      } else {
        const r = await pesapalCreateLink(cfg.creds.pesapal!, {
          reference: reference!,
          amountKes,
          description: `Payment ${label}`,
          ipnUrl: `${appUrl()}/api/payments/pesapal?tenant=${slug}`,
          callbackUrl: `${appUrl()}/pay/${slug}/thanks`,
          phone,
          name: customer.name,
        });
        customerMessage = "Here is your payment link.";
        url = r.url;
        mocked = r.mocked;
        providerRef = r.reference;
      }

      // The demo checkout page needs to know the business to find the payment (every table is tenant-scoped).
      if (url && mocked) url = `${appUrl()}/pay/mock/${providerRef}?tenant=${slug}`;
      const [updated] = await ctx.db
        .update(schema.payments)
        .set({
          providerRef,
          mpesaCheckoutRequestId: checkoutId,
          checkoutUrl: url,
          rawPayload: { ...extra, mocked, ...(fallbacks.length ? { fallbackFrom: fallbacks } : {}) },
        })
        .where(eq(schema.payments.id, pending!.id))
        .returning();
      await audit(ctx, "payment.stk_initiated", "payment", pending!.id, { amountKes, provider, mode: input.mode, fallbacks: fallbacks.length });
      return { payment: updated!, provider, customerMessage, url, mocked, fallbacks };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await ctx.db
        .update(schema.payments)
        .set({ status: "failed", rawPayload: { error: message } })
        .where(eq(schema.payments.id, pending!.id));
      await audit(ctx, "payment.provider_failed", "payment", pending!.id, { provider, mode: input.mode, error: message.slice(0, 300) });
      fallbacks.push({ provider, error: message });
    }
  }

  // Throwing rolls back this transaction, attempt rows and all. The failure is written on its own connection first, so the
  // business can still see that payments failed and why (the secrets never appear in these messages).
  await withTenant(ctx.tenantId, (tx) =>
    tx.insert(schema.integrationsLog).values({
      tenantId: ctx.tenantId,
      kind: "payments",
      direction: "outbound",
      request: { mode: input.mode, bookingId: booking.id, invoiceId: invoice?.id ?? null, amountKes },
      response: { attempts: fallbacks },
      ok: false,
      error: fallbacks.map((f) => `${f.provider}: ${f.error}`).join("; ").slice(0, 1000),
    }),
  ).catch(() => undefined);

  const last = fallbacks[fallbacks.length - 1];
  throw new PaymentProviderError(
    fallbacks.length > 1
      ? `Every payment provider failed (${fallbacks.map((f) => `${PAYMENT_PROVIDERS[f.provider].label}: ${f.error}`).join("; ")}).`
      : (last?.error ?? "The payment could not be started."),
  );
}

/** Kept for existing callers: an M-Pesa prompt, with fallback. */
export async function initiateStk(
  ctx: ServiceContext,
  input: { bookingId: string; invoiceId?: string; phone?: string; amountKes?: number },
): Promise<{ payment: Payment; customerMessage: string; mocked: boolean }> {
  const r = await requestPayment(ctx, { ...input, mode: "stk" });
  return { payment: r.payment, customerMessage: r.customerMessage, mocked: r.mocked };
}

/* ───────────────────────────── confirming a payment ───────────────────────────── */

async function findByProviderRef(ctx: ServiceContext, provider: PaymentProviderId, ref: string): Promise<Payment | null> {
  return (
    (await ctx.db.query.payments.findFirst({
      where: and(eq(schema.payments.tenantId, ctx.tenantId), eq(schema.payments.provider, provider), eq(schema.payments.providerRef, ref)),
    })) ?? null
  );
}

async function settle(
  ctx: ServiceContext,
  provider: PaymentProviderId,
  parsed: ParsedCallback,
  method: "mpesa" | "card" | undefined,
): Promise<Payment | null> {
  const payment = await findByProviderRef(ctx, provider, parsed.checkoutRequestId);
  if (!payment) {
    await ctx.db.insert(schema.integrationsLog).values({
      tenantId: ctx.tenantId,
      kind: provider,
      direction: "inbound",
      request: parsed.raw,
      response: { matched: false },
      ok: false,
      error: "Unknown payment reference",
    });
    return null;
  }
  if (payment.status === "succeeded") return payment; // a repeated notification changes nothing
  if (!parsed.success) {
    const [failed] = await ctx.db
      .update(schema.payments)
      .set({ status: "failed", rawPayload: parsed.raw })
      .where(eq(schema.payments.id, payment.id))
      .returning();
    await audit(ctx, "payment.provider_failed", "payment", payment.id, { provider, resultDesc: parsed.resultDesc });
    return failed ?? null;
  }
  if (parsed.amountKes <= 0) {
    // A success we cannot value in KES (for example another currency) must not be booked as money received.
    await audit(ctx, "payment.provider_unverified", "payment", payment.id, { provider, resultDesc: parsed.resultDesc });
    return payment;
  }
  return applySuccessfulCallback(ctx, payment, parsed, { method });
}

/**
 * Paystack's `charge.success` webhook. The body is checked against the business's own secret key before anything is believed.
 * Returns null for events we don't act on.
 */
export async function handlePaystackWebhook(ctx: ServiceContext, rawBody: string, signature: string | null): Promise<Payment | null> {
  const cfg = await loadPaymentConfig(ctx);
  const secret = cfg.creds.paystack?.secretKey;
  if (!secret) throw new ForbiddenError("Paystack isn't set up for this business.");
  if (!verifyPaystackSignature(rawBody, signature, secret)) throw new ForbiddenError("Bad Paystack signature.");
  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    throw new ValidationError("Invalid JSON");
  }
  const parsed = parsePaystackEvent(payload);
  if (!parsed) return null;
  const channel = paystackChannel(payload);
  return settle(ctx, "paystack", parsed, channel === "mobile_money" ? "mpesa" : channel === "card" ? "card" : undefined);
}

/**
 * Pesapal's notification (IPN). It carries no proof of payment, so the status is always read back from Pesapal with this
 * business's own keys and that answer is what is believed.
 */
export async function handlePesapalIpn(ctx: ServiceContext, params: URLSearchParams | Record<string, unknown>): Promise<Payment | null> {
  const ipn = parsePesapalIpn(params);
  if (!ipn) return null;
  const cfg = await loadPaymentConfig(ctx);
  if (!cfg.creds.pesapal) throw new ForbiddenError("Pesapal isn't set up for this business.");
  const known = await findByProviderRef(ctx, "pesapal", ipn.merchantReference);
  if (!known) {
    await ctx.db.insert(schema.integrationsLog).values({
      tenantId: ctx.tenantId,
      kind: "pesapal",
      direction: "inbound",
      request: { ...ipn },
      response: { matched: false },
      ok: false,
      error: "Unknown payment reference",
    });
    return null;
  }
  const status = await pesapalTransactionStatus(cfg.creds.pesapal, ipn.orderTrackingId);
  if (status.merchantReference && status.merchantReference !== ipn.merchantReference) throw new ForbiddenError("Pesapal reference mismatch.");
  if (!status.final) return known; // still pending at Pesapal
  const method = status.method && /mpesa|m-pesa|airtel|mobile/i.test(status.method) ? "mpesa" : "card";
  return settle(ctx, "pesapal", pesapalToParsed({ ...status, merchantReference: ipn.merchantReference }), method);
}

/** Demo only (mock mode): the fake checkout page "pays" a link payment. */
export async function settleMockCheckout(ctx: ServiceContext, reference: string): Promise<Payment> {
  if (mpesaMode() !== "mock") throw new PolicyError("This is only available in mock mode.");
  const payment = await ctx.db.query.payments.findFirst({
    where: and(eq(schema.payments.tenantId, ctx.tenantId), eq(schema.payments.providerRef, reference)),
  });
  if (!payment) throw new NotFoundError("Payment", reference);
  return applySuccessfulCallback(
    ctx,
    payment,
    {
      checkoutRequestId: reference,
      merchantRequestId: null,
      receipt: `MOCK${Date.now().toString().slice(-8)}`,
      amountKes: payment.amountKes,
      phone: payment.phone,
      success: true,
      resultCode: 0,
      resultDesc: "Mock success",
      raw: { simulated: true },
    },
    { method: "card" },
  );
}

/* ───────────────────────────── the WhatsApp payment message ───────────────────────────── */

const BODY = "Hi {{1}}, KES {{2}} is due for your booking on {{3}} at {{4}}. Choose how you would like to pay.";

type SendKind = "options" | "link" | "stk";

/**
 * Asks the customer to pay over WhatsApp, in the way this business's providers allow:
 *  - a link provider and an M-Pesa prompt provider: a message with a "Pay with M-Pesa" button and a "Pay online" link button,
 *  - only a link provider: a message with the link,
 *  - only an M-Pesa prompt provider: the prompt goes straight to their phone.
 * The "Pay with M-Pesa" tap comes back as a button reply and is handled by `payFromButton`.
 */
export async function sendPaymentOptions(
  ctx: ServiceContext,
  input: { bookingId: string; invoiceId?: string; amountKes?: number },
): Promise<{ kind: SendKind; sent: boolean; payUrl: string | null; message: string; fallbacks: PaymentRequestResult["fallbacks"] }> {
  const { booking, customer, invoice, amountKes } = await resolvePayable(ctx, input);
  const caps = await paymentCapabilities(ctx);
  if (!caps.stk && !caps.link) throw new ValidationError("No payment provider is set up. Connect one in Integrations.");
  const settings = await getSettings(ctx);
  const slug = settings.tenant.slug;
  const date = formatNairobi(booking.startsAt);

  if (caps.stk && !caps.link) {
    const r = await requestPayment(ctx, { bookingId: booking.id, invoiceId: invoice?.id, amountKes, mode: "stk" });
    const text = `Hi ${customer.name}, I've sent an M-Pesa prompt for KES ${amountKes} to your phone. Enter your PIN to pay.`;
    const out = await sendFreeform(ctx, customer, text);
    return { kind: "stk", sent: out.sent, payUrl: null, message: r.customerMessage, fallbacks: r.fallbacks };
  }

  // The link is made when the customer opens it, so a fresh one is always used and nothing is created for a link nobody taps.
  const payUrl = invoice ? `${appUrl()}/pay/${slug}/${invoice.id}` : null;
  if (!payUrl) throw new ValidationError("A payment message needs an invoice. Create one first.");
  const params = [customer.name, String(amountKes), date, settings.tenant.name];
  const fallbackText = caps.stk
    ? `Hi ${customer.name}, KES ${amountKes} is due for your booking on ${date}. Pay online: ${payUrl} . Or reply PAY and I'll send an M-Pesa prompt to this number.`
    : `Hi ${customer.name}, KES ${amountKes} is due for your booking on ${date}. Pay here: ${payUrl}`;

  const result = await sendProactiveButtons(ctx, {
    customer,
    templateName: caps.stk ? PAY_TEMPLATE_OPTIONS : PAY_TEMPLATE_LINK,
    body: BODY,
    params,
    buttons: caps.stk
      ? [{ type: "quick_reply", payload: `${PAY_BUTTON_PREFIX}${invoice!.id}` }, { type: "url", suffix: invoice!.id }]
      : [{ type: "url", suffix: invoice!.id }],
    fallbackText,
    language: customer.language,
  });
  await audit(ctx, "payment.options_sent", "invoice", invoice!.id, { kind: caps.stk ? "options" : "link", sent: result.sent, template: result.usedTemplate });
  return { kind: caps.stk ? "options" : "link", sent: result.sent, payUrl, message: result.error ?? "Payment message sent.", fallbacks: [] };
}

/** The customer tapped "Pay with M-Pesa". Sends the prompt to the number they are writing from; if that fails everywhere, sends the link. */
export async function payFromButton(
  ctx: ServiceContext,
  input: { invoiceId: string; fromPhone: string },
): Promise<{ reply: string; ok: boolean }> {
  if (!/^[0-9a-f-]{36}$/i.test(input.invoiceId)) return { reply: "Sorry, I couldn't find that invoice. A member of the team will help you.", ok: false };
  const invoice = await ctx.db.query.invoices.findFirst({
    where: and(eq(schema.invoices.id, input.invoiceId), eq(schema.invoices.tenantId, ctx.tenantId)),
  });
  if (!invoice) return { reply: "Sorry, I couldn't find that invoice. A member of the team will help you.", ok: false };
  const booking = await ctx.db.query.bookings.findFirst({ where: eq(schema.bookings.id, invoice.bookingId) });
  const customer = booking ? await ctx.db.query.customers.findFirst({ where: eq(schema.customers.id, booking.customerId) }) : null;
  // Only the customer the invoice belongs to can start a prompt from it, and only to their own number.
  if (!booking || !customer || customer.phoneE164 !== input.fromPhone) {
    return { reply: "Sorry, that payment request isn't linked to this number.", ok: false };
  }
  if (invoice.balanceKes <= 0) return { reply: "Good news, there's nothing left to pay on this invoice. Thank you!", ok: true };

  try {
    const r = await requestPayment(ctx, { bookingId: booking.id, invoiceId: invoice.id, phone: customer.phoneE164, mode: "stk" });
    return { reply: `I've sent an M-Pesa prompt for KES ${r.payment.amountKes} to this number. Enter your PIN to pay.`, ok: true };
  } catch {
    try {
      const l = await requestPayment(ctx, { bookingId: booking.id, invoiceId: invoice.id, mode: "link" });
      return { reply: `I couldn't send the M-Pesa prompt just now. You can pay here instead: ${l.url}`, ok: true };
    } catch {
      return { reply: "Sorry, payments aren't working at the moment. A member of the team will get back to you shortly.", ok: false };
    }
  }
}

/** For the public pay link: makes (or reuses) a hosted link for this invoice's balance and returns where to send the customer. */
export async function paymentLinkForInvoice(ctx: ServiceContext, invoiceId: string): Promise<{ url: string; paid: boolean }> {
  const invoice = await ctx.db.query.invoices.findFirst({
    where: and(eq(schema.invoices.id, invoiceId), eq(schema.invoices.tenantId, ctx.tenantId)),
  });
  if (!invoice) throw new NotFoundError("Invoice", invoiceId);
  if (invoice.balanceKes <= 0) return { url: "", paid: true };
  const r = await requestPayment(ctx, { bookingId: invoice.bookingId, invoiceId: invoice.id, mode: "link" });
  if (!r.url) throw new ConflictError("No payment link could be made.");
  return { url: r.url, paid: false };
}

/* ───────────────────────────── WhatsApp template setup ───────────────────────────── */

export type PayTemplateStatus = { name: string; status: string };

/**
 * Submits the two payment message templates to Meta for this business's WhatsApp account (needs APP_URL, since the link button
 * points at it) and records their status. Approval is Meta's decision and can take a while; until then the plain-text fallback is used.
 */
export async function setupPaymentTemplates(ctx: ServiceContext): Promise<PayTemplateStatus[]> {
  requireOwner(ctx.principal);
  const slug = await tenantSlug(ctx);
  const base = `${appUrl()}/pay/${slug}/`;
  if (whatsappMode() === "cloud" && !/^https:\/\//.test(base)) {
    throw new ValidationError("APP_URL must be a public https:// address before payment messages can be set up.");
  }
  const conn = await getWhatsappConnection(ctx.tenantId);
  const creds = await getWhatsappCreds(ctx.tenantId);
  if (whatsappMode() === "cloud" && (!conn || !creds)) throw new ValidationError("Connect WhatsApp first.");

  const url = { type: "URL" as const, text: "Pay online", url: `${base}{{1}}`, example: `${base}8f14e45f-ceea-4672-a5d5-0000000000a1` };
  const defs = [
    { name: PAY_TEMPLATE_OPTIONS, buttons: [{ type: "QUICK_REPLY" as const, text: "Pay with M-Pesa" }, url] },
    { name: PAY_TEMPLATE_LINK, buttons: [url] },
  ];
  const cfg = await loadPaymentConfig(ctx);
  const templates = { ...cfg.templates };
  const out: PayTemplateStatus[] = [];
  for (const def of defs) {
    const r = await createMessageTemplate(conn?.wabaId ?? "", creds?.accessToken ?? "", {
      name: def.name,
      body: BODY,
      bodyExamples: ["Amina", "5000", "12 Dec 2026", "Palda Gardens"],
      buttons: def.buttons,
    });
    const status = r.existed ? ((await getMessageTemplateStatus(conn?.wabaId ?? "", creds?.accessToken ?? "", def.name).catch(() => null)) ?? "UNKNOWN") : r.status;
    templates[def.name] = status;
    out.push({ name: def.name, status });
  }
  if (cfg.source === "business") await writeConfig(ctx, cfg.creds, { enabled: cfg.enabled, templates });
  await audit(ctx, "payments.templates_submitted", "tenant_integration", null, { templates: out });
  return out;
}

/** Refreshes the recorded approval status of the payment templates. */
export async function refreshPaymentTemplates(ctx: ServiceContext): Promise<PayTemplateStatus[]> {
  requireOwner(ctx.principal);
  const conn = await getWhatsappConnection(ctx.tenantId);
  const creds = await getWhatsappCreds(ctx.tenantId);
  if (whatsappMode() === "cloud" && (!conn || !creds)) throw new ValidationError("Connect WhatsApp first.");
  const cfg = await loadPaymentConfig(ctx);
  const templates = { ...cfg.templates };
  const out: PayTemplateStatus[] = [];
  for (const name of [PAY_TEMPLATE_OPTIONS, PAY_TEMPLATE_LINK]) {
    const status = (await getMessageTemplateStatus(conn?.wabaId ?? "", creds?.accessToken ?? "", name)) ?? "NOT SUBMITTED";
    templates[name] = status;
    out.push({ name, status });
  }
  if (cfg.source === "business") await writeConfig(ctx, cfg.creds, { enabled: cfg.enabled, templates });
  return out;
}
