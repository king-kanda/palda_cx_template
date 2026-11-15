import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { customerProfileFor, kes } from "@garden/services";
import { getSession } from "@/lib/auth";
import { principalOf } from "@/lib/principal";
import { dateTime, shortDate, timeAgo, titleCase } from "@/lib/format";
import { PageHeader, Section, StatusPill } from "@/components/ui";
import { addNoteAction, eraseCustomerAction, updateTagsAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function CustomerProfilePage({
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

  let profile: Awaited<ReturnType<typeof customerProfileFor>>;
  try {
    profile = await customerProfileFor(principalOf(session), id);
  } catch {
    notFound();
  }

  const { customer, bookings, conversations, reviews, averageRating, lifetimeValueKes } =
    profile;

  return (
    <div>
      <PageHeader
        title={customer.name}
        subtitle={`${customer.phoneE164}${customer.email ? ` · ${customer.email}` : ""}`}
        action={
          <div className="flex gap-2">
            <Link className="btn btn-secondary" href="/customers">
              ← Customers
            </Link>
            <Link className="btn btn-primary" href={`/bookings/new?customerId=${customer.id}`}>
              + Booking
            </Link>
          </div>
        }
      />

      {query.error ? (
        <p className="mb-4 rounded-xl border border-danger-600/30 bg-danger-100 px-4 py-3 text-sm text-danger-600">{query.error}</p>
      ) : null}

      <div className="mb-5 grid gap-3 sm:grid-cols-4">
        <div className="card p-4">
          <p className="text-xs text-ink-muted">Lifetime value</p>
          <p className="mt-1 text-2xl font-semibold text-brand-800">{kes(lifetimeValueKes)}</p>
        </div>
        <div className="card p-4">
          <p className="text-xs text-ink-muted">Bookings</p>
          <p className="mt-1 text-2xl font-semibold">{bookings.length}</p>
        </div>
        <div className="card p-4">
          <p className="text-xs text-ink-muted">Language</p>
          <p className="mt-1 text-2xl font-semibold uppercase">{customer.language}</p>
        </div>
        <div className="card p-4">
          <p className="text-xs text-ink-muted">Customer since</p>
          <p className="mt-1 text-lg font-semibold">{shortDate(customer.createdAt)}</p>
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-[1.5fr_1fr]">
        <div className="space-y-5">
          <Section title="Bookings">
            {bookings.length === 0 ? (
              <p className="text-sm text-ink-muted">No bookings yet.</p>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Package</th>
                    <th>Guests</th>
                    <th>Total</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {bookings.map(({ booking, offering }) => (
                    <tr key={booking.id}>
                      <td>
                        <Link className="font-medium hover:text-brand-800" href={`/bookings/${booking.id}`}>
                          {shortDate(booking.startsAt)}
                        </Link>
                      </td>
                      <td>{offering.name}</td>
                      <td>{booking.partySize}</td>
                      <td>{kes(booking.totalKes)}</td>
                      <td>
                        <StatusPill status={booking.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Section>

          <Section title="Conversations">
            {conversations.length === 0 ? (
              <p className="text-sm text-ink-muted">No conversations yet.</p>
            ) : (
              <ul className="divide-y divide-line">
                {conversations.map((conversation) => (
                  <li key={conversation.id} className="flex items-center justify-between gap-3 py-2.5">
                    <div>
                      <p className="text-sm font-medium capitalize">{conversation.channel} · {conversation.handler}</p>
                      <p className="text-xs text-ink-subtle">
                        Last inbound {timeAgo(conversation.lastInboundAt)}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <StatusPill status={conversation.handler} />
                      <Link className="text-sm font-medium text-brand-700 hover:underline" href={`/wambo/${conversation.id}`}>
                        Open
                      </Link>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="Notes">
            <pre className="whitespace-pre-wrap text-sm text-ink-muted">
              {customer.notes || "No notes yet."}
            </pre>
            <form action={addNoteAction} className="mt-3 flex gap-2">
              <input type="hidden" name="customerId" value={customer.id} />
              <input className="input" name="note" placeholder="Add a note…" required />
              <button className="btn btn-secondary whitespace-nowrap">Add note</button>
            </form>
          </Section>
        </div>

        <div className="space-y-5">
          <Section title="Tags">
            <div className="mb-3 flex flex-wrap gap-1">
              {customer.tags.length ? (
                customer.tags.map((tag) => (
                  <span key={tag} className="pill bg-lime-100 text-brand-800">
                    {tag}
                  </span>
                ))
              ) : (
                <span className="text-sm text-ink-muted">No tags.</span>
              )}
            </div>
            <form action={updateTagsAction} className="flex gap-2">
              <input type="hidden" name="customerId" value={customer.id} />
              <input
                className="input"
                name="tags"
                defaultValue={customer.tags.join(", ")}
                placeholder="vip, wedding"
              />
              <button className="btn btn-secondary whitespace-nowrap">Save</button>
            </form>
          </Section>

          <Section title="Attributes">
            <dl className="space-y-2 text-sm">
              {Object.entries(customer.attributes as Record<string, unknown>).map(([key, value]) => (
                <div key={key} className="flex justify-between gap-3">
                  <dt className="capitalize text-ink-muted">{titleCase(key)}</dt>
                  <dd className="text-right">{String(value ?? "—")}</dd>
                </div>
              ))}
              {Object.keys(customer.attributes as Record<string, unknown>).length === 0 ? (
                <p className="text-ink-muted">No extra attributes.</p>
              ) : null}
            </dl>
          </Section>

          <Section title="Timeline">
            <ul className="space-y-2 text-sm">
              {bookings.slice(0, 6).map(({ booking, offering }) => (
                <li key={booking.id} className="flex justify-between gap-2">
                  <span className="text-ink-muted">{offering.name}</span>
                  <span className="text-xs text-ink-subtle">{dateTime(booking.startsAt)}</span>
                </li>
              ))}
            </ul>
          </Section>

          <Section title="Reviews">
            {reviews.length === 0 ? (
              <p className="text-sm text-ink-muted">No reviews yet.</p>
            ) : (
              <>
                <p className="mb-2 text-sm text-ink-muted">
                  Average{" "}
                  <span className="font-semibold text-ink">
                    {averageRating?.toFixed(1)}
                  </span>{" "}
                  from {reviews.length} review(s).
                </p>
                <ul className="space-y-2">
                   {reviews.map((review) => (
                    <li key={review.id} className="rounded-xl border border-line p-3 text-sm">
                      <div className="flex items-center justify-between gap-2">
                        <span
                          className={
                            review.rating === null
                              ? "font-semibold text-ink-subtle"
                              : review.rating <= 3
                                ? "font-semibold text-danger-600"
                                : "font-semibold text-success-600"
                          }
                        >
                          {review.rating === null ? "pending" : `${review.rating}/5`}
                        </span>
                        <span className="text-xs text-ink-subtle">
                          {review.receivedAt ? shortDate(review.receivedAt) : "pending"}
                        </span>
                      </div>
                      {review.comment ? (
                        <p className="mt-1 text-ink-muted">{review.comment}</p>
                      ) : null}
                      {review.rating !== null && review.rating <= 3 ? (
                        <p className="mt-1 text-xs text-danger-600">Needs follow-up.</p>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </Section>

          {session.role === "owner" ? (
            <Section title="Data protection">
              <p className="text-sm text-ink-muted">
                Erase this customer&apos;s personal data (Kenya DPA). Names, phone, notes,
                tags, sensitive records and conversations are removed. Booking and payment
                totals are kept for accounting but stripped of personal details. This cannot
                be undone.
              </p>
              <form action={eraseCustomerAction} className="mt-3 space-y-2">
                <input type="hidden" name="customerId" value={customer.id} />
                <input
                  className="input"
                  name="confirm"
                  placeholder='Type ERASE to confirm'
                  autoComplete="off"
                  required
                />
                <button className="btn btn-secondary w-full">Erase personal data</button>
              </form>
            </Section>
          ) : null}
        </div>
      </div>
    </div>
  );
}
