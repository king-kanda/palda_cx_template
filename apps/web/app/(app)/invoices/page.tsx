import Link from "next/link";
import { redirect } from "next/navigation";
import { kes, listInvoices, listUnmatchedPayments, withPrincipal } from "@garden/services";
import { getSession } from "@/lib/auth";
import { principalOf } from "@/lib/principal";
import { shortDate } from "@/lib/format";
import { EmptyState, PageHeader, StatCard, StatusPill } from "@/components/ui";
import { sendInvoiceFromListAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string; error?: string; highlight?: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  const params = await searchParams;
  const principal = principalOf(session);

  const [rows, unmatched] = await Promise.all([
    withPrincipal(principal, (ctx) =>
      listInvoices(ctx, {
        status: params.status ? params.status.split(",") : undefined,
        search: params.q,
        limit: 200,
      }),
    ),
    withPrincipal(principal, (ctx) => listUnmatchedPayments(ctx)),
  ]);

  const outstanding = rows
    .filter((row) => ["sent", "partial", "overdue"].includes(row.invoice.status))
    .reduce((sum, row) => sum + row.invoice.balanceKes, 0);
  const paid = rows.filter((row) => row.invoice.status === "paid").length;
  const overdue = rows.filter((row) => row.invoice.status === "overdue").length;

  return (
    <div>
      <PageHeader
        title="Invoices & Payments"
        subtitle="Deposits, balances, M-Pesa reconciliation and PDF invoices."
      />

      {params.error ? (
        <p className="mb-4 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{params.error}</p>
      ) : null}

      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Invoices" value={rows.length} />
        <StatCard label="Outstanding" value={kes(outstanding)} accent />
        <StatCard label="Paid" value={paid} />
        <StatCard label="Overdue" value={overdue} />
      </div>

      {unmatched.length > 0 ? (
        <section className="card mb-5 p-5">
          <h2 className="mb-1 text-sm font-semibold">Unmatched M-Pesa receipts</h2>
          <p className="mb-3 text-xs text-[#78716c]">
            These payments have no booking. Match them from the booking page.
          </p>
          <table className="table">
            <thead>
              <tr>
                <th>Receipt</th>
                <th>Phone</th>
                <th>Amount</th>
                <th>Received</th>
              </tr>
            </thead>
            <tbody>
              {unmatched.map((payment) => (
                <tr key={payment.id}>
                  <td className="font-mono text-xs">{payment.mpesaReceipt}</td>
                  <td>{payment.phone ?? "—"}</td>
                  <td className="font-medium">{kes(payment.amountKes)}</td>
                  <td>{shortDate(payment.receivedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}

      <section className="card overflow-hidden">
        <form className="flex flex-wrap items-center gap-2 border-b border-[#e7e5e0] p-3" action="/invoices">
          <input className="input max-w-xs" name="q" placeholder="Invoice number or customer…" defaultValue={params.q} />
          <select className="input max-w-44" name="status" defaultValue={params.status ?? ""}>
            <option value="">All statuses</option>
            <option value="draft">Draft</option>
            <option value="sent">Sent</option>
            <option value="partial">Partial</option>
            <option value="paid">Paid</option>
            <option value="overdue">Overdue</option>
            <option value="void">Void</option>
          </select>
          <button className="btn btn-secondary">Filter</button>
          <Link className="text-xs text-[#78716c] underline" href="/invoices">
            Reset
          </Link>
        </form>

        {rows.length === 0 ? (
          <div className="p-6">
            <EmptyState
              title="No invoices yet"
              body="Generate a deposit or balance invoice from any booking."
              href="/bookings"
              cta="Go to bookings"
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Number</th>
                  <th>Customer</th>
                  <th>Kind</th>
                  <th>Total</th>
                  <th>Balance</th>
                  <th>Due</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.invoice.id}
                    className={params.highlight === row.invoice.id ? "bg-[#fff7ed]" : ""}
                  >
                    <td>
                      <Link className="font-medium hover:text-[#c2410c]" href={`/invoices/${row.invoice.id}`}>
                        {row.invoice.number}
                      </Link>
                      <div className="text-[11px] text-[#a8a29e]">{shortDate(row.invoice.createdAt)}</div>
                    </td>
                    <td>
                      <Link className="hover:text-[#c2410c]" href={`/customers/${row.customer.id}`}>
                        {row.customer.name}
                      </Link>
                    </td>
                    <td className="capitalize">{row.invoice.kind}</td>
                    <td className="font-medium">{kes(row.invoice.totalKes)}</td>
                    <td>{kes(row.invoice.balanceKes)}</td>
                    <td className="text-xs text-[#78716c]">{shortDate(row.invoice.dueAt)}</td>
                    <td>
                      <StatusPill status={row.invoice.status} />
                    </td>
                    <td>
                      <div className="flex items-center gap-2">
                        <Link className="text-xs font-medium text-[#c2410c]" href={`/invoices/${row.invoice.id}`}>
                          Open
                        </Link>
                        {["draft", "sent", "partial", "overdue"].includes(row.invoice.status) ? (
                          <form action={sendInvoiceFromListAction}>
                            <input type="hidden" name="invoiceId" value={row.invoice.id} />
                            <button className="text-xs font-medium text-[#57534e]">Send</button>
                          </form>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
