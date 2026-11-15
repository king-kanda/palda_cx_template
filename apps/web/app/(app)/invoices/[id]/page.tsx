import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  getInvoiceDetail,
  kes,
  listUnmatchedPayments,
  withPrincipal,
} from "@garden/services";
import { getSession } from "@/lib/auth";
import { principalOf } from "@/lib/principal";
import { dateTime, shortDate } from "@/lib/format";
import { PageHeader, Section, StatusPill } from "@/components/ui";
import {
  initiateStkAction,
  matchPaymentAction,
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
  let unmatched: Awaited<ReturnType<typeof listUnmatchedPayments>>;
  try {
    const principal = principalOf(session);
    detail = await withPrincipal(principal, (ctx) => getInvoiceDetail(ctx, id));
    unmatched = await withPrincipal(principal, (ctx) => listUnmatchedPayments(ctx));
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
        <p className="mb-4 rounded-xl border border-danger-600/30 bg-danger-100 px-4 py-3 text-sm text-danger-600">{query.error}</p>
      ) : null}

      <div className="grid gap-5 xl:grid-cols-[1.4fr_1fr]">
        <div className="space-y-5">
          <Section title="Invoice">
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <StatusPill status={invoice.status} />
              <span className="pill bg-neutral-100 capitalize text-neutral-600">{invoice.kind}</span>
              <span className="text-xs text-ink-muted">Issued {shortDate(invoice.issuedAt)}</span>
              <span className="text-xs text-ink-muted">Due {shortDate(invoice.dueAt)}</span>
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
                <dt className="text-ink-muted">Total</dt>
                <dd className="font-medium">{kes(invoice.totalKes)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-ink-muted">Balance</dt>
                <dd className="font-semibold text-brand-800">{kes(invoice.balanceKes)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-ink-muted">Paid</dt>
                <dd>{kes(invoice.totalKes - invoice.balanceKes)}</dd>
              </div>
            </dl>
          </Section>

          <Section title="Payments">
            {payments.length === 0 ? (
              <p className="text-sm text-ink-muted">No payments recorded.</p>
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
                            <button className="text-sm font-medium text-brand-700 hover:underline">Simulate success</button>
                          </form>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {pending.length > 0 ? (
              <p className="mt-2 text-xs text-ink-subtle">
                {pending.length} pending STK request(s). In mock mode you can simulate success.
              </p>
            ) : null}
          </Section>

          {unmatched.length > 0 ? (
            <Section title="Unmatched M-Pesa receipts">
              <p className="mb-3 text-xs text-ink-muted">
                Receipts with no booking. Matching one attaches it to this invoice and updates the
                balance.
              </p>
              <ul className="space-y-2">
                {unmatched.map((payment) => (
                  <li
                    key={payment.id}
                    className="flex items-center justify-between gap-2 rounded-xl border border-line p-3 text-sm"
                  >
                    <div>
                      <p className="font-mono text-xs font-medium">{payment.mpesaReceipt ?? payment.id.slice(0, 8)}</p>
                      <p className="text-xs text-ink-subtle">
                        {kes(payment.amountKes)} · {payment.phone ?? "unknown phone"}
                      </p>
                    </div>
                    <form action={matchPaymentAction}>
                      <input type="hidden" name="invoiceId" value={invoice.id} />
                      <input type="hidden" name="bookingId" value={booking.id} />
                      <input type="hidden" name="paymentId" value={payment.id} />
                      <button className="btn btn-secondary text-xs">Match</button>
                    </form>
                  </li>
                ))}
              </ul>
            </Section>
          ) : null}
        </div>

        <div className="space-y-5">
          <Section title="M-Pesa STK push">
            <p className="mb-2 text-xs text-ink-muted">
              Send a payment prompt to the customer&apos;s phone for the balance.
            </p>
            <form action={initiateStkAction} className="space-y-2">
              <input type="hidden" name="invoiceId" value={invoice.id} />
              <input
                className="input"
                name="phone"
                defaultValue={customer.phoneE164}
                placeholder="2547…"
                required
              />
              <input
                className="input"
                type="number"
                name="amountKes"
                min={1}
                defaultValue={invoice.balanceKes || undefined}
                placeholder="Amount KES"
              />
              <button className="btn btn-primary w-full">Send STK push</button>
            </form>
          </Section>

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
                <dt className="text-ink-muted">Name</dt>
                <dd>
                  <Link className="font-medium hover:text-brand-800" href={`/customers/${customer.id}`}>
                    {customer.name}
                  </Link>
                </dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-ink-muted">Phone</dt>
                <dd className="font-mono text-xs">{customer.phoneE164}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-ink-muted">Booking</dt>
                <dd>
                  <Link className="font-medium hover:text-brand-800" href={`/bookings/${booking.id}`}>
                    {shortDate(booking.startsAt)}
                  </Link>
                </dd>
              </div>
            </dl>
          </Section>

          {invoice.status !== "paid" && invoice.status !== "void" ? (
            <Section title="Danger zone">
              <p className="mb-2 text-xs text-ink-muted">
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
