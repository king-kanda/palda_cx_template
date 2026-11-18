import { Hono } from "hono";
import { and, eq, gte, sql } from "drizzle-orm";
import { getDb, loadEnv, schema } from "@garden/db";
import {
  createHandoff,
  customerPrincipal,
  ensureConversation,
  getConversationThread,
  getSettings,
  requestApproval,
  sendFreeform,
  sendNatural,
  sendStaffAlert,
  sendStaffMessage,
  staffPrincipal,
  systemPrincipal,
  withPrincipal,
  appendOutboundMessage,
  getWhatsappCreds,
  markWhatsappDisconnected,
  payFromButton,
  recordAppReply,
  recordInboundMessage,
  recordWhatsappSync,
  routeWhatsappAccount,
  routeWhatsappNumber,
  upsertCustomerByPhone,
  type ServiceContext,
} from "@garden/services";
import {
  PAY_BUTTON_PREFIX,
  parseWhatsAppPayload,
  sendTypingIndicator,
  verifyWebhookSignature,
  webhookChallenge,
  whatsappMode,
  type InboundWhatsAppMessage,
  type WhatsAppChange,
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

/**
 * Which business is this WhatsApp number? Each business connects its own number, recorded in whatsapp_routes. A number nobody has
 * connected is IGNORED: it must never fall through to some default business, or one customer's messages would land in
 * another's inbox. Two narrow development fallbacks remain: the single number in the environment belongs to the default business,
 * and in mock mode a hand-made payload with no number at all goes to the default business.
 */
async function tenantForWhatsappNumber(phoneNumberId: string | null) {
  const db = getDb();
  const defaultTenant = async () =>
    (await db.query.tenants.findFirst({ where: eq(schema.tenants.slug, process.env.DEFAULT_TENANT_SLUG ?? "palda") })) ?? null;
  if (phoneNumberId) {
    const route = await routeWhatsappNumber(phoneNumberId);
    if (route) return (await db.query.tenants.findFirst({ where: eq(schema.tenants.id, route.tenantId) })) ?? null;
    if (process.env.WHATSAPP_PHONE_NUMBER_ID && phoneNumberId === process.env.WHATSAPP_PHONE_NUMBER_ID) return defaultTenant();
    return null;
  }
  return whatsappMode() === "mock" ? defaultTenant() : null;
}

/**
 * Phase 6 shadow mode: model-authored replies are held for staff approval
 * instead of being sent. Consent and deterministic template messages are not
 * affected. Returns whether the message went out.
 */
async function deliverAgentReply(
  ctx: ServiceContext,
  customer: typeof schema.customers.$inferSelect,
  conversationId: string,
  text: string,
): Promise<{ sent: boolean; approvalId?: string }> {
  const settings = await getSettings(ctx);
  if (!settings.shadowMode) {
    await sendNatural(ctx, customer, text);
    return { sent: true };
  }
  const approval = await requestApproval(ctx, {
    kind: "message_review",
    payload: { conversationId, customerId: customer.id, text },
    conversationId,
    requestedBy: "wambo:shadow",
  });
  await sendStaffAlert(
    ctx,
    `Wambo drafted a reply for ${customer.name}; approve it in the Approvals queue.`,
  );
  return { sent: false, approvalId: approval.id };
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

  // One request can carry changes for several businesses (each number is its own change), so route every change separately.
  // A failing change never blocks the others, and we always answer 200 so Meta doesn't keep retrying.
  let received = 0;
  let ignored = 0;
  for (const change of parseWhatsAppPayload(payload)) {
    try {
      if (change.field === "account_update") {
        await handleAccountUpdate(change);
        continue;
      }
      const tenant = await tenantForWhatsappNumber(change.phoneNumberId);
      if (!tenant) {
        ignored += 1;
        console.warn("[whatsapp] ignoring a change for a number no business has connected", change.phoneNumberId ?? "(none)");
        continue;
      }
      if (change.field === "smb_message_echoes") {
        await handleEchoes(tenant, change);
      } else if (change.field === "history" || change.field === "smb_app_state_sync") {
        await withPrincipal(systemPrincipal(tenant.id, "whatsapp"), (ctx) =>
          recordWhatsappSync(ctx, { field: change.field, phoneNumberId: change.phoneNumberId, raw: change.raw }),
        );
      } else if (change.messages.length > 0) {
        received += await handleMessages(tenant, change.contacts, change.messages);
      }
    } catch (error) {
      console.error("[agent-service] whatsapp change failed", change.field, error);
    }
  }
  return c.json({ ok: true, received, ...(ignored ? { ignored: "no tenant" } : {}) });
});

