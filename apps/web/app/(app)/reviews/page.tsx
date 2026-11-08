import Link from "next/link";
import { redirect } from "next/navigation";
import { listBookingsFor, listReviews, withPrincipal } from "@garden/services";
import { getSession } from "@/lib/auth";
import { principalOf } from "@/lib/principal";
import { dateTime, shortDate } from "@/lib/format";
import { EmptyState, PageHeader, StatCard } from "@/components/ui";
import { recordReviewAction, requestReviewAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function ReviewsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  const params = await searchParams;
  const principal = principalOf(session);

  const [reviews, completed] = await Promise.all([
    withPrincipal(principal, (ctx) => listReviews(ctx)),
    listBookingsFor(principal, { status: ["completed"], limit: 50 }),
  ]);

  const rated = reviews.filter((row) => row.review.rating != null);
  const average = rated.length
    ? rated.reduce((sum, row) => sum + (row.review.rating ?? 0), 0) / rated.length
    : 0;
  const promoters = rated.filter((row) => (row.review.rating ?? 0) >= 4).length;
  const detractors = rated.filter((row) => (row.review.rating ?? 0) <= 3).length;

  return (
    <div>
      <PageHeader
        title="Reviews"
        subtitle="Post-event feedback, ratings and recovery handoffs."
      />

      {params.error ? (
        <p className="mb-4 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{params.error}</p>
      ) : null}

      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Average rating" value={average ? average.toFixed(1) : "—"} accent />
        <StatCard label="Responses" value={rated.length} />
        <StatCard label="Promoters (4-5)" value={promoters} />
        <StatCard label="Recovery (1-3)" value={detractors} />
      </div>

      <div className="grid gap-5 xl:grid-cols-[1.5fr_1fr]">
        <section className="card overflow-hidden">
          <h2 className="border-b border-[#e7e5e0] px-4 py-3 text-sm font-semibold">Feedback</h2>
          {reviews.length === 0 ? (
            <div className="p-6">
              <EmptyState title="No reviews yet" body="Request a review from a completed booking." />
            </div>
          ) : (
            <div className="divide-y divide-[#f5f5f4]">
              {reviews.map((row) => (
                <div key={row.review.id} className="flex items-start gap-3 p-4">
                  <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-[#fff7ed] text-sm font-semibold text-[#c2410c]">
                    {row.review.rating ? `${row.review.rating}★` : "…"}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        className="text-sm font-medium hover:text-[#c2410c]"
                        href={`/customers/${row.customer.id}`}
                      >
                        {row.customer.name}
                      </Link>
                      <span className="text-[11px] text-[#a8a29e]">
                        {shortDate(row.review.receivedAt ?? row.review.requestedAt)}
                      </span>
                      {row.review.rating != null && row.review.rating <= 3 ? (
                        <span className="pill bg-rose-50 text-rose-700">needs recovery</span>
                      ) : null}
                    </div>
                    <p className="mt-1 text-sm text-[#57534e]">
                      {row.review.comment || "No comment yet."}
                    </p>
                    <Link
                      className="mt-1 inline-block text-[11px] text-[#a8a29e] hover:text-[#c2410c]"
                      href={`/bookings/${row.booking.id}`}
                    >
                      {row.booking.startsAt.toISOString().slice(0, 10)} · open booking
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <div className="space-y-5">
          <section className="card p-5">
            <h2 className="mb-3 text-sm font-semibold">Request a review</h2>
            {completed.length === 0 ? (
              <p className="text-sm text-[#78716c]">No completed bookings to follow up.</p>
            ) : (
              <form action={requestReviewAction} className="space-y-2">
                <select className="input" name="bookingId" required>
                  {completed.map((row) => (
                    <option key={row.booking.id} value={row.booking.id}>
                      {row.customer.name} · {dateTime(row.booking.startsAt)}
                    </option>
                  ))}
                </select>
                <button className="btn btn-primary w-full">Send review request</button>
              </form>
            )}
          </section>

          <section className="card p-5">
            <h2 className="mb-3 text-sm font-semibold">Record a review</h2>
            {completed.length === 0 ? (
              <p className="text-sm text-[#78716c]">Nothing to record yet.</p>
            ) : (
              <form action={recordReviewAction} className="space-y-2">
                <select className="input" name="bookingId" required>
                  {completed.map((row) => (
                    <option key={row.booking.id} value={row.booking.id}>
                      {row.customer.name} · {shortDate(row.booking.startsAt)}
                    </option>
                  ))}
                </select>
                <select className="input" name="rating" defaultValue="5">
                  <option value="5">5 — Excellent</option>
                  <option value="4">4 — Great</option>
                  <option value="3">3 — Okay</option>
                  <option value="2">2 — Poor</option>
                  <option value="1">1 — Bad</option>
                </select>
                <textarea className="input min-h-20" name="comment" placeholder="What did they say?" />
                <button className="btn btn-secondary w-full">Save review</button>
              </form>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
