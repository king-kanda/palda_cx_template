import { and, desc, eq, inArray } from "drizzle-orm";
import { schema } from "@garden/db";
import { audit, type ServiceContext } from "./context";
import { sendFreeform, sendStaffAlert } from "./notify";
import { ForbiddenError, NotFoundError, requireStaff } from "./types";

export async function createHandoff(
  ctx: ServiceContext,
  input: {
    conversationId: string;
    reason: string;
    priority?: "low" | "normal" | "high" | "urgent";
    notifyCustomer?: boolean;
  },
): Promise<typeof schema.handoffs.$inferSelect> {
  const conversation = await ctx.db.query.conversations.findFirst({
    where: and(
      eq(schema.conversations.id, input.conversationId),
      eq(schema.conversations.tenantId, ctx.tenantId),
    ),
  });
  if (!conversation) throw new NotFoundError("Conversation", input.conversationId);
  if (ctx.principal.type === "customer" && conversation.customerId !== ctx.principal.customerId) {
    throw new ForbiddenError("You can only use your own conversation.");
  }
  const customer = await ctx.db.query.customers.findFirst({
    where: eq(schema.customers.id, conversation.customerId),
  });

  const [handoff] = await ctx.db
    .insert(schema.handoffs)
    .values({
      tenantId: ctx.tenantId,
      conversationId: conversation.id,
      reason: input.reason,
      priority: input.priority ?? "normal",
      status: "open",
    })
    .returning();

  await ctx.db
    .update(schema.conversations)
    .set({ handler: "human", state: "waiting_human" })
    .where(eq(schema.conversations.id, conversation.id));

  if (customer && input.notifyCustomer !== false) {
    await sendFreeform(ctx, customer, "A team member will respond shortly. Thank you for your patience.");
  }
  if (customer) {
    await sendStaffAlert(
      ctx,
      `Handoff (${input.priority ?? "normal"}): ${customer.name} (${customer.phoneE164}) — ${input.reason}`,
    );
  }
  await audit(ctx, "handoff.created", "handoff", handoff!.id, {
    priority: input.priority ?? "normal",
    reason: input.reason,
  });
  return handoff!;
}

export async function listHandoffs(ctx: ServiceContext, input: { status?: string } = {}) {
  return ctx.db
    .select({
      handoff: schema.handoffs,
      conversation: schema.conversations,
      customer: schema.customers,
    })
    .from(schema.handoffs)
    .innerJoin(schema.conversations, eq(schema.handoffs.conversationId, schema.conversations.id))
    .innerJoin(schema.customers, eq(schema.conversations.customerId, schema.customers.id))
    .where(
      and(
        eq(schema.handoffs.tenantId, ctx.tenantId),
        input.status ? eq(schema.handoffs.status, input.status) : undefined,
      ),
    )
    .orderBy(desc(schema.handoffs.createdAt))
    .limit(100);
}

export async function resolveHandoff(ctx: ServiceContext, handoffId: string): Promise<void> {
  requireStaff(ctx.principal);
  const handoff = await ctx.db.query.handoffs.findFirst({
    where: and(eq(schema.handoffs.id, handoffId), eq(schema.handoffs.tenantId, ctx.tenantId)),
  });
  if (!handoff) throw new NotFoundError("Handoff", handoffId);
  await ctx.db
    .update(schema.handoffs)
    .set({ status: "resolved", resolvedAt: new Date() })
    .where(eq(schema.handoffs.id, handoffId));
  await audit(ctx, "handoff.resolved", "handoff", handoffId);
}

export async function handBackToAgent(ctx: ServiceContext, conversationId: string): Promise<void> {
  requireStaff(ctx.principal);
  const conversation = await ctx.db.query.conversations.findFirst({
    where: and(
      eq(schema.conversations.id, conversationId),
      eq(schema.conversations.tenantId, ctx.tenantId),
    ),
  });
  if (!conversation) throw new NotFoundError("Conversation", conversationId);
  await ctx.db
    .update(schema.conversations)
    .set({ handler: "wambo", state: "open" })
    .where(eq(schema.conversations.id, conversationId));
  await ctx.db
    .update(schema.handoffs)
    .set({ status: "resolved", resolvedAt: new Date() })
    .where(
      and(
        eq(schema.handoffs.tenantId, ctx.tenantId),
        eq(schema.handoffs.conversationId, conversationId),
        eq(schema.handoffs.status, "open"),
      ),
    );
  await audit(ctx, "handoff.handed_back", "conversation", conversationId);
}

export async function takeOverConversation(ctx: ServiceContext, conversationId: string): Promise<void> {
  requireStaff(ctx.principal);
  const conversation = await ctx.db.query.conversations.findFirst({
    where: and(
      eq(schema.conversations.id, conversationId),
      eq(schema.conversations.tenantId, ctx.tenantId),
    ),
  });
  if (!conversation) throw new NotFoundError("Conversation", conversationId);
  await ctx.db
    .update(schema.conversations)
    .set({ handler: "human", state: "waiting_human" })
    .where(eq(schema.conversations.id, conversationId));
  await audit(ctx, "conversation.takeover", "conversation", conversationId);
}

export async function openHandoffCount(ctx: ServiceContext): Promise<number> {
  const rows = await ctx.db.query.handoffs.findMany({
    where: and(eq(schema.handoffs.tenantId, ctx.tenantId), eq(schema.handoffs.status, "open")),
    columns: { id: true },
  });
  return rows.length;
}

export { inArray };
