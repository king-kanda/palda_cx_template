import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  parsePaystackEvent,
  parsePesapalIpn,
  payerEmail,
  paystackChannel,
  paystackChargeMpesa,
  paystackCreateLink,
  pesapalCreateLink,
  pesapalToParsed,
  pesapalTransactionStatus,
  sendTemplateWithButtons,
  verifyPaystackSignature,
} from "../../packages/integrations/src/index";

type Call = { url: string; init: RequestInit & { body?: string } };

function stubFetch(responder: (call: Call) => unknown): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit & { body?: string }) => {
      const call = { url: String(url), init };
      calls.push(call);
      const body = responder(call);
      return { ok: true, status: 200, json: async () => body } as Response;
    }),
  );
  return calls;
}

const savedEnv = { ...process.env };
beforeEach(() => {
  process.env.MPESA_MODE = "tuma"; // anything but "mock": these tests exercise the real request shapes
  process.env.WHATSAPP_MODE = "cloud";
  process.env.WHATSAPP_GRAPH_VERSION = "v21.0";
});
afterEach(() => {
  vi.unstubAllGlobals();
  process.env = { ...savedEnv };
});

describe("Paystack", () => {
  const creds = { secretKey: "sk_test_abc" };

  it("opens a card checkout in minor units (KES 1,500 is 150000)", async () => {
    const calls = stubFetch(() => ({ status: true, data: { authorization_url: "https://checkout.paystack.com/abc", reference: "INV-1-x" } }));
    const r = await paystackCreateLink(creds, { reference: "INV-1-x", amountKes: 1500, email: "a@b.co" });
    expect(r.url).toBe("https://checkout.paystack.com/abc");
    expect(calls[0]!.url).toBe("https://api.paystack.co/transaction/initialize");
    const body = JSON.parse(calls[0]!.init.body!);
    expect(body).toMatchObject({ amount: 150000, currency: "KES", reference: "INV-1-x", channels: ["card"] });
    expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBe("Bearer sk_test_abc");
  });

  it("starts an M-Pesa prompt through the Charge API with the customer's own number", async () => {
    const calls = stubFetch(() => ({ status: true, data: { status: "pay_offline", reference: "R1", display_text: "Enter PIN" } }));
    const r = await paystackChargeMpesa(creds, { reference: "R1", amountKes: 500, email: "a@b.co", phone: "0712345678" });
    expect(r.customerMessage).toBe("Enter PIN");
    expect(calls[0]!.url).toBe("https://api.paystack.co/charge");
    expect(JSON.parse(calls[0]!.init.body!)).toMatchObject({
      amount: 50000,
      currency: "KES",
      mobile_money: { phone: "+254712345678", provider: "mpesa" },
    });
  });

  it("rejects a malformed phone before calling Paystack", async () => {
    const calls = stubFetch(() => ({}));
    await expect(paystackChargeMpesa(creds, { reference: "R", amountKes: 5, email: "a@b.co", phone: "123" })).rejects.toThrow(/phone/i);
    expect(calls).toHaveLength(0);
  });

  it("verifies the webhook signature with the business's own secret and rejects anything else", () => {
    const body = JSON.stringify({ event: "charge.success", data: { reference: "R" } });
    const good = createHmac("sha512", "sk_test_abc").update(body).digest("hex");
    expect(verifyPaystackSignature(body, good, "sk_test_abc")).toBe(true);
    expect(verifyPaystackSignature(body, good, "sk_test_other")).toBe(false);
    expect(verifyPaystackSignature(body + " ", good, "sk_test_abc")).toBe(false);
    expect(verifyPaystackSignature(body, null, "sk_test_abc")).toBe(false);
    expect(verifyPaystackSignature(body, "", "sk_test_abc")).toBe(false);
  });

  it("turns charge.success into a settled KES amount and names the channel", () => {
    const event = {
      event: "charge.success",
      data: { id: 99, reference: "R1", status: "success", amount: 150000, currency: "KES", channel: "mobile_money", gateway_response: "Success" },
    };
    const parsed = parsePaystackEvent(event)!;
    expect(parsed).toMatchObject({ checkoutRequestId: "R1", success: true, amountKes: 1500, receipt: "PSK99" });
    expect(paystackChannel(event)).toBe("mobile_money");
  });

  it("never books a non-KES charge as KES, ignores other events, and reports failures", () => {
    const usd = parsePaystackEvent({ event: "charge.success", data: { reference: "R", status: "success", amount: 5000, currency: "USD" } })!;
    expect(usd.amountKes).toBe(0);
    expect(parsePaystackEvent({ event: "transfer.success", data: { reference: "R" } })).toBeNull();
    expect(parsePaystackEvent({ event: "charge.success", data: {} })).toBeNull();
    const failed = parsePaystackEvent({ event: "charge.failed", data: { reference: "R", gateway_response: "Declined" } })!;
    expect(failed).toMatchObject({ success: false, receipt: null, resultDesc: "Declined" });
  });

  it("gives a customer with no email a stable placeholder", () => {
    expect(payerEmail(null, "+254712345678")).toBe("254712345678@customers.invalid");
    expect(payerEmail("a@b.co", "+254712345678")).toBe("a@b.co");
    expect(payerEmail("not an email", "0712345678")).toBe("254712345678@customers.invalid");
  });
});

