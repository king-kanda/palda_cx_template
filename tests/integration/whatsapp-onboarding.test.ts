import { and, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { closeDb, getDb, loadEnv, schema } from "../../packages/db/src/index";
import { decryptJson } from "../../packages/integrations/src/index";
import {
  ConflictError,
  ValidationError,
  appendOutboundMessage,
  clearWhatsappCredCache,
  completeWhatsappSignup,
  createEngineCustomer,
  createPlatformAdmin,
  disconnectWhatsapp,
  ensureConversation,
  getWhatsappConnection,
  getWhatsappCreds,
  recordAppReply,
  refreshWhatsappConnection,
  routeWhatsappAccount,
  routeWhatsappNumber,
  sendFreeform,
  systemPrincipal,
  upsertCustomerByPhone,
  withPrincipal,
  type OnboardingInput,
} from "../../packages/services/src/index";
import { getPreset } from "../../packages/verticals/src/index";
import { app } from "../../apps/agent-service/src/app";

loadEnv();

vi.hoisted(() => {
  process.env.MAX_TURNS_PER_HOUR = "20";
  process.env.WAMBO_MODEL = "mock";
  delete process.env.OPENROUTER_API_KEY;
  process.env.WHATSAPP_MODE = "mock";
  process.env.HUMAN_PACING = "off";
});

const enabled = Boolean(process.env.DATABASE_URL);
const stamp = Date.now();
const tenantIds: string[] = [];
const adminEmails: string[] = [];

function input(label: string): OnboardingInput {
  const preset = getPreset("cleaning");
  return {
    vertical: "cleaning",
    businessName: `WA ${label} ${stamp}`,
    location: "Nairobi",
    description: "",
    reviewLink: "",
    agent: { name: "Zuri", tone: "", notes: "" },
    resources: preset.starterResources.map((r) => ({ name: r.name, kind: r.kind as "staff" })),
    offerings: preset.offerings.map((o) => ({
      name: o.name,
      resourceKind: o.resourceKind as "staff",
      durationMin: o.durationMin,
      basePriceKes: o.basePriceKes,
      bufferBeforeMin: o.bufferBeforeMin ?? 0,
    })),
    workingHours: Object.fromEntries(
      Object.entries(preset.defaults.workingHours).map(([d, h]) => [d, h ?? null]),
    ) as OnboardingInput["workingHours"],
    depositPct: 0,
    cancellationNoticeHours: 24,
    owner: { name: "Owner", email: `owner-${label}-${stamp}@example.test` },
  };
}

const sys = (tenantId: string) => systemPrincipal(tenantId, "test");
const run = <T>(tenantId: string, fn: Parameters<typeof withPrincipal>[1] extends (ctx: infer C) => Promise<infer R> ? (ctx: C) => Promise<T> : never) =>
  withPrincipal(sys(tenantId), fn as never) as Promise<T>;

async function post(body: unknown) {
  return app.request("/webhooks/whatsapp", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}

const textMessage = (id: string, from: string, body: string) => ({ id, from, timestamp: String(Math.floor(Date.now() / 1000)), type: "text", text: { body } });
const messagesChange = (phoneNumberId: string, waId: string, wamid: string, body: string) => ({
  field: "messages",
  value: {
    messaging_product: "whatsapp",
    metadata: { display_phone_number: "254700000000", phone_number_id: phoneNumberId },
    contacts: [{ wa_id: waId, profile: { name: `Guest ${waId.slice(-3)}` } }],
    messages: [textMessage(wamid, waId, body)],
  },
});
const echoChange = (phoneNumberId: string, to: string, wamid: string, body: string) => ({
  field: "smb_message_echoes",
  value: {
    messaging_product: "whatsapp",
    metadata: { display_phone_number: "254700000000", phone_number_id: phoneNumberId },
    message_echoes: [{ from: "254700000000", to, id: wamid, timestamp: String(Math.floor(Date.now() / 1000)), type: "text", text: { body } }],
  },
});

async function customersOf(tenantId: string, waId: string) {
  return getDb().query.customers.findMany({ where: and(eq(schema.customers.tenantId, tenantId), eq(schema.customers.phoneE164, `+${waId}`)) });
}
async function messagesOf(tenantId: string, waId: string) {
  const [c] = await customersOf(tenantId, waId);
  if (!c) return [];
  const conv = await getDb().query.conversations.findFirst({ where: and(eq(schema.conversations.tenantId, tenantId), eq(schema.conversations.customerId, c.id)) });
  if (!conv) return [];
  return getDb().query.messages.findMany({ where: eq(schema.messages.conversationId, conv.id), orderBy: (m, { asc }) => [asc(m.createdAt)] });
}

describe.skipIf(!enabled)("WhatsApp Embedded Signup, routing and coexistence (needs Postgres)", () => {
  let adminId = "";
  let A = "";
  let B = "";
  let C = "";
  let D = "";
  let E = "";

  const sign = (tenantId: string, over: Partial<Parameters<typeof completeWhatsappSignup>[2]> & { wabaId?: string | null }) =>
    completeWhatsappSignup(`engine:${adminId}`, tenantId, { code: "mock-code", wabaId: "mock_waba", phoneNumberId: null, coexistence: false, ...over } as never);

  it("sets up five businesses", async () => {
    const email = `wa-admin-${stamp}@palda.test`;
    adminEmails.push(email);
    adminId = (await createPlatformAdmin({ email, name: "Admin", password: "correct-horse-battery" })).id;
    const ids: string[] = [];
    for (const label of ["a", "b", "c", "d", "e"]) ids.push((await createEngineCustomer(adminId, input(label))).tenantId);
    [A, B, C, D, E] = ids as [string, string, string, string, string];
    tenantIds.push(...ids);
  });

  /* ───────────────────────────────── mock mode ───────────────────────────────── */

  it("connects a new number for business A; its token is stored encrypted and it is routed to A", async () => {
    const conn = await sign(A, { wabaId: "WABA_A", phoneNumberId: "mock_pn_A" });
    expect(conn).toMatchObject({ status: "active", mode: "cloud_api", phoneNumberId: "mock_pn_A", wabaId: "WABA_A", verifiedName: "Mock Business" });

    const row = await getDb().query.tenantIntegrations.findFirst({ where: and(eq(schema.tenantIntegrations.tenantId, A), eq(schema.tenantIntegrations.kind, "whatsapp")) });
    expect(row!.configEncrypted).not.toContain("mock_token");
    expect(decryptJson<{ accessToken: string; pin?: string }>(row!.configEncrypted).accessToken).toMatch(/^mock_token_/);
    expect(decryptJson<{ pin?: string }>(row!.configEncrypted).pin).toMatch(/^\d{6}$/); // a new number gets a registration PIN
    expect(await routeWhatsappNumber("mock_pn_A")).toEqual({ tenantId: A });
    expect(await routeWhatsappAccount("WABA_A")).toEqual([A]);
  });

  it("connects an existing WhatsApp Business app number (coexistence) for business B, and requests the one-time sync", async () => {
    const conn = await sign(B, { wabaId: "WABA_B", phoneNumberId: null, coexistence: true });
    // no number id was supplied (the coexistence event only carries the account), so it was looked up
    expect(conn.phoneNumberId).toBe("mock_pn_WABA_B");
    expect(conn.mode).toBe("coexistence");
    expect(conn.sync?.contacts).toMatch(/^mock_sync_smb_app_state_sync_/);
    expect(conn.sync?.history).toMatch(/^mock_sync_history_/);
    const row = await getDb().query.tenantIntegrations.findFirst({ where: and(eq(schema.tenantIntegrations.tenantId, B), eq(schema.tenantIntegrations.kind, "whatsapp")) });
    expect(decryptJson<{ pin?: string }>(row!.configEncrypted).pin).toBeUndefined(); // a coexistence number is never registered by us
  });

  it("a number can only ever belong to one business", async () => {
    await expect(sign(B, { wabaId: "WABA_X", phoneNumberId: "mock_pn_A" })).rejects.toThrow(ConflictError);
    await expect(sign(B, { wabaId: "WABA_X", phoneNumberId: "mock_pn_A" })).rejects.toThrow(/already connected to another business/);
    expect(await routeWhatsappNumber("mock_pn_A")).toEqual({ tenantId: A });
    expect((await getWhatsappConnection(B))!.phoneNumberId).toBe("mock_pn_WABA_B"); // B's own connection is untouched
    // the same business reconnecting its own number is fine
    await expect(sign(A, { wabaId: "WABA_A", phoneNumberId: "mock_pn_A" })).resolves.toMatchObject({ status: "active" });
  });

  it("a WhatsApp Business account can only ever belong to one business, even with a different number", async () => {
    // C tries to connect a new number that sits on A's account.
    await expect(sign(C, { wabaId: "WABA_A", phoneNumberId: "mock_pn_C_on_A" })).rejects.toThrow(ConflictError);
    await expect(sign(C, { wabaId: "WABA_A", phoneNumberId: "mock_pn_C_on_A" })).rejects.toThrow(/Business account is already connected to another business/);
    expect(await routeWhatsappNumber("mock_pn_C_on_A")).toBeNull();
    expect(await getWhatsappConnection(C)).toBeNull();
    expect(await routeWhatsappAccount("WABA_A")).toEqual([A]);

    // The database refuses it too, so no code path (or a hand-written query) can share an account.
    await expect(
      getDb().insert(schema.whatsappRoutes).values({ phoneNumberId: "mock_pn_raw", tenantId: C, wabaId: "WABA_A" }),
    ).rejects.toThrow();
    expect(await routeWhatsappNumber("mock_pn_raw")).toBeNull();
  });

  it("a number nobody connected routes nowhere", async () => {
    expect(await routeWhatsappNumber("mock_pn_nobody")).toBeNull();
    expect(await routeWhatsappNumber("")).toBeNull();
  });

  it("each business gets only its own credentials; an unconnected business gets none", async () => {
    clearWhatsappCredCache();
    const a = await getWhatsappCreds(A);
    const b = await getWhatsappCreds(B);
    expect(a).toMatchObject({ phoneNumberId: "mock_pn_A" });
    expect(b).toMatchObject({ phoneNumberId: "mock_pn_WABA_B" });
    expect(a!.accessToken).not.toBe(b!.accessToken);
    expect(await getWhatsappCreds(E)).toBeNull();
  });

  it("a bad sign-up code, or missing account, stores nothing and claims nothing", async () => {
    await expect(sign(E, { code: "garbage", wabaId: "WABA_E", phoneNumberId: "mock_pn_E" })).rejects.toThrow(ValidationError);
    await expect(sign(E, { code: "mock-code", wabaId: null, phoneNumberId: "mock_pn_E" })).rejects.toThrow(/which account/);
    await expect(sign(E, { code: "", wabaId: "WABA_E", phoneNumberId: "mock_pn_E" })).rejects.toThrow(/sign-up code/);
    expect(await getWhatsappConnection(E)).toBeNull();
    expect(await routeWhatsappNumber("mock_pn_E")).toBeNull();
  });

  /* ─────────────────────────── the webhook, two businesses ─────────────────────────── */

  it("a message to A's number lands in A only; a message to B's number lands in B only", async () => {
    expect((await post({ entry: [{ id: "WABA_A", changes: [messagesChange("mock_pn_A", "254711000001", "wamid.A1", "Hello A")] }] })).status).toBe(200);
    expect((await post({ entry: [{ id: "WABA_B", changes: [messagesChange("mock_pn_WABA_B", "254722000002", "wamid.B1", "Hello B")] }] })).status).toBe(200);

    expect((await messagesOf(A, "254711000001")).some((m) => m.body === "Hello A")).toBe(true);
    expect(await customersOf(B, "254711000001")).toEqual([]);
    expect((await messagesOf(B, "254722000002")).some((m) => m.body === "Hello B")).toBe(true);
    expect(await customersOf(A, "254722000002")).toEqual([]);
  });

  it("one request carrying changes for both businesses routes each to its own", async () => {
    const res = await post({
      entry: [
        { id: "WABA_A", changes: [messagesChange("mock_pn_A", "254711000011", "wamid.A2", "Batch for A")] },
        { id: "WABA_B", changes: [messagesChange("mock_pn_WABA_B", "254722000022", "wamid.B2", "Batch for B")] },
      ],
    });
    expect(await res.json()).toMatchObject({ ok: true, received: 2 });
    expect((await messagesOf(A, "254711000011")).some((m) => m.body === "Batch for A")).toBe(true);
    expect(await customersOf(B, "254711000011")).toEqual([]);
    expect((await messagesOf(B, "254722000022")).some((m) => m.body === "Batch for B")).toBe(true);
    expect(await customersOf(A, "254722000022")).toEqual([]);
  });

  it("a message to a number no business connected is ignored, never given to a default business", async () => {
    const res = await post({ entry: [{ changes: [messagesChange("mock_pn_stranger", "254733000099", "wamid.S1", "Who is this")] }] });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, received: 0, ignored: "no tenant" });
    for (const t of [A, B, C, D, E]) expect(await customersOf(t, "254733000099")).toEqual([]);
  });

  it("a malformed request never crashes the handler (Meta would keep retrying)", async () => {
    for (const body of [{}, { entry: "x" }, { entry: [{ changes: [{ field: "messages", value: { messages: [{ id: 1 }] } }] }] }, { entry: [{ changes: [null] }] }]) {
      expect((await post(body)).status).toBe(200);
    }
  });

  /* ───────────────────── coexistence: the business replies from its phone ───────────────────── */

  it("a reply sent from the WhatsApp Business app is kept in the thread and silences the agent for that chat", async () => {
    const waId = "254711000033";
    await post({ entry: [{ changes: [messagesChange("mock_pn_A", waId, "wamid.A3", "Is Saturday free?")] }] });
    const before = await messagesOf(A, waId);
    expect(before.some((m) => m.direction === "outbound" && m.type !== "app_reply")).toBe(true); // the agent answered

    await post({ entry: [{ changes: [echoChange("mock_pn_A", waId, "wamid.ECHO1", "Hi, it's the owner. Yes, Saturday works.")] }] });
    const [customer] = await customersOf(A, waId);
    const conv = await getDb().query.conversations.findFirst({ where: and(eq(schema.conversations.tenantId, A), eq(schema.conversations.customerId, customer!.id)) });
    expect(conv!.handler).toBe("human");
    const afterEcho = await messagesOf(A, waId);
    expect(afterEcho.some((m) => m.type === "app_reply" && m.body === "Hi, it's the owner. Yes, Saturday works.")).toBe(true);

    // the customer writes again: nothing from the agent
    const agentRepliesBefore = afterEcho.filter((m) => m.direction === "outbound" && m.type !== "app_reply").length;
    await post({ entry: [{ changes: [messagesChange("mock_pn_A", waId, "wamid.A4", "Great, thanks!")] }] });
    const after = await messagesOf(A, waId);
    expect(after.some((m) => m.body === "Great, thanks!")).toBe(true);
    expect(after.filter((m) => m.direction === "outbound" && m.type !== "app_reply").length).toBe(agentRepliesBefore);
  });

  it("the same echo delivered twice is recorded once", async () => {
    const waId = "254711000033";
    await post({ entry: [{ changes: [echoChange("mock_pn_A", waId, "wamid.ECHO1", "Hi, it's the owner. Yes, Saturday works.")] }] });
    const copies = (await messagesOf(A, waId)).filter((m) => m.waMessageId === "wamid.ECHO1");
    expect(copies).toHaveLength(1);
  });

  it("an echo of the agent's OWN message is not mistaken for a person taking over", async () => {
    const waId = "254711000044";
    const customer = await run<{ id: string }>(A, (ctx) => upsertCustomerByPhone(ctx, { name: "Own Echo", phone: `+${waId}` }));
    const conv = await run<{ id: string }>(A, (ctx) => ensureConversation(ctx, customer.id, "whatsapp"));
    await run(A, (ctx) => appendOutboundMessage(ctx, { conversationId: conv.id, text: "Your booking is confirmed for Saturday." }));
    const result = await run<{ recorded: boolean; reason?: string }>(A, (ctx) =>
      recordAppReply(ctx, { customerPhone: `+${waId}`, waMessageId: "wamid.OWN1", text: "Your booking is confirmed for Saturday.", type: "text" }),
    );
    expect(result).toEqual({ recorded: false, reason: "own_message" });
    const after = await getDb().query.conversations.findFirst({ where: eq(schema.conversations.id, conv.id) });
    expect(after!.handler).toBe("wambo");
  });

  it("an echo for one business's number never touches another business", async () => {
    await post({ entry: [{ changes: [echoChange("mock_pn_WABA_B", "254711000033", "wamid.ECHO_B", "From B's phone")] }] });
    expect((await messagesOf(B, "254711000033")).some((m) => m.waMessageId === "wamid.ECHO_B")).toBe(true);
    expect((await messagesOf(A, "254711000033")).some((m) => m.waMessageId === "wamid.ECHO_B")).toBe(false);
  });

  it("contacts and history from a coexistence sync are kept (raw) in that business's log and create no messages", async () => {
    const waId = "254744000055";
    await post({ entry: [{ changes: [{ field: "history", value: { messaging_product: "whatsapp", metadata: { phone_number_id: "mock_pn_WABA_B" }, threads: [{ id: waId, messages: [{ id: "h1", from: waId, text: { body: "old chat" } }] }] } }] }] });
    const logs = await getDb().query.integrationsLog.findMany({ where: and(eq(schema.integrationsLog.tenantId, B), eq(schema.integrationsLog.kind, "whatsapp_sync")) });
    expect(logs).toHaveLength(1);
    expect(JSON.stringify(logs[0]!.request)).toContain("old chat");
    expect(await customersOf(B, waId)).toEqual([]);
    expect(await getDb().query.integrationsLog.findMany({ where: and(eq(schema.integrationsLog.tenantId, A), eq(schema.integrationsLog.kind, "whatsapp_sync")) })).toEqual([]);
  });

  it("when WhatsApp ends a connection (PARTNER_REMOVED) that business stops sending and receiving, and the others are unaffected", async () => {
    await post({ entry: [{ changes: [{ field: "account_update", value: { event: "PARTNER_REMOVED", waba_info: { waba_id: "WABA_B" }, disconnection_info: { reason: "PRIMARY_INACTIVITY", initiated_by: "WHATSAPP" } } }] }] });
    const b = await getWhatsappConnection(B);
    expect(b!.status).toBe("disconnected");
    expect(b!.lastError).toBe("PRIMARY_INACTIVITY");
    clearWhatsappCredCache();
    expect(await getWhatsappCreds(B)).toBeNull();
    expect((await getWhatsappConnection(A))!.status).toBe("active");
    expect(await getWhatsappCreds(A)).not.toBeNull();
    const rows = await getDb().query.auditLog.findMany({ where: eq(schema.auditLog.tenantId, B) });
    expect(rows.some((r) => r.action === "whatsapp.disconnected_by_meta")).toBe(true);
  });

  it("disconnecting removes the route and the credentials; the number can then be used by another business", async () => {
    await disconnectWhatsapp(`engine:${adminId}`, A);
    expect(await getWhatsappConnection(A)).toBeNull();
    expect(await routeWhatsappNumber("mock_pn_A")).toBeNull();
    clearWhatsappCredCache();
    expect(await getWhatsappCreds(A)).toBeNull();
    await expect(sign(E, { wabaId: "WABA_E2", phoneNumberId: "mock_pn_A" })).resolves.toMatchObject({ phoneNumberId: "mock_pn_A" });
    expect(await routeWhatsappNumber("mock_pn_A")).toEqual({ tenantId: E });
    await disconnectWhatsapp(`engine:${adminId}`, E);
  });
});

