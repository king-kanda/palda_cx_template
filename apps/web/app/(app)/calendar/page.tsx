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
  nairobiTime,
  startOfNairobiDay,
  weekdayName,
  withPrincipal,
} from "@garden/services";
import { getSession } from "@/lib/auth";
import { principalOf } from "@/lib/principal";
import { shortTime } from "@/lib/format";
import { PageHeader, StatusPill } from "@/components/ui";
import { createBlockAction, deleteBlockAction } from "./actions";
import { DragBooking, DropDay } from "./drag";

export const dynamic = "force-dynamic";

type View = "month" | "week" | "day";

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; view?: string; date?: string; error?: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  const params = await searchParams;
  const principal = principalOf(session);
  const view: View = params.view === "week" || params.view === "day" ? params.view : "month";
  const anchor =
    params.date && /^\d{4}-\d{2}-\d{2}$/.test(params.date) ? params.date : dateKey(new Date());
  const month =
    params.month && /^\d{4}-\d{2}$/.test(params.month)
      ? params.month
      : monthKeyOf(nairobiTime(anchor, "12:00"));

  const weekStart = startOfWeek(anchor);
  const weekDays = Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));
  const bounds =
    view === "month"
      ? monthBounds(month)
      : view === "week"
        ? {
            start: startOfNairobiDay(weekStart),
            end: endOfNairobiDay(addDays(weekStart, 6)),
          }
        : { start: startOfNairobiDay(anchor), end: endOfNairobiDay(anchor) };

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

  const cells = monthMatrix(month);
  const title =
    view === "month"
      ? monthLabel(month)
      : view === "week"
        ? `${shortDay(weekStart)} – ${shortDay(addDays(weekStart, 6))}`
        : shortDay(anchor);

  const prev =
    view === "month"
      ? `/calendar?month=${shiftMonth(month, -1)}`
      : view === "week"
        ? `/calendar?view=week&date=${addDays(weekStart, -7)}`
        : `/calendar?view=day&date=${addDays(anchor, -1)}`;
  const next =
    view === "month"
      ? `/calendar?month=${shiftMonth(month, 1)}`
      : view === "week"
        ? `/calendar?view=week&date=${addDays(weekStart, 7)}`
        : `/calendar?view=day&date=${addDays(anchor, 1)}`;

  return (
    <div>
      <PageHeader
        title="Calendar"
        subtitle={
          view === "month"
            ? "Month view. Click a day to start a booking; drag a booking to another day to reschedule."
            : view === "week"
              ? "Week view. Drag a booking to another day to reschedule."
              : "Day view. Drag is available in month and week views."
        }
        action={
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex rounded-lg border border-line bg-surface p-0.5 text-xs">
              {(["month", "week", "day"] as const).map((option) => (
                <Link
                  key={option}
                  href={
                    option === "month"
                      ? `/calendar?month=${month}`
                      : option === "week"
                        ? `/calendar?view=week&date=${anchor}`
                        : `/calendar?view=day&date=${anchor}`
                  }
                  className={`rounded-md px-2.5 py-1 font-medium capitalize ${
                    view === option ? "bg-brand-800 text-white" : "text-ink-muted"
                  }`}
                >
                  {option}
                </Link>
              ))}
            </div>
            <Link className="btn btn-secondary" href={prev}>
              ←
            </Link>
            <span className="min-w-36 text-center text-sm font-semibold">{title}</span>
            <Link className="btn btn-secondary" href={next}>
              →
            </Link>
          </div>
        }
      />

      {params.error ? (
        <p className="mb-4 rounded-xl border border-danger-600/30 bg-danger-100 px-4 py-3 text-sm text-danger-600">{params.error}</p>
      ) : null}

      <div className="grid gap-5 xl:grid-cols-[1.5fr_1fr]">
        <section className="card overflow-hidden p-2">
          {view === "month" ? (
            <>
              <div className="grid grid-cols-7">
                {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day) => (
                  <div
                    key={day}
                    className="px-2 py-2 text-center text-xs font-medium text-ink-muted"
                  >
                    {day}
                  </div>
                ))}
                {alignToMonday(cells).map((day, index) =>
                  day ? (
                    <DropDay
                      key={day}
                      date={day}
                      className={`min-h-24 border-t border-line p-1.5 ${
                        day === dateKey(new Date()) ? "bg-lime-100/60" : ""
                      }`}
                    >
                      <div className="mb-1 flex items-center justify-between px-0.5">
                        <Link
                          href={`/bookings/new?date=${day}`}
                          className="text-[11px] font-semibold text-ink-muted hover:text-brand-800"
                        >
                          {Number(day.slice(8, 10))}
                        </Link>
                        <span className="text-[9px] text-ink-subtle">
                          {weekdayName(day).slice(0, 3)}
                        </span>
                      </div>
                      <div className="space-y-0.5">
                        {(byDay.get(day) ?? []).slice(0, 3).map((row) => (
                          <DragBooking key={row.booking.id} bookingId={row.booking.id}>
                            {bookingChip(row)}
                          </DragBooking>
                        ))}
                        {(byDay.get(day) ?? []).length > 3 ? (
                          <p className="px-1 text-[9px] text-ink-subtle">
                            +{(byDay.get(day) ?? []).length - 3} more
                          </p>
                        ) : null}
                      </div>
                    </DropDay>
                  ) : (
                    <div
                      key={`empty-${index}`}
                      className="min-h-24 border-t border-line bg-surface-muted"
                    />
                  ),
                )}
              </div>
            </>
          ) : view === "week" ? (
            <div className="grid grid-cols-7">
              {weekDays.map((day) => (
                <DropDay
                  key={day}
                  date={day}
                  className={`min-h-64 border-l border-line p-1.5 first:border-l-0 ${
                    day === dateKey(new Date()) ? "bg-lime-100/60" : ""
                  }`}
                >
                  <div className="mb-1 flex items-center justify-between px-0.5">
                    <Link
                      href={`/bookings/new?date=${day}`}
                      className="text-[11px] font-semibold text-ink-muted hover:text-brand-800"
                    >
                      {Number(day.slice(8, 10))}
                    </Link>
                    <span className="text-[9px] text-ink-subtle">
                      {weekdayName(day).slice(0, 3)}
                    </span>
                  </div>
                  <div className="space-y-1">
                    {(byDay.get(day) ?? []).map((row) => (
                      <DragBooking key={row.booking.id} bookingId={row.booking.id}>
                        {bookingChip(row)}
                      </DragBooking>
                    ))}
                    {(byDay.get(day) ?? []).length === 0 ? (
                      <p className="px-1 text-[9px] text-ink-subtle">Free</p>
                    ) : null}
                  </div>
                </DropDay>
              ))}
            </div>
          ) : (
            <div className="p-3">
              <h2 className="mb-3 text-lg font-semibold">{shortDay(anchor)}</h2>
              {(byDay.get(anchor) ?? []).length === 0 ? (
                <p className="py-8 text-center text-sm text-ink-muted">
                  Nothing booked.{" "}
                  <Link className="text-brand-800 underline" href={`/bookings/new?date=${anchor}`}>
                    Add a booking
                  </Link>
                  .
                </p>
              ) : (
                <ul className="divide-y divide-line">
                  {(byDay.get(anchor) ?? []).map((row) => (
                    <li key={row.booking.id} className="flex items-center gap-3 py-3">
                      <span className="w-16 shrink-0 text-xs text-ink-muted">
                        {shortTime(row.booking.startsAt)}
                      </span>
                      <Link
                        href={`/bookings/${row.booking.id}`}
                        className="min-w-0 flex-1 truncate text-sm font-medium hover:text-brand-800"
                      >
                        {row.customer.name} · {row.offering.name}
                      </Link>
                      <StatusPill status={row.booking.status} />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </section>

        <div className="space-y-5">
          <section className="card p-5">
            <h2 className="mb-3 text-lg font-semibold">Block a date</h2>
            <form action={createBlockAction} className="space-y-2">
              <select className="input" name="resourceId" defaultValue={resources[0]?.id ?? ""} required>
                {resources.map((resource) => (
                  <option key={resource.id} value={resource.id}>
                    {resource.name}
                  </option>
                ))}
              </select>
              <input className="input" type="date" name="date" required defaultValue={anchor} />
              <div className="flex gap-2">
                <input className="input" type="time" name="from" defaultValue="08:00" />
                <input className="input" type="time" name="to" defaultValue="18:00" />
              </div>
              <input className="input" name="reason" placeholder="Maintenance, private use…" />
              <button className="btn btn-secondary w-full text-xs">Block period</button>
            </form>
          </section>

          <section className="card p-5">
            <h2 className="mb-3 text-lg font-semibold">Blocks this period</h2>
            {blocks.length === 0 ? (
              <p className="text-sm text-ink-muted">No blocks in this period.</p>
            ) : (
              <ul className="space-y-2">
                {blocks.map((block) => (
                  <li
                    key={block.id}
                    className="flex items-start justify-between gap-2 border-b border-line pb-2 text-sm last:border-0"
                  >
                    <div>
                      <p className="font-medium">{block.reason}</p>
                      <p className="text-xs text-ink-subtle">
                        {shortDateKey(dateKey(block.startsAt))} · {shortTime(block.startsAt)}–
                        {shortTime(block.endsAt)}
                      </p>
                    </div>
                    <form action={deleteBlockAction}>
                      <input type="hidden" name="blockId" value={block.id} />
                      <button className="text-[11px] font-medium text-danger-600">Remove</button>
                    </form>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="card p-5">
            <h2 className="mb-2 text-lg font-semibold">Colour key</h2>
            <div className="flex flex-wrap gap-3 text-xs text-ink-muted">
              <span className="flex items-center gap-1">
                <i className="h-2.5 w-2.5 rounded-full bg-brand-800" /> Confirmed
              </span>
              <span className="flex items-center gap-1">
                <i className="h-2.5 w-2.5 rounded-full bg-warning-600" /> Hold
              </span>
              <span className="flex items-center gap-1">
                <i className="h-2.5 w-2.5 rounded-full bg-danger-600/40" /> Cancelled
              </span>
            </div>
            <p className="mt-3 text-xs text-ink-muted">
              {bookings.length} bookings in {title}. {settings.labels.resource}s: {resources.length}.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}

function bookingChip(row: {
  booking: { id: string; status: string; startsAt: Date };
  customer: { name: string };
  offering: { name: string };
}) {
  return (
    <Link
      href={`/bookings/${row.booking.id}`}
      draggable={false}
      className={`block truncate rounded px-1 py-0.5 text-[9px] font-medium ${
        row.booking.status === "hold"
          ? "bg-warning-100 text-warning-600"
          : row.booking.status === "cancelled"
            ? "bg-danger-100 text-danger-600"
            : "bg-lime-100 text-brand-900"
      }`}
      title={`${row.customer.name} · ${row.offering.name}`}
    >
      {shortTime(row.booking.startsAt)} {row.customer.name.split(" ")[0]}
    </Link>
  );
}

function startOfWeek(dateKeyValue: string): string {
  const weekday = new Date(`${dateKeyValue}T09:00:00+03:00`).getUTCDay(); // 0 Sun
  const offset = weekday === 0 ? 6 : weekday - 1;
  return addDays(dateKeyValue, -offset);
}

function monthLabel(key: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    month: "long",
    year: "numeric",
    timeZone: "Africa/Nairobi",
  }).format(new Date(`${key}-15T09:00:00+03:00`));
}

function shortDay(key: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "Africa/Nairobi",
  }).format(new Date(`${key}T09:00:00+03:00`));
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
