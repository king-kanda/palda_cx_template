import { z } from "zod";

export type MpesaMode = "daraja" | "tuma" | "mock";

export function mpesaMode(): MpesaMode {
  return (process.env.MPESA_MODE as MpesaMode) ?? "mock";
}

export type StkResult = {
  checkoutRequestId: string;
  merchantRequestId: string;
  customerMessage: string;
  mocked: boolean;
};

export class MpesaError extends Error {
  constructor(
    message: string,
    readonly response?: unknown,
  ) {
    super(message);
    this.name = "MpesaError";
  }
}

function normalisePhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.startsWith("254")) return digits;
  if (digits.startsWith("0")) return `254${digits.slice(1)}`;
  if (digits.length === 9 && digits.startsWith("7")) return `254${digits}`;
  return digits;
}

/* ------------------------------- Tuma ---------------------------------- */

function tumaBaseUrl(): string {
  return (process.env.TUMA_API_BASE_URL ?? "https://api.tuma.co.ke").replace(/\/+$/, "");
}

function tumaCallbackUrl(): string {
  const url = process.env.TUMA_CALLBACK_URL ?? process.env.MPESA_CALLBACK_URL;
  if (!url) {
    throw new MpesaError(
      "TUMA_CALLBACK_URL (or MPESA_CALLBACK_URL) is not configured.",
    );
  }
  return url;
}

type TumaTokenCache = { token: string; expiresAt: number };
let tumaTokenCache: TumaTokenCache | null = null;