type TenantRow = typeof schema.tenants.$inferSelect;

/** Messages the business sent from the WhatsApp Business app on the same number: kept in the thread, and the agent goes quiet. */
async function handleEchoes(tenant: TenantRow, change: WhatsAppChange): Promise<void> {
  for (const echo of change.echoes) {
    await withPrincipal(systemPrincipal(tenant.id, "whatsapp"), (ctx) =>
      recordAppReply(ctx, { customerPhone: echo.to, waMessageId: echo.waMessageId, text: echo.text, type: echo.type }),
    );
  }
}

/** Meta says a connection ended (for example the WhatsApp Business app was idle too long). Stop sending for that business. */
async function handleAccountUpdate(change: WhatsAppChange): Promise<void> {
  const update = change.accountUpdate;
  if (!update || update.event !== "PARTNER_REMOVED") return;
  const tenantIds = new Set<string>();
  if (change.phoneNumberId) {
    const route = await routeWhatsappNumber(change.phoneNumberId);
    if (route) tenantIds.add(route.tenantId);
  }
  if (update.wabaId) for (const id of await routeWhatsappAccount(update.wabaId)) tenantIds.add(id);
  for (const tenantId of tenantIds) await markWhatsappDisconnected(tenantId, update.reason ?? "WhatsApp ended the connection.");
}

/** The customer tapped "Pay with M-Pesa". The prompt goes to the number they are writing from, and they are told so. */
async function handlePayButton(
  tenant: TenantRow,
  contacts: { waId: string; name: string }[],
  message: InboundWhatsAppMessage,
): Promise<void> {
  await withPrincipal(systemPrincipal(tenant.id, "whatsapp"), async (ctx) => {
    const customer = await upsertCustomerByPhone(ctx, {
      name: contacts.find((c) => `+${c.waId}` === message.from)?.name ?? "WhatsApp customer",
      phone: message.from,
    });
    const recorded = await recordInboundMessage(ctx, {
      customerId: customer.id,
      waMessageId: message.waMessageId,
      type: "button",
      text: message.text ?? "Pay with M-Pesa",
      raw: message.raw,
    });
    if (recorded.duplicate) return; // WhatsApp redelivered the tap: one prompt only
    const conversation = await ensureConversation(ctx, customer.id, "whatsapp");
    const invoiceId = (message.interactiveReply ?? "").slice(PAY_BUTTON_PREFIX.length);
    const result = await payFromButton(ctx, { invoiceId, fromPhone: message.from });
    await sendFreeform(ctx, customer, result.reply);
    await appendOutboundMessage(ctx, { conversationId: conversation.id, text: result.reply });
  });
}

