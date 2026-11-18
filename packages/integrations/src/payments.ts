import { createHmac, timingSafeEqual } from "node:crypto";
import { mpesaMode, type ParsedCallback } from "./mpesa";

/**
 * Payment providers beyond M-Pesa-via-Tuma: Paystack (card link + M-Pesa through the Charge API) and Pesapal (hosted link).
 * Every function takes the business's OWN credentials; nothing here reads a platform-wide key. In `MPESA_MODE=mock` nothing
 * leaves the machine: the calls return a fake reference and a fake link so the whole flow can be shown without accounts.
 */

export type PaymentProviderId = "tuma" | "paystack" | "pesapal";

export const PAYMENT_PROVIDERS: Record<PaymentProviderId, { label: string; stk: boolean; link: boolean; blurb: string }> = {
  tuma: {
    label: "Tuma (M-Pesa)",
    stk: true,
    link: false,
    blurb: "M-Pesa prompt sent straight to the customer's phone.",
  },
  paystack: {
    label: "Paystack",
    stk: true,
    link: true,
    blurb: "Card payments by link, and an M-Pesa prompt the customer starts with a WhatsApp button.",
  },
  pesapal: {
    label: "Pesapal",
    stk: false,
    link: true,
    blurb: "A payment link where the customer pays by card or M-Pesa. We confirm once Pesapal says it is paid.",
  },
};

export class PaymentProviderError extends Error {
  constructor(
    message: string,
    readonly response?: unknown,
  ) {
    super(message);
    this.name = "PaymentProviderError";
  }
}

export type PaystackCreds = { secretKey: string };
export type PesapalCreds = { consumerKey: string; consumerSecret: string; environment: "sandbox" | "live" };

export type LinkResult = { reference: string; url: string; mocked: boolean };
export type PromptResult = { reference: string; customerMessage: string; mocked: boolean };

function mockRef(prefix: string): string {
  return `${prefix}_MOCK_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function digitsOf(phone: string): string {
  const d = phone.replace(/\D/g, "");
  if (d.startsWith("254")) return d;
  if (d.startsWith("0")) return `254${d.slice(1)}`;
  if (d.length === 9) return `254${d}`;
  return d;
}

/** Paystack insists on an email. A customer who never gave one gets a stable placeholder derived from the phone number. */
export function payerEmail(email: string | null | undefined, phone: string): string {
  const e = email?.trim();
  if (e && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return e;
  return `${digitsOf(phone)}@customers.invalid`;
}

/* ───────────────────────────────── Paystack ───────────────────────────────── */

const PAYSTACK = "https://api.paystack.co";

type PaystackEnvelope = { status?: boolean; message?: string; data?: Record<string, unknown> };

async function paystack(creds: PaystackCreds, path: string, body?: Record<string, unknown>): Promise<Record<string, unknown>> {
  if (!creds.secretKey) throw new PaymentProviderError("Paystack isn't set up for this business (no secret key).");
  const res = await fetch(`${PAYSTACK}${path}`, {
    method: body ? "POST" : "GET",
    headers: { Authorization: `Bearer ${creds.secretKey}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = (await res.json().catch(() => ({}))) as PaystackEnvelope;
  if (!res.ok || json.status !== true) throw new PaymentProviderError(json.message ?? "Paystack request failed.", json);
  return json.data ?? {};
}

/** A hosted card checkout. Paystack amounts are in the minor unit (cents), so KES 1,000 is 100000. */
export async function paystackCreateLink(
  creds: PaystackCreds,
  input: { reference: string; amountKes: number; email: string; callbackUrl?: string; metadata?: Record<string, unknown> },
): Promise<LinkResult> {
  if (mpesaMode() === "mock") {
    return { reference: input.reference, url: `${process.env.APP_URL ?? "http://localhost:3000"}/pay/mock/${input.reference}`, mocked: true };
  }
  const data = await paystack(creds, "/transaction/initialize", {
    email: input.email,
    amount: Math.round(input.amountKes) * 100,
    currency: "KES",
    reference: input.reference,
    channels: ["card"],
    ...(input.callbackUrl ? { callback_url: input.callbackUrl } : {}),
    metadata: input.metadata ?? {},
  });
  const url = typeof data.authorization_url === "string" ? data.authorization_url : "";
  if (!url) throw new PaymentProviderError("Paystack returned no payment link.", data);
  return { reference: String(data.reference ?? input.reference), url, mocked: false };
}

/**
 * The Charge API with `mobile_money` sends the customer an M-Pesa prompt (status "pay_offline"). The result arrives on the
 * `charge.success` webhook, never in this response.
 */
