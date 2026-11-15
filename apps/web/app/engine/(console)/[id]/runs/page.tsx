import { customerTelemetry, getEngineCustomer, langfuseTraceUrl, type RunOutcome } from "@garden/services";
import { requireEngineAdmin } from "@/lib/engine-auth";
import { dateTime } from "@/lib/format";
import { OutcomePill, Panel, PillTabs, fmtKes, fmtMs } from "../../../components/ui";
import { WorkspaceHeader } from "../header";

export const dynamic = "force-dynamic";

const AGENT_NAMES: Record<string, string> = { admin: "Staff assistant", "ledger-digest": "Daily digest", ops: "Ops watcher" };
const FILTERS = ["all", "attention", "handoff", "limit", "succeeded"] as const;
type Filter = (typeof FILTERS)[number];

const inFilter = (outcome: RunOutcome, f: Filter) =>
  f === "all" ||
  (f === "attention" && (outcome === "flagged" || outcome === "looping" || outcome === "blocked")) ||
  outcome === f;

export default async function RunsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ o?: string }>;
}) {
  await requireEngineAdmin();
  const { id } = await params;
  const filter: Filter = FILTERS.includes((await searchParams).o as Filter) ? ((await searchParams).o as Filter) : "all";
  const [customer, t] = await Promise.all([getEngineCustomer(id), customerTelemetry(id, "month", new Date(), { recentLimit: 50 })]);
  const name = (agentId: string) => (agentId === "wambo" ? customer.agent.name : (AGENT_NAMES[agentId] ?? agentId));
  const labels: Record<Filter, string> = { all: "All", attention: "Needs attention", handoff: "Handed over", limit: "Hit a limit", succeeded: "Succeeded" };
  const runs = t.recent.filter((r) => inFilter(r.outcome, filter));

  return (
    <>
      <WorkspaceHeader
        customer={customer}
        title="Runs"
        subtitle="Every time this customer's agents answered, newest first. Open a trace to see the full conversation in Langfuse."
      />
      <PillTabs
        className="mb-5"
        items={FILTERS.map((f) => ({
          label: labels[f],
          href: `/engine/${id}/runs${f === "all" ? "" : `?o=${f}`}`,
          active: f === filter,
          count: t.recent.filter((r) => inFilter(r.outcome, f)).length,
        }))}
      />
      <Panel title={`Latest ${t.recent.length} runs`} aside={t.langfuseRuns > 0 ? `${t.langfuseRuns} traced in Langfuse (30 days)` : "no Langfuse traces"}>
        {runs.length === 0 ? (
          <p className="text-sm text-ink-muted">No runs match.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left">
              <thead>
                <tr className="font-mono text-[11px] uppercase tracking-wider text-ink-muted">
                  <th className="pb-2 pr-3 font-normal">When</th>
                  <th className="pb-2 pr-3 font-normal">Agent</th>
                  <th className="pb-2 pr-3 font-normal">Outcome</th>
                  <th className="pb-2 pr-3 text-right font-normal">Time</th>
                  <th className="pb-2 pr-3 text-right font-normal">Tools</th>
                  <th className="pb-2 pr-3 text-right font-normal">Cost</th>
                  <th className="pb-2 font-normal">Why / trace</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {runs.map((r) => {
                  const trace = langfuseTraceUrl(r.traceId);
                  return (
                    <tr key={r.id} className="align-top">
                      <td className="py-3 pr-3 font-mono text-xs text-ink-muted">{dateTime(r.at)}</td>
                      <td className="py-3 pr-3 text-[15px] font-medium">
                        {name(r.agentId)}
                        <span className="block font-mono text-[11px] font-normal text-ink-muted">via {r.trigger}</span>
                      </td>
                      <td className="py-3 pr-3">
                        <OutcomePill outcome={r.outcome} />
                      </td>
                      <td className="py-3 pr-3 text-right font-mono text-xs">{fmtMs(r.latencyMs)}</td>
                      <td className="py-3 pr-3 text-right font-mono text-xs">{r.tools}</td>
                      <td className="py-3 pr-3 text-right font-mono text-xs">{fmtKes(r.costKes).replace("KES ", "")}</td>
                      <td className="max-w-xs py-3 text-xs text-ink-muted">
                        {r.note ? <span className="block">{r.note}</span> : null}
                        {trace ? (
                          <a href={trace} target="_blank" rel="noreferrer" className="font-medium text-brand-800 hover:underline">
                            Open trace ↗
                          </a>
                        ) : r.note ? null : (
                          "—"
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </>
  );
}
