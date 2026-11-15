import { and, desc, eq, gte } from "drizzle-orm";
import { schema } from "@garden/db";
import { audit, type ServiceContext } from "./context";
import { ensureConversation } from "./conversations";
import { upsertCustomerByPhone } from "./customers";

/**
 * Coexistence: the business keeps using the WhatsApp Business app on the same number as our agent. When a person replies to a
 * customer from their phone, Meta tells us (an "echo"). We keep that reply in the thread so everyone sees the whole
 * conversation, and the agent goes quiet for that conversation until someone hands it back in the inbox, so the agent never
 * talks over a person.
 */

export type AppReplyResult = { recorded: boolean; reason?: "duplicate" | "own_message" };

const OWN_MESSAGE_WINDOW_MS = 15 * 60 * 1000;
const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

export async function recordAppReply(
  ctx: ServiceContext,
  input: { customerPhone: string; waMessageId: string; text: string | null; type: string },
): Promise<AppReplyResult> {
  // Meta can deliver the same echo more than once.
  const seen = await ctx.db.query.messages.findFirst({
    where: and(eq(schema.messages.tenantId, ctx.tenantId), eq(schema.messages.waMessageId, input.waMessageId)),
    columns: { id: true },
  });
  if (seen) return { recorded: false, reason: "duplicate" };

  const customer = await upsertCustomerByPhone(ctx, { name: "WhatsApp customer", phone: input.customerPhone });
  const conversation = await ensureConversation(ctx, customer.id, "whatsapp");

  // An echo of a message OUR agent just sent must not be mistaken for a person taking over.
  if (input.text) {
    const recent = await ctx.db.query.messages.findMany({
      where: and(
        eq(schema.messages.tenantId, ctx.tenantId),
        eq(schema.messages.conversationId, conversation.id),
        eq(schema.messages.direction, "outbound"),
        gte(schema.messages.createdAt, new Date(Date.now() - OWN_MESSAGE_WINDOW_MS)),
      ),
      orderBy: desc(schema.messages.createdAt),
      limit: 20,
    });
    if (recent.some((m) => m.type !== "app_reply" && m.body && norm(m.body) === norm(input.text!))) {
      return { recorded: false, reason: "own_message" };
    }
  }

  await ctx.db.insert(schema.messages).values({
    tenantId: ctx.tenantId,
    conversationId: conversation.id,
    direction: "outbound",
    waMessageId: input.waMessageId,
    type: "app_reply",
    body: input.text ?? `[${input.type} sent from the WhatsApp Business app]`,
  });
  if (conversation.handler !== "human") {
    await ctx.db
      .update(schema.conversations)
      .set({ handler: "human", state: "waiting_human" })
      .where(eq(schema.conversations.id, conversation.id));
    await audit(ctx, "conversation.app_reply_takeover", "conversation", conversation.id);
  }
  return { recorded: true };
}

const MAX_STORED_BYTES = 400_000;

/**
 * Meta sends the number's contacts and past messages once, shortly after a coexistence number is connected. They arrive in chunks.
 * We keep the raw payload (in the integration log, per business) so nothing is lost, and import it into the inbox separately; a
 * payload too large to store is recorded as a summary.
 */
export async function recordWhatsappSync(
  ctx: ServiceContext,
  input: { field: string; phoneNumberId: string | null; raw: Record<string, unknown> },
): Promise<void> {
  const size = JSON.stringify(input.raw).length;
  await ctx.db.insert(schema.integrationsLog).values({
    tenantId: ctx.tenantId,
    kind: "whatsapp_sync",
    direction: "inbound",
    request: { field: input.field, phoneNumberId: input.phoneNumberId, ...(size <= MAX_STORED_BYTES ? { payload: input.raw } : { payloadBytes: size, note: "too large to store" }) },
    response: null,
    ok: true,
    error: null,
  });
}
