import Link from "next/link";
import { redirect } from "next/navigation";
import {
  ArrowDownRight,
  ArrowUpRight,
  CalendarOff,
  CalendarPlus,
  CheckCircle2,
  MessageCircle,
  ReceiptText,
  type LucideIcon,
} from "lucide-react";
import { getSession } from "@/lib/auth";
import { principalOf } from "@/lib/principal";
import { getDashboard, getDashboardOverview, getSettings, kes, withPrincipal } from "@garden/services";
import { dateTime, shortDate, shortTime } from "@/lib/format";
import { activityHref, activityPhrase } from "@/lib/activity";
import { StatusPill } from "@/components/ui";
import { Donut, MoneyChart, type DonutSlice } from "./charts";

export const dynamic = "force-dynamic";

/** Fixed colour per booking source, so a source keeps its colour whatever else is on the chart. */
const SOURCE_COLOURS: Record<string, string> = {
  whatsapp: "var(--color-brand-800)",
  staff: "#5f9e86",
  web: "var(--color-lime-400)",
  internal: "#d9dedb",
};

const METHOD_LABELS: Record<string, string> = {
  mpesa: "M-Pesa",
  cash: "Cash",
  bank: "Bank",
  card: "Card",
  refund: "Refund",
};

function change(now: number, before: number): number | null {
  if (before <= 0) return null;
  return Math.round(((now - before) / before) * 100);
}

function Delta({ value, dark }: { value: number | null; dark?: boolean }) {
  if (value === null) return null;
  const up = value >= 0;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return (
    <span
      className={`inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-xs font-semibold tabular ${
        dark ? "bg-lime-400 text-brand-900" : up ? "bg-lime-100 text-brand-800" : "bg-danger-100 text-danger-600"
      }`}
      title="Compared with last month"
    >
      <Icon className="size-3.5" />
      {up ? "+" : ""}
      {value}%
    </span>
  );
}

function Tile({ value, label, delta, hint }: { value: string | number; label: string; delta?: number | null; hint?: string }) {
  return (
    <div className="card flex flex-col p-5">
      <div className="h-6">{delta !== undefined ? <Delta value={delta} /> : null}</div>
      <p className="mt-1 text-[1.75rem] font-bold leading-9 tabular">{value}</p>
      <p className="text-sm text-ink-muted">{label}</p>
      {hint ? <p className="mt-0.5 text-xs text-ink-subtle">{hint}</p> : null}
    </div>
  );
}

function initials(name: string) {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]!.toUpperCase())
      .join("") || "?"
  );
}

