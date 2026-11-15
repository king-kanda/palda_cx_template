import { Lock, Trash2 } from "lucide-react";
import { getEngineCustomer, listExternalServers } from "@garden/services";
import { requireEngineAdmin } from "@/lib/engine-auth";
import { dateTime } from "@/lib/format";
import { Panel } from "../../../../components/ui";
import { deleteExternalServerAction, setExternalServerStatusAction } from "../../actions";
import { WorkspaceHeader } from "../../header";
import { AddServerForm, SyncButton, ToolReview, type ReviewTool } from "./integrations-forms";

export const dynamic = "force-dynamic";

const paramsOf = (schema: Record<string, unknown>): string[] => {
  const props = (schema as { properties?: Record<string, unknown> }).properties;
  return props ? Object.keys(props).slice(0, 12) : [];
};

export default async function IntegrationsPage({ params }: { params: Promise<{ id: string }> }) {
  await requireEngineAdmin();
  const { id } = await params;
  const [customer, servers] = await Promise.all([getEngineCustomer(id), listExternalServers(id)]);

  return (
    <div className="space-y-5">
      <WorkspaceHeader
        customer={customer}
        title="Integrations"
        subtitle={`External tools ${customer.agent.name} can use for ${customer.name}, such as a calendar or CRM, connected through MCP. Only you can set these up; the customer never sees them.`}
      />

      <Panel title="How this is kept safe">
        <ul className="list-disc space-y-1 pl-5 text-sm text-ink-muted">
          <li>Every tool starts <strong className="text-ink">off</strong>. You read what each one does, then switch on only what this agent needs.</li>
          <li>If the server later changes a tool you approved, it is switched off again and flagged until you review it.</li>
          <li>Tool results are shown to the agent as outside data, never as instructions. The access token is stored encrypted and never displayed.</li>
          <li>Addresses must be https and public. Private network addresses are refused, including after DNS lookup.</li>
        </ul>
      </Panel>

      <div className="grid items-start gap-5 xl:grid-cols-[1fr_1.6fr]">
        <Panel title="Connect a server">
          <AddServerForm tenantId={id} />
        </Panel>

        <div className="space-y-5">
          {servers.length === 0 ? (
            <Panel title="Connected servers">
              <p className="text-sm text-ink-muted">None yet. Connect one on the left; its tools will appear here for review.</p>
            </Panel>
          ) : null}
          {servers.map((s) => {
            const tools: ReviewTool[] = s.tools.map((t) => ({
              name: t.name,
              description: t.description,
              enabled: t.enabled,
              changed: Boolean(t.changed),
              params: paramsOf(t.inputSchema),
            }));
            return (
              <Panel
                key={s.id}
                title={
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-mono">{s.name}</span>
                    <span className={`pill ${s.status === "active" ? "bg-lime-100 text-brand-800" : "bg-surface-muted text-ink-muted"}`}>{s.status}</span>
                  </span>
                }
                aside={`${s.enabledCount} of ${s.tools.length} tools on`}
              >
                <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 text-sm">
                    <p className="truncate font-mono text-xs text-ink-muted">{s.host}</p>
                    <p className="mt-1 flex items-center gap-1 text-xs text-ink-muted">
                      {s.hasToken ? (
                        <>
                          <Lock className="size-3" /> token saved (hidden)
                        </>
                      ) : (
                        "no token"
                      )}
                      {" · "}used by: {s.agents.join(", ")}
                      {s.lastSyncedAt ? ` · synced ${dateTime(s.lastSyncedAt)}` : ""}
                    </p>
                    {s.lastError ? <p className="mt-1 text-xs text-danger-600">Last problem: {s.lastError}</p> : null}
                  </div>
                  <div className="flex items-start gap-2">
                    <SyncButton tenantId={id} serverId={s.id} />
                    <form action={setExternalServerStatusAction}>
                      <input type="hidden" name="tenantId" value={id} />
                      <input type="hidden" name="serverId" value={s.id} />
                      <input type="hidden" name="status" value={s.status === "active" ? "disabled" : "active"} />
                      <button className="btn btn-secondary h-10 px-4">{s.status === "active" ? "Disable" : "Enable"}</button>
                    </form>
                    <form action={deleteExternalServerAction}>
                      <input type="hidden" name="tenantId" value={id} />
                      <input type="hidden" name="serverId" value={s.id} />
                      <button aria-label={`Remove ${s.name}`} className="grid size-10 place-items-center rounded-full text-ink-muted hover:bg-surface-muted hover:text-danger-600">
                        <Trash2 className="size-4" />
                      </button>
                    </form>
                  </div>
                </div>
                <ToolReview tenantId={id} serverId={s.id} serverName={s.name} tools={tools} />
              </Panel>
            );
          })}
        </div>
      </div>
    </div>
  );
}
