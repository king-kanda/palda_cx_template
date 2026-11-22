import { WAMBO } from "@garden/engine";
import { TOOLS } from "@garden/mcp-server";
import { CUSTOMER_SCOPES, getAgentControl, getEngineCustomer, listAppConnections, listExternalServers } from "@garden/services";
import { requireEngineAdmin } from "@/lib/engine-auth";
import { Panel } from "../../../../components/ui";
import { activateVersionAction } from "../../actions";
import { WorkspaceHeader } from "../../header";
import { ToolsForm, type AppSection, type McpSection, type ToolRow } from "./tools-form";

export const dynamic = "force-dynamic";

const forCustomers = (t: (typeof TOOLS)[number]) =>
  t.principalTypes.includes("customer") && t.scopes.some((s) => (CUSTOMER_SCOPES as readonly string[]).includes(s));

const row = (t: (typeof TOOLS)[number], locked: boolean): ToolRow => ({
  name: t.name,
  group: t.group,
  tier: t.tier,
  description: t.description,
  locked,
});

/**
 * Everything the customer-facing agent can be allowed to do for one business, in three kinds:
 *  - built in (Palda CX's own booking system): on unless switched off; the shipped safety blocks are locked off,
 *  - apps (our own tools for Google, Zoho, Odoo): off until switched on, and only offered while the app is connected,
 *  - custom MCP servers: reviewed and saved per server (fingerprinted), as before.
 * Built-in and app choices are published together as one version that can be rolled back.
 */
export default async function AgentToolsPage({ params }: { params: Promise<{ id: string }> }) {
  await requireEngineAdmin();
  const { id } = await params;
  const [customer, control, servers, connections] = await Promise.all([
    getEngineCustomer(id),
    getAgentControl(id, "wambo"),
    listExternalServers(id),
    listAppConnections(id),
  ]);
  const locked = new Set(WAMBO.toolPolicy.blockedTools ?? []);
  const builtIn = TOOLS.filter((t) => forCustomers(t) && !t.integration)
    .map((t) => row(t, locked.has(t.name)))
    .sort((a, b) => a.group.localeCompare(b.group) || a.name.localeCompare(b.name));
  const apps: AppSection[] = connections.map((c) => ({
    id: c.id,
    name: c.name,
    mark: c.mark,
    colour: c.colour,
    auth: c.auth,
    status: c.status,
    account: c.account,
    capabilities: c.capabilities,
    tools: TOOLS.filter((t) => t.integration === c.id && forCustomers(t)).map((t) => row(t, false)),
  }));
  const mcp: McpSection[] = servers.map((s) => ({
    id: s.id,
    name: s.name,
    displayName: s.displayName,
    host: s.host,
    active: s.status === "active",
    lastError: s.lastError,
    tools: s.tools.map((t) => ({
      name: t.name,
      description: t.description,
      enabled: t.enabled,
      changed: Boolean(t.changed),
      params: Object.keys((t.inputSchema as { properties?: Record<string, unknown> }).properties ?? {}).slice(0, 12),
    })),
  }));

  const knownBuiltIn = new Set(builtIn.map((t) => t.name));
  const knownApp = new Set(apps.flatMap((a) => a.tools.map((t) => t.name)));
  const policy = control.live?.override?.toolPolicy;
  const blocked = (policy?.blockedTools ?? []).filter((n) => knownBuiltIn.has(n));
  const enabled = (policy?.enabledIntegrationTools ?? []).filter((n) => knownApp.has(n));
  const maxCalls = policy?.maxToolCalls ?? WAMBO.toolPolicy.maxToolCalls ?? 6;

  return (
    <div className="space-y-5">
      <WorkspaceHeader
        customer={customer}
        title="Tools"
        subtitle={`Everything ${customer.agent.name} may do for ${customer.name}. Every publish is a version you can roll back.`}
      />

      <ToolsForm
        tenantId={id}
        businessName={customer.name}
        tools={builtIn}
        apps={apps}
        mcp={mcp}
        initialBlocked={blocked}
        initialEnabled={enabled}
        initialMax={maxCalls}
      />

      <Panel title="Versions" aside={control.live ? `Live: version ${control.live.version}` : "Live: shipped defaults"}>
        <ul className="divide-y divide-line">
          <li className="flex items-center justify-between gap-3 py-3 text-sm">
            <span>
              <span className="font-semibold">Shipped defaults</span>
              <span className="block text-xs text-ink-muted">Every safe built-in tool on, every app tool off, standard limits</span>
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
          {control.versions.map((v) => {
            const p = v.override?.toolPolicy;
            return (
              <li key={v.id} className="flex items-center justify-between gap-3 py-3 text-sm">
                <span>
                  <span className="font-semibold">Version {v.version}</span>
                  <span className="block text-xs text-ink-muted">
                    {p
                      ? `${p.blockedTools.length} built-in off · ${p.enabledIntegrationTools.length} app tools on · max ${p.maxToolCalls ?? "default"} calls`
                      : "unreadable"}
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
            );
          })}
        </ul>
      </Panel>
    </div>
  );
}
