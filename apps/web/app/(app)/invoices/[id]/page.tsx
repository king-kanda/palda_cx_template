import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getInvoiceDetail, kes, withPrincipal } from "@garden/services";
import { getSession } from "@/lib/auth";
import { principalOf } from "@/lib/principal";
import { dateTime, shortDate } from "@/lib/format";
import { PageHeader, Section, StatusPill } from "@/components/ui";
import {
  recordInvoicePaymentAction,
  sendInvoiceFromListAction,
  simulateMpesaAction,
  voidInvoiceAction,
} from "../actions";

export const dynamic = "force-dynamic";

export default async function InvoiceDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  const { id } = await params;
  const query = await searchParams;

  let detail: Awaited<ReturnType<typeof getInvoiceDetail>>;
  try {
    detail = await withPrincipal(principalOf(session), (ctx) => getInvoiceDetail(ctx, id));
  } catch {
    notFound();
  }

  const { invoice, booking, customer, offering, payments, items } = detail;
  const pending = payments.filter((payment) => payment.status === "pending");

  return (
    <div>
      <PageHeader
        title={`Invoice ${invoice.number}`}
        subtitle={`${customer.name} · ${offering.name} · ${shortDate(booking.startsAt)}`}
        action={
          <div className="flex flex-wrap gap-2">
            <Link className="btn btn-secondary" href="/invoices">
              ← Invoices
            </Link>
            <a className="btn btn-secondary" href={`/invoices/${invoice.id}/pdf`} target="_blank" rel="noreferrer">
              Open PDF
            </a>
            <form action={sendInvoiceFromListAction}>
              <input type="hidden" name="invoiceId" value={invoice.id} />
              <button className="btn btn-primary">Send to customer</button>
            </form>
          </div>
        }
      />

      {query.error ? (
        <p className="mb-4 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{query.error}</p>
      ) : null}

      <div className="grid gap-5 xl:grid-cols-[1.4fr_1fr]">
        <div className="space-y-5">
          <Section title="Invoice">
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <StatusPill status={invoice.status} />
              <span className="pill bg-slate-100 capitalize text-slate-600">{invoice.kind}</span>
              <span className="text-xs text-[#78716c]">Issued {shortDate(invoice.issuedAt)}</span>
              <span className="text-xs text-[#78716c]">Due {shortDate(invoice.dueAt)}</span>
            </div>

            {items.length > 0 ? (
              <table className="table">
                <thead>
                  <tr>
                    <th>Description</th>
                    <th>Qty</th>
                    <th>Unit price</th>
                    <th>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={item.id}>
                      <td>{item.description}</td>
                      <td>{item.qty}</td>
                      <td>{kes(item.unitPriceKes)}</td>
                      <td>{kes(item.qty * item.unitPriceKes)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}

            <dl className="mt-4 ml-auto max-w-xs space-y-1.5 text-sm">
              <div className="flex justify-between">
                <dt className="text-[#78716c]">Total</dt>
                <dd className="font-medium">{kes(invoice.totalKes)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-[#78716c]">Balance</dt>
                <dd className="font-semibold text-[#c2410c]">{kes(invoice.balanceKes)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-[#78716c]">Paid</dt>
                <dd>{kes(invoice.totalKes - invoice.balanceKes)}</dd>
              </div>
            </dl>
          </Section>

          <Section title="Payments">
            {payments.length === 0 ? (
              <p className="text-sm text-[#78716c]">No payments recorded.</p>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Method</th>
                    <th>Amount</th>
                    <th>Receipt</th>
                    <th>Status</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {payments.map((payment) => (
                    <tr key={payment.id}>
                      <td>{dateTime(payment.receivedAt)}</td>
                      <td className="capitalize">{payment.method}</td>
                      <td>{kes(payment.amountKes)}</td>
                      <td className="font-mono text-xs">{payment.mpesaReceipt ?? "—"}</td>
                      <td>
                        <StatusPill status={payment.status} />
                      </td>
                      <td>
                        {payment.status === "pending" ? (
                          <form action={simulateMpesaAction}>
                            <input type="hidden" name="invoiceId" value={invoice.id} />
                            <input type="hidden" name="paymentId" value={payment.id} />
                            <button className="text-xs font-medium text-[#c2410c]">Simulate success</button>
                          </form>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {pending.length > 0 ? (
              <p className="mt-2 text-xs text-[#a8a29e]">
                {pending.length} pending STK request(s). In mock mode you can simulate success.
              </p>
            ) : null}
          </Section>
        </div>

        <div className="space-y-5">
          <Section title="Record a payment">
            <form action={recordInvoicePaymentAction} className="space-y-2">
              <input type="hidden" name="invoiceId" value={invoice.id} />
              <input
                className="input"
                type="number"
                name="amountKes"
                min={1}
                defaultValue={invoice.balanceKes || undefined}
                required
              />
              <select className="input" name="method" defaultValue="mpesa">
                <option value="mpesa">M-Pesa</option>
                <option value="cash">Cash</option>
                <option value="bank">Bank</option>
                <option value="card">Card</option>
              </select>
              <input className="input" name="mpesaReceipt" placeholder="M-Pesa receipt (optional)" />
              <button className="btn btn-primary w-full">Record payment</button>
            </form>
          </Section>

          <Section title="Customer">
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between gap-2">
                <dt className="text-[#78716c]">Name</dt>
                <dd>
                  <Link className="font-medium hover:text-[#c2410c]" href={`/customers/${customer.id}`}>
                    {customer.name}
                  </Link>
                </dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-[#78716c]">Phone</dt>
                <dd className="font-mono text-xs">{customer.phoneE164}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-[#78716c]">Booking</dt>
                <dd>
                  <Link className="font-medium hover:text-[#c2410c]" href={`/bookings/${booking.id}`}>
                    {shortDate(booking.startsAt)}
                  </Link>
                </dd>
              </div>
            </dl>
          </Section>

          {invoice.status !== "paid" && invoice.status !== "void" ? (
            <Section title="Danger zone">
              <p className="mb-2 text-xs text-[#78716c]">
                Voiding keeps the audit trail but removes the balance from reports.
              </p>
              <form action={voidInvoiceAction}>
                <input type="hidden" name="invoiceId" value={invoice.id} />
                <button className="btn btn-danger w-full text-xs">Void invoice</button>
              </form>
            </Section>
          ) : null}
        </div>
      </div>
    </div>
  );
}
