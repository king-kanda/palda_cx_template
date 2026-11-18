import Link from "next/link";
import { Plus, Search } from "lucide-react";
import { fleetTelemetry, type FleetRow } from "@garden/services";
import { requireEngineAdmin } from "@/lib/engine-auth";
import { AgentAvatar } from "../../../components/avatar-picker";
import { CustomerStatusPill } from "../../../components/status-pill";
import { Eyebrow, PageHeader, PillTabs, ago, fmtKes } from "../../../components/ui";

export const dynamic = "force-dynamic";

type Filter = "all" | "live" | "attention" | "setup" | "suspended";
const FILTERS: Filter[] = ["all", "live", "attention", "setup", "suspended"];

function matches(row: FleetRow, filter: Filter): boolean {
  switch (filter) {
    case "live":
      return row.customer.status === "active";
    case "setup":
      return row.customer.status === "setup";
    case "suspended":
      return row.customer.status === "suspended";
    case "attention":
      return row.attention.some((a) => a.severity !== "low");
    default:
      return true;
  }
}

export default async function CustomersPage({ searchParams }: { searchParams: Promise<{ f?: string; q?: string }> }) {
  await requireEngineAdmin();
  const params = await searchParams;
  const filter: Filter = FILTERS.includes(params.f as Filter) ? (params.f as Filter) : "all";
  const q = (params.q ?? "").trim().toLowerCase();

  const fleet = await fleetTelemetry();
  const label: Record<Filter, string> = { all: "All", live: "Live", attention: "Needs attention", setup: "In setup", suspended: "Suspended" };
  const href = (f: Filter) => `/engine/customers?${new URLSearchParams({ ...(f !== "all" ? { f } : {}), ...(q ? { q } : {}) })}`;
  const rows = fleet.rows.filter(
    (r) =>
      matches(r, filter) &&
      (!q || r.customer.name.toLowerCase().includes(q) || r.customer.slug.includes(q) || r.customer.owner?.email.toLowerCase().includes(q)),
  );

  return (
    <main className="mx-auto w-full max-w-[90rem] p-4 md:p-6">
      <PageHeader
        title="Customers"
        subtitle="Every business you run an agent for. Open one to set it up, roll it out or see how its agent is doing."
        action={
          <div className="flex items-center gap-4">
            <span className="font-mono text-sm text-ink-muted">{fleet.totals.customers} total</span>
            <Link href="/engine/new" className="btn btn-primary h-11 px-5">
              <Plus className="size-4" /> New customer
            </Link>
          </div>
        }
      />

      <div className="mb-5 flex flex-wrap items-center gap-3">
        <form action="/engine/customers" className="relative w-full max-w-xs">
          {filter !== "all" ? <input type="hidden" name="f" value={filter} /> : null}
          <Search className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-ink-muted" />
          <input
            name="q"
            defaultValue={params.q ?? ""}
            placeholder="Search customers…"
            aria-label="Search customers"
            className="h-10 w-full rounded-full border border-line bg-surface pl-10 pr-4 text-sm outline-none focus:border-brand-800"
          />
        </form>
        <PillTabs
          items={FILTERS.map((f) => ({
            label: label[f],
            href: href(f),
            active: f === filter,
            count: fleet.rows.filter((r) => matches(r, f)).length,
          }))}
        />
      </div>

      {rows.length === 0 ? (
        <div className="card grid place-items-center px-6 py-16 text-center">
          <h2 className="text-lg font-semibold">{fleet.rows.length === 0 ? "No customers yet" : "Nothing matches"}</h2>
          <p className="mt-1 max-w-sm text-sm text-ink-muted">
            {fleet.rows.length === 0
              ? "Create the first one: pick their type of business, name their agent and add their services."
              : "Try another filter or a different search."}
          </p>
        </div>
      ) : (
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {rows.map(({ customer, pulse, attention }) => {
            const urgent = attention.filter((a) => a.severity !== "low").length;
            return (
              <Link
                key={customer.id}
                href={`/engine/${customer.id}`}
                className="card block p-5 transition-shadow hover:shadow-md"
              >
                <div className="flex items-start gap-3">
                  <AgentAvatar src={customer.agent.avatar} name={customer.name} className="size-11" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-lg font-semibold">{customer.name}</p>
                    <p className="truncate font-mono text-xs text-ink-muted">{customer.slug}</p>
                  </div>
                  <CustomerStatusPill status={customer.status} />
                </div>

                <div className="mt-4 grid grid-cols-2 gap-4 border-t border-line pt-4">
                  <div>
                    <Eyebrow>Type</Eyebrow>
                    <p className="mt-1 truncate font-mono text-sm">{customer.vertical}</p>
                  </div>
                  <div>
                    <Eyebrow>Agent</Eyebrow>
                    <p className="mt-1 truncate font-mono text-sm">{customer.agent.name}</p>
                  </div>
                </div>

                <div className="mt-4 flex items-end justify-between gap-3 border-t border-line pt-4">
                  <div className="grid grid-cols-3 gap-5">
                    <div>
                      <Eyebrow>Runs 24h</Eyebrow>
                      <p className="mt-1 text-lg font-bold tabular">{pulse.runs24h}</p>
                    </div>
                    <div>
                      <Eyebrow>Cost 24h</Eyebrow>
                      <p className="mt-1 text-lg font-bold tabular">{fmtKes(pulse.cost24hKes).replace("KES ", "")}</p>
                    </div>
                    <div>
                      <Eyebrow>Attention</Eyebrow>
                      <p className={`mt-1 text-lg font-bold tabular ${urgent > 0 ? "text-warning-600" : ""}`}>{urgent}</p>
                    </div>
                  </div>
                  <span className="shrink-0 pb-0.5 text-xs text-ink-muted">{ago(pulse.lastRunAt)}</span>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </main>
  );
}