/** Reads the JWT `exp` claim so the token is reused until shortly before expiry. */
function jwtExpiresAt(token: string): number | null {
  const part = token.split(".")[1];
  if (!part) return null;
  try {
    const json = JSON.parse(
      Buffer.from(part.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"),
    ) as { exp?: unknown };
    return typeof json.exp === "number" ? json.exp * 1000 : null;
  } catch {
    return null;
  }
}

async function tumaToken(): Promise<string> {
  if (tumaTokenCache && tumaTokenCache.expiresAt > Date.now() + 60_000) {
    return tumaTokenCache.token;
  }
  const email = process.env.TUMA_EMAIL;
  const apiKey = process.env.TUMA_API_KEY;
  if (!email || !apiKey) {
    throw new MpesaError("Tuma credentials are not configured (TUMA_EMAIL, TUMA_API_KEY).");
  }

  const res = await fetch(`${tumaBaseUrl()}/auth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ email, api_key: apiKey }),
  });
  const json = (await res.json().catch(() => ({}))) as {
    success?: boolean;
    message?: string;
    data?: { token?: string };
  };
  const token = json.data?.token;
  if (!res.ok || json.success !== true || !token) {
    throw new MpesaError(json.message ?? "Could not authenticate with Tuma.", json);
  }

  tumaTokenCache = {
    token,
    expiresAt: jwtExpiresAt(token) ?? Date.now() + 10 * 60_000,
  };
  return token;
}

async function initiateTumaStk(input: {
  phone: string;
  amountKes: number;
  description: string;
}): Promise<StkResult> {
  const token = await tumaToken();
  const phone = normalisePhone(input.phone);
  if (!/^254\d{9}$/.test(phone)) {
    throw new MpesaError("Invalid Kenyan phone number for M-Pesa (expected 254XXXXXXXXX).");
  }

  const res = await fetch(`${tumaBaseUrl()}/payment/stk-push`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      amount: Math.round(input.amountKes),
      phone,
      callback_url: tumaCallbackUrl(),
      description: input.description.slice(0, 200),
    }),
  });
  const json = (await res.json().catch(() => ({}))) as {
    success?: boolean;
    message?: string;
    data?: {
      merchant_request_id?: string;
      checkout_request_id?: string;
      customer_message?: string;
    };
  };
  if (!res.ok || json.success !== true) {
    throw new MpesaError(json.message ?? "Tuma STK push failed.", json);
  }
  const checkoutRequestId = String(json.data?.checkout_request_id ?? "");
  if (!checkoutRequestId) {
    throw new MpesaError("Tuma returned no CheckoutRequestID.", json);
  }

  return {
    checkoutRequestId,
    merchantRequestId: String(json.data?.merchant_request_id ?? ""),
    customerMessage:
      json.data?.customer_message ?? json.message ?? "STK push sent. Enter your M-Pesa PIN.",
    mocked: false,
  };
}


async function darajaToken(): Promise<string> {
  const key = process.env.MPESA_CONSUMER_KEY;
  const secret = process.env.MPESA_CONSUMER_SECRET;
  if (!key || !secret) throw new MpesaError("M-Pesa consumer credentials are not configured.");
  const basic = Buffer.from(`${key}:${secret}`).toString("base64");
  const base =
    process.env.MPESA_ENV === "production"
      ? "https://api.safaricom.co.ke"
      : "https://sandbox.safaricom.co.ke";
  const res = await fetch(`${base}/oauth/v1/generate?grant_type=client_credentials`, {
    headers: { Authorization: `Basic ${basic}` },
  });
  if (!res.ok) throw new MpesaError("Could not get M-Pesa access token.");
  const json = (await res.json()) as { access_token?: string };
  if (!json.access_token) throw new MpesaError("M-Pesa token response was empty.");
  return json.access_token;
}

export async function initiateStkPush(input: {
  phone: string;
  amountKes: number;
  accountRef: string;
  description: string;
}): Promise<StkResult> {
  if (mpesaMode() === "mock") {
    const id = `ws_CO_MOCK_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    return {
      checkoutRequestId: id,
      merchantRequestId: `mr_${id.slice(-8)}`,
      customerMessage: "Mock STK push sent. Enter M-Pesa PIN to complete.",
      mocked: true,
    };
  }
  if (mpesaMode() === "tuma") {
    return initiateTumaStk(input);
  }
  const token = await darajaToken();
  const base =
    process.env.MPESA_ENV === "production"
      ? "https://api.safaricom.co.ke"
      : "https://sandbox.safaricom.co.ke";
  const shortcode = process.env.MPESA_SHORTCODE ?? "";
  const passkey = process.env.MPESA_PASSKEY ?? "";
  const timestamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
  const password = Buffer.from(`${shortcode}${passkey}${timestamp}`).toString("base64");
  const callbackUrl = process.env.MPESA_CALLBACK_URL;
  if (!callbackUrl) throw new MpesaError("MPESA_CALLBACK_URL is not configured.");

  const res = await fetch(`${base}/mpesa/stkpush/v1/processrequest`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      BusinessShortCode: shortcode,
      Password: password,
      Timestamp: timestamp,
      TransactionType: "CustomerPayBillOnline",
      Amount: Math.round(input.amountKes),
      PartyA: normalisePhone(input.phone),
      PartyB: shortcode,
      PhoneNumber: normalisePhone(input.phone),
      CallBackURL: callbackUrl,
      AccountReference: input.accountRef.slice(0, 12),
      TransactionDesc: input.description.slice(0, 100),
    }),
  });
  const json = (await res.json()) as Record<string, unknown>;
  if (!res.ok) throw new MpesaError("STK push failed.", json);
  return {
    checkoutRequestId: String(json.CheckoutRequestID ?? ""),
    merchantRequestId: String(json.MerchantRequestID ?? ""),
    customerMessage: String(json.CustomerMessage ?? "STK push sent."),
    mocked: false,
  };
}

export type ParsedCallback = {
  checkoutRequestId: string;
  merchantRequestId: string | null;
  receipt: string | null;
  amountKes: number;
  phone: string | null;
  success: boolean;
  resultCode: number;
  resultDesc: string;
  raw: Record<string, unknown>;
};

const tumaCallbackSchema = z
  .object({
    result_code: z.union([z.number(), z.string()]),
    status: z.string().optional(),
    checkout_request_id: z.string().min(1),
    merchant_request_id: z.string().nullish(),
    mpesa_receipt_number: z.string().nullish(),
    amount: z.union([z.number(), z.string()]).nullish(),
    phone: z.union([z.string(), z.number()]).nullish(),
    msisdn: z.union([z.string(), z.number()]).nullish(),
    result_desc: z.string().nullish(),
    failure_reason: z.string().nullish(),
    message: z.string().nullish(),
  })
  .passthrough();

