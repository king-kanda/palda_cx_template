import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { closeDb, getDb, loadEnv, schema } from "../../packages/db/src/index";
import {
  ensureConversation,
  seedDemoTenant,
  systemPrincipal,
  withPrincipal,
} from "../../packages/services/src/index";
import { app } from "../../apps/agent-service/src/app";

loadEnv();

/**
 * Pin the offline model and the turn cap before `app.ts` is imported, because
 * MAX_TURNS_PER_HOUR is read once when the module initialises.
 */
const { forcedCap } = vi.hoisted(() => {
  process.env.MAX_TURNS_PER_HOUR = "20";
  process.env.WAMBO_MODEL = "mock";
  delete process.env.OPENROUTER_API_KEY;
  process.env.WHATSAPP_MODE = "mock";
  return { forcedCap: 20 };
});

const enabled = Boolean(process.env.DATABASE_URL);

/**
 * Phase 3 acceptance for the WhatsApp side of the agent service, exercised
 * through the real Hono routes and a real database:
 *   - an inbound message is stored once (webhook dedupe)
 *   - a staff takeover silences automation
 *   - the Kenya DPA consent line is sent on first contact
 *   - the hourly turn cap hands off instead of running the model
 *   - image receipts are stored for staff without invoking the agent
 *
 * `WAMBO_MODEL=mock` (or a missing OpenRouter key) keeps the turn offline.
 */
