import Link from "next/link";
import { redirect } from "next/navigation";
import {
  getAvailabilityGrid,
  listBookingsFor,
  listAllOfferings,
  listResources,
  dateKey,
  addDays,
  startOfNairobiDay,
  withPrincipal,
  kes,
} from "@garden/services";
import { getSession } from "@/lib/auth";
import { principalOf } from "@/lib/principal";
import { dateTime, shortDate, titleCase } from "@/lib/format";
import { EmptyState, PageHeader, StatCard, StatusPill } from "@/components/ui";

export const dynamic = "force-dynamic";

type Search = Promise<{ q?: string; status?: string; from?: string; to?: string; error?: string }>;

export default async function BookingsPage({ searchParams }: { searchParams: Search }) {
  const session = await getSession();
  if (!session) redirect("/login");
  const params = await searchParams;
  const principal = principalOf(session);

  const today = dateKey(new Date());
  const from = params.from ?? today;
  const to = params.to ?? addDays(today, 30);
  const status = params.status ? params.status.split(",") : undefined;

  const [grid, bookings, offerings, resources, settings] = await Promise.all([
    withPrincipal(principal, (ctx) =>
      getAvailabilityGrid(ctx, { fromDateKey: today, days: 14 }),
    ),
    withPrincipal(principal, (ctx) =>
      listBookingsFor(principal, {
        status,
        from: startOfNairobiDay(from).toISOString(),
        to: startOfNairobiDay(addDays(to, 1)).toISOString(),
        search: params.q,
        limit: 200,
      }),
    ),
    withPrincipal(principal, (ctx) => listAllOfferings(ctx)),
    withPrincipal(principal, (ctx) => listResources(ctx)),
    withPrincipal(principal, (ctx) =>
      import("@garden/services").then((svc) => svc.getSettings(ctx)),
    ),
  ]);

  const holds = bookings.filter((b) => b.booking.status === "hold").length;
  const confirmed = bookings.filter((b) => b.booking.status === "confirmed").length;
  const value = bookings.reduce((sum, b) => sum + b.booking.totalKes, 0);

  const dayLabel = (key: string) => {
    const date = new Date(`${key}T09:00:00+03:00`);
    return {
      weekday: new Intl.DateTimeFormat("en-GB", { weekday: "short", timeZone: "Africa/Nairobi" }).format(date),
      day: new Intl.DateTimeFormat("en-GB", { day: "numeric", timeZone: "Africa/Nairobi" }).format(date),
    };
  };

  return (
    <div>
      <PageHeader
        title={`${settings.labels.booking}s`}
        subtitle="Availability, holds and the full booking ledger."
        action={
          <Link className="btn btn-primary" href="/bookings/new">
            + Add {settings.labels.booking.toLowerCase()}
          </Link>
        }
      />

      {params.error ? (
        <p className="mb-4 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{params.error}</p>
      ) : null}

      <section className="card mb-5 p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold">
            {settings.labels.resource} availability · next 14 days
          </h2>
          <span className="text-xs text-[#78716c]">
            <span className="pill bg-emerald-50 text-emerald-700">free</span>{" "}
            <span className="pill bg-[#fff7ed] text-[#c2410c]">booked</span>{" "}
            <span className="pill bg-amber-50 text-amber-700">hold</span>{" "}
            <span className="pill bg-slate-100 text-slate-500">blocked</span>
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full border-separate border-spacing-1">
            <thead>
              <tr>
                <th className="w-40" />
                {grid.days.map((day) => {
                  const label = dayLabel(day);
                  return (
                    <th key={day} className="min-w-9 text-center text-[10px] font-medium text-[#a8a29e]">
                      <div>{label.weekday}</div>
                      <div className="text-xs font-semibold text-[#57534e]">{label.day}</div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {grid.resources.map((resource) => (
                <tr key={resource.id}>
                  <td className="pr-2 text-xs font-medium">
                    {resource.name}
                    {resource.capacity ? (
                      <span className="ml-1 text-[10px] text-[#a8a29e]">({resource.capacity})</span>
                    ) : null}
                  </td>
                  {grid.days.map((day) => {
                    const cell = grid.cells[`${resource.id}:${day}`];
                    const status = cell?.status ?? "free";
                    const tone =
                      status === "booked"
                        ? "bg-[#c2410c]/85"
                        : status === "hold"
                          ? "bg-amber-300"
                          : status === "blocked"
                            ? "bg-slate-300"
                            : "bg-emerald-100";
                    return (
                      <td key={`${resource.id}:${day}`} className="p-0">
                        {cell?.bookingId ? (
                          <Link
                            href={`/bookings/${cell.bookingId}`}
                            title={`${resource.name} · ${day} · ${status}`}
                            className={`block h-8 rounded-md ${tone}`}
                          />
                        ) : (
                          <Link
                            href={`/bookings/new?date=${day}&resourceId=${resource.id}`}
                            title={`${resource.name} · ${day} · ${status}`}
                            className={`block h-8 rounded-md ${tone} hover:opacity-80`}
                          />
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="In this view" value={bookings.length} />
        <StatCard label="Confirmed" value={confirmed} />
        <StatCard label="Holds" value={holds} />
        <StatCard label="Pipeline value" value={kes(value)} accent />
      </div>

      <section className="card overflow-hidden">
        <form className="flex flex-wrap items-center gap-2 border-b border-[#e7e5e0] p-3" action="/bookings">
          <input
            className="input max-w-xs"
            name="q"
            placeholder="Search customer, phone or package…"
            defaultValue={params.q}
          />
          <select className="input max-w-44" name="status" defaultValue={params.status ?? ""}>
            <option value="">All statuses</option>
            <option value="confirmed">Confirmed</option>
            <option value="hold">Hold</option>
            <option value="inquiry">Inquiry</option>
            <option value="completed">Completed</option>
            <option value="cancelled">Cancelled</option>
          </select>
          <input className="input max-w-40" type="date" name="from" defaultValue={from} />
          <input className="input max-w-40" type="date" name="to" defaultValue={to} />
          <button className="btn btn-secondary">Filter</button>
          <Link className="text-xs text-[#78716c] underline" href="/bookings">
            Reset
          </Link>
        </form>

        {bookings.length === 0 ? (
          <div className="p-6">
            <EmptyState
              title="No bookings in this view"
              body="Change the filters, or create the first booking for this period."
              href="/bookings/new"
              cta="Add booking"
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Customer</th>
                  <th>Event type</th>
                  <th>{settings.labels.resource}</th>
                  <th>Date</th>
                  <th>Guests</th>
                  <th>Total</th>
                  <th>Status</th>
                  <th>Source</th>
                </tr>
              </thead>
              <tbody>
                {bookings.map((row) => (
                  <tr key={row.booking.id}>
                    <td>
                      <Link className="font-medium hover:text-[#c2410c]" href={`/bookings/${row.booking.id}`}>
                        {row.customer.name}
                      </Link>
                      <div className="text-[11px] text-[#a8a29e]">{row.customer.phoneE164}</div>
                    </td>
                    <td className="capitalize">
                      {String((row.booking.attributes as Record<string, unknown>)?.eventType ?? "—")}
                    </td>
                    <td>{row.resources.map((r) => r.name).join(", ") || "—"}</td>
                    <td className="whitespace-nowrap">
                      {shortDate(row.booking.startsAt)}
                      <div className="text-[11px] text-[#a8a29e]">{dateTime(row.booking.startsAt).split("·")[1]}</div>
                    </td>
                    <td>{row.booking.partySize}</td>
                    <td className="whitespace-nowrap font-medium">{kes(row.booking.totalKes)}</td>
                    <td>
                      <StatusPill status={row.booking.status} />
                    </td>
                    <td>
                      <StatusPill status={row.booking.source} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <p className="mt-3 text-xs text-[#a8a29e]">
        Packages: {offerings.map((o) => `${o.name} (${kes(o.basePriceKes)})`).join(" · ")} ·{" "}
        {resources.length} {settings.labels.resource.toLowerCase()} resources ·{" "}
        {titleCase(status?.[0] ?? "all statuses")}
      </p>
    </div>
  );
}