export async function paystackChargeMpesa(
  creds: PaystackCreds,
  input: { reference: string; amountKes: number; email: string; phone: string; metadata?: Record<string, unknown> },
): Promise<PromptResult> {
  if (mpesaMode() === "mock") {
    return { reference: input.reference, customerMessage: "Mock Paystack M-Pesa prompt sent.", mocked: true };
  }
  const phone = digitsOf(input.phone);
  if (!/^254\d{9}$/.test(phone)) throw new PaymentProviderError("Invalid Kenyan phone number for M-Pesa (expected 254XXXXXXXXX).");
  const data = await paystack(creds, "/charge", {
    email: input.email,
    amount: Math.round(input.amountKes) * 100,
    currency: "KES",
    reference: input.reference,
    mobile_money: { phone: `+${phone}`, provider: "mpesa" },
    metadata: input.metadata ?? {},
  });
  const status = String(data.status ?? "");
  if (status === "failed") throw new PaymentProviderError(String(data.message ?? data.gateway_response ?? "Paystack could not start the M-Pesa prompt."), data);
  return {
    reference: String(data.reference ?? input.reference),
    customerMessage: String(data.display_text ?? "M-Pesa prompt sent. Enter your PIN to pay."),
    mocked: false,
  };
}

/** Paystack signs the raw body with HMAC-SHA512 using the business's secret key. */
export function verifyPaystackSignature(rawBody: string, signature: string | null, secretKey: string): boolean {
  if (!signature || !secretKey) return false;
  const expected = createHmac("sha512", secretKey).update(rawBody).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** `charge.success` becomes a settled payment; other events are ignored (null). A `charge.failed` becomes a failure. */
export function parsePaystackEvent(payload: unknown): ParsedCallback | null {
  const p = payload as { event?: unknown; data?: Record<string, unknown> } | null;
  if (!p || typeof p !== "object" || !p.data) return null;
  const event = String(p.event ?? "");
  if (event !== "charge.success" && event !== "charge.failed") return null;
  const d = p.data;
  const reference = typeof d.reference === "string" ? d.reference : "";
  if (!reference) return null;
  const success = event === "charge.success" && String(d.status ?? "success") === "success";
  const customer = (d.customer ?? {}) as Record<string, unknown>;
  const auth = (d.authorization ?? {}) as Record<string, unknown>;
  const receipt = d.receipt_number ? String(d.receipt_number) : d.id !== undefined ? `PSK${String(d.id)}` : null;
  return {
    checkoutRequestId: reference,
    merchantRequestId: null,
    receipt: success ? receipt : null,
    // Paystack reports the minor unit; a non-KES charge must never be booked as KES, so it is reported as 0 and checked by the caller.
    amountKes: String(d.currency ?? "KES") === "KES" ? Math.round(Number(d.amount ?? 0) / 100) : 0,
    phone: typeof auth.mobile_money_number === "string" ? `+${digitsOf(auth.mobile_money_number)}` : typeof customer.phone === "string" ? customer.phone : null,
    success,
    resultCode: success ? 0 : 1,
    resultDesc: String(d.gateway_response ?? (success ? "Payment successful" : "Payment failed")),
    raw: payload as Record<string, unknown>,
  };
}

/** Which channel paid: "mobile_money" is M-Pesa, "card" is a card. Used to label the payment correctly. */
export function paystackChannel(payload: unknown): string | null {
  const d = (payload as { data?: Record<string, unknown> } | null)?.data;
  return d && typeof d.channel === "string" ? d.channel : null;
}

/* ───────────────────────────────── Pesapal ───────────────────────────────── */

function pesapalBase(c: PesapalCreds): string {
  return c.environment === "live" ? "https://pay.pesapal.com/v3" : "https://cybqa.pesapal.com/pesapalv3";
}

const pesapalTokens = new Map<string, { token: string; expiresAt: number }>();
const pesapalIpns = new Map<string, string>();

async function pesapalToken(c: PesapalCreds): Promise<string> {
  const key = `${c.environment}:${c.consumerKey}`;
  const hit = pesapalTokens.get(key);
  if (hit && hit.expiresAt > Date.now() + 30_000) return hit.token;
  if (!c.consumerKey || !c.consumerSecret) throw new PaymentProviderError("Pesapal isn't set up for this business (no keys).");
  const res = await fetch(`${pesapalBase(c)}/api/Auth/RequestToken`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ consumer_key: c.consumerKey, consumer_secret: c.consumerSecret }),
  });
  const json = (await res.json().catch(() => ({}))) as { token?: string; expiryDate?: string; error?: { message?: string } | null; message?: string };
  if (!res.ok || !json.token) throw new PaymentProviderError(json.error?.message ?? json.message ?? "Could not sign in to Pesapal.", json);
  const expiresAt = json.expiryDate ? Date.parse(json.expiryDate) : NaN;
  pesapalTokens.set(key, { token: json.token, expiresAt: Number.isFinite(expiresAt) ? expiresAt : Date.now() + 4 * 60_000 });
  return json.token;
}

