import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { principalOf } from "@/lib/principal";
import { getDashboard, kes } from "@garden/services";
import { dateTime, shortDate } from "@/lib/format";
import { PageHeader, StatCard, StatusPill, EmptyState } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const data = await withPrincipalDashboard(session);
  const maxRevenue = Math.max(1, ...data.revenueSeries.map((r) => r.collectedKes));

  return (
    <div>
      <PageHeader
        title="Dashboard"
        subtitle={`${data.monthLabel} · today is ${shortDate(new Date())}`}
        action={
          <Link className="btn btn-primary" href="/bookings/new">
            + Add booking
          </Link>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard label="Confirmed this month" value={data.kpis.confirmedThisMonth} />
        <StatCard label="Pending / holds" value={data.kpis.activeHolds} />
        <StatCard label="Cancelled" value={data.kpis.cancelledThisMonth} />
        <StatCard
          label="Revenue this month"
          value={kes(data.kpis.revenueThisMonthKes)}
          accent
        />
        <StatCard
          label="Outstanding"
          value={kes(data.kpis.outstandingKes)}
          hint={`${data.kpis.needsHuman} item(s) need a human`}
        />
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-[1.3fr_1fr]">
        <section className="card p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold">Next 7 days</h2>
            <Link className="text-xs font-medium text-[#c2410c]" href="/calendar">
              Open calendar →
            </Link>
          </div>
          {data.next7Days.length === 0 ? (
            <p className="py-8 text-center text-sm text-[#78716c]">
              Nothing booked in the next week. A quiet garden.
            </p>
          ) : (
            <div className="divide-y divide-[#f5f5f4]">
              {data.next7Days.map((row) => (
                <Link
                  key={row.booking.id}
                  href={`/bookings/${row.booking.id}`}
                  className="flex items-center gap-3 py-3"
                >
                  <div className="w-20 shrink-0 text-xs text-[#78716c]">
                    {shortDate(row.booking.startsAt)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {row.offering.name} · {row.customer.name}
                    </p>
                    <p className="text-xs text-[#78716c]">
                      {dateTime(row.booking.startsAt)} · {row.booking.partySize} guests
                      {row.resources.length ? ` · ${row.resources.join(", ")}` : ""}
                    </p>
                  </div>
                  <StatusPill status={row.booking.status} />
                </Link>
              ))}
            </div>
          )}
        </section>

        <div className="space-y-5">
          <section className="card p-5">
            <h2 className="mb-3 text-sm font-semibold">Revenue · last 6 months</h2>
            <div className="flex h-40 items-end gap-2">
              {data.revenueSeries.map((point) => (
                <div key={point.month} className="flex flex-1 flex-col items-center gap-2">
                  <div
                    className="w-full rounded-t-lg bg-[#c2410c]/80"
                    style={{ height: `${Math.max(4, (point.collectedKes / maxRevenue) * 120)}px` }}
                    title={kes(point.collectedKes)}
                  />
                  <span className="text-[10px] text-[#a8a29e]">{point.label}</span>
                </div>
              ))}
            </div>
            <p className="mt-3 text-right text-xs text-[#78716c]">
              Collected this month:{" "}
              <span className="font-semibold text-[#1c1917]">{kes(data.kpis.revenueThisMonthKes)}</span>
            </p>
          </section>

          <section className="card p-5">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-semibold">Needs a human</h2>
              <Link className="text-xs font-medium text-[#c2410c]" href="/approvals">
                Approvals →
              </Link>
            </div>
            <p className="text-sm text-[#57534e]">
              {data.kpis.needsHuman === 0
                ? "All clear. Wambo is handling everything within policy."
                : `${data.kpis.needsHuman} handoff(s) or approval(s) waiting for you.`}
            </p>
            <div className="mt-3 flex gap-2">
              <Link className="btn btn-secondary text-xs" href="/wambo">
                Open inbox
              </Link>
              <Link className="btn btn-secondary text-xs" href="/approvals">
                Review queue
              </Link>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

async function withPrincipalDashboard(session: Awaited<ReturnType<typeof getSession>>) {
  if (!session) throw new Error("No session");
  return withTenantDashboard(session);
}

async function withTenantDashboard(session: NonNullable<Awaited<ReturnType<typeof getSession>>>) {
  const { withPrincipal } = await import("@garden/services");
  return withPrincipal(principalOf(session), (ctx) => getDashboard(ctx));
}
