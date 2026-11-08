import Link from "next/link";
import { redirect } from "next/navigation";
import {
  EXPENSE_CATEGORIES,
  kes,
  listExpenses,
  monthBounds,
  monthKeyOf,
  profitAndLoss,
  withPrincipal,
} from "@garden/services";
import { getSession } from "@/lib/auth";
import { principalOf } from "@/lib/principal";
import { dateKey, shortDate, titleCase } from "@/lib/format";
import { EmptyState, PageHeader, StatCard } from "@/components/ui";
import { createExpenseAction, deleteExpenseAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function ExpensesPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; category?: string; error?: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  const params = await searchParams;
  const principal = principalOf(session);
  const month =
    params.month && /^\d{4}-\d{2}$/.test(params.month) ? params.month : monthKeyOf(new Date());
  const bounds = monthBounds(month);

  const [expenses, pnl] = await Promise.all([
    withPrincipal(principal, (ctx) =>
      listExpenses(ctx, {
        from: bounds.start,
        to: bounds.end,
        category: params.category,
        limit: 300,
      }),
    ),
    withPrincipal(principal, (ctx) => profitAndLoss(ctx, month)),
  ]);

  const today = dateKey(new Date());

  return (
    <div>
      <PageHeader
        title="Expenses & P&L"
        subtitle="Simple ledger for staff, utilities, decor, maintenance, marketing and supplies."
        action={
          <div className="flex items-center gap-2">
            <Link className="btn btn-secondary" href={`/expenses?month=${shiftMonth(month, -1)}`}>
              ←
            </Link>
            <span className="min-w-32 text-center text-sm font-semibold">{month}</span>
            <Link className="btn btn-secondary" href={`/expenses?month=${shiftMonth(month, 1)}`}>
              →
            </Link>
          </div>
        }
      />

      {params.error ? (
        <p className="mb-4 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{params.error}</p>
      ) : null}

      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Revenue" value={kes(pnl.revenueKes)} />
        <StatCard label="Refunds" value={kes(pnl.refundsKes)} />
        <StatCard label="Expenses" value={kes(pnl.expensesKes)} />
        <StatCard label="Net profit" value={kes(pnl.netKes)} accent />
      </div>

      <div className="grid gap-5 xl:grid-cols-[1.5fr_1fr]">
        <section className="card overflow-hidden">
          <form className="flex flex-wrap items-center gap-2 border-b border-[#e7e5e0] p-3" action="/expenses">
            <input type="hidden" name="month" value={month} />
            <select className="input max-w-44" name="category" defaultValue={params.category ?? ""}>
              <option value="">All categories</option>
              {EXPENSE_CATEGORIES.map((category) => (
                <option key={category} value={category}>
                  {titleCase(category)}
                </option>
              ))}
            </select>
            <button className="btn btn-secondary">Filter</button>
            <Link className="text-xs text-[#78716c] underline" href={`/expenses?month=${month}`}>
              Reset
            </Link>
          </form>

          {expenses.length === 0 ? (
            <div className="p-6">
              <EmptyState
                title="No expenses this month"
                body="Record expenses on the right to see your monthly P&L."
              />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Category</th>
                    <th>Vendor</th>
                    <th>Amount</th>
                    <th>Notes</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {expenses.map((expense) => (
                    <tr key={expense.id}>
                      <td className="whitespace-nowrap">{shortDate(expense.incurredOn)}</td>
                      <td>
                        <span className="pill bg-slate-100 text-slate-600">
                          {titleCase(expense.category)}
                        </span>
                      </td>
                      <td>{expense.vendor ?? "—"}</td>
                      <td className="font-medium">{kes(expense.amountKes)}</td>
                      <td className="max-w-52 truncate text-xs text-[#78716c]">{expense.notes ?? "—"}</td>
                      <td>
                        <form action={deleteExpenseAction}>
                          <input type="hidden" name="expenseId" value={expense.id} />
                          <button className="text-[11px] font-medium text-rose-600">Delete</button>
                        </form>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <div className="space-y-5">
          <section className="card p-5">
            <h2 className="mb-3 text-sm font-semibold">Add expense</h2>
            <form action={createExpenseAction} className="space-y-2">
              <select className="input" name="category" defaultValue="supplies">
                {EXPENSE_CATEGORIES.map((category) => (
                  <option key={category} value={category}>
                    {titleCase(category)}
                  </option>
                ))}
              </select>
              <input className="input" type="number" min={1} name="amountKes" placeholder="Amount KES" required />
              <input className="input" name="vendor" placeholder="Vendor" />
              <input className="input" type="date" name="incurredOn" defaultValue={today} />
              <input className="input" name="receiptUrl" placeholder="Receipt URL (optional)" />
              <input className="input" name="notes" placeholder="Notes" />
              <button className="btn btn-primary w-full">Save expense</button>
            </form>
          </section>

          <section className="card p-5">
            <h2 className="mb-3 text-sm font-semibold">By category</h2>
            {pnl.byCategory.length === 0 ? (
              <p className="text-sm text-[#78716c]">Nothing recorded this month.</p>
            ) : (
              <ul className="space-y-2">
                {pnl.byCategory.map((row) => (
                  <li key={row.category} className="flex items-center justify-between text-sm">
                    <span className="text-[#57534e]">{titleCase(row.category)}</span>
                    <span className="font-medium">{kes(row.amountKes)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

function shiftMonth(key: string, delta: number): string {
  const [year, month] = key.split("-").map(Number);
  const date = new Date(Date.UTC(year!, month! - 1 + delta, 15));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}
