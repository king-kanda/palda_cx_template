import { z } from "zod";

export type MpesaMode = "daraja" | "mock";

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
  return digits;
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