async function pesapal<T>(c: PesapalCreds, path: string, body?: Record<string, unknown>): Promise<T> {
  const token = await pesapalToken(c);
  const res = await fetch(`${pesapalBase(c)}${path}`, {
    method: body ? "POST" : "GET",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = (await res.json().catch(() => ({}))) as T & { error?: { message?: string } | null; message?: string };
  if (!res.ok || json.error) throw new PaymentProviderError(json.error?.message ?? json.message ?? "Pesapal request failed.", json);
  return json;
}

/** Registers the notification (IPN) address once per account and address; Pesapal needs its id on every order. */
async function pesapalIpnId(c: PesapalCreds, ipnUrl: string): Promise<string> {
  const key = `${c.environment}:${c.consumerKey}:${ipnUrl}`;
  const cached = pesapalIpns.get(key);
  if (cached) return cached;
  const json = await pesapal<{ ipn_id?: string }>(c, "/api/URLSetup/RegisterIPN", { url: ipnUrl, ipn_notification_type: "GET" });
  if (!json.ipn_id) throw new PaymentProviderError("Pesapal did not return a notification id.", json);
  pesapalIpns.set(key, json.ipn_id);
  return json.ipn_id;
}

export async function pesapalCreateLink(
  creds: PesapalCreds,
  input: {
    reference: string;
    amountKes: number;
    description: string;
    ipnUrl: string;
    callbackUrl: string;
    phone: string;
    email?: string | null;
    name?: string | null;
  },
): Promise<LinkResult> {
  if (mpesaMode() === "mock") {
    return { reference: input.reference, url: `${process.env.APP_URL ?? "http://localhost:3000"}/pay/mock/${input.reference}`, mocked: true };
  }
  const notificationId = await pesapalIpnId(creds, input.ipnUrl);
  const [first, ...rest] = (input.name ?? "").trim().split(/\s+/);
  const json = await pesapal<{ order_tracking_id?: string; redirect_url?: string }>(creds, "/api/Transactions/SubmitOrderRequest", {
    id: input.reference.slice(0, 50),
    currency: "KES",
    amount: Math.round(input.amountKes),
    description: input.description.slice(0, 100),
    callback_url: input.callbackUrl,
    notification_id: notificationId,
    billing_address: {
      phone_number: `+${digitsOf(input.phone)}`,
      ...(input.email ? { email_address: input.email } : {}),
      first_name: first || undefined,
      last_name: rest.join(" ") || undefined,
    },
  });
  if (!json.redirect_url || !json.order_tracking_id) throw new PaymentProviderError("Pesapal returned no payment link.", json);
  // Our own reference is what ties the IPN back to the payment; Pesapal's tracking id is kept by the caller too.
  return { reference: input.reference, url: json.redirect_url, mocked: false };
}

export type PesapalStatus = {
  paid: boolean;
  final: boolean;
  amountKes: number;
  currency: string;
  confirmationCode: string | null;
  method: string | null;
  merchantReference: string;
  description: string;
  raw: Record<string, unknown>;
};

/** Pesapal's IPN carries no proof of payment, so the status is always read back from Pesapal itself. */
export async function pesapalTransactionStatus(creds: PesapalCreds, orderTrackingId: string): Promise<PesapalStatus> {
  const json = await pesapal<Record<string, unknown>>(creds, `/api/Transactions/GetTransactionStatus?orderTrackingId=${encodeURIComponent(orderTrackingId)}`);
  const code = Number(json.status_code ?? -1);
  return {
    paid: code === 1,
    final: code === 1 || code === 2 || code === 3,
    amountKes: String(json.currency ?? "KES") === "KES" ? Math.round(Number(json.amount ?? 0)) : 0,
    currency: String(json.currency ?? ""),
    confirmationCode: json.confirmation_code ? String(json.confirmation_code) : null,
    method: json.payment_method ? String(json.payment_method) : null,
    merchantReference: String(json.merchant_reference ?? ""),
    description: String(json.payment_status_description ?? ""),
    raw: json,
  };
}

/** Pesapal sends the IPN as a GET (or POST) with these three parameters. */
export function parsePesapalIpn(params: URLSearchParams | Record<string, unknown>): { orderTrackingId: string; merchantReference: string } | null {
  const get = (k: string) => (params instanceof URLSearchParams ? params.get(k) : typeof params[k] === "string" ? (params[k] as string) : null);
  const orderTrackingId = get("OrderTrackingId");
  const merchantReference = get("OrderMerchantReference");
  if (!orderTrackingId || !merchantReference) return null;
  return { orderTrackingId, merchantReference };
}

export function pesapalToParsed(status: PesapalStatus): ParsedCallback {
  return {
    checkoutRequestId: status.merchantReference,
    merchantRequestId: null,
    receipt: status.paid ? status.confirmationCode : null,
    amountKes: status.amountKes,
    phone: null,
    success: status.paid,
    resultCode: status.paid ? 0 : 1,
    resultDesc: status.description || (status.paid ? "Payment successful" : "Payment failed"),
    raw: status.raw,
  };
}

/* ───────────────────── WhatsApp "pay" message templates ───────────────────── */

/** The two template names we create on each business's WhatsApp account. Bump the suffix when the wording changes. */
export const PAY_TEMPLATE_OPTIONS = "payment_options_v1";
export const PAY_TEMPLATE_LINK = "payment_link_v1";
/** The quick-reply button payload prefix; the invoice id follows. */
export const PAY_BUTTON_PREFIX = "pay_mpesa:";
