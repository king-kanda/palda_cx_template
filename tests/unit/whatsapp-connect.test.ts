import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseWhatsAppPayload } from "../../packages/integrations/src/whatsapp";
import { sendText } from "../../packages/integrations/src/whatsapp";
import { parseSignupMessage } from "../../packages/integrations/src/whatsapp-signup-message";
import { createWhatsappConnectToken, verifyWhatsappConnectToken } from "../../packages/services/src/whatsapp-connect";

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const TENANT_B = "22222222-2222-4222-8222-222222222222";

const message = (id: string, from: string, body: string) => ({ id, from, timestamp: "1760000000", type: "text", text: { body } });
const change = (phoneNumberId: string, value: Record<string, unknown>, field = "messages") => ({
  field,
  value: { messaging_product: "whatsapp", metadata: { display_phone_number: "254700000000", phone_number_id: phoneNumberId }, ...value },
});

describe("parseWhatsAppPayload", () => {
  it("reads a normal message with its contact and the number it was sent to", () => {
    const out = parseWhatsAppPayload({
      entry: [{ id: "WABA1", changes: [change("PN_A", { contacts: [{ wa_id: "254711000001", profile: { name: "Amina" } }], messages: [message("wamid.1", "254711000001", "Hello")] })] }],
    });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ field: "messages", phoneNumberId: "PN_A", displayPhoneNumber: "254700000000" });
    expect(out[0]!.contacts).toEqual([{ waId: "254711000001", name: "Amina" }]);
    expect(out[0]!.messages[0]).toMatchObject({ waMessageId: "wamid.1", from: "+254711000001", type: "text", text: "Hello" });
  });

  it("keeps every change tied to ITS OWN number when one request carries several businesses", () => {
    const out = parseWhatsAppPayload({
      entry: [
        { id: "WABA1", changes: [change("PN_A", { messages: [message("wamid.a", "254711000001", "for A")] })] },
        { id: "WABA2", changes: [change("PN_B", { messages: [message("wamid.b", "254722000002", "for B")] })] },
      ],
    });
    expect(out.map((c) => [c.phoneNumberId, c.messages.map((m) => m.text)])).toEqual([
      ["PN_A", ["for A"]],
      ["PN_B", ["for B"]],
    ]);
  });

  it("reads messages the business sent from the WhatsApp Business app (echoes)", () => {
    const out = parseWhatsAppPayload({
      entry: [
        {
          changes: [
            change("PN_A", { message_echoes: [{ from: "254700000000", to: "254711000001", id: "wamid.echo", timestamp: "1760000100", type: "text", text: { body: "On my way" } }] }, "smb_message_echoes"),
          ],
        },
      ],
    });
    expect(out[0]!.field).toBe("smb_message_echoes");
    expect(out[0]!.echoes).toEqual([
      expect.objectContaining({ waMessageId: "wamid.echo", from: "+254700000000", to: "+254711000001", type: "text", text: "On my way" }),
    ]);
    expect(out[0]!.messages).toEqual([]);
  });

  it("reads an account update with the account id and the reason", () => {
    const out = parseWhatsAppPayload({
      entry: [{ changes: [{ field: "account_update", value: { event: "PARTNER_REMOVED", waba_info: { waba_id: "WABA9" }, disconnection_info: { reason: "PRIMARY_INACTIVITY", initiated_by: "WHATSAPP" } } }] }],
    });
    expect(out[0]!.phoneNumberId).toBeNull();
    expect(out[0]!.accountUpdate).toMatchObject({ event: "PARTNER_REMOVED", wabaId: "WABA9", reason: "PRIMARY_INACTIVITY" });
  });

  it("passes history and contact-sync changes through without trying to interpret them", () => {
    const out = parseWhatsAppPayload({ entry: [{ changes: [change("PN_A", { threads: [{ id: "t1", messages: [] }] }, "history"), change("PN_A", { state_sync: [] }, "smb_app_state_sync")] }] });
    expect(out.map((c) => c.field)).toEqual(["history", "smb_app_state_sync"]);
    expect(out[0]!.raw).toHaveProperty("threads");
  });

  it("never throws on junk, and skips what it does not understand", () => {
    for (const junk of [null, undefined, 42, "x", [], {}, { entry: "nope" }, { entry: [null, 1, { changes: "x" }] }, { entry: [{ changes: [null, { value: 3 }] }] }]) {
      expect(() => parseWhatsAppPayload(junk)).not.toThrow();
    }
    const out = parseWhatsAppPayload({ entry: [{ changes: [change("PN_A", { messages: [{ id: 5 }, message("wamid.ok", "254711000001", "kept")] })] }] });
    expect(out[0]!.messages.map((m) => m.waMessageId)).toEqual(["wamid.ok"]);
  });
});

