import Link from "next/link";
import { Activity, Bot, Gauge, TriangleAlert } from "lucide-react";
import { customerWorkspace, langfuseTraceUrl, parseRange, type TelemetryRange } from "@garden/services";
import { requireEngineAdmin } from "@/lib/engine-auth";
import { dateTime } from "@/lib/format";
import { AttentionList, BarChart, CHART, MetricCard, OutcomePill, Panel, PillTabs, fmtKes, fmtMs } from "../../components/ui";
import { WorkspaceHeader } from "./header";

export const dynamic = "force-dynamic";

const AGENT_NAMES: Record<string, string> = {
  admin: "Staff assistant",
  "ledger-digest": "Daily digest",
  ops: "Ops watcher",
};

/** Chart headline: palda-homes "kpi" style, 28 px bold tabular. */
const HEADLINE = "text-[1.75rem] font-bold leading-9 tabular";

export default async function WorkspaceOverviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ range?: string }>;
}) {
  await requireEngineAdmin();
  const { id } = await params;
  const range = parseRange((await searchParams).range);
  const { customer, telemetry: t, attention } = await customerWorkspace(id, range);

  const agentLabel = (agentId: string) => (agentId === "wambo" ? customer.agent.name : (AGENT_NAMES[agentId] ?? agentId));
  const tabs: { label: string; value: TelemetryRange }[] = [
    { label: "Today", value: "day" },
    { label: "Week", value: "week" },
    { label: "Month", value: "month" },
  ];
  const tabItems = tabs.map((x) => ({ label: x.label, href: `/engine/${id}?range=${x.value}`, active: x.value === range }));

  const live = customer.status === "active";
  return (
    <div className="space-y-5">
      <WorkspaceHeader
        customer={customer}
        title={customer.name}
        subtitle={`Monitor ${customer.agent.name}, then act on what needs attention.`}
      />

      {attention.length > 0 ? (
        <Panel title="Needs a decision" aside="most urgent first">
          <AttentionList items={attention} showCustomer={false} />
        </Panel>
      ) : null}

      <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          icon={Bot}
          label="Agent"
          value={customer.agent.name}
          hint={live ? (customer.whatsappConnected ? "live on WhatsApp" : "live · WhatsApp not connected") : customer.status === "setup" ? "in setup" : "suspended"}
          tone={live && !customer.whatsappConnected ? "warn" : "default"}
        />
        <MetricCard icon={Activity} label="Runs" value={t.totals.runs.toLocaleString("en-KE")} hint={t.rangeLabel} />
        <MetricCard
          icon={TriangleAlert}
          label="Run attention"
          value={t.totals.attention}
          tone={t.totals.attention > 0 ? "danger" : "default"}
          hint="flagged, blocked, or stuck in a loop"
        />
        <MetricCard
          icon={Gauge}
          label="Hit a limit"
          value={t.totals.limits}
          tone={t.totals.limits > 0 ? "warn" : "default"}
          hint="answered, but stopped at a step limit"
        />
      </div>

      <PillTabs items={tabItems} />

      <div className="grid gap-5 lg:grid-cols-3">
        <Panel title="Runs" aside={`${t.totals.attention === 0 ? "none" : t.totals.attention} to review · ${t.rangeLabel}`}>
          <p className={`mb-4 ${HEADLINE}`}>{t.totals.runs.toLocaleString("en-KE")}</p>
          <BarChart buckets={t.buckets} value={(b) => b.runs} secondary={(b) => b.attention} />
          <div className="mt-3 flex gap-4 text-xs text-ink-muted">
            <span className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-sm" style={{ background: CHART.runs }} /> runs
            </span>
            <span className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-sm" style={{ background: CHART.attention }} /> need attention
            </span>
          </div>
        </Panel>

        <Panel title="Cost" aside={`estimated · ${t.rangeLabel}`}>
          <p className={`mb-4 ${HEADLINE}`}>{fmtKes(t.totals.costKes)}</p>
          <BarChart buckets={t.buckets} value={(b) => b.costKes} color={CHART.cost} format={fmtKes} />
        </Panel>

        <Panel title="Response time" aside={`typical · ${t.rangeLabel}`}>
          <p className={`mb-4 ${HEADLINE}`}>
            {fmtMs(t.totals.medianMs)} <span className="text-sm font-normal text-ink-muted">typical · {fmtMs(t.totals.p95Ms)} slowest 5%</span>
          </p>
          <BarChart buckets={t.buckets} value={(b) => b.medianMs} color={CHART.response} format={fmtMs} />
        </Panel>
      </div>

      {t.totals.runs === 0 ? (
        <p className="rounded-2xl border border-dashed border-line px-5 py-4 text-sm text-ink-muted">
          No runs recorded {t.rangeLabel}. Runs appear here as soon as the agent answers its first message.
        </p>
      ) : null}

      <div className="grid items-start gap-5 xl:grid-cols-[1.5fr_1fr]">
        <Panel title={`Agent activity · ${t.rangeLabel}`} aside="busiest first">
          {t.agents.length === 0 ? (
            <p className="text-sm text-ink-muted">No activity in this period.</p>
          ) : (
            <div className="-mx-5 overflow-x-auto">
              <table className="table min-w-[37.5rem]">
                <thead>
                  <tr>
                    <th>Agent</th>
                    <th className="text-right">Runs</th>
                    <th className="text-right">Review</th>
                    <th className="text-right">Cost (KES)</th>
                    <th className="text-right">Typical</th>
                    <th className="text-right">P95</th>
                    <th className="text-right">Prompt</th>
                    <th className="text-right">Tools</th>
                  </tr>
                </thead>
                <tbody>
                  {t.agents.map((a) => (
                    <tr key={a.agentId}>
                      <td className="font-semibold">{agentLabel(a.agentId)}</td>
                      <td className="text-right tabular">{a.runs}</td>
                      <td className={`text-right tabular ${a.attention > 0 ? "font-semibold text-danger-600" : ""}`}>{a.attention}</td>
                      <td className="text-right tabular">{fmtKes(a.costKes).replace("KES ", "")}</td>
                      <td className="text-right tabular">{fmtMs(a.medianMs)}</td>
                      <td className="text-right tabular">{fmtMs(a.p95Ms)}</td>
                      <td className="text-right tabular">{a.avgPromptTokens.toLocaleString("en-KE")}</td>
                      <td className="text-right tabular">{a.avgTools}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="mt-3 text-xs text-ink-muted">Prompt is the average tokens sent per run. Tools is the average tool calls per run.</p>
        </Panel>

        <Panel
          title="Recent runs"
          aside={
            <Link href={`/engine/${id}/runs`} className="font-medium text-brand-700 hover:underline">
              Open runs →
            </Link>
          }
        >
          {t.recent.length === 0 ? (
            <p className="text-sm text-ink-muted">Nothing yet.</p>
          ) : (
            <ul className="divide-y divide-line">
              {t.recent.slice(0, 7).map((r) => {
                const trace = langfuseTraceUrl(r.traceId);
                return (
                  <li key={r.id} className="flex items-center gap-3 py-3">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">{agentLabel(r.agentId)}</span>
                      <span className="block font-mono text-xs text-ink-muted">
                        {dateTime(r.at)}
                        {trace ? (
                          <>
                            {" · "}
                            <a href={trace} target="_blank" rel="noreferrer" className="text-brand-700 hover:underline">
                              trace ↗
                            </a>
                          </>
                        ) : null}
                      </span>
                    </span>
                    <OutcomePill outcome={r.outcome} />
                    <span className="w-12 text-right text-sm tabular text-ink-muted">{fmtKes(r.costKes).replace("KES ", "")}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}
