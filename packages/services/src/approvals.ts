import { and, desc, eq, sql } from "drizzle-orm";
import { schema } from "@garden/db";
import { withPrincipal, audit, type ServiceContext } from "./context";
import { requireStaff, ConflictError, NotFoundError, ServiceError, type Principal } from "./types";

export type ApprovalKind =
  | "refund"
  | "discount"
  | "cancel_outside_policy"
  | "bulk_send"
  | "override_price"
  | "other";

export const APPROVAL_KINDS: ApprovalKind[] = [
  "refund",
  "discount",
  "cancel_outside_policy",
  "bulk_send",
  "override_price",
  "other",
];

export async function requestApproval(
  ctx: ServiceContext,
  input: {
    kind: ApprovalKind;
    payload: Record<string, unknown>;
    conversationId?: string | null;
    expiresInHours?: number;
    requestedBy?: string;
  },
): Promise<typeof schema.approvals.$inferSelect> {
  const expiresAt = new Date(Date.now() + (input.expiresInHours ?? 24) * 3_600_000);
  const [approval] = await ctx.db
    .insert(schema.approvals)
    .values({
      tenantId: ctx.tenantId,
      requestedBy: input.requestedBy ?? actorLabel(ctx.principal),
      kind: input.kind,
      payload: input.payload,
      conversationId: input.conversationId ?? null,
      expiresAt,
      status: "pending",
    })
    .returning();
  await audit(ctx, "approval.requested", "approval", approval!.id, { kind: input.kind, payload: input.payload });
  return approval!;
}

function actorLabel(principal: Principal): string {
  switch (principal.type) {
    case "customer":
      return `customer:${principal.customerId}`;
    case "staff":
      return `staff:${principal.userId}`;
    case "system":
      return `system:${principal.label ?? "agent"}`;
  }
}

export async function listApprovals(
  ctx: ServiceContext,
  input: { status?: string } = {},
): Promise<(typeof schema.approvals.$inferSelect)[]> {
  return ctx.db.query.approvals.findMany({
    where: (a, { and: andOp, eq: eqOp }) =>
      andOp(eqOp(a.tenantId, ctx.tenantId), input.status ? eqOp(a.status, input.status) : undefined),
    orderBy: [desc(schema.approvals.createdAt)],
    limit: 200,
  });
}

export async function getApproval(ctx: ServiceContext, id: string) {
  const approval = await ctx.db.query.approvals.findFirst({
    where: and(eq(schema.approvals.id, id), eq(schema.approvals.tenantId, ctx.tenantId)),
  });
  if (!approval) throw new NotFoundError("Approval", id);
  return approval;
}

export async function decideApproval(
  ctx: ServiceContext,
  id: string,
  decision: "approved" | "rejected",
): Promise<typeof schema.approvals.$inferSelect> {
  requireStaff(ctx.principal);
  const approval = await getApproval(ctx, id);
  if (approval.status !== "pending") {
    throw new ConflictError(`Approval is already ${approval.status}.`);
  }
  if (approval.expiresAt.getTime() < Date.now()) {
    await ctx.db
      .update(schema.approvals)
      .set({ status: "expired" })
      .where(eq(schema.approvals.id, id));
    throw new ServiceError("EXPIRED", "This approval has expired.", 409);
  }
  const [updated] = await ctx.db
    .update(schema.approvals)
    .set({
      status: decision,
      decidedBy: `staff:${ctx.principal.type === "staff" ? ctx.principal.userId : "unknown"}`,
      decidedAt: new Date(),
    })
    .where(and(eq(schema.approvals.id, id), eq(schema.approvals.status, "pending")))
    .returning();
  if (!updated) throw new ConflictError("Approval was decided by someone else.");
  await audit(ctx, `approval.${decision}`, "approval", id, { kind: approval.kind });
  return updated;
}

export async function markApprovalExecuted(ctx: ServiceContext, id: string, result?: unknown) {
  await ctx.db
    .update(schema.approvals)
    .set({ status: "executed" })
    .where(and(eq(schema.approvals.id, id), eq(schema.approvals.tenantId, ctx.tenantId)));
  await audit(ctx, "approval.executed", "approval", id, { result: result as Record<string, unknown> });
}

export async function pendingApprovalCount(ctx: ServiceContext): Promise<number> {
  const [row] = await ctx.db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.approvals)
    .where(and(eq(schema.approvals.tenantId, ctx.tenantId), eq(schema.approvals.status, "pending")));
  return row?.count ?? 0;
}

export async function expireStaleApprovals(ctx: ServiceContext, now = new Date()): Promise<number> {
  const rows = await ctx.db
    .update(schema.approvals)
    .set({ status: "expired" })
    .where(
      and(
        eq(schema.approvals.tenantId, ctx.tenantId),
        eq(schema.approvals.status, "pending"),
        sql`${schema.approvals.expiresAt} < ${now}`,
      ),
    )
    .returning({ id: schema.approvals.id });
  return rows.length;
}

export async function requestApprovalForPrincipal(
  principal: Principal,
  input: Parameters<typeof requestApproval>[1],
) {
  return withPrincipal(principal, (ctx) => requestApproval(ctx, input));
}

export async function decideApprovalForPrincipal(
  principal: Principal,
  id: string,
  decision: "approved" | "rejected",
) {
  return withPrincipal(principal, (ctx) => decideApproval(ctx, id, decision));
}