describe("parseSignupMessage (what Meta's popup posts back)", () => {
  const finish = { type: "WA_EMBEDDED_SIGNUP", event: "FINISH", data: { phone_number_id: "PN1", waba_id: "W1", business_id: "B1" } };

  it("reads a finish event from facebook.com, as an object or as JSON text", () => {
    const expected = { kind: "finish", event: "FINISH", wabaId: "W1", phoneNumberId: "PN1", businessId: "B1", coexistence: false };
    expect(parseSignupMessage("https://www.facebook.com", finish)).toEqual(expected);
    expect(parseSignupMessage("https://business.facebook.com", JSON.stringify(finish))).toEqual(expected);
    expect(parseSignupMessage("https://facebook.com", finish)).toEqual(expected);
  });

  it("recognises the existing-WhatsApp-Business-app (coexistence) finish event, which carries no number id", () => {
    const msg = parseSignupMessage("https://www.facebook.com", { type: "WA_EMBEDDED_SIGNUP", event: "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING", data: { waba_id: "W2" } });
    expect(msg).toEqual({ kind: "finish", event: "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING", wabaId: "W2", phoneNumberId: null, businessId: null, coexistence: true });
  });

  it("reads cancel and error events", () => {
    expect(parseSignupMessage("https://www.facebook.com", { type: "WA_EMBEDDED_SIGNUP", event: "CANCEL", data: { current_step: "PHONE_NUMBER_SETUP" } })).toEqual({ kind: "cancel", step: "PHONE_NUMBER_SETUP" });
    expect(parseSignupMessage("https://www.facebook.com", { type: "WA_EMBEDDED_SIGNUP", event: "ERROR", data: { error_message: "Boom" } })).toEqual({ kind: "error", message: "Boom" });
  });

  it.each(["https://evil.example", "https://facebook.com.evil.example", "https://notfacebook.com", "http://localhost:3000", "null", "", "javascript:alert(1)"])(
    "ignores a message from %s",
    (origin) => expect(parseSignupMessage(origin, finish)).toBeNull(),
  );

  it("ignores messages that are not Embedded Signup messages", () => {
    for (const data of [null, "not json", 5, {}, { type: "OTHER", event: "FINISH" }, { type: "WA_EMBEDDED_SIGNUP", event: "SOMETHING_NEW" }, "{bad"]) {
      expect(parseSignupMessage("https://www.facebook.com", data)).toBeNull();
    }
  });
});