describe.skipIf(!enabled)("WhatsApp webhook flow (needs Postgres)", () => {
  const slug = `itest-wa-${Date.now()}`;
  const phoneNumberId = `PNID-${Date.now()}`;
  let tenantId = "";

  function payload(input: {
    waId: string;
    waMessageId: string;
    text?: string;
    type?: "text" | "image";
    imageId?: string;
    caption?: string;
  }): Record<string, unknown> {
    const message =
      input.type === "image"
        ? {
            id: input.waMessageId,
            from: input.waId,
            timestamp: String(Math.floor(Date.now() / 1000)),
            type: "image",
            image: { id: input.imageId ?? "media-receipt-1", caption: input.caption ?? "" },
          }
        : {
            id: input.waMessageId,
            from: input.waId,
            timestamp: String(Math.floor(Date.now() / 1000)),
            type: "text",
            text: { body: input.text ?? "" },
          };
    return {
      object: "whatsapp_business_account",
      entry: [
        {
          id: "WABA_TEST",
          changes: [
            {
              field: "messages",
              value: {
                messaging_product: "whatsapp",
                metadata: {
                  display_phone_number: "254700000000",
                  phone_number_id: phoneNumberId,
                },
                contacts: [{ profile: { name: "Test Guest" }, wa_id: input.waId }],
                messages: [message],
              },
            },
          ],
        },
      ],
    };
  }

  async function post(body: unknown) {
    return app.request("/webhooks/whatsapp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  async function customerFor(waId: string) {
    return getDb().query.customers.findFirst({
      where: and(
        eq(schema.customers.tenantId, tenantId),
        eq(schema.customers.phoneE164, `+${waId}`),
      ),
    });
  }

  async function conversationFor(waId: string) {
    const customer = await customerFor(waId);
    if (!customer) return null;
    return withPrincipal(systemPrincipal(tenantId, "test"), (ctx) =>
      ensureConversation(ctx, customer.id, "whatsapp"),
    );
  }

  async function messagesFor(waId: string) {
    const conversation = await conversationFor(waId);
    if (!conversation) return [];
    return getDb().query.messages.findMany({
      where: and(
        eq(schema.messages.tenantId, tenantId),
        eq(schema.messages.conversationId, conversation.id),
      ),
      orderBy: (m, { asc }) => [asc(m.createdAt)],
    });
  }

  async function runCount(conversationId: string | undefined) {
    if (!conversationId) return 0;
    const rows = await getDb().query.agentRuns.findMany({
      where: and(
        eq(schema.agentRuns.tenantId, tenantId),
        eq(schema.agentRuns.conversationId, conversationId),
      ),
    });
    return rows.length;
  }

  beforeAll(async () => {
    process.env.INTERNAL_SECRET = process.env.INTERNAL_SECRET ?? "itest-internal";

    const result = await seedDemoTenant({
      slug,
      name: "WhatsApp Test Gardens",
      vertical: "venue",
      ownerEmail: `owner-${slug}@example.test`,
      ownerPassword: "test-password-1234",
      staffEmail: `staff-${slug}@example.test`,
      staffPassword: "test-password-1234",
      reset: true,
    });
    tenantId = result.tenantId;

    // The webhook routes a phone_number_id to its tenant through this row.
    await getDb().insert(schema.tenantIntegrations).values({
      tenantId,
      kind: "whatsapp",
      configEncrypted: "not-used-in-mock-mode",
      meta: { phoneNumberId, displayNumber: "+254700000000" },
    });
  });

  afterAll(async () => {
    await closeDb();
  });

  it("stores an inbound message exactly once and sends the consent line", async () => {
    const waId = "254711000101";
    const body = payload({
      waId,
      waMessageId: "wamid.dedupe.1",
      text: "Hello there",
    });

    const first = await post(body);
    expect(first.status).toBe(200);

    const second = await post(body);
    expect(second.status).toBe(200);

    const messages = await messagesFor(waId);
    const inbound = messages.filter((m) => m.waMessageId === "wamid.dedupe.1");
    expect(inbound).toHaveLength(1);
    expect(inbound[0]!.direction).toBe("inbound");

    // Consent line goes out on first contact (Kenya DPA).
    const consent = messages.find(
      (m) => m.direction === "outbound" && (m.body ?? "").includes("Karibu!"),
    );
    expect(consent).toBeTruthy();
    expect(consent!.body).toContain("STOP");

    // The duplicate webhook delivery must not produce a second agent run.
    const conversation = await conversationFor(waId);
    expect(await runCount(conversation?.id)).toBe(1);

    // And the customer still got an assistant reply.
    const reply = messages.find(
      (m) =>
        m.direction === "outbound" &&
        !(m.body ?? "").includes("Karibu!") &&
        !(m.body ?? "").includes("STOP"),
    );
    expect(reply).toBeTruthy();
  });

  it("keeps automation silent after a staff takeover", async () => {
    const waId = "254711000102";
    await post(
      payload({ waId, waMessageId: "wamid.takeover.1", text: "Hello, first message" }),
    );

    const conversation = await conversationFor(waId);
    expect(conversation).toBeTruthy();
    await getDb()
      .update(schema.conversations)
      .set({ handler: "human", state: "waiting_human" })
      .where(eq(schema.conversations.id, conversation!.id));

    const runsBefore = await runCount(conversation!.id);
    const outboundBefore = (await messagesFor(waId)).filter(
      (m) => m.direction === "outbound",
    ).length;

    await post(
      payload({
        waId,
        waMessageId: "wamid.takeover.2",
        text: "Any update on my booking?",
      }),
    );

    const messages = await messagesFor(waId);
    const inbound = messages.filter((m) => m.waMessageId === "wamid.takeover.2");
    // The message is stored for staff, but Wambo does not answer.
    expect(inbound).toHaveLength(1);
    expect(await runCount(conversation!.id)).toBe(runsBefore);
    expect(messages.filter((m) => m.direction === "outbound")).toHaveLength(outboundBefore);

    const after = await getDb().query.conversations.findFirst({
      where: eq(schema.conversations.id, conversation!.id),
    });
    expect(after?.handler).toBe("human");
    expect(after?.state).toBe("waiting_human");
  });

  it("hands off instead of running the model once the hourly turn cap is reached", async () => {
    const waId = "254711000103";
    await post(
      payload({ waId, waMessageId: "wamid.cap.1", text: "Hello there" }),
    );

    const conversation = await conversationFor(waId);
    expect(conversation).toBeTruthy();

    const cap = forcedCap;
    const rows = Array.from({ length: cap }, (_, index) => ({
      tenantId,
      agentId: "wambo",
      agentVersion: 1,
      principalType: "customer",
      principalId: conversation!.customerId,
      trigger: "whatsapp",
      conversationId: conversation!.id,
      model: "mock",
      outcome: "ok",
      latencyMs: 1,
      createdAt: new Date(),
    }));
    await getDb().insert(schema.agentRuns).values(rows);

    const runsBefore = await runCount(conversation!.id);
    expect(runsBefore).toBeGreaterThanOrEqual(cap);

    await post(
      payload({
        waId,
        waMessageId: "wamid.cap.2",
        text: "One more question please",
      }),
    );

    // No extra model run; a handoff row is created instead.
    expect(await runCount(conversation!.id)).toBe(runsBefore);
    const handoffs = await getDb().query.handoffs.findMany({
      where: and(
        eq(schema.handoffs.tenantId, tenantId),
        eq(schema.handoffs.conversationId, conversation!.id),
      ),
    });
    expect(handoffs.some((h) => h.reason.includes("Turn limit"))).toBe(true);

    const customer = await customerFor(waId);
    expect(customer?.phoneE164).toBe(`+${waId}`);
  });

  it("stores an image receipt for staff without invoking the agent", async () => {
    const waId = "254711000104";
    await post(
      payload({
        waId,
        waMessageId: "wamid.image.1",
        type: "image",
        imageId: "media-receipt-9",
        caption: "Deposit receipt",
      }),
    );

    const messages = await messagesFor(waId);
    const inbound = messages.filter((m) => m.direction === "inbound");
    expect(inbound).toHaveLength(1);
    expect(inbound[0]!.type).toBe("image");
    expect(inbound[0]!.body).toContain("Deposit receipt");

    const conversation = await conversationFor(waId);
    expect(await runCount(conversation?.id)).toBe(0);
  });

  it("rejects a webhook with a bad signature when an app secret is configured", async () => {
    const saved = process.env.WHATSAPP_APP_SECRET;
    process.env.WHATSAPP_APP_SECRET = "itest-app-secret";
    try {
      const response = await app.request("/webhooks/whatsapp", {
        method: "POST",
        headers: { "content-type": "application/json", "x-hub-signature-256": "sha256=deadbeef" },
        body: JSON.stringify(
          payload({ waId: "254711000105", waMessageId: "wamid.badsig.1", text: "hi" }),
        ),
      });
      expect(response.status).toBe(401);
      expect(await customerFor("254711000105")).toBeFalsy();
    } finally {
      if (saved === undefined) delete process.env.WHATSAPP_APP_SECRET;
      else process.env.WHATSAPP_APP_SECRET = saved;
    }
  });
});
