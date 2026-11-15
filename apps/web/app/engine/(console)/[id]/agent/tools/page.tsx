import { WAMBO } from "@garden/engine";
import { TOOLS } from "@garden/mcp-server";
import { CUSTOMER_SCOPES, getAgentControl, getEngineCustomer, listExternalServers } from "@garden/services";
import { requireEngineAdmin } from "@/lib/engine-auth";
import { Panel } from "../../../../components/ui";
import { activateVersionAction } from "../../actions";
import { WorkspaceHeader } from "../../header";
import { SyncButton, ToolReview, type ReviewTool } from "../integrations/integrations-forms";
import { ToolsForm, type ToolRow } from "./tools-form";

export const dynamic = "force-dynamic";

/** The tools the customer-facing agent can be given: what a customer principal may see, with the shipped safety blocks marked locked. */
function catalogue(): ToolRow[] {
  const locked = new Set(WAMBO.toolPolicy.blockedTools ?? []);
  return TOOLS.filter(
    (t) =>
      t.principalTypes.includes("customer") && t.scopes.some((s) => (CUSTOMER_SCOPES as readonly string[]).includes(s)),
  )
    .map((t) => ({ name: t.name, group: t.group, tier: t.tier, description: t.description, locked: locked.has(t.name) }))
    .sort((a, b) => a.group.localeCompare(b.group) || a.name.localeCompare(b.name));
}

export default async function AgentToolsPage({ params }: { params: Promise<{ id: string }> }) {
  await requireEngineAdmin();
  const { id } = await params;
  const [customer, control, servers] = await Promise.all([getEngineCustomer(id), getAgentControl(id, "wambo"), listExternalServers(id)]);
  const tools = catalogue();
  const known = new Set(tools.map((t) => t.name));
  const blocked = (control.live?.override?.toolPolicy.blockedTools ?? []).filter((n) => known.has(n));
  const maxCalls = control.live?.override?.toolPolicy.maxToolCalls ?? WAMBO.toolPolicy.maxToolCalls ?? 6;

  return (
    <div className="space-y-5">
      <WorkspaceHeader
        customer={customer}
        title="Tools"
        subtitle={`Everything ${customer.agent.name} is allowed to do for ${customer.name}: the built-in actions, then the tools from integrations the customer connected. Built-in changes are saved as a new version you can roll back.`}
      />
      <div className="grid items-start gap-5 xl:grid-cols-[1.6fr_1fr]">
        <Panel
          title="Available tools"
          aside={control.live ? `Live: version ${control.live.version}` : "Live: shipped defaults"}
        >
          <ToolsForm tenantId={id} tools={tools} initialBlocked={blocked} initialMax={maxCalls} />
        </Panel>

        <Panel title="Versions" aside={`${control.versions.length} saved`}>
          <ul className="divide-y divide-line">
            <li className="flex items-center justify-between gap-3 py-3 text-sm">
              <span>
                <span className="font-semibold">Shipped defaults</span>
                <span className="block text-xs text-ink-muted">Every safe tool on, standard limits</span>
              </span>
              {control.live ? (
                <form action={activateVersionAction}>
                  <input type="hidden" name="tenantId" value={id} />
                  <input type="hidden" name="agentId" value="wambo" />
                  <button className="btn btn-secondary">Use these</button>
                </form>
              ) : (
                <span className="pill bg-lime-100 text-brand-800">live</span>
              )}
            </li>
            {control.versions.map((v) => (
              <li key={v.id} className="flex items-center justify-between gap-3 py-3 text-sm">
                <span>
                  <span className="font-semibold">Version {v.version}</span>
                  <span className="block text-xs text-ink-muted">
                    {v.override ? `${v.override.toolPolicy.blockedTools.length} tools off · max ${v.override.toolPolicy.maxToolCalls ?? "default"} calls` : "unreadable"}
                    {" · "}
                    {new Date(v.createdAt).toLocaleDateString("en-KE")}
                  </span>
                </span>
                {v.live ? (
                  <span className="pill bg-lime-100 text-brand-800">live</span>
                ) : (
                  <form action={activateVersionAction}>
                    <input type="hidden" name="tenantId" value={id} />
                    <input type="hidden" name="agentId" value="wambo" />
                    <input type="hidden" name="versionId" value={v.id} />
                    <button className="btn btn-secondary">Roll back to this</button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        </Panel>
      </div>

      <Panel
        title="Tools from the customer's integrations"
        aside={servers.length ? `${servers.reduce((n, x) => n + x.enabledCount, 0)} of ${servers.reduce((n, x) => n + x.tools.length, 0)} on` : "none connected"}
      >
        {servers.length === 0 ? (
          <p className="text-sm text-ink-muted">
            When {customer.name} connects a tool from their own app, its tools appear here, switched off, for you to review. See the list on Integrations.
          </p>
        ) : (
          <div className="space-y-6">
            <p className="text-xs text-ink-muted">
              Every tool starts off. Read what it does, then switch on only what {customer.agent.name} needs. If a server changes a tool you approved, it switches off and is flagged until you review it again.
            </p>
            {servers.map((srv) => {
              const tools: ReviewTool[] = srv.tools.map((t) => ({
                name: t.name,
                description: t.description,
                enabled: t.enabled,
                changed: Boolean(t.changed),
                params: Object.keys(((t.inputSchema as { properties?: Record<string, unknown> }).properties ?? {})).slice(0, 12),
              }));
              return (
                <section key={srv.id}>
                  <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                        <span className="font-mono">{srv.name}</span>
                        <span className={`pill ${srv.status === "active" ? "bg-lime-100 text-brand-800" : "bg-surface-muted text-ink-muted"}`}>
                          {srv.status === "active" ? "connected" : "paused"}
                        </span>
                      </h3>
                      <p className="font-mono text-xs text-ink-muted">
                        {srv.host} · added by {srv.addedBy === "customer" ? "the customer" : "the Palda team"}
                      </p>
                      {srv.lastError ? <p className="text-xs text-danger-600">Last problem: {srv.lastError}</p> : null}
                    </div>
                    <SyncButton tenantId={id} serverId={srv.id} />
                  </div>
                  <ToolReview tenantId={id} serverId={srv.id} serverName={srv.name} tools={tools} />
                </section>
              );
            })}
          </div>
        )}
      </Panel>
    </div>
  );
}