describe("connect links", () => {
  const original = process.env.AUTH_SECRET;
  beforeEach(() => {
    process.env.AUTH_SECRET = "unit-test-secret-aaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  });
  afterEach(() => {
    process.env.AUTH_SECRET = original;
  });

  it("round-trips and names exactly one business", () => {
    const token = createWhatsappConnectToken(TENANT_A, 72);
    expect(verifyWhatsappConnectToken(token)).toEqual({ tenantId: TENANT_A });
    expect(verifyWhatsappConnectToken(createWhatsappConnectToken(TENANT_B))).toEqual({ tenantId: TENANT_B });
  });

  it("expires", () => {
    const token = createWhatsappConnectToken(TENANT_A, 1);
    expect(verifyWhatsappConnectToken(token, Date.now() + 30 * 60 * 1000)).not.toBeNull();
    expect(verifyWhatsappConnectToken(token, Date.now() + 61 * 60 * 1000)).toBeNull();
  });

  it("cannot be altered to connect a number to a different business", () => {
    const token = createWhatsappConnectToken(TENANT_A, 72);
    const [payload, sig] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ p: "wa-connect", t: TENANT_B, e: Math.floor(Date.now() / 1000) + 99999, n: "x" })).toString("base64url");
    expect(verifyWhatsappConnectToken(`${forged}.${sig}`)).toBeNull();
    expect(verifyWhatsappConnectToken(`${payload}.${"0".repeat(64)}`)).toBeNull();
    expect(verifyWhatsappConnectToken(`${payload}.${sig}.extra`)).toBeNull();
    expect(verifyWhatsappConnectToken(`${payload}x.${sig}`)).toBeNull();
  });

  it("is rejected under a different secret, and for garbage", () => {
    const token = createWhatsappConnectToken(TENANT_A, 72);
    process.env.AUTH_SECRET = "a-different-secret-bbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    expect(verifyWhatsappConnectToken(token)).toBeNull();
    process.env.AUTH_SECRET = "unit-test-secret-aaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    for (const junk of ["", "x", "a.b", "...", "not a token", "e30.e30"]) expect(verifyWhatsappConnectToken(junk)).toBeNull();
  });

  it("is not usable as any other kind of signed value", () => {
    const payload = Buffer.from(JSON.stringify({ p: "something-else", t: TENANT_A, e: Math.floor(Date.now() / 1000) + 999 })).toString("base64url");
    const real = createWhatsappConnectToken(TENANT_A, 72);
    expect(verifyWhatsappConnectToken(`${payload}.${real.split(".")[1]}`)).toBeNull();
  });
});

describe("sending uses the credentials of the business it is for", () => {
  const calls: { url: string; auth: string | null; body: unknown }[] = [];
  const saved = { ...process.env };
  beforeEach(() => {
    calls.length = 0;
    process.env.WHATSAPP_MODE = "cloud";
    delete process.env.WHATSAPP_PHONE_NUMBER_ID;
    delete process.env.WHATSAPP_ACCESS_TOKEN;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const headers = new Headers((init as RequestInit | undefined)?.headers);
      calls.push({ url: String(input), auth: headers.get("authorization"), body: JSON.parse(String((init as RequestInit).body ?? "{}")) });
      return new Response(JSON.stringify({ messages: [{ id: "wamid.sent" }] }), { status: 200, headers: { "content-type": "application/json" } });
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    process.env.WHATSAPP_MODE = saved.WHATSAPP_MODE;
    if (saved.WHATSAPP_PHONE_NUMBER_ID !== undefined) process.env.WHATSAPP_PHONE_NUMBER_ID = saved.WHATSAPP_PHONE_NUMBER_ID;
    if (saved.WHATSAPP_ACCESS_TOKEN !== undefined) process.env.WHATSAPP_ACCESS_TOKEN = saved.WHATSAPP_ACCESS_TOKEN;
  });

  it("sends from the given number with the given token", async () => {
    await sendText("+254711000001", "hi", { phoneNumberId: "PN_A", accessToken: "TOKEN_A" });
    await sendText("+254722000002", "hello", { phoneNumberId: "PN_B", accessToken: "TOKEN_B" });
    expect(calls[0]!.url).toContain("/PN_A/messages");
    expect(calls[0]!.auth).toBe("Bearer TOKEN_A");
    expect(calls[1]!.url).toContain("/PN_B/messages");
    expect(calls[1]!.auth).toBe("Bearer TOKEN_B");
    expect(calls[0]!.body).toMatchObject({ messaging_product: "whatsapp", to: "254711000001", type: "text" });
  });

  it("refuses to send when there are no credentials at all, instead of guessing", async () => {
    await expect(sendText("+254711000001", "hi")).rejects.toThrow(/isn't connected/);
    expect(calls).toHaveLength(0);
  });

  it("falls back to the single-number environment values only when no credentials are passed (development)", async () => {
    process.env.WHATSAPP_PHONE_NUMBER_ID = "PN_ENV";
    process.env.WHATSAPP_ACCESS_TOKEN = "TOKEN_ENV";
    await sendText("+254711000001", "hi");
    expect(calls[0]!.url).toContain("/PN_ENV/messages");
    await sendText("+254711000001", "hi", { phoneNumberId: "PN_A", accessToken: "TOKEN_A" });
    expect(calls[1]!.url).toContain("/PN_A/messages"); // explicit credentials always win
    expect(calls[1]!.auth).toBe("Bearer TOKEN_A");
  });
});
