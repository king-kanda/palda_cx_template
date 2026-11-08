import Link from "next/link";
import { redirect } from "next/navigation";
import {
  addDays,
  dateKey,
  endOfNairobiDay,
  getSettings,
  kes,
  listBlocks,
  listBookingsFor,
  listResources,
  monthBounds,
  monthKeyOf,
  monthMatrix,
  startOfNairobiDay,
  weekdayName,
  withPrincipal,
} from "@garden/services";
import { getSession } from "@/lib/auth";
import { principalOf } from "@/lib/principal";
import { shortTime } from "@/lib/format";
import { PageHeader, StatusPill } from "@/components/ui";
import { createBlockAction, deleteBlockAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; error?: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  const params = await searchParams;
  const principal = principalOf(session);
  const month = params.month && /^\d{4}-\d{2}$/.test(params.month) ? params.month : monthKeyOf(new Date());
  const bounds = monthBounds(month);
  const cells = monthMatrix(month);

  const [bookings, resources, blocks, settings] = await Promise.all([
    withPrincipal(principal, (ctx) =>
      listBookingsFor(principal, {
        from: bounds.start.toISOString(),
        to: bounds.end.toISOString(),
        limit: 300,
      }),
    ),
    withPrincipal(principal, (ctx) => listResources(ctx)),
    withPrincipal(principal, (ctx) => listBlocks(ctx, { from: bounds.start, to: bounds.end })),
    withPrincipal(principal, (ctx) => getSettings(ctx)),
  ]);

  const byDay = new Map<string, typeof bookings>();
  for (const row of bookings) {
    const key = dateKey(row.booking.startsAt);
    const list = byDay.get(key) ?? [];
    list.push(row);
    byDay.set(key, list);
  }

  const prevMonth = shiftMonth(month, -1);
  const nextMonth = shiftMonth(month, 1);
  const monthLabel = new Intl.DateTimeFormat("en-GB", {
    month: "long",
    year: "numeric",
    timeZone: "Africa/Nairobi",
  }).format(new Date(`${month}-15T09:00:00+03:00`));

  return (
    <div>
      <PageHeader
        title="Calendar"
        subtitle="Month view. Click a day to start a booking; block dates for maintenance or private use."
        action={
          <div className="flex items-center gap-2">
            <Link className="btn btn-secondary" href={`/calendar?month=${prevMonth}`}>
              ←
            </Link>
            <span className="min-w-36 text-center text-sm font-semibold">{monthLabel}</span>
            <Link className="btn btn-secondary" href={`/calendar?month=${nextMonth}`}>
              →
            </Link>
          </div>
        }
      />

      {params.error ? (
        <p className="mb-4 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{params.error}</p>
      ) : null}

      <div className="grid gap-5 xl:grid-cols-[1.5fr_1fr]">
        <section className="card overflow-hidden p-2">
          <div className="grid grid-cols-7">
            {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day) => (
              <div key={day} className="px-2 py-2 text-center text-[10px] font-semibold uppercase tracking-wider text-[#a8a29e]">
                {day}
              </div>
            ))}
            {alignToMonday(cells).map((day, index) =>
              day ? (
                <div
                  key={day}
                  className={`min-h-24 border-t border-[#f5f5f4] p-1.5 ${
                    day === dateKey(new Date()) ? "bg-[#fff7ed]/60" : ""
                  }`}
                >
                  <div className="mb-1 flex items-center justify-between px-0.5">
                    <Link
                      href={`/bookings/new?date=${day}`}
                      className="text-[11px] font-semibold text-[#57534e] hover:text-[#c2410c]"
                    >
                      {Number(day.slice(8, 10))}
                    </Link>
                    <span className="text-[9px] text-[#d6d3d1]">{weekdayName(day).slice(0, 3)}</span>
                  </div>
                  <div className="space-y-0.5">
                    {(byDay.get(day) ?? []).slice(0, 3).map((row) => (
                      <Link
                        key={row.booking.id}
                        href={`/bookings/${row.booking.id}`}
                        className={`block truncate rounded px-1 py-0.5 text-[9px] font-medium ${
                          row.booking.status === "hold"
                            ? "bg-amber-100 text-amber-800"
                            : row.booking.status === "cancelled"
                              ? "bg-rose-50 text-rose-700"
                              : "bg-[#fff7ed] text-[#9a3412]"
                        }`}
                        title={`${row.customer.name} · ${row.offering.name}`}
                      >
                        {shortTime(row.booking.startsAt)} {row.customer.name.split(" ")[0]}
                      </Link>
                    ))}
                    {(byDay.get(day) ?? []).length > 3 ? (
                      <p className="px-1 text-[9px] text-[#a8a29e]">
                        +{(byDay.get(day) ?? []).length - 3} more
                      </p>
                    ) : null}
                  </div>
                </div>
              ) : (
                <div key={`empty-${index}`} className="min-h-24 border-t border-[#f5f5f4] bg-[#fcfcfb]" />
              ),
            )}
          </div>
        </section>

        <div className="space-y-5">
          <section className="card p-5">
            <h2 className="mb-3 text-sm font-semibold">Block a date</h2>
            <form action={createBlockAction} className="space-y-2">
              <select className="input" name="resourceId" defaultValue={resources[0]?.id ?? ""} required>
                {resources.map((resource) => (
                  <option key={resource.id} value={resource.id}>
                    {resource.name}
                  </option>
                ))}
              </select>
              <input className="input" type="date" name="date" required defaultValue={dateKey(new Date())} />
              <div className="flex gap-2">
                <input className="input" type="time" name="from" defaultValue="08:00" />
                <input className="input" type="time" name="to" defaultValue="18:00" />
              </div>
              <input className="input" name="reason" placeholder="Maintenance, private use…" />
              <button className="btn btn-secondary w-full text-xs">Block period</button>
            </form>
          </section>

          <section className="card p-5">
            <h2 className="mb-3 text-sm font-semibold">Blocks this month</h2>
            {blocks.length === 0 ? (
              <p className="text-sm text-[#78716c]">No blocks this month.</p>
            ) : (
              <ul className="space-y-2">
                {blocks.map((block) => (
                  <li key={block.id} className="flex items-start justify-between gap-2 border-b border-[#f5f5f4] pb-2 text-sm last:border-0">
                    <div>
                      <p className="font-medium">{block.reason}</p>
                      <p className="text-xs text-[#a8a29e]">
                        {shortDateKey(dateKey(block.startsAt))} · {shortTime(block.startsAt)}–
                        {shortTime(block.endsAt)}
                      </p>
                    </div>
                    <form action={deleteBlockAction}>
                      <input type="hidden" name="blockId" value={block.id} />
                      <button className="text-[11px] font-medium text-rose-600">Remove</button>
                    </form>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="card p-5">
            <h2 className="mb-2 text-sm font-semibold">Colour key</h2>
            <div className="flex flex-wrap gap-3 text-xs text-[#57534e]">
              <span className="flex items-center gap-1"><i className="h-2.5 w-2.5 rounded-full bg-[#c2410c]" /> Confirmed</span>
              <span className="flex items-center gap-1"><i className="h-2.5 w-2.5 rounded-full bg-amber-300" /> Hold</span>
              <span className="flex items-center gap-1"><i className="h-2.5 w-2.5 rounded-full bg-rose-200" /> Cancelled</span>
            </div>
            <p className="mt-3 text-xs text-[#78716c]">
              {bookings.length} bookings in {monthLabel}. {settings.labels.resource}s: {resources.length}.
            </p>
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

/** monthMatrix already pads the first week; ensure a Monday-first layout. */
function alignToMonday(cells: string[]): string[] {
  const first = cells.find((c) => c !== "");
  if (!first) return cells;
  const weekday = new Date(`${first}T09:00:00+03:00`).getUTCDay(); // 0 Sun
  const offset = weekday === 0 ? 6 : weekday - 1;
  const padding = Array.from({ length: offset }, () => "");
  const total = [...padding, ...cells.filter(Boolean)];
  while (total.length % 7 !== 0) total.push("");
  return total;
}

function shortDateKey(key: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "Africa/Nairobi",
  }).format(new Date(`${key}T09:00:00+03:00`));
}
