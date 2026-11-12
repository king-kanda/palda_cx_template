import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@garden/db";
import { getBookingFor, kes, type EnrichedBooking } from "@garden/services";
import { getSession } from "@/lib/auth";
import { principalOf } from "@/lib/principal";
import { dateTime, shortDate, titleCase } from "@/lib/format";
import { PageHeader, StatusPill } from "@/components/ui";
import {
  cancelBookingAction,
  confirmBookingAction,
  createMeetingLinkAction,
  generateInvoiceAction,
  recordPaymentAction,
  requestReviewAction,
  rescheduleBookingAction,
  sendIntakeFormAction,
} from "../actions";

export const dynamic = "force-dynamic";

type Detail = EnrichedBooking & {
  invoices: { id: string; number: string; kind: string; status: string; totalKes: number; balanceKes: number }[];
  payments: { id: string; method: string; amountKes: number; status: string; mpesaReceipt: string | null; receivedAt: Date | null }[];
  reminders: { id: string; kind: string; sendAt: Date; status: string; template: string }[];
  review: { id: string; rating: number | null; comment: string | null; requestedAt: Date | null } | null;
  paidKes: number;
  balanceKes: number;
};

export default async function BookingDetailPage({
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

  const [verticalRow, tenantRow] = await Promise.all([
    getDb().query.tenantVertical.findFirst({
      where: eq(schema.tenantVertical.tenantId, session.tenantId),
      columns: { vertical: true },
    }),
    getDb().query.tenants.findFirst({
      where: eq(schema.tenants.id, session.tenantId),
      columns: { slug: true },
    }),
  ]);
  const isConsultancy = (verticalRow?.vertical ?? "venue") === "consultancy";
  const tenantSlug = tenantRow?.slug ?? "";

  let detail: Detail;
  try {
    detail = (await getBookingFor(principalOf(session), id)) as Detail;
  } catch {
    notFound();
  }

  const attributes = detail.booking.attributes as Record<string, unknown>;
  const eventType = String(attributes?.eventType ?? "—");
  const meetingUrl = typeof attributes?.meetingUrl === "string" ? attributes.meetingUrl : "";
  const intakeUrl = typeof attributes?.intakeUrl === "string" ? attributes.intakeUrl : "";

  return (
    <div>
      <PageHeader
        title={`${detail.customer.name} · ${detail.offering.name}`}
        subtitle={`${shortDate(detail.booking.startsAt)} · ${detail.resources.map((r) => r.name).join(", ")}`}
        action={
          <div className="flex gap-2">
            <Link className="btn btn-secondary" href="/bookings">
              ← Bookings
            </Link>
            {detail.booking.status === "hold" || detail.booking.status === "inquiry" ? (
              <form action={confirmBookingAction}>
                <input type="hidden" name="bookingId" value={detail.booking.id} />
                <button className="btn btn-primary">Confirm booking</button>
              </form>
            ) : null}
          </div>
        }
      />

      {query.error ? (
        <p className="mb-4 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{query.error}</p>
      ) : null}

      <div className="grid gap-5 xl:grid-cols-[1.4fr_1fr]">
        <div className="space-y-5">
          <section className="card p-5">
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <StatusPill status={detail.booking.status} />
              <StatusPill status={detail.booking.source} />
              <span className="text-xs text-[#78716c]">
                Created {dateTime(detail.booking.createdAt)}
              </span>
            </div>
            <dl className="grid gap-4 sm:grid-cols-2">
              <Field label="Customer">{detail.customer.name}</Field>
              <Field label="Phone">{detail.customer.phoneE164}</Field>
              <Field label="Event type">{titleCase(eventType)}</Field>
              <Field label="Guests">{detail.booking.partySize}</Field>
              <Field label="Start">{dateTime(detail.booking.startsAt)}</Field>
              <Field label="End">{dateTime(detail.booking.endsAt)}</Field>
              <Field label="Space">{detail.resources.map((r) => r.name).join(", ")}</Field>
              <Field label="Hold expires">
                {detail.booking.holdExpiresAt ? dateTime(detail.booking.holdExpiresAt) : "—"}
              </Field>
              <Field label="Notes">{detail.booking.notes || "—"}</Field>
            </dl>
          </section>

          <section className="card p-5">
            <h2 className="mb-3 text-sm font-semibold">Money</h2>
            <div className="grid gap-3 sm:grid-cols-4">
              <Money label="Subtotal" value={detail.booking.subtotalKes} />
              <Money label="Discount" value={detail.booking.discountKes} />
              <Money label="Tax" value={detail.booking.taxKes} />
              <Money label="Total" value={detail.booking.totalKes} strong />
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <Money label="Deposit required" value={detail.booking.depositRequiredKes} />
              <Money label="Paid" value={detail.paidKes} />
              <Money label="Balance" value={detail.balanceKes} strong />
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <form action={generateInvoiceAction} className="flex items-center gap-1">
                <input type="hidden" name="bookingId" value={detail.booking.id} />
                <select className="input !w-36 !py-1.5 text-xs" name="kind" defaultValue="deposit">
                  <option value="deposit">Deposit invoice</option>
                  <option value="balance">Balance invoice</option>
                  <option value="full">Full invoice</option>
                </select>
                <button className="btn btn-secondary text-xs">Generate invoice</button>
              </form>
            </div>

            <form action={recordPaymentAction} className="mt-4 grid gap-2 sm:grid-cols-5">
              <input type="hidden" name="bookingId" value={detail.booking.id} />
              <input
                className="input"
                type="number"
                name="amountKes"
                min={1}
                placeholder="Amount KES"
                required
              />
              <select className="input" name="method" defaultValue="mpesa">
                <option value="mpesa">M-Pesa</option>
                <option value="cash">Cash</option>
                <option value="bank">Bank</option>
                <option value="card">Card</option>
              </select>
              <select className="input" name="invoiceId" defaultValue="">
                <option value="">No invoice</option>
                {detail.invoices
                  .filter((i) => i.status !== "paid" && i.status !== "void")
                  .map((invoice) => (
                    <option key={invoice.id} value={invoice.id}>
                      {invoice.number} · {kes(invoice.balanceKes)} left
                    </option>
                  ))}
              </select>
              <input className="input" name="mpesaReceipt" placeholder="M-Pesa receipt" />
              <button className="btn btn-primary text-xs">Record payment</button>
            </form>
          </section>

          <section className="card p-5">
            <h2 className="mb-3 text-sm font-semibold">Invoices</h2>
            {detail.invoices.length === 0 ? (
              <p className="text-sm text-[#78716c]">No invoices yet.</p>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>Number</th>
                    <th>Kind</th>
                    <th>Total</th>
                    <th>Balance</th>
                    <th>Status</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {detail.invoices.map((invoice) => (
                    <tr key={invoice.id}>
                      <td className="font-medium">{invoice.number}</td>
                      <td className="capitalize">{invoice.kind}</td>
                      <td>{kes(invoice.totalKes)}</td>
                      <td>{kes(invoice.balanceKes)}</td>
                      <td>
                        <StatusPill status={invoice.status} />
                      </td>
                      <td>
                        <Link className="text-xs font-medium text-[#c2410c]" href={`/invoices/${invoice.id}`}>
                          Open
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <section className="card p-5">
            <h2 className="mb-3 text-sm font-semibold">Payments</h2>
            {detail.payments.length === 0 ? (
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
                  </tr>
                </thead>
                <tbody>
                  {detail.payments.map((payment) => (
                    <tr key={payment.id}>
                      <td>{dateTime(payment.receivedAt)}</td>
                      <td className="capitalize">{payment.method}</td>
                      <td>{kes(payment.amountKes)}</td>
                      <td className="font-mono text-xs">{payment.mpesaReceipt ?? "—"}</td>
                      <td>
                        <StatusPill status={payment.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </div>

        <div className="space-y-5">
          {isConsultancy ? (
            <section className="card p-5">
              <h2 className="mb-3 text-sm font-semibold">Online session</h2>
              <div className="space-y-4 text-sm">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-[#a8a29e]">
                    Meeting link
                  </p>
                  {meetingUrl ? (
                    <a
                      className="mt-0.5 block break-all text-xs font-medium text-[#c2410c]"
                      href={meetingUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {meetingUrl}
                    </a>
                  ) : (
                    <>
                      <p className="mt-0.5 text-[#78716c]">No link yet.</p>
                      <form action={createMeetingLinkAction} className="mt-2">
                        <input type="hidden" name="bookingId" value={detail.booking.id} />
                        <button className="btn btn-secondary w-full text-xs">
                          Create meeting link
                        </button>
                      </form>
                    </>
                  )}
                </div>

                <div className="border-t border-[#f5f5f4] pt-4">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-[#a8a29e]">
                    Intake form
                  </p>
                  <Link
                    className="mt-0.5 block break-all text-xs font-medium text-[#c2410c]"
                    href={intakeUrl || `/intake/${tenantSlug}/${detail.booking.id}`}
                    target="_blank"
                  >
                    {intakeUrl || `/intake/${tenantSlug}/${detail.booking.id}`}
                  </Link>
                  <form action={sendIntakeFormAction} className="mt-2">
                    <input type="hidden" name="bookingId" value={detail.booking.id} />
                    <button className="btn btn-secondary w-full text-xs">
                      {intakeUrl ? "Resend intake form" : "Send intake form"}
                    </button>
                  </form>
                  <p className="mt-2 text-xs text-[#a8a29e]">
                    Answers are stored encrypted and are never shared with the booking assistant.
                  </p>
                </div>
              </div>
            </section>
          ) : null}

          <section className="card p-5">
            <h2 className="mb-3 text-sm font-semibold">Actions</h2>
            <form action={rescheduleBookingAction} className="space-y-2">
              <input type="hidden" name="bookingId" value={detail.booking.id} />
              <p className="text-xs font-medium text-[#78716c]">Reschedule</p>
              <div className="flex gap-2">
                <input className="input" type="date" name="date" required />
                <input className="input" type="time" name="time" required defaultValue="09:00" />
              </div>
              <button className="btn btn-secondary w-full text-xs">Move booking</button>
            </form>

            <form action={cancelBookingAction} className="mt-4 space-y-2 border-t border-[#f5f5f4] pt-4">
              <input type="hidden" name="bookingId" value={detail.booking.id} />
              <p className="text-xs font-medium text-[#78716c]">Cancel</p>
              <input className="input" name="reason" placeholder="Reason" defaultValue="Staff cancellation" />
              <button className="btn btn-danger w-full text-xs">Cancel booking</button>
            </form>

            <form action={requestReviewAction} className="mt-4 border-t border-[#f5f5f4] pt-4">
              <input type="hidden" name="bookingId" value={detail.booking.id} />
              <button className="btn btn-secondary w-full text-xs">Request a review</button>
            </form>
          </section>

          <section className="card p-5">
            <h2 className="mb-3 text-sm font-semibold">Reminders</h2>
            {detail.reminders.length === 0 ? (
              <p className="text-sm text-[#78716c]">No reminders scheduled.</p>
            ) : (
              <ul className="space-y-2">
                {detail.reminders.map((reminder) => (
                  <li key={reminder.id} className="flex items-center justify-between gap-2 text-sm">
                    <div>
                      <p className="capitalize">{reminder.kind.replace(/_/g, " ")}</p>
                      <p className="text-xs text-[#a8a29e]">{dateTime(reminder.sendAt)}</p>
                    </div>
                    <StatusPill status={reminder.status} />
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="card p-5">
            <h2 className="mb-3 text-sm font-semibold">Review</h2>
            {detail.review ? (
              <div className="text-sm">
                <p className="text-lg">{detail.review.rating ? `${"★".repeat(detail.review.rating)}${"☆".repeat(5 - detail.review.rating)}` : "Requested"}</p>
                <p className="mt-1 text-[#57534e]">{detail.review.comment ?? "No comment yet."}</p>
              </div>
            ) : (
              <p className="text-sm text-[#78716c]">No review requested yet.</p>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[11px] font-semibold uppercase tracking-wider text-[#a8a29e]">{label}</dt>
      <dd className="mt-0.5 text-sm">{children}</dd>
    </div>
  );
}

function Money({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  return (
    <div className={`rounded-xl border border-[#f5f5f4] p-3 ${strong ? "bg-[#fff7ed]" : ""}`}>
      <p className="text-[10px] font-semibold uppercase tracking-wider text-[#a8a29e]">{label}</p>
      <p className={`mt-0.5 ${strong ? "text-lg font-semibold text-[#c2410c]" : "text-sm font-medium"}`}>
        {kes(value)}
      </p>
    </div>
  );
}
