import { afterEach, describe, expect, it, vi } from "vitest";
import {
  initiateStkPush,
  parseC2BConfirmation,
  parseStkCallback,
} from "../../packages/integrations/src/mpesa";

const darajaSuccess = {
  Body: {
    stkCallback: {
      MerchantRequestID: "29115-34620561-1",
      CheckoutRequestID: "ws_CO_191220191020363925",
      ResultCode: 0,
      ResultDesc: "The service request is processed successfully.",
      CallbackMetadata: {
        Item: [
          { Name: "Amount", Value: 1500 },
          { Name: "MpesaReceiptNumber", Value: "NLJ7RT61SV" },
          { Name: "PhoneNumber", Value: 254712345678 },
        ],
      },
    },
  },
};

const tumaSuccess = {
  result_code: 0,
  status: "completed",
  merchant_request_id: "mr_tuma_1",
  checkout_request_id: "cr_tuma_1",
  mpesa_receipt_number: "RJ01ABC123",
  amount: 100,
  phone: "0712345678",
  timestamp: "2026-11-11 10:00:00",
  result_desc: "Payment successful",
};

describe("M-Pesa callback parsing", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("parses a Daraja success callback", () => {
    const parsed = parseStkCallback(darajaSuccess);
    expect(parsed.checkoutRequestId).toBe("ws_CO_191220191020363925");
    expect(parsed.success).toBe(true);
    expect(parsed.receipt).toBe("NLJ7RT61SV");
    expect(parsed.amountKes).toBe(1500);
    expect(parsed.phone).toBe("+254712345678");
  });

  it("parses a Daraja failure callback", () => {
    const parsed = parseStkCallback({
      Body: {
        stkCallback: {
          CheckoutRequestID: "ws_CO_FAIL",
          ResultCode: 1032,
          ResultDesc: "Request cancelled by user",
        },
      },
    });
    expect(parsed.success).toBe(false);
    expect(parsed.resultCode).toBe(1032);
    expect(parsed.receipt).toBeNull();
  });

  it("parses a flat Tuma success callback and normalizes the phone", () => {
    const parsed = parseStkCallback(tumaSuccess);
    expect(parsed.checkoutRequestId).toBe("cr_tuma_1");
    expect(parsed.merchantRequestId).toBe("mr_tuma_1");
    expect(parsed.success).toBe(true);
    expect(parsed.receipt).toBe("RJ01ABC123");
    expect(parsed.amountKes).toBe(100);
    expect(parsed.phone).toBe("+254712345678");
    expect(parsed.resultDesc).toBe("Payment successful");
  });

  it("treats a Tuma non-zero result as failed", () => {
    const parsed = parseStkCallback({
      ...tumaSuccess,
      result_code: "1032",
      status: "failed",
      mpesa_receipt_number: null,
      failure_reason: "Request cancelled by user",
    });
    expect(parsed.success).toBe(false);
    expect(parsed.resultCode).toBe(1032);
    expect(parsed.resultDesc).toBe("Request cancelled by user");
    expect(parsed.receipt).toBeNull();
  });

  it("accepts a Tuma callback wrapped in data", () => {
    const parsed = parseStkCallback({ data: tumaSuccess });
    expect(parsed.checkoutRequestId).toBe("cr_tuma_1");
    expect(parsed.success).toBe(true);
  });

  it("rejects a malformed callback", () => {
    expect(() => parseStkCallback({ hello: "world" })).toThrow();
  });

  it("still parses a Daraja C2B confirmation", () => {
    const parsed = parseC2BConfirmation({
      TransID: "RJ01C2B999",
      TransAmount: 750,
      MSISDN: "254712345678",
      BillRefNumber: "INV-2026-0001",
    });
    expect(parsed.receipt).toBe("RJ01C2B999");
    expect(parsed.amountKes).toBe(750);
    expect(parsed.phone).toBe("+254712345678");
    expect(parsed.success).toBe(true);
  });

  it("sends a Tuma STK request with a bearer token and a normalized phone", async () => {
    const saved = {
      MPESA_MODE: process.env.MPESA_MODE,
      TUMA_EMAIL: process.env.TUMA_EMAIL,
      TUMA_API_KEY: process.env.TUMA_API_KEY,
      TUMA_CALLBACK_URL: process.env.TUMA_CALLBACK_URL,
    };
    process.env.MPESA_MODE = "tuma";
    process.env.TUMA_EMAIL = "merchant@example.test";
    process.env.TUMA_API_KEY = "tuma-test-key";
    process.env.TUMA_CALLBACK_URL = "https://example.test/api/mpesa/callback?tenant=palda";

    const calls: { url: string; init?: { body?: string; headers?: Record<string, string> } }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: unknown, init?: { body?: string; headers?: Record<string, string> }) => {
        calls.push({ url: String(url), init });
        if (String(url).endsWith("/auth/token")) {
          return new Response(JSON.stringify({ success: true, data: { token: "a.b.c" } }), {
            status: 200,
          });
        }
        return new Response(
          JSON.stringify({
            success: true,
            message: "STK sent",
            data: {
              merchant_request_id: "mr_tuma_2",
              checkout_request_id: "cr_tuma_2",
              customer_message: "Enter PIN",
            },
          }),
          { status: 201 },
        );
      }),
    );

    try {
      const result = await initiateStkPush({
        phone: "0712 345 678",
        amountKes: 100,
        accountRef: "INV-2026-0001",
        description: "Booking deposit",
      });

      expect(result).toEqual({
        checkoutRequestId: "cr_tuma_2",
        merchantRequestId: "mr_tuma_2",
        customerMessage: "Enter PIN",
        mocked: false,
      });
      expect(calls).toHaveLength(2);
      expect(calls[0]!.url).toBe("https://api.tuma.co.ke/auth/token");
      expect(calls[1]!.url).toBe("https://api.tuma.co.ke/payment/stk-push");
      expect(calls[1]!.init?.headers?.Authorization).toBe("Bearer a.b.c");
      expect(JSON.parse(calls[1]!.init!.body!)).toEqual({
        amount: 100,
        phone: "254712345678",
        callback_url: "https://example.test/api/mpesa/callback?tenant=palda",
        description: "Booking deposit",
      });
    } finally {
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });
});