describe("Pesapal", () => {
  const creds = { consumerKey: "ck", consumerSecret: "cs", environment: "sandbox" as const };

  it("signs in, registers the notification address once, and submits the order", async () => {
    const calls = stubFetch(({ url }) => {
      if (url.endsWith("/api/Auth/RequestToken")) return { token: "tok", expiryDate: new Date(Date.now() + 300_000).toISOString() };
      if (url.endsWith("/api/URLSetup/RegisterIPN")) return { ipn_id: "ipn-1" };
      return { order_tracking_id: "trk-1", redirect_url: "https://pay.pesapal.com/iframe?OrderTrackingId=trk-1" };
    });
    const input = {
      reference: "INV-9-abc",
      amountKes: 2500,
      description: "Payment INV-9",
      ipnUrl: "https://app.example/api/payments/pesapal?tenant=acme",
      callbackUrl: "https://app.example/pay/acme/thanks",
      phone: "0712345678",
      name: "Amina Wanjiru",
    };
    const r = await pesapalCreateLink(creds, input);
    expect(r).toMatchObject({ reference: "INV-9-abc", url: "https://pay.pesapal.com/iframe?OrderTrackingId=trk-1" });

    const order = calls.find((c) => c.url.endsWith("SubmitOrderRequest"))!;
    expect(order.url.startsWith("https://cybqa.pesapal.com/pesapalv3")).toBe(true);
    expect(JSON.parse(order.init.body!)).toMatchObject({
      id: "INV-9-abc",
      currency: "KES",
      amount: 2500,
      notification_id: "ipn-1",
      billing_address: { phone_number: "+254712345678", first_name: "Amina", last_name: "Wanjiru" },
    });

    // Same account and address again: no second sign-in, no second registration.
    const before = calls.length;
    await pesapalCreateLink(creds, { ...input, reference: "INV-9-def" });
    expect(calls.slice(before).map((c) => c.url.split("/").pop())).toEqual(["SubmitOrderRequest"]);
  });

  it("uses the live address for a live account", async () => {
    const calls = stubFetch(({ url }) => (url.endsWith("RequestToken") ? { token: "t", expiryDate: new Date(Date.now() + 300_000).toISOString() } : { status_code: 1 }));
    await pesapalTransactionStatus({ ...creds, consumerKey: "live-ck", environment: "live" }, "x");
    expect(calls[0]!.url.startsWith("https://pay.pesapal.com/v3")).toBe(true);
  });

  it("reads the status back from Pesapal and maps it (1 paid, 2 failed, 0 still open)", async () => {
    const make = (code: number) =>
      stubFetch(({ url }) =>
        url.endsWith("RequestToken")
          ? { token: `t${code}`, expiryDate: new Date(Date.now() + 300_000).toISOString() }
          : { status_code: code, payment_status_description: "x", amount: 2500, currency: "KES", confirmation_code: "CONF1", payment_method: "MpesaKE", merchant_reference: "INV-9-abc" },
      );
    make(1);
    const paid = await pesapalTransactionStatus({ ...creds, consumerKey: "k1" }, "trk");
    expect(paid).toMatchObject({ paid: true, final: true, amountKes: 2500, confirmationCode: "CONF1" });
    expect(pesapalToParsed(paid)).toMatchObject({ checkoutRequestId: "INV-9-abc", success: true, receipt: "CONF1", amountKes: 2500 });

    make(2);
    const failed = await pesapalTransactionStatus({ ...creds, consumerKey: "k2" }, "trk");
    expect(failed).toMatchObject({ paid: false, final: true });

    make(0);
    const open = await pesapalTransactionStatus({ ...creds, consumerKey: "k3" }, "trk");
    expect(open).toMatchObject({ paid: false, final: false });
  });

  it("never treats a non-KES amount as KES", async () => {
    stubFetch(({ url }) =>
      url.endsWith("RequestToken")
        ? { token: "tz", expiryDate: new Date(Date.now() + 300_000).toISOString() }
        : { status_code: 1, amount: 40, currency: "USD", merchant_reference: "R" },
    );
    const s = await pesapalTransactionStatus({ ...creds, consumerKey: "kz" }, "trk");
    expect(s.amountKes).toBe(0);
  });

  it("reads the notification parameters", () => {
    expect(parsePesapalIpn(new URLSearchParams("OrderTrackingId=t&OrderMerchantReference=r&OrderNotificationType=IPNCHANGE"))).toEqual({
      orderTrackingId: "t",
      merchantReference: "r",
    });
    expect(parsePesapalIpn(new URLSearchParams("OrderTrackingId=t"))).toBeNull();
    expect(parsePesapalIpn({ OrderTrackingId: "t", OrderMerchantReference: "r" })).not.toBeNull();
  });
});

describe("WhatsApp button template", () => {
  it("sends a quick-reply payload and a URL suffix at the right button index", async () => {
    const calls = stubFetch(() => ({ messages: [{ id: "wamid.1" }] }));
    await sendTemplateWithButtons(
      "+254712345678",
      "payment_options_v1",
      ["Amina", "5000", "12 Dec", "Palda"],
      [
        { type: "quick_reply", payload: "pay_mpesa:inv-1" },
        { type: "url", suffix: "inv-1" },
      ],
      "en",
      { phoneNumberId: "123", accessToken: "tok" },
    );
    const sent = JSON.parse(calls[0]!.init.body!);
    expect(sent.to).toBe("254712345678");
    expect(sent.template.name).toBe("payment_options_v1");
    expect(sent.template.components).toEqual([
      { type: "body", parameters: ["Amina", "5000", "12 Dec", "Palda"].map((text) => ({ type: "text", text })) },
      { type: "button", sub_type: "quick_reply", index: "0", parameters: [{ type: "payload", payload: "pay_mpesa:inv-1" }] },
      { type: "button", sub_type: "url", index: "1", parameters: [{ type: "text", text: "inv-1" }] },
    ]);
  });
});
