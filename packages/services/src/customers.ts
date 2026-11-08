import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import { schema } from "@garden/db";
import { decryptJson, encryptJson } from "@garden/integrations";
import { audit, type ServiceContext } from "./context";
import { sendStaffAlert } from "./notify";
import {
  ForbiddenError,
  NotFoundError,
  normalisePhone,
  requireStaff,
  type Principal,
} from "./types";
import { withPrincipal } from "./context";

export type CustomerInput = {
  name: string;
  phone: string;
  email?: string | null;
  language?: string;
  tags?: string[];
  attributes?: Record<string, unknown>;
  notes?: string | null;
};

export async function upsertCustomerByPhone(
  ctx: ServiceContext,
  input: CustomerInput,
): Promise<typeof schema.customers.$inferSelect> {
  if (ctx.principal.type === "customer" && normalisePhone(input.phone) !== ctx.principal.phoneE164) {
    throw new ForbiddenError("Customers can only update their own profile.");
  }
  const phoneE164 = normalisePhone(input.phone);
  const existing = await ctx.db.query.customers.findFirst({
    where: and(eq(schema.customers.tenantId, ctx.tenantId), eq(schema.customers.phoneE164, phoneE164)),
  });
  if (existing) {
    const [updated] = await ctx.db
      .update(schema.customers)
      .set({
        name: input.name || existing.name,
        email: input.email === undefined ? existing.email : input.email,
        language: input.language ?? existing.language,
        tags: input.tags ?? existing.tags,
        attributes: input.attributes ?? existing.attributes,
        notes: input.notes === undefined ? existing.notes : input.notes,
      })
      .where(eq(schema.customers.id, existing.id))
      .returning();
    return updated!;
  }
  const [created] = await ctx.db
    .insert(schema.customers)
    .values({
      tenantId: ctx.tenantId,
      name: input.name,
      phoneE164,
      email: input.email ?? null,
      language: input.language ?? "en",
      tags: input.tags ?? [],
      attributes: input.attributes ?? {},
      notes: input.notes ?? null,
    })
    .returning();
  await audit(ctx, "customer.created", "customer", created!.id, { phoneE164 });
  return created!;
}

export async function getCustomer(ctx: ServiceContext, id: string) {
  const customer = await ctx.db.query.customers.findFirst({
    where: and(eq(schema.customers.id, id), eq(schema.customers.tenantId, ctx.tenantId)),
  });
  if (!customer) throw new NotFoundError("Customer", id);
  if (ctx.principal.type === "customer" && ctx.principal.customerId !== id) {
    throw new ForbiddenError("You can only view your own profile.");
  }
  return customer;
}

export async function findCustomerByPhone(ctx: ServiceContext, phone: string) {
  return ctx.db.query.customers.findFirst({
    where: and(
      eq(schema.customers.tenantId, ctx.tenantId),
      eq(schema.customers.phoneE164, normalisePhone(phone)),
    ),
  });
}

export async function listCustomers(
  ctx: ServiceContext,
  input: { search?: string; tag?: string; limit?: number } = {},
) {
  requireStaff(ctx.principal);
  const search = input.search?.trim();
  const rows = await ctx.db
    .select({
      customer: schema.customers,
      bookingCount: sql<number>`count(${schema.bookings.id})::int`,
      lifetimeValueKes: sql<number>`coalesce(sum(case when ${schema.bookings.status} in ('confirmed','completed') then ${schema.bookings.totalKes} else 0 end), 0)::int`,
      lastBookingAt: sql<Date | null>`max(${schema.bookings.startsAt})`,
    })
    .from(schema.customers)
    .leftJoin(schema.bookings, eq(schema.bookings.customerId, schema.customers.id))
    .where(
      and(
        eq(schema.customers.tenantId, ctx.tenantId),
        search
          ? or(
              ilike(schema.customers.name, `%${search}%`),
              ilike(schema.customers.phoneE164, `%${search}%`),
              ilike(schema.customers.email, `%${search}%`),
            )
          : undefined,
        input.tag ? sql`${input.tag} = any(${schema.customers.tags})` : undefined,
      ),
    )
    .groupBy(schema.customers.id)
    .orderBy(desc(schema.customers.createdAt))
    .limit(input.limit ?? 100);
  return rows;
}

export async function getCustomerProfile(ctx: ServiceContext, id: string) {
  const customer = await getCustomer(ctx, id);
  const bookings = await ctx.db
    .select({ booking: schema.bookings, offering: schema.offerings })
    .from(schema.bookings)
    .innerJoin(schema.offerings, eq(schema.bookings.offeringId, schema.offerings.id))
    .where(and(eq(schema.bookings.tenantId, ctx.tenantId), eq(schema.bookings.customerId, id)))
    .orderBy(desc(schema.bookings.startsAt));
  const conversations = await ctx.db.query.conversations.findMany({
    where: and(eq(schema.conversations.tenantId, ctx.tenantId), eq(schema.conversations.customerId, id)),
    orderBy: desc(schema.conversations.lastInboundAt),
  });
  const spend = bookings
    .filter((b) => ["confirmed", "completed"].includes(b.booking.status))
    .reduce((sum, b) => sum + b.booking.totalKes, 0);
  return { customer, bookings, conversations, lifetimeValueKes: spend };
}