export default async function DashboardPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  const principal = principalOf(session);

  const [data, overview, settings] = await Promise.all([
    withPrincipal(principal, (ctx) => getDashboard(ctx)),
    withPrincipal(principal, (ctx) => getDashboardOverview(ctx)),
    withPrincipal(principal, (ctx) => getSettings(ctx)),
  ]);
  const { labels, agentName } = settings;
  const booking = labels.booking.toLowerCase();
  const bookings = labels.bookings.toLowerCase();
  const currentMonth = overview.money.at(-1)?.month ?? "";
  const yearCollected = overview.money.reduce((s, m) => s + m.collectedKes, 0);

  // A brand-new business has nothing booked yet: show the getting-started steps first.
  const isNewBusiness =
    data.next7Days.length === 0 &&
    data.kpis.confirmedThisMonth === 0 &&
    data.kpis.activeHolds === 0 &&
    data.kpis.cancelledThisMonth === 0 &&
    data.kpis.revenueThisMonthKes === 0 &&
    data.kpis.outstandingKes === 0;

  const sourceLabels: Record<string, string> = {
    whatsapp: `${agentName} on WhatsApp`,
    staff: "Your team",
    web: "Website",
    internal: "Internal",
  };
  const slices: DonutSlice[] = ["whatsapp", "staff", "web", "internal"]
    .map((key) => ({
      key,
      label: sourceLabels[key]!,
      count: overview.sources.find((s) => s.source === key)?.count ?? 0,
      color: SOURCE_COLOURS[key]!,
    }))
    .filter((s) => s.count > 0 || s.key !== "internal");
  const sourceTotal = slices.reduce((s, x) => s + x.count, 0);

  // Activity grouped by day, newest first.
  const days: { day: string; rows: typeof overview.activity }[] = [];
  for (const row of overview.activity) {
    const day = shortDate(row.createdAt);
    const last = days.at(-1);
    if (last && last.day === day) last.rows.push(row);
    else days.push({ day, rows: [row] });
  }

  const actions: { href: string; label: string; icon: LucideIcon; badge?: number }[] = [
    { href: "/bookings/new", label: `New ${booking}`, icon: CalendarPlus },
    { href: "/calendar", label: "Block dates", icon: CalendarOff },
    { href: "/invoices", label: "Invoices", icon: ReceiptText },
    { href: "/wambo", label: "Inbox", icon: MessageCircle, badge: data.kpis.needsHuman },
  ];

  return (
    <div>
      {isNewBusiness ? (
        <section className="relative mb-5 overflow-hidden rounded-2xl bg-brand-800 p-5 text-white">
          <h2 className="text-lg font-semibold">Welcome to Palda CX. Your business is set up</h2>
          <p className="mt-1 max-w-2xl text-sm text-white/70">
            Your {labels.offerings.toLowerCase()}, hours and reminders are set up. Four things left to do:
          </p>
          <ol className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {[
              { href: "/settings", title: `Check your ${labels.offerings.toLowerCase()}`, hint: "Prices, durations, add-ons" },
              { href: "/bookings/new", title: `Add your first ${booking}`, hint: "Try the booking flow" },
              { href: "/wambo/settings", title: `Set up ${agentName}`, hint: "Your WhatsApp assistant" },
              { href: "/settings", title: "Add your review link", hint: "Happy customers get sent here" },
            ].map((step, index) => (
              <li key={step.title}>
                <Link href={step.href} className="block h-full rounded-xl bg-white/10 p-3 transition-colors hover:bg-white/15">
                  <span className="grid size-6 place-items-center rounded-full bg-lime-400 text-xs font-bold text-brand-900">
                    {index + 1}
                  </span>
                  <span className="mt-2 block text-sm font-semibold">{step.title}</span>
                  <span className="block text-xs text-white/70">{step.hint}</span>
                </Link>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      <div className="grid gap-5 xl:grid-cols-[19rem_minmax(0,1fr)_21rem]">
        {/* ── Left: headline, shortcuts, money that needs matching, the week ahead ── */}
        <div className="min-w-0 space-y-5">
          <section className="relative overflow-hidden rounded-2xl bg-brand-800 p-5 text-white">
            <h2 className="truncate text-lg font-semibold">{settings.tenant.name}</h2>
            <div className="mt-3 flex items-center gap-2">
              <p className="text-xs text-white/70">Collected this month</p>
              <Delta value={change(data.kpis.revenueThisMonthKes, overview.previous.revenueKes)} dark />
            </div>
            <p className="mt-1 text-[2rem] font-bold leading-10 tabular">{kes(data.kpis.revenueThisMonthKes)}</p>
            <p className="mt-1 text-xs text-white/70">{data.monthLabel}</p>
          </section>

          <nav aria-label="Shortcuts" className="card grid grid-cols-4 gap-1 p-2">
            {actions.map(({ href, label, icon: Icon, badge }) => (
              <Link
                key={href}
                href={href}
                className="group flex flex-col items-center gap-1.5 rounded-xl px-1 py-3 text-center text-xs font-medium text-ink-muted transition-colors hover:bg-surface-muted hover:text-ink"
              >
                <span className="relative grid size-10 place-items-center rounded-full border border-line bg-surface text-brand-800 group-hover:border-brand-800/30">
                  <Icon className="size-[1.125rem]" strokeWidth={1.75} />
                  {badge ? (
                    <span className="absolute -right-1 -top-1 grid min-w-[1.125rem] place-items-center rounded-full bg-danger-600 px-1 text-[0.625rem] font-bold leading-[1.125rem] text-white">
                      {badge}
                    </span>
                  ) : null}
                </span>
                <span className="leading-tight">{label}</span>
              </Link>
            ))}
          </nav>

          <section className="card p-5">
            <h2 className="text-lg font-semibold">Unmatched payments</h2>
            {overview.unmatched.count > 0 ? (
              <>
                <p className="mt-2 text-sm">
                  <span className="font-semibold tabular">{kes(overview.unmatched.totalKes)}</span>{" "}
                  <span className="text-ink-muted">
                    in {overview.unmatched.count} payment{overview.unmatched.count === 1 ? "" : "s"}
                  </span>
                </p>
                <p className="mt-1 text-xs text-ink-muted">
                  Received without a {booking} reference.
                </p>
                <Link href="/invoices#reconcile" className="btn btn-primary mt-4">
                  Reconcile now
                </Link>
              </>
            ) : (
              <p className="mt-2 flex items-center gap-2 text-sm text-ink-muted">
                <CheckCircle2 className="size-4 text-success-600" /> Every payment is matched to a {booking}.
              </p>
            )}
          </section>

          <section className="card p-5">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">Next 7 days</h2>
              <Link className="text-sm font-medium text-brand-700 hover:underline" href="/calendar">
                Calendar
              </Link>
            </div>
            {data.next7Days.length === 0 ? (
              <p className="py-6 text-center text-sm text-ink-muted">Nothing booked in the next week.</p>
            ) : (
              <ul className="mt-3 space-y-2">
                {data.next7Days.slice(0, 6).map((row) => (
                  <li key={row.booking.id}>
                    <Link
                      href={`/bookings/${row.booking.id}`}
                      className="flex items-center gap-3 rounded-xl border border-line px-3 py-3 transition-colors hover:bg-surface-muted"
                    >
                      <span className="grid w-10 shrink-0 text-center leading-tight">
                        <span className="text-[0.6875rem] uppercase text-ink-subtle">
                          {/* Slice: en-GB's short month for September is "Sept". */}
                          {new Intl.DateTimeFormat("en-GB", { month: "short", timeZone: "Africa/Nairobi" }).format(row.booking.startsAt).slice(0, 3)}
                        </span>
                        <span className="text-lg font-bold tabular">
                          {new Intl.DateTimeFormat("en-GB", { day: "numeric", timeZone: "Africa/Nairobi" }).format(row.booking.startsAt)}
                        </span>
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{row.customer.name}</span>
                        <span className="block truncate text-xs text-ink-muted">
                          {shortTime(row.booking.startsAt)} · {row.offering.name}
                        </span>
                      </span>
                      <StatusPill status={row.booking.status} />
                    </Link>
                  </li>
                ))}
                {data.next7Days.length > 6 ? (
                  <li className="pt-1 text-center text-xs text-ink-muted">
                    <Link href="/bookings" className="hover:text-ink">
                      +{data.next7Days.length - 6} more this week
                    </Link>
                  </li>
                ) : null}
              </ul>
            )}
          </section>
        </div>

        {/* ── Middle: the numbers, money over time, latest payments ── */}
        <div className="min-w-0 space-y-5">
          <div className="grid gap-5 sm:grid-cols-3">
            <Tile
              value={data.kpis.confirmedThisMonth}
              label={`Confirmed ${bookings}`}
              delta={change(data.kpis.confirmedThisMonth, overview.previous.confirmed)}
            />
            <Tile
              value={data.kpis.activeHolds}
              label="On hold"
              delta={undefined}
              hint={data.kpis.cancelledThisMonth ? `${data.kpis.cancelledThisMonth} cancelled this month` : undefined}
            />
            <Tile value={kes(data.kpis.outstandingKes)} label="Outstanding" delta={undefined} hint="Unpaid invoice balances" />
          </div>

          <section className="card p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">Money in</h2>
                <p className="mt-3 text-xs text-ink-muted">Collected in the last 12 months</p>
                <p className="text-[2rem] font-bold leading-10 tabular">{kes(yearCollected)}</p>
              </div>
              <div className="flex items-center gap-4 text-xs text-ink-muted">
                <span className="flex items-center gap-1.5">
                  <span className="size-2.5 rounded-full bg-brand-800" /> Collected
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="size-2.5 rounded-full bg-lime-400 ring-1 ring-brand-800/20" /> Invoiced
                </span>
              </div>
            </div>
            <div className="mt-5">
              <MoneyChart data={overview.money} currentMonth={currentMonth} />
            </div>
          </section>

          <section className="card overflow-hidden">
            <div className="flex items-center justify-between px-5 pb-3 pt-5">
              <h2 className="text-lg font-semibold">Recent payments</h2>
              <Link className="text-sm font-medium text-brand-700 hover:underline" href="/invoices">
                All payments
              </Link>
            </div>
            {overview.recentPayments.length === 0 ? (
              <p className="px-5 pb-8 pt-4 text-center text-sm text-ink-muted">No payments yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Customer</th>
                      <th>Date &amp; time</th>
                      <th className="!text-right">Amount</th>
                      <th>Method</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {overview.recentPayments.map((p) => (
                      <tr key={p.id}>
                        <td className="font-medium">
                          {p.bookingId ? (
                            <Link href={`/bookings/${p.bookingId}`} className="hover:text-brand-800">
                              {p.customerName ?? "Customer"}
                            </Link>
                          ) : (
                            <span className="text-ink-muted">No {booking} yet</span>
                          )}
                        </td>
                        <td className="whitespace-nowrap text-ink-muted">{dateTime(p.receivedAt)}</td>
                        <td className={`whitespace-nowrap text-right font-semibold tabular ${p.method === "refund" ? "text-danger-600" : ""}`}>
                          {p.method === "refund" ? "−" : ""}
                          {kes(p.amountKes)}
                        </td>
                        <td className="whitespace-nowrap text-ink-muted">
                          {METHOD_LABELS[p.method] ?? p.method}
                          {p.provider && p.provider !== "manual" && p.provider !== "tuma" ? ` · ${p.provider[0]!.toUpperCase()}${p.provider.slice(1)}` : ""}
                        </td>
                        <td>
                          {p.matched ? (
                            <span className="pill bg-success-100 text-success-600">Matched</span>
                          ) : (
                            <span className="pill bg-warning-100 text-warning-600">Unmatched</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>

        {/* ── Right: where bookings come from, what needs a person, what happened ── */}
        <div className="min-w-0 space-y-5 md:grid md:grid-cols-2 md:gap-5 md:space-y-0 xl:block xl:space-y-5">
          <section className="card p-5">
            <h2 className="text-lg font-semibold">Where {bookings} come from</h2>
            <p className="mt-0.5 text-xs text-ink-muted">New this month</p>
            <div className="mt-5">
              {sourceTotal === 0 ? (
                <p className="py-10 text-center text-sm text-ink-muted">No new {bookings} this month yet.</p>
              ) : (
                <Donut slices={slices} centreLabel="New" />
              )}
            </div>
          </section>

          <section className="card p-5">
            <h2 className="text-lg font-semibold">Needs you</h2>
            <p className="mt-2 text-sm text-ink-muted">
              {data.kpis.needsHuman === 0
                ? `All clear. ${agentName} is handling everything within your rules.`
                : `${data.kpis.needsHuman} chat${data.kpis.needsHuman === 1 ? "" : "s"} or approval${data.kpis.needsHuman === 1 ? "" : "s"} waiting for you.`}
            </p>
            {data.kpis.needsHuman > 0 ? (
              <div className="mt-4 flex gap-2">
                <Link className="btn btn-primary !min-h-9 !text-xs" href="/wambo?filter=human">
                  Open chats
                </Link>
                <Link className="btn btn-secondary !min-h-9 !text-xs" href="/approvals">
                  Approvals
                </Link>
              </div>
            ) : null}
          </section>

          <section className="card p-5 md:col-span-2 xl:col-span-1">
            <h2 className="text-lg font-semibold">Recent activity</h2>
            {days.length === 0 ? (
              <p className="py-6 text-center text-sm text-ink-muted">Nothing yet.</p>
            ) : (
              <div className="mt-3 space-y-4">
                {days.map(({ day, rows }) => (
                  <div key={day}>
                    <p className="text-xs font-medium text-ink-muted">{day}</p>
                    <ul className="mt-2 space-y-3">
                      {rows.map((row) => {
                        const href = activityHref(row.entity, row.entityId);
                        const body = (
                          <>
                            <span className="grid size-8 shrink-0 place-items-center rounded-full bg-brand-100 text-[0.6875rem] font-bold text-brand-800">
                              {initials(row.actor)}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block text-sm leading-snug">
                                <span className="font-semibold">{row.actor}</span>{" "}
                                <span className="text-ink-muted">{activityPhrase(row.action, row.entity)}</span>
                              </span>
                              <span className="text-xs text-ink-subtle">{shortTime(row.createdAt)}</span>
                            </span>
                          </>
                        );
                        return (
                          <li key={row.id}>
                            {href ? (
                              <Link href={href} className="-mx-2 flex gap-3 rounded-lg px-2 py-1 hover:bg-surface-muted">
                                {body}
                              </Link>
                            ) : (
                              <div className="flex gap-3 py-1">{body}</div>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
