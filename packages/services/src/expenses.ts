import { and, desc, eq, gte, lt, sql } from "drizzle-orm";
import { schema } from "@garden/db";
import { z } from "zod";
import { audit, type ServiceContext } from "./context";
import { endOfNairobiDay, monthBounds, monthKeyOf, startOfNairobiDay } from "./tz";
import { requireStaff, ValidationError } from "./types";

export const EXPENSE_CATEGORIES = [
  "staff",
  "utilities",
  "decor",
  "maintenance",
  "marketing",
  "supplies",
  "other",
] as const;

export const expenseInputSchema = z.object({
  category: z.enum(EXPENSE_CATEGORIES),
  amountKes: z.number().int().positive().max(100_000_000),
  vendor: z.string().max(160).optional().nullable(),
  incurredOn: z.string().min(10).max(40),
  receiptUrl: z.string().url().max(2000).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
});

export type ExpenseInput = z.infer<typeof expenseInputSchema>;

export async function listExpenses(
  ctx: ServiceContext,
  input: { from?: Date; to?: Date; category?: string; limit?: number } = {},
) {
  requireStaff(ctx.principal);
  return ctx.db.query.expenses.findMany({
    where: and(
      eq(schema.expenses.tenantId, ctx.tenantId),
      input.category ? eq(schema.expenses.category, input.category) : undefined,
      input.from ? gte(schema.expenses.incurredOn, input.from) : undefined,
      input.to ? lt(schema.expenses.incurredOn, input.to) : undefined,
    ),
    orderBy: desc(schema.expenses.incurredOn),
    limit: input.limit ?? 200,
  });
}

export async function createExpense(ctx: ServiceContext, input: ExpenseInput) {
  requireStaff(ctx.principal);
  const parsed = expenseInputSchema.parse(input);
  const incurredOn = new Date(parsed.incurredOn);
  if (Number.isNaN(incurredOn.getTime())) throw new ValidationError("Invalid expense date.");
  const [expense] = await ctx.db
    .insert(schema.expenses)
    .values({
      tenantId: ctx.tenantId,
      category: parsed.category,
      amountKes: parsed.amountKes,
      vendor: parsed.vendor ?? null,
      incurredOn,
      receiptUrl: parsed.receiptUrl ?? null,
      notes: parsed.notes ?? null,
    })
    .returning();
  await audit(ctx, "expense.created", "expense", expense!.id, {
    category: parsed.category,
    amountKes: parsed.amountKes,
  });
  return expense!;
}

export async function deleteExpense(ctx: ServiceContext, id: string): Promise<void> {
  requireStaff(ctx.principal);
  const deleted = await ctx.db
    .delete(schema.expenses)
    .where(and(eq(schema.expenses.id, id), eq(schema.expenses.tenantId, ctx.tenantId)))
    .returning({ id: schema.expenses.id });
  if (deleted.length === 0) throw new ValidationError("Expense not found.");
  await audit(ctx, "expense.deleted", "expense", id);
}

export type ProfitAndLoss = {
  monthKey: string;
  revenueKes: number;
  refundsKes: number;
  expensesKes: number;
  netKes: number;
  byCategory: { category: string; amountKes: number }[];
};

/** Monthly P&L: collected revenue - refunds - expenses, all in Nairobi months. */
export async function profitAndLoss(
  ctx: ServiceContext,
  monthKey = monthKeyOf(new Date()),
): Promise<ProfitAndLoss> {
  requireStaff(ctx.principal);
  const bounds = monthBounds(monthKey);

  const [revenueRow] = await ctx.db
    .select({
      collected: sql<number>`coalesce(sum(case when ${schema.payments.method} <> 'refund' then ${schema.payments.amountKes} else 0 end), 0)::int`,
      refunded: sql<number>`coalesce(sum(case when ${schema.payments.method} = 'refund' then ${schema.payments.amountKes} else 0 end), 0)::int`,
    })
    .from(schema.payments)
    .where(
      and(
        eq(schema.payments.tenantId, ctx.tenantId),
        eq(schema.payments.status, "succeeded"),
        gte(schema.payments.receivedAt, bounds.start),
        lt(schema.payments.receivedAt, bounds.end),
      ),
    );

  const byCategory = await ctx.db
    .select({
      category: schema.expenses.category,
      amountKes: sql<number>`coalesce(sum(${schema.expenses.amountKes}), 0)::int`,
    })
    .from(schema.expenses)
    .where(
      and(
        eq(schema.expenses.tenantId, ctx.tenantId),
        gte(schema.expenses.incurredOn, bounds.start),
        lt(schema.expenses.incurredOn, bounds.end),
      ),
    )
    .groupBy(schema.expenses.category);

  const expensesKes = byCategory.reduce((sum, row) => sum + row.amountKes, 0);
  const revenueKes = revenueRow?.collected ?? 0;
  const refundsKes = revenueRow?.refunded ?? 0;

  return {
    monthKey,
    revenueKes,
    refundsKes,
    expensesKes,
    netKes: revenueKes - refundsKes - expensesKes,
    byCategory: byCategory.map((row) => ({
      category: row.category,
      amountKes: row.amountKes,
    })),
  };
}

/** Daily P&L helper used by the digest and ops agent. */
export async function profitAndLossForDay(ctx: ServiceContext, dateKeyValue: string): Promise<ProfitAndLoss> {
  const from = startOfNairobiDay(dateKeyValue);
  const to = endOfNairobiDay(dateKeyValue);
  const month = await profitAndLoss(ctx, dateKeyValue.slice(0, 7));
  const rows = await ctx.db
    .select({
      category: schema.expenses.category,
      amountKes: sql<number>`coalesce(sum(${schema.expenses.amountKes}), 0)::int`,
    })
    .from(schema.expenses)
    .where(
      and(
        eq(schema.expenses.tenantId, ctx.tenantId),
        gte(schema.expenses.incurredOn, from),
        lt(schema.expenses.incurredOn, to),
      ),
    )
    .groupBy(schema.expenses.category);
  const expensesKes = rows.reduce((sum, row) => sum + row.amountKes, 0);
  return { ...month, expensesKes, byCategory: rows, netKes: month.revenueKes - month.refundsKes - expensesKes };
}