export async function addNote(ctx: ServiceContext, customerId: string, note: string) {
  const customer = await getCustomer(ctx, customerId);
  const stamped = `${new Date().toISOString()} — ${note}`;
  const [updated] = await ctx.db
    .update(schema.customers)
    .set({ notes: customer.notes ? `${customer.notes}\n${stamped}` : stamped })
    .where(eq(schema.customers.id, customerId))
    .returning();
  await audit(ctx, "customer.note", "customer", customerId, { note });
  return updated!;
}

export async function updateTags(ctx: ServiceContext, customerId: string, tags: string[]) {
  requireStaff(ctx.principal);
  const [updated] = await ctx.db
    .update(schema.customers)
    .set({ tags })
    .where(and(eq(schema.customers.id, customerId), eq(schema.customers.tenantId, ctx.tenantId)))
    .returning();
  if (!updated) throw new NotFoundError("Customer", customerId);
  await audit(ctx, "customer.tags", "customer", customerId, { tags });
  return updated;
}

export async function logComplaint(
  ctx: ServiceContext,
  input: {
    customerId: string;
    summary: string;
    severity?: "low" | "normal" | "high" | "urgent";
    conversationId?: string | null;
  },
): Promise<{ handoffId: string }> {
  const customer = await getCustomer(ctx, input.customerId);
  let conversationId = input.conversationId ?? null;
  if (!conversationId) {
    const existing = await ctx.db.query.conversations.findFirst({
      where: and(
        eq(schema.conversations.tenantId, ctx.tenantId),
        eq(schema.conversations.customerId, customer.id),
      ),
    });
    if (existing) conversationId = existing.id;
    else {
      const [created] = await ctx.db
        .insert(schema.conversations)
        .values({
          tenantId: ctx.tenantId,
          customerId: customer.id,
          channel: "whatsapp",
          state: "open",
          handler: "wambo",
        })
        .returning();
      conversationId = created!.id;
    }
  }

  const [handoff] = await ctx.db
    .insert(schema.handoffs)
    .values({
      tenantId: ctx.tenantId,
      conversationId: conversationId!,
      reason: `Complaint (${input.severity ?? "normal"}): ${input.summary}`,
      priority: input.severity ?? "normal",
      status: "open",
    })
    .returning();

  await ctx.db
    .update(schema.conversations)
    .set({ handler: "human", state: "waiting_human" })
    .where(eq(schema.conversations.id, conversationId!));

  await ctx.db.insert(schema.messages).values({
    tenantId: ctx.tenantId,
    conversationId: conversationId!,
    direction: "inbound",
    type: "system",
    body: `Complaint logged: ${input.summary}`,
    toolCalls: [{ tool: "log_complaint", severity: input.severity ?? "normal" }],
  });

  await sendStaffAlert(
    ctx,
    `Complaint from ${customer.name} (${customer.phoneE164}): ${input.summary}`,
  );
  await audit(ctx, "complaint.logged", "handoff", handoff!.id, {
    customerId: customer.id,
    severity: input.severity ?? "normal",
  });
  return { handoffId: handoff!.id };
}

/* ───────────────────────── Sensitive data ───────────────────────── */

export function setSensitiveData(
  ctx: ServiceContext,
  customerId: string,
  data: Record<string, unknown>,
  consentAt: Date | null,
): Promise<void> {
  return (async () => {
    requireStaff(ctx.principal);
    await ctx.db
      .insert(schema.customerSensitive)
      .values({
        customerId,
        tenantId: ctx.tenantId,
        dataEncrypted: encryptJson(data),
        consentAt,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: schema.customerSensitive.customerId,
        set: { dataEncrypted: encryptJson(data), consentAt, updatedAt: new Date() },
      });
    await audit(ctx, "customer.sensitive.updated", "customer", customerId, { fields: Object.keys(data) });
  })();
}

export async function getSensitiveData(
  ctx: ServiceContext,
  customerId: string,
): Promise<Record<string, unknown> | null> {
  requireStaff(ctx.principal);
  const row = await ctx.db.query.customerSensitive.findFirst({
    where: and(
      eq(schema.customerSensitive.customerId, customerId),
      eq(schema.customerSensitive.tenantId, ctx.tenantId),
    ),
  });
  if (!row) return null;
  return decryptJson<Record<string, unknown>>(row.dataEncrypted);
}

export async function deleteSensitiveData(ctx: ServiceContext, customerId: string): Promise<void> {
  requireStaff(ctx.principal);
  await ctx.db
    .delete(schema.customerSensitive)
    .where(
      and(
        eq(schema.customerSensitive.customerId, customerId),
        eq(schema.customerSensitive.tenantId, ctx.tenantId),
      ),
    );
  await audit(ctx, "customer.sensitive.deleted", "customer", customerId);
}

/* ───────────────────────── Public wrappers ───────────────────────── */

export async function customersFor(
  principal: Principal,
  input: { search?: string; tag?: string; limit?: number } = {},
) {
  return withPrincipal(principal, (ctx) => listCustomers(ctx, input));
}

export async function customerProfileFor(principal: Principal, id: string) {
  return withPrincipal(principal, (ctx) => getCustomerProfile(ctx, id));
}

export async function upsertCustomerFor(principal: Principal, input: CustomerInput) {
  return withPrincipal(principal, (ctx) => upsertCustomerByPhone(ctx, input));
}