/* ───────────────────────────── real Meta calls (stubbed) ───────────────────────────── */

type Call = { method: string; path: string; query: URLSearchParams; auth: string | null; body: Record<string, unknown> };

describe.skipIf(!enabled)("WhatsApp Embedded Signup against a stubbed Meta Graph API (needs Postgres)", () => {
  const calls: Call[] = [];
  const saved = { ...process.env };
  let adminId = "";
  let C = "";
  let D = "";
  const behaviour = { failSubscribeFor: new Set<string>(), checkStatus: 200 };

  const stub = () =>
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = new URL(String(input));
      const path = url.pathname.replace(/^\/v[\d.]+\//, "");
      const headers = new Headers((init as RequestInit | undefined)?.headers);
      const body = (init as RequestInit | undefined)?.body ? (JSON.parse(String((init as RequestInit).body)) as Record<string, unknown>) : {};
      calls.push({ method: (init as RequestInit | undefined)?.method ?? "GET", path, query: url.searchParams, auth: headers.get("authorization"), body });
      const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

      if (path === "oauth/access_token") {
        const code = url.searchParams.get("code") ?? "";
        if (code.startsWith("BAD")) return json({ error: { message: "Invalid verification code format.", code: 100 } }, 400);
        return json({ access_token: `BIZ_TOKEN_${code}`, token_type: "bearer", expires_in: 5184000 });
      }
      if (path.endsWith("/subscribed_apps")) {
        const waba = path.split("/")[0]!;
        return behaviour.failSubscribeFor.has(waba) ? json({ error: { message: "Subscribe failed", code: 200 } }, 400) : json({ success: true });
      }
      if (path.endsWith("/register") || path.endsWith("/smb_app_data")) return path.endsWith("/register") ? json({ success: true }) : json({ request_id: `req_${String(body.sync_type)}` });
      if (path.endsWith("/phone_numbers")) return json({ data: [{ id: `PN_${path.split("/")[0]}`, display_phone_number: "+254 722 000 222", verified_name: "Delta Co", quality_rating: "GREEN" }] });
      if (path.endsWith("/messages")) return json({ messages: [{ id: "wamid.sent" }] });
      if (/^[^/]+$/.test(path)) {
        if (behaviour.checkStatus !== 200) return json({ error: { message: "Error validating access token", code: 190 } }, behaviour.checkStatus);
        const coex = path.startsWith("PN_WABA_D");
        return json({ display_phone_number: coex ? "+254 722 000 222" : "+254 711 000 111", verified_name: coex ? "Delta Co" : "Charlie Ltd", quality_rating: "GREEN", platform_type: "CLOUD_API", is_on_biz_app: coex });
      }
      return json({ error: { message: `unexpected ${path}` } }, 404);
    });

  beforeAll(async () => {
    process.env.WHATSAPP_MODE = "cloud";
    process.env.META_APP_ID = "app-id-123";
    process.env.META_APP_SECRET = "s3cret-app-value";
    process.env.META_ES_CONFIG_ID = "config-1";
    process.env.HUMAN_PACING = "off";
    delete process.env.WHATSAPP_PHONE_NUMBER_ID;
    delete process.env.WHATSAPP_ACCESS_TOKEN;
    const email = `wa-admin2-${stamp}@palda.test`;
    adminEmails.push(email);
    adminId = (await createPlatformAdmin({ email, name: "Admin", password: "correct-horse-battery" })).id;
    C = (await createEngineCustomer(adminId, input("cloud-c"))).tenantId;
    D = (await createEngineCustomer(adminId, input("cloud-d"))).tenantId;
    tenantIds.push(C, D);
  });
  afterAll(() => {
    process.env.WHATSAPP_MODE = saved.WHATSAPP_MODE;
    delete process.env.META_APP_ID;
    delete process.env.META_APP_SECRET;
    delete process.env.META_ES_CONFIG_ID;
    vi.restoreAllMocks();
  });
  afterEach(() => {
    calls.length = 0;
    behaviour.failSubscribeFor.clear();
    behaviour.checkStatus = 200;
    clearWhatsappCredCache();
  });

  const sign = (tenantId: string, over: Record<string, unknown>) =>
    completeWhatsappSignup(`engine:${adminId}`, tenantId, { code: "GOOD1", wabaId: "WABA_C", phoneNumberId: "PN_C", coexistence: false, ...over } as never);

  it("a new number: exchange the code, read the number, subscribe the webhooks, then register it with a PIN", async () => {
    stub();
    const conn = await sign(C, {});
    expect(conn).toMatchObject({ mode: "cloud_api", displayPhone: "+254 711 000 111", verifiedName: "Charlie Ltd", status: "active" });
    expect(calls.map((c) => `${c.method} ${c.path.split("?")[0]}`)).toEqual([
      "GET oauth/access_token",
      "GET PN_C",
      "POST WABA_C/subscribed_apps",
      "POST PN_C/register",
    ]);
    expect(calls[0]!.query.get("code")).toBe("GOOD1");
    expect(calls[0]!.query.get("client_id")).toBe("app-id-123");
    expect(calls[1]!.auth).toBe("Bearer BIZ_TOKEN_GOOD1"); // the customer's token, not ours
    expect(calls[2]!.auth).toBe("Bearer BIZ_TOKEN_GOOD1");
    expect(calls[3]!.body).toMatchObject({ messaging_product: "whatsapp" });
    expect(String(calls[3]!.body.pin)).toMatch(/^\d{6}$/);
    expect(calls.some((c) => c.path.endsWith("smb_app_data"))).toBe(false);
  });

  it("an existing WhatsApp Business app number (coexistence): looked up from the account, NEVER registered, synced once", async () => {
    stub();
    const conn = await sign(D, { code: "GOOD2", wabaId: "WABA_D", phoneNumberId: null, coexistence: true });
    expect(conn).toMatchObject({ mode: "coexistence", phoneNumberId: "PN_WABA_D" });
    const seq = calls.map((c) => `${c.method} ${c.path.split("?")[0]}`);
    expect(seq).toEqual([
      "GET oauth/access_token",
      "GET WABA_D/phone_numbers",
      "GET PN_WABA_D",
      "POST WABA_D/subscribed_apps",
      "POST PN_WABA_D/smb_app_data",
      "POST PN_WABA_D/smb_app_data",
    ]);
    expect(seq.some((s) => s.endsWith("/register"))).toBe(false); // registering a coexistence number would break the customer's app
    expect(calls[4]!.body).toEqual({ messaging_product: "whatsapp", sync_type: "smb_app_state_sync" });
    expect(calls[5]!.body).toEqual({ messaging_product: "whatsapp", sync_type: "history" });
    expect(conn.sync).toEqual({ contacts: "req_smb_app_state_sync", history: "req_history" });
  });

  it("a number the platform reports as also on the WhatsApp Business app is treated as coexistence even if the flow didn't say so", async () => {
    stub();
    await disconnectWhatsapp(`engine:${adminId}`, D);
    const conn = await sign(D, { code: "GOOD3", wabaId: "WABA_D", phoneNumberId: "PN_WABA_D", coexistence: false });
    expect(conn.mode).toBe("coexistence");
    expect(calls.some((c) => c.path.endsWith("/register"))).toBe(false);
  });

  it("a rejected code fails cleanly: nothing else is called, nothing is stored, and the app secret never appears in the error", async () => {
    stub();
    await disconnectWhatsapp(`engine:${adminId}`, C);
    calls.length = 0; // the disconnect above unsubscribes from Meta; only the failing sign-up below is being measured
    let message = "";
    try {
      await sign(C, { code: "BAD_CODE" });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toMatch(/Invalid verification code/);
    expect(message).not.toContain("s3cret-app-value");
    expect(calls).toHaveLength(1);
    expect(await getWhatsappConnection(C)).toBeNull();
    expect(await routeWhatsappNumber("PN_C")).toBeNull();
  });

  it("if subscribing the webhooks fails, the number is released and nothing is stored (and no PIN is registered)", async () => {
    stub();
    behaviour.failSubscribeFor.add("WABA_C");
    await expect(sign(C, { code: "GOOD4" })).rejects.toThrow(/Subscribe failed/);
    expect(await routeWhatsappNumber("PN_C")).toBeNull();
    expect(await getWhatsappConnection(C)).toBeNull();
    expect(calls.some((c) => c.path.endsWith("/register"))).toBe(false);
  });

  it("each business sends from its own number with its own token", async () => {
    stub();
    await sign(C, { code: "GOODC" });
    await sign(D, { code: "GODDD", wabaId: "WABA_D", phoneNumberId: "PN_WABA_D", coexistence: true });
    calls.length = 0;
    const custC = await run<{ id: string; phoneE164: string }>(C, (ctx) => upsertCustomerByPhone(ctx, { name: "Cust C", phone: "+254700100001" }));
    const custD = await run<{ id: string; phoneE164: string }>(D, (ctx) => upsertCustomerByPhone(ctx, { name: "Cust D", phone: "+254700100002" }));
    await withPrincipal(sys(C), (ctx) => sendFreeform(ctx, custC as never, "Hello from C"));
    await withPrincipal(sys(D), (ctx) => sendFreeform(ctx, custD as never, "Hello from D"));
    const sends = calls.filter((c) => c.path.endsWith("/messages"));
    expect(sends.map((c) => [c.path, c.auth])).toEqual([
      ["PN_C/messages", "Bearer BIZ_TOKEN_GOODC"],
      ["PN_WABA_D/messages", "Bearer BIZ_TOKEN_GODDD"],
    ]);
    expect(sends[0]!.body).toMatchObject({ to: "254700100001", text: { body: "Hello from C" } });
  });

  it("a business with no connected number cannot send, and never borrows another's", async () => {
    stub();
    await disconnectWhatsapp(`engine:${adminId}`, C);
    calls.length = 0;
    const cust = await run<{ id: string }>(C, (ctx) => upsertCustomerByPhone(ctx, { name: "Orphan", phone: "+254700100003" }));
    const result = await withPrincipal(sys(C), (ctx) => sendFreeform(ctx, cust as never, "Should not go anywhere"));
    expect(result.sent).toBe(false);
    expect(calls.filter((c) => c.path.endsWith("/messages"))).toHaveLength(0);
  });

  it("Check connection confirms a working token, and flags a revoked one without disconnecting", async () => {
    stub();
    await sign(C, { code: "GOODC2" });
    const ok = await refreshWhatsappConnection(`engine:${adminId}`, C);
    expect(ok).toMatchObject({ status: "active", lastError: null });
    behaviour.checkStatus = 401;
    const bad = await refreshWhatsappConnection(`engine:${adminId}`, C);
    expect(bad!.status).toBe("attention");
    expect(bad!.lastError).toMatch(/access token/i);
    behaviour.checkStatus = 200;
    expect((await refreshWhatsappConnection(`engine:${adminId}`, C))!.status).toBe("active"); // it recovers
  });

  it("every connection change is audited and the token never appears in the audit trail", async () => {
    const rows = await getDb().query.auditLog.findMany({ where: eq(schema.auditLog.tenantId, C) });
    const actions = rows.map((r) => r.action);
    expect(actions).toEqual(expect.arrayContaining(["whatsapp.connected", "whatsapp.disconnected", "whatsapp.checked"]));
    expect(JSON.stringify(rows)).not.toContain("BIZ_TOKEN");
  });
});

afterAll(async () => {
  if (!enabled) return;
  for (const id of tenantIds) await getDb().delete(schema.tenants).where(eq(schema.tenants.id, id));
  for (const email of adminEmails) await getDb().delete(schema.platformAdmins).where(eq(schema.platformAdmins.email, email.toLowerCase()));
  await closeDb();
});
