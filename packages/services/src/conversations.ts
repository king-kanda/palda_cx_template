import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { schema } from "@garden/db";
import { audit, type ServiceContext } from "./context";
import { sendFreeform } from "./notify";
import { ForbiddenError, NotFoundError, requireStaff } from "./types";

export async function ensureConversation(
  ctx: ServiceContext,
  customerId: string,
  channel: "whatsapp" | "web" = "whatsapp",
): Promise<typeof schema.conversations.$inferSelect> {
  const existing = await ctx.db.query.conversations.findFirst({
    where: and(
      eq(schema.conversations.tenantId, ctx.tenantId),
      eq(schema.conversations.customerId, customerId),
      eq(schema.conversations.channel, channel),
    ),
  });
  if (existing) return existing;
  const [created] = await ctx.db
    .insert(schema.conversations)
    .values({ tenantId: ctx.tenantId, customerId, channel, state: "open", handler: "wambo" })
    .onConflictDoNothing()
    .returning();
  if (created) return created;
  const again = await ctx.db.query.conversations.findFirst({
    where: and(
      eq(schema.conversations.tenantId, ctx.tenantId),
      eq(schema.conversations.customerId, customerId),
      eq(schema.conversations.channel, channel),
    ),
  });
  if (!again) throw new NotFoundError("Conversation", customerId);
  return again;
}

export async function recordInboundMessage(
  ctx: ServiceContext,
  input: {
    customerId: string;
    channel?: "whatsapp" | "web";
    waMessageId?: string | null;
    type?: string;
    text: string;
    raw?: Record<string, unknown>;
  },
): Promise<{ conversationId: string; messageId: string; duplicate: boolean }> {
  const channel = input.channel ?? "whatsapp";
  if (input.waMessageId) {
    const existing = await ctx.db.query.messages.findFirst({
      where: and(
        eq(schema.messages.tenantId, ctx.tenantId),
        eq(schema.messages.waMessageId, input.waMessageId),
      ),
    });
    if (existing) {
      return { conversationId: existing.conversationId, messageId: existing.id, duplicate: true };
    }
  }
  const conversation = await ensureConversation(ctx, input.customerId, channel);
  const [message] = await ctx.db
    .insert(schema.messages)
    .values({
      tenantId: ctx.tenantId,
      conversationId: conversation.id,
      direction: "inbound",
      waMessageId: input.waMessageId ?? null,
      type: input.type ?? "text",
      body: input.text,
    })
    .onConflictDoNothing()
    .returning();

  await ctx.db
    .update(schema.conversations)
    .set({
      lastInboundAt: new Date(),
      state: conversation.handler === "human" ? "waiting_human" : "open",
    })
    .where(eq(schema.conversations.id, conversation.id));

  if (!message) {
    const existing = input.waMessageId
      ? await ctx.db.query.messages.findFirst({
          where: and(
            eq(schema.messages.tenantId, ctx.tenantId),
            eq(schema.messages.waMessageId, input.waMessageId),
          ),
        })
      : null;
    return {
      conversationId: conversation.id,
      messageId: existing?.id ?? "",
      duplicate: true,
    };
  }
  return { conversationId: conversation.id, messageId: message.id, duplicate: false };
}

export async function appendOutboundMessage(
  ctx: ServiceContext,
  input: {
    conversationId: string;
    text: string;
    waMessageId?: string | null;
    type?: string;
    toolCalls?: unknown[];
  },
): Promise<string> {
  const conversation = await ctx.db.query.conversations.findFirst({
    where: and(
      eq(schema.conversations.id, input.conversationId),
      eq(schema.conversations.tenantId, ctx.tenantId),
    ),
  });
  if (!conversation) throw new NotFoundError("Conversation", input.conversationId);
  const [message] = await ctx.db
    .insert(schema.messages)
    .values({
      tenantId: ctx.tenantId,
      conversationId: input.conversationId,
      direction: "outbound",
      waMessageId: input.waMessageId ?? null,
      type: input.type ?? "text",
      body: input.text,
      toolCalls: input.toolCalls ?? null,
    })
    .returning();
  return message!.id;
}