function tumaPhone(value: string | number | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const digits = normalisePhone(String(value));
  return digits ? `+${digits}` : null;
}

/**
 * Tuma posts a flat JSON body (optionally wrapped in `data`):
 * { result_code, status, checkout_request_id, mpesa_receipt_number, amount, ... }
 * Success is `result_code === 0` with status `completed`.
 */
function parseTumaCallback(payload: unknown): ParsedCallback | null {
  const record = payload as Record<string, unknown> | null;
  const nested = record?.data;
  const candidate =
    nested && typeof nested === "object" && !Array.isArray(nested) &&
    "checkout_request_id" in (nested as Record<string, unknown>)
      ? nested
      : payload;
  const parsed = tumaCallbackSchema.safeParse(candidate);
  if (!parsed.success) return null;

  const cb = parsed.data;
  const resultCode = Number(cb.result_code);
  const status = cb.status?.toLowerCase();
  const success =
    resultCode === 0 &&
    (status === undefined || ["completed", "success", "successful"].includes(status));

  return {
    checkoutRequestId: cb.checkout_request_id,
    merchantRequestId: cb.merchant_request_id ?? null,
    receipt: cb.mpesa_receipt_number ? String(cb.mpesa_receipt_number) : null,
    amountKes: Number(cb.amount ?? 0),
    phone: tumaPhone(cb.phone ?? cb.msisdn),
    success,
    resultCode,
    resultDesc:
      cb.failure_reason ??
      cb.result_desc ??
      cb.message ??
      (success ? "Payment successful" : "Payment failed"),
    raw: payload as Record<string, unknown>,
  };
}

const callbackSchema = z.object({
  Body: z.object({
    stkCallback: z.object({
      MerchantRequestID: z.string().optional(),
      CheckoutRequestID: z.string(),
      ResultCode: z.number(),
      ResultDesc: z.string().optional(),
      CallbackMetadata: z
        .object({
          Item: z
            .array(
              z.object({
                Name: z.string(),
                Value: z.union([z.string(), z.number()]).optional(),
              }),
            )
            .optional(),
        })
        .optional(),
    }),
  }),
});

export function parseStkCallback(payload: unknown): ParsedCallback {
  const tuma = parseTumaCallback(payload);
  if (tuma) return tuma;

  const parsed = callbackSchema.safeParse(payload);
  if (!parsed.success) throw new MpesaError("Malformed M-Pesa callback payload.", parsed.error.flatten());
  const cb = parsed.data.Body.stkCallback;
  const items = cb.CallbackMetadata?.Item ?? [];
  const pick = (name: string) => items.find((i) => i.Name === name)?.Value;
  return {
    checkoutRequestId: cb.CheckoutRequestID,
    merchantRequestId: cb.MerchantRequestID ?? null,
    receipt: pick("MpesaReceiptNumber") ? String(pick("MpesaReceiptNumber")) : null,
    amountKes: Number(pick("Amount") ?? 0),
    phone: pick("PhoneNumber") ? `+${String(pick("PhoneNumber"))}` : null,
    success: cb.ResultCode === 0,
    resultCode: cb.ResultCode,
    resultDesc: cb.ResultDesc ?? "",
    raw: payload as Record<string, unknown>,
  };
}

/** C2B (Till/Paybill) confirmations. */
export function parseC2BConfirmation(payload: unknown): ParsedCallback {
  const p = payload as Record<string, unknown>;
  const transId = String(p.TransID ?? p.TransID ?? "");
  return {
    checkoutRequestId: transId,
    merchantRequestId: null,
    receipt: transId || null,
    amountKes: Number(p.TransAmount ?? 0),
    phone: p.MSISDN ? `+${String(p.MSISDN).replace(/^\+/, "")}` : null,
    success: true,
    resultCode: 0,
    resultDesc: "C2B confirmation",
    raw: p,
  };
}
