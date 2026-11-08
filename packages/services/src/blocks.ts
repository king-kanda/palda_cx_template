import { and, asc, eq, gt, lt } from "drizzle-orm";
import { schema } from "@garden/db";
import { audit, type ServiceContext } from "./context";
import { expandResourceIds } from "./availability";
import { SlotUnavailableError, NotFoundError, requireStaff, ValidationError } from "./types";
import { z } from "zod";

export const blockSchema = z.object({
  resourceId: z.string().uuid(),
  startsAt: z.string(),
  endsAt: z.string(),
  reason: z.string().max(300).optional(),
});

export async function createBlock(
  ctx: ServiceContext,
  input: z.infer<typeof blockSchema>,
): Promise<typeof schema.blocks.$inferSelect> {
  requireStaff(ctx.principal);
  const startsAt = new Date(input.startsAt);
  const endsAt = new Date(input.endsAt);
  if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime()) || endsAt <= startsAt) {
    throw new ValidationError("Block end must be after start.");
  }
  const resource = await ctx.db.query.resources.findFirst({
    where: and(eq(schema.resources.id, input.resourceId), eq(schema.resources.tenantId, ctx.tenantId)),
  });
  if (!resource) throw new NotFoundError("Resource", input.resourceId);

  const [block] = await ctx.db
    .insert(schema.blocks)
    .values({
      tenantId: ctx.tenantId,
      resourceId: resource.id,
      startsAt,
      endsAt,
      reason: input.reason ?? "Blocked",
      createdBy: ctx.principal.type === "staff" ? `staff:${ctx.principal.userId}` : "system",
    })
    .returning();

  const expanded = await expandResourceIds(ctx, [resource.id]);
  try {
    await ctx.db.insert(schema.resourceOccupancy).values(
      expanded.map((resourceId) => ({
        tenantId: ctx.tenantId,
        resourceId,
        blockId: block!.id,
        kind: "block",
        startsAt,
        endsAt,
        status: "active",
      })),
    );
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === "23P01") {
      throw new SlotUnavailableError("That period overlaps an existing booking or block.");
    }
    throw error;
  }
  await audit(ctx, "block.created", "block", block!.id, {
    resourceId: resource.id,
    startsAt: startsAt.toISOString(),
    endsAt: endsAt.toISOString(),
  });
  return block!;
}

export async function deleteBlock(ctx: ServiceContext, blockId: string): Promise<void> {
  requireStaff(ctx.principal);
  const block = await ctx.db.query.blocks.findFirst({
    where: and(eq(schema.blocks.id, blockId), eq(schema.blocks.tenantId, ctx.tenantId)),
  });
  if (!block) throw new NotFoundError("Block", blockId);
  await ctx.db
    .delete(schema.resourceOccupancy)
    .where(
      and(
        eq(schema.resourceOccupancy.tenantId, ctx.tenantId),
        eq(schema.resourceOccupancy.blockId, blockId),
      ),
    );
  await ctx.db.delete(schema.blocks).where(eq(schema.blocks.id, blockId));
  await audit(ctx, "block.deleted", "block", blockId);
}

export async function listBlocks(ctx: ServiceContext, input: { from?: Date; to?: Date } = {}) {
  return ctx.db.query.blocks.findMany({
    where: and(
      eq(schema.blocks.tenantId, ctx.tenantId),
      input.from ? gt(schema.blocks.endsAt, input.from) : undefined,
      input.to ? lt(schema.blocks.startsAt, input.to) : undefined,
    ),
    orderBy: asc(schema.blocks.startsAt),
    limit: 100,
  });
}
