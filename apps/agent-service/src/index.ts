import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { and, eq, gte, sql } from "drizzle-orm";
import { getDb, loadEnv, schema } from "@garden/db";
import {
  createHandoff,
  customerPrincipal,
  ensureConversation,
  getConversationThread,
  sendFreeform,
  sendStaffAlert,
  sendStaffMessage,
  staffPrincipal,
  systemPrincipal,
  withPrincipal,
  appendOutboundMessage,
  recordInboundMessage,
  upsertCustomerByPhone,
} from "@garden/services";
import {
  parseWebhook,
  verifyWebhookSignature,
  webhookChallenge,
} from "@garden/integrations";
import type { EngineMessage } from "@garden/engine";
import { runTurn } from "./run-service";
import { customerSummary } from "./run-service";

loadEnv();

const app = new Hono();

/** PLAN §5.5: max agent turns per conversation per hour. */
const MAX_TURNS_PER_HOUR = Number(process.env.MAX_TURNS_PER_HOUR ?? 20) || 20;

function internalAuthorised(header: string | undefined): boolean {
  const secret = process.env.INTERNAL_SECRET;
  if (!secret) return true; // local development only
  return header === secret;
}

async function readJson(request: Request): Promise<Record<string, unknown>> {
  try {
    const value = await request.json();
    return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

async function tenantBySlugOrId(input: {
  tenantSlug?: unknown;
  tenantId?: unknown;
}): Promise<typeof schema.tenants.$inferSelect | null> {
  const db = getDb();
  if (typeof input.tenantId === "string" && input.tenantId) {
    const tenant = await db.query.tenants.findFirst({
      where: eq(schema.tenants.id, input.tenantId),
    });
    if (tenant) return tenant;
  }
  const slug =
    (typeof input.tenantSlug === "string" && input.tenantSlug) ||
    process.env.DEFAULT_TENANT_SLUG ||
    "palda";
  return (await db.query.tenants.findFirst({ where: eq(schema.tenants.slug, slug) })) ?? null;
}

async function tenantForPhoneNumberId(phoneNumberId: string | null) {
  const db = getDb();
  if (phoneNumberId) {
    const rows = await db.query.tenantIntegrations.findMany({
      where: eq(schema.tenantIntegrations.kind, "whatsapp"),
    });
    const match = rows.find((row) => {
      const meta = row.meta as Record<string, unknown>;
      return meta.phoneNumberId === phoneNumberId;
    });
    if (match) {
      const tenant = await db.query.tenants.findFirst({
        where: eq(schema.tenants.id, match.tenantId),
      });
      if (tenant) return tenant;
    }
  }
  const slug = process.env.DEFAULT_TENANT_SLUG ?? "palda";
  return (await db.query.tenants.findFirst({ where: eq(schema.tenants.slug, slug) })) ?? null;
}

function whatsappMeta(payload: Record<string, unknown>): {
  phoneNumberId: string | null;
  contacts: { waId: string; name: string }[];
} {
  const entry = Array.isArray(payload.entry) ? (payload.entry[0] as Record<string, unknown>) : null;
  const change =
    entry && Array.isArray(entry.changes)
      ? ((entry.changes[0] as Record<string, unknown>).value as Record<string, unknown>)
      : null;
  const metadata = change?.metadata as Record<string, unknown> | undefined;
  const contacts = Array.isArray(change?.contacts)
    ? (change!.contacts as Record<string, unknown>[]).map((c) => ({
        waId: String(c.wa_id ?? ""),
        name: String(((c.profile as Record<string, unknown> | undefined)?.name ?? "") || "WhatsApp customer"),
      }))
    : [];
  return {
    phoneNumberId: typeof metadata?.phone_number_id === "string" ? metadata.phone_number_id : null,
    contacts,
  };
}

app.get("/health", (c) =>
  c.json({ ok: true, service: "garden-agent-service", time: new Date().toISOString() }),
);

/* ───────────────────────────── WhatsApp webhook ───────────────────────────── */

app.get("/webhooks/whatsapp", (c) => {
  const challenge = webhookChallenge(new URL(c.req.url).searchParams);
  if (!challenge) return c.text("Forbidden", 403);
  return c.text(challenge);
});

app.post("/webhooks/whatsapp", async (c) => {
  const rawBody = await c.req.text();
  const signature = c.req.header("x-hub-signature-256") ?? null;
  if (!verifyWebhookSignature(rawBody, signature)) {
    return c.json({ ok: false, error: "Invalid signature" }, 401);
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return c.json({ ok: false, error: "Invalid JSON" }, 400);
  }

  const { phoneNumberId, contacts } = whatsappMeta(payload);
  const tenant = await tenantForPhoneNumberId(phoneNumberId);
  if (!tenant) return c.json({ ok: true, ignored: "no tenant" });

  const messages = parseWebhook(payload);
  for (const message of messages) {
    const text = message.text?.trim();
    if (!text) continue;
    if (message.type === "image") {
      // v1: store the caption and ask for text. Staff see the flag in the inbox.
      await withPrincipal(systemPrincipal(tenant.id, "whatsapp"), async (ctx) => {
        const customer = await upsertCustomerByPhone(ctx, {
          name: contacts.find((c) => `+${c.waId}` === message.from)?.name ?? "WhatsApp customer",
          phone: message.from,
        });
        await recordInboundMessage(ctx, {
          customerId: customer.id,
          waMessageId: message.waMessageId,
          type: "image",
          text: text || "[image receipt]",
          raw: message.raw,
        });
      });
      continue;
    }
    if (message.type === "audio") {
      await withPrincipal(systemPrincipal(tenant.id, "whatsapp"), async (ctx) => {
        const customer = await upsertCustomerByPhone(ctx, {
          name: contacts.find((c) => `+${c.waId}` === message.from)?.name ?? "WhatsApp customer",
          phone: message.from,
        });
        await recordInboundMessage(ctx, {
          customerId: customer.id,
          waMessageId: message.waMessageId,
          type: "audio",
          text: "[voice note]",
          raw: message.raw,
        });
        await sendFreeform(
          ctx,
          customer,
          "Sorry, I can't listen to voice notes yet. Please send your question as text.",
        );
        await appendOutboundMessage(ctx, {
          conversationId: (
            await ensureConversation(ctx, customer.id, "whatsapp")
          ).id,
          text: "Sorry, I can't listen to voice notes yet. Please send your question as text.",
        });
      });
      continue;
    }

    try {
      await withPrincipal(systemPrincipal(tenant.id, "whatsapp"), async (ctx) => {
        const customer = await upsertCustomerByPhone(ctx, {
          name: contacts.find((c) => `+${c.waId}` === message.from)?.name ?? "WhatsApp customer",
          phone: message.from,
        });
        const recorded = await recordInboundMessage(ctx, {
          customerId: customer.id,
          waMessageId: message.waMessageId,
          type: message.type,
          text,
          raw: message.raw,
        });
        if (recorded.duplicate) return;

        const conversation = await ensureConversation(ctx, customer.id, "whatsapp");
        if (conversation.handler === "human") {
          // Automation stays silent while a person owns the conversation.
          return;
        }

        // Kenya DPA: a one-time consent line on first contact (PLAN §7).
        const recentMessages = await ctx.db.query.messages.findMany({
          where: eq(schema.messages.conversationId, conversation.id),
          columns: { id: true },
          limit: 2,
        });
        if (recentMessages.length === 1) {
          const consent =
            "Karibu! By chatting with us you agree that we store these messages to manage your booking and improve service. Reply STOP to opt out or ask for your data to be deleted.";
          await sendFreeform(ctx, customer, consent);
          await appendOutboundMessage(ctx, { conversationId: conversation.id, text: consent });
        }

        // PLAN §5.5: cap turns per conversation per hour; a runaway loop or a
        // spammer gets a human instead of another model run.
        const since = new Date(Date.now() - 60 * 60 * 1000);
        const [recentRuns] = await ctx.db
          .select({ count: sql<number>`count(*)::int` })
          .from(schema.agentRuns)
          .where(
            and(
              eq(schema.agentRuns.tenantId, tenant.id),
              eq(schema.agentRuns.conversationId, conversation.id),
              gte(schema.agentRuns.createdAt, since),
            ),
          );
        if ((recentRuns?.count ?? 0) >= MAX_TURNS_PER_HOUR) {
          await createHandoff(ctx, {
            conversationId: conversation.id,
            reason: "Turn limit reached for this hour (possible spam or runaway loop).",
            priority: "normal",
            notifyCustomer: true,
          });
          return;
        }

        const principal = customerPrincipal({
          tenantId: tenant.id,
          customerId: customer.id,
          phoneE164: customer.phoneE164,
        });

        const turn = await runTurn({
          tenantId: tenant.id,
          agentId: "wambo",
          principal,
          trigger: "whatsapp",
          conversationId: conversation.id,
          userText: text,
        });

        if (turn.busy) {
          await sendFreeform(ctx, customer, "Nashughulikia hii sasa hivi — one moment please.");
          return;
        }
        if (!turn.text) return;

        // handoffs.create already sent its own acknowledgement; still keep the
        // engine's words in the thread for staff context.
        if (!turn.result?.handoff) {
          await sendFreeform(ctx, customer, turn.text);
        }
        await appendOutboundMessage(ctx, {
          conversationId: conversation.id,
          text: turn.text,
          toolCalls: turn.result?.toolCalls ?? [],
        });
      });
    } catch (error) {
      console.error("[agent-service] whatsapp turn failed", error);
    }
  }

  return c.json({ ok: true, received: messages.length });
});

/* ───────────────────────────── Staff / internal ───────────────────────────── */

app.use("/internal/*", async (c, next) => {
  if (!internalAuthorised(c.req.header("x-internal-secret"))) {
    return c.json({ ok: false, error: "Unauthorised" }, 401);
  }
  await next();
});

/** Staff chat with the admin assistant. No customer conversation row. */
app.post("/internal/chat", async (c) => {
  const body = await readJson(c.req.raw);
  const tenant = await tenantBySlugOrId(body);
  if (!tenant) return c.json({ ok: false, error: "Tenant not found" }, 404);

  const userId = typeof body.userId === "string" ? body.userId : null;
  const user = userId
    ? await getDb().query.users.findFirst({
        where: and(eq(schema.users.tenantId, tenant.id), eq(schema.users.id, userId)),
      })
    : null;
  if (!user) return c.json({ ok: false, error: "User not found" }, 404);

  const agentId = typeof body.agentId === "string" ? body.agentId : "admin";
  const userText = typeof body.userText === "string" ? body.userText : undefined;
  const messages = Array.isArray(body.messages) ? (body.messages as EngineMessage[]) : undefined;

  const principal = staffPrincipal(tenant.id, user.id, user.role === "owner" ? "owner" : "staff");
  const turn = await runTurn({
    tenantId: tenant.id,
    agentId,
    principal,
    trigger: "staff",
    userText,
    messages,
    extraContext: typeof body.context === "string" ? body.context : "",
  });

  if (turn.busy) return c.json({ ok: false, busy: true, error: "Still working on the previous message." }, 409);
  return c.json({
    ok: true,
    text: turn.text,
    result: turn.result,
  });
});

/** Web-chat reply for a customer conversation (used by the Wambo inbox). */
app.post("/internal/reply", async (c) => {
  const body = await readJson(c.req.raw);
  const tenant = await tenantBySlugOrId(body);
  if (!tenant) return c.json({ ok: false, error: "Tenant not found" }, 404);
  const conversationId = typeof body.conversationId === "string" ? body.conversationId : null;
  if (!conversationId) return c.json({ ok: false, error: "conversationId is required" }, 400);

  const conversation = await getDb().query.conversations.findFirst({
    where: and(
      eq(schema.conversations.tenantId, tenant.id),
      eq(schema.conversations.id, conversationId),
    ),
  });
  if (!conversation) return c.json({ ok: false, error: "Conversation not found" }, 404);

  const customer = await getDb().query.customers.findFirst({
    where: eq(schema.customers.id, conversation.customerId),
  });
  if (!customer) return c.json({ ok: false, error: "Customer not found" }, 404);

  const userText = typeof body.text === "string" ? body.text : undefined;
  const principal = customerPrincipal({
    tenantId: tenant.id,
    customerId: customer.id,
    phoneE164: customer.phoneE164,
  });

  const turn = await runTurn({
    tenantId: tenant.id,
    agentId: "wambo",
    principal,
    trigger: "web",
    conversationId,
    userText,
  });
  if (turn.busy) return c.json({ ok: false, busy: true, error: "Still working." }, 409);
  if (!turn.text) return c.json({ ok: false, error: "No reply produced." }, 502);

  await withPrincipal(systemPrincipal(tenant.id, "wambo"), async (ctx) => {
    if (!turn.result?.handoff) await sendFreeform(ctx, customer, turn.text);
    await appendOutboundMessage(ctx, {
      conversationId,
      text: turn.text,
      toolCalls: turn.result?.toolCalls ?? [],
    });
  });

  return c.json({ ok: true, text: turn.text, result: turn.result });
});

/** Daily digest produced by the read-only ledger-digest agent. */
app.post("/internal/digest", async (c) => {
  const body = await readJson(c.req.raw);
  const tenant = await tenantBySlugOrId(body);
  if (!tenant) return c.json({ ok: false, error: "Tenant not found" }, 404);

  const turn = await runTurn({
    tenantId: tenant.id,
    agentId: "ledger-digest",
    principal: systemPrincipal(tenant.id, "ledger-digest"),
    trigger: "scheduled",
  });
  if (turn.busy) return c.json({ ok: false, busy: true }, 409);
  if (!turn.text) return c.json({ ok: false, error: "No digest produced." }, 502);

  await withPrincipal(systemPrincipal(tenant.id, "ledger-digest"), (ctx) =>
    sendStaffAlert(ctx, turn.text),
  );

  return c.json({ ok: true, text: turn.text, result: turn.result });
});

/** Staff sends a manual WhatsApp message from the inbox. */
app.post("/internal/staff-message", async (c) => {
  const body = await readJson(c.req.raw);
  const tenant = await tenantBySlugOrId(body);
  if (!tenant) return c.json({ ok: false, error: "Tenant not found" }, 404);
  const conversationId = typeof body.conversationId === "string" ? body.conversationId : null;
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!conversationId || !text) {
    return c.json({ ok: false, error: "conversationId and text are required" }, 400);
  }
  const user = body.userId
    ? await getDb().query.users.findFirst({
        where: and(
          eq(schema.users.tenantId, tenant.id),
          eq(schema.users.id, String(body.userId)),
        ),
      })
    : await getDb().query.users.findFirst({
        where: and(eq(schema.users.tenantId, tenant.id), eq(schema.users.role, "owner")),
      });
  if (!user) return c.json({ ok: false, error: "No staff user on this tenant." }, 404);

  await withPrincipal(
    staffPrincipal(tenant.id, user.id, user.role === "owner" ? "owner" : "staff"),
    (ctx) => sendStaffMessage(ctx, { conversationId, text }),
  );
  return c.json({ ok: true });
});

/** Event endpoint for the ops agent. Kept small and idempotent by payload. */
app.post("/internal/events", async (c) => {
  const body = await readJson(c.req.raw);
  const tenant = await tenantBySlugOrId(body);
  if (!tenant) return c.json({ ok: false, error: "Tenant not found" }, 404);
  const event = typeof body.event === "string" ? body.event : "unknown";

  if (event === "daily.digest") {
    return c.redirect("/internal/digest", 307);
  }

  // v1 ops agent is read-only: acknowledge and let the worker decide next steps.
  return c.json({ ok: true, event, tenantId: tenant.id, accepted: true });
});

/** Customer web-chat endpoint can read its own recent history for context. */
app.get("/internal/conversation/:id", async (c) => {
  const id = c.req.param("id");
  const body = { tenantId: c.req.query("tenantId") };
  const tenant = await tenantBySlugOrId(body);
  if (!tenant) return c.json({ ok: false, error: "Tenant not found" }, 404);
  const tenantId = tenant.id;
  const thread = await withPrincipal(systemPrincipal(tenantId, "web"), (ctx) =>
    getConversationThread(ctx, id, 100),
  );
  const summary = thread.customer ? await customerSummary(tenantId, thread.customer.id) : "";
  return c.json({ ok: true, ...thread, summary });
});

const port = Number(process.env.AGENT_SERVICE_PORT ?? process.env.PORT ?? 3100);
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`[agent-service] listening on http://localhost:${info.port}`);
});

export { app };