async function handleMessages(
  tenant: TenantRow,
  contacts: { waId: string; name: string }[],
  messages: InboundWhatsAppMessage[],
): Promise<number> {
  const creds = await getWhatsappCreds(tenant.id);
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

    if (message.type === "button" && message.interactiveReply?.startsWith(PAY_BUTTON_PREFIX)) {
      // "Pay with M-Pesa" on a payment message: send the prompt right away, no model involved.
      await handlePayButton(tenant, contacts, message);
      continue;
    }

    try {
      // Store the inbound message and conversation first, in their own
      // committed transaction. The agent turn then runs on the shared pool:
      // running it inside this transaction would hide the new conversation
      // from the `agent_runs` FK and from tools that reference it.
      const prepared = await withPrincipal(
        systemPrincipal(tenant.id, "whatsapp"),
        async (ctx) => {
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
          if (recorded.duplicate) return null;

          const conversation = await ensureConversation(ctx, customer.id, "whatsapp");
          if (conversation.handler === "human") {
            // Automation stays silent while a person owns the conversation.
            return null;
          }

          // Kenya DPA: a one-time consent line on first contact (PLAN §7). Counts only real customer messages, so staff
          // "Test as customer" messages in the inbox can never make a real first message look like a later one.
          const recentMessages = await ctx.db.query.messages.findMany({
            where: and(
              eq(schema.messages.conversationId, conversation.id),
              eq(schema.messages.direction, "inbound"),
              sql`${schema.messages.type} <> 'test'`,
            ),
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
            return null;
          }

          return { customer, conversationId: conversation.id };
        },
      );
      if (!prepared) continue;

      const principal = customerPrincipal({
        tenantId: tenant.id,
        customerId: prepared.customer.id,
        phoneE164: prepared.customer.phoneE164,
      });

      void sendTypingIndicator(message.waMessageId, creds);
      const turn = await runTurn({
        tenantId: tenant.id,
        agentId: "wambo",
        principal,
        trigger: "whatsapp",
        conversationId: prepared.conversationId,
        userText: text,
      });

      if (turn.busy) {
        await withPrincipal(systemPrincipal(tenant.id, "whatsapp"), (ctx) =>
          sendFreeform(ctx, prepared.customer, "Nashughulikia hii sasa hivi, give me a minute."),
        );
        continue;
      }
      if (!turn.text) continue;

      await withPrincipal(systemPrincipal(tenant.id, "whatsapp"), async (ctx) => {
        // handoffs.create already sent its own acknowledgement; still keep the
        // engine's words in the thread for staff context.
        if (!turn.result?.handoff) {
          const delivery = await deliverAgentReply(
            ctx,
            prepared.customer,
            prepared.conversationId,
            turn.text,
          );
          if (!delivery.sent) {
            // Shadow mode: show the draft to staff in the thread; it is only
            // sent to the customer after approval.
            await appendOutboundMessage(ctx, {
              conversationId: prepared.conversationId,
              text: `[Draft awaiting approval] ${turn.text}`,
              type: "draft",
              toolCalls: turn.result?.toolCalls ?? [],
            });
            return;
          }
        }
        await appendOutboundMessage(ctx, {
          conversationId: prepared.conversationId,
          text: turn.text,
          toolCalls: turn.result?.toolCalls ?? [],
        });
      });
    } catch (error) {
      console.error("[agent-service] whatsapp turn failed", error);
    }
  }

  return messages.length;
}

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

  const startedAt = new Date();
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
    // Keep the staff member's test question in the thread (timed before the answer), so the transcript reads as a
    // conversation. Type "test", and the conversation's last inbound time is NOT touched: that drives WhatsApp's 24-hour
    // window, and a test must never open it.
    if (userText?.trim()) {
      await ctx.db.insert(schema.messages).values({
        tenantId: tenant.id,
        conversationId,
        direction: "inbound",
        type: "test",
        body: userText.trim(),
        createdAt: startedAt,
      });
    }
    if (!turn.result?.handoff) {
      const delivery = await deliverAgentReply(ctx, customer, conversationId, turn.text);
      if (!delivery.sent) {
        await appendOutboundMessage(ctx, {
          conversationId,
          text: `[Draft awaiting approval] ${turn.text}`,
          type: "draft",
          toolCalls: turn.result?.toolCalls ?? [],
        });
        return;
      }
    }
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

/** Ops watch: read-only scan; any proposal lands in the approvals queue. */
app.post("/internal/ops", async (c) => {
  const body = await readJson(c.req.raw);
  const tenant = await tenantBySlugOrId(body);
  if (!tenant) return c.json({ ok: false, error: "Tenant not found" }, 404);

  const turn = await runTurn({
    tenantId: tenant.id,
    agentId: "ops",
    principal: systemPrincipal(tenant.id, "ops"),
    trigger: "scheduled",
    userText:
      "Scan open handoffs, expiring holds, unmatched M-Pesa receipts and pending approvals. Report what needs attention, or propose at most one action for staff approval.",
    extraContext:
      typeof body.event === "string" ? `Triggered by event: ${body.event}.` : "Scheduled queue scan.",
  });
  if (turn.busy) return c.json({ ok: false, busy: true }, 409);
  if (!turn.text) return c.json({ ok: false, error: "No ops report produced." }, 502);

  await withPrincipal(systemPrincipal(tenant.id, "ops"), (ctx) =>
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

  if (event === "ops.scan" || event === "handoff.created" || event === "hold.expiring") {
    return c.redirect("/internal/ops", 307);
  }

  // Unknown events are acknowledged; no model run is spent on them.
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

/**
 * Exported for integration tests and for `index.ts`, which owns the listener.
 * Keeping the app construction side-effect-free lets tests drive the real
 * webhook routes in-process without binding a port.
 */
export { app };
