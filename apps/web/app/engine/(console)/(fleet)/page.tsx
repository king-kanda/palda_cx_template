import Link from "next/link";
import { fleetTelemetry } from "@garden/services";
import { requireEngineAdmin } from "@/lib/engine-auth";
import { AgentAvatar } from "../../components/avatar-picker";
import { CustomerStatusPill } from "../../components/status-pill";
import { Activity, ListChecks, Users, Wallet } from "lucide-react";
import { AttentionList, Eyebrow, MetricCard, PageHeader, Panel, ago, fmtKes } from "../../components/ui";

export const dynamic = "force-dynamic";

export default async function EngineOverviewPage() {
  await requireEngineAdmin();
  const fleet = await fleetTelemetry();
  const high = fleet.attention.filter((a) => a.severity === "high").length;
  const busiest = [...fleet.rows]
    .filter((r) => r.customer.status === "active")
    .sort((a, b) => b.pulse.runs24h - a.pulse.runs24h)
    .slice(0, 6);

  return (
    <main className="mx-auto w-full max-w-[90rem] p-4 md:p-6">
      <PageHeader
        title="Overview"
        subtitle="Every customer's agents, boiled down to what needs a decision. Open a customer to dig into one."
        action={<span className="font-mono text-sm text-ink-muted">{fleet.totals.customers} customers</span>}
      />

      <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard icon={Users} label="Live customers" value={fleet.totals.live} hint={`${fleet.totals.setup} in setup · ${fleet.totals.suspended} suspended`} />
        <MetricCard icon={Activity} label="Agent runs" value={fleet.totals.runs24h.toLocaleString("en-KE")} hint="across all customers, last 24 hours" />
        <MetricCard
          icon={ListChecks}
          label="Needs a decision"
          value={fleet.attention.length}
          tone={high > 0 ? "danger" : fleet.attention.length > 0 ? "warn" : "default"}
          hint={high > 0 ? `${high} high priority` : fleet.attention.length > 0 ? "nothing urgent" : "all clear"}
        />
        <MetricCard icon={Wallet} label="Agent spend" value={fmtKes(fleet.totals.cost7dKes)} hint="all customers, last 7 days" />
      </div>

      <div className="mt-6 grid gap-5 xl:grid-cols-[1.6fr_1fr]">
        <Panel title="Needs a decision" aside="most urgent first">
          <AttentionList items={fleet.attention} />
        </Panel>

        <div className="space-y-5">
          <Panel title="Busiest customers" aside="runs, last 24 hours">
            {busiest.length === 0 ? (
              <p className="text-sm text-ink-muted">No live customers yet.</p>
            ) : (
              <ul className="divide-y divide-line">
                {busiest.map(({ customer, pulse }) => (
                  <li key={customer.id}>
                    <Link href={`/engine/${customer.id}`} className="flex items-center gap-3 py-2.5 hover:bg-surface-muted">
                      <AgentAvatar src={customer.agent.avatar} name={customer.agent.name} className="size-8" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{customer.name}</span>
                        <span className="block text-xs text-ink-muted">{ago(pulse.lastRunAt)}</span>
                      </span>
                      <span className="text-right">
                        <span className="block text-sm font-semibold tabular">{pulse.runs24h}</span>
                        {pulse.attention24h > 0 ? (
                          <span className="block font-mono text-xs text-danger-600">{pulse.attention24h} to review</span>
                        ) : null}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="In setup" aside={`${fleet.totals.setup}`}>
            {fleet.rows.filter((r) => r.customer.status === "setup").length === 0 ? (
              <p className="text-sm text-ink-muted">Nobody waiting to be rolled out.</p>
            ) : (
              <ul className="divide-y divide-line">
                {fleet.rows
                  .filter((r) => r.customer.status === "setup")
                  .map(({ customer }) => (
                    <li key={customer.id} className="flex items-center justify-between gap-3 py-2.5">
                      <Link href={`/engine/${customer.id}/rollout`} className="min-w-0 truncate text-sm font-medium hover:text-brand-800">
                        {customer.name}
                      </Link>
                      <CustomerStatusPill status={customer.status} />
                    </li>
                  ))}
              </ul>
            )}
          </Panel>

          <Eyebrow className="px-1">Numbers come from each agent&apos;s run log. See Data sources.</Eyebrow>
        </div>
      </div>
    </main>
  );
}