export async function getConversationThread(
  ctx: ServiceContext,
  conversationId: string,
  limit = 100,
) {
  const conversation = await ctx.db.query.conversations.findFirst({
    where: and(
      eq(schema.conversations.id, conversationId),
      eq(schema.conversations.tenantId, ctx.tenantId),
    ),
  });
  if (!conversation) throw new NotFoundError("Conversation", conversationId);
  if (ctx.principal.type === "customer" && conversation.customerId !== ctx.principal.customerId) {
    throw new ForbiddenError("You can only view your own conversation.");
  }
  const customer = await ctx.db.query.customers.findFirst({
    where: eq(schema.customers.id, conversation.customerId),
  });
  const messages = await ctx.db.query.messages.findMany({
    where: and(
      eq(schema.messages.tenantId, ctx.tenantId),
      eq(schema.messages.conversationId, conversationId),
    ),
    orderBy: desc(schema.messages.createdAt),
    limit,
  });
  return {
    conversation,
    customer,
    messages: messages.reverse(),
  };
}

export async function listConversations(ctx: ServiceContext) {
  requireStaff(ctx.principal);
  const rows = await ctx.db
    .select({ conversation: schema.conversations, customer: schema.customers })
    .from(schema.conversations)
    .innerJoin(schema.customers, eq(schema.conversations.customerId, schema.customers.id))
    .where(eq(schema.conversations.tenantId, ctx.tenantId))
    .orderBy(desc(schema.conversations.lastInboundAt))
    .limit(100);
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.conversation.id);

  // The newest message of every conversation, in one query.
  const lastMessages = await ctx.db
    .selectDistinctOn([schema.messages.conversationId])
    .from(schema.messages)
    .where(and(eq(schema.messages.tenantId, ctx.tenantId), inArray(schema.messages.conversationId, ids)))
    .orderBy(schema.messages.conversationId, desc(schema.messages.createdAt));
  const lastBy = new Map(lastMessages.map((m) => [m.conversationId, m]));

  // Customer messages nobody has answered yet: inbound messages newer than the conversation's latest outbound one.
  const unanswered = await ctx.db
    .select({ conversationId: schema.messages.conversationId, count: sql<number>`count(*)::int` })
    .from(schema.messages)
    .where(
      and(
        eq(schema.messages.tenantId, ctx.tenantId),
        inArray(schema.messages.conversationId, ids),
        eq(schema.messages.direction, "inbound"),
        sql`${schema.messages.createdAt} > coalesce((
          select max(o.created_at) from messages o
          where o.conversation_id = ${schema.messages.conversationId} and o.direction = 'outbound'
        ), '-infinity'::timestamptz)`,
      ),
    )
    .groupBy(schema.messages.conversationId);
  const unansweredBy = new Map(unanswered.map((u) => [u.conversationId, u.count]));

  const out = rows.map((row) => ({
    ...row,
    lastMessage: lastBy.get(row.conversation.id) ?? null,
    unanswered: unansweredBy.get(row.conversation.id) ?? 0,
  }));
  // Newest activity first (an outbound reply also moves a chat up, as in WhatsApp).
  const at = (r: (typeof out)[number]) =>
    (r.lastMessage?.createdAt ?? r.conversation.lastInboundAt ?? r.conversation.createdAt).getTime();
  return out.sort((a, b) => at(b) - at(a));
}

export async function sendStaffMessage(
  ctx: ServiceContext,
  input: { conversationId: string; text: string },
): Promise<void> {
  requireStaff(ctx.principal);
  const thread = await getConversationThread(ctx, input.conversationId, 1);
  if (!thread.customer) throw new NotFoundError("Customer");
  await sendFreeform(ctx, thread.customer, input.text);
  await appendOutboundMessage(ctx, {
    conversationId: input.conversationId,
    text: input.text,
    toolCalls: [{ staff: true }],
  });
  await audit(ctx, "conversation.staff_message", "conversation", input.conversationId);
}

export async function listOpenHandoffsWithConversations(ctx: ServiceContext) {
  return ctx.db
    .select({ handoff: schema.handoffs, conversation: schema.conversations, customer: schema.customers })
    .from(schema.handoffs)
    .innerJoin(schema.conversations, eq(schema.handoffs.conversationId, schema.conversations.id))
    .innerJoin(schema.customers, eq(schema.conversations.customerId, schema.customers.id))
    .where(and(eq(schema.handoffs.tenantId, ctx.tenantId), eq(schema.handoffs.status, "open")))
    .orderBy(asc(schema.handoffs.createdAt));
}
