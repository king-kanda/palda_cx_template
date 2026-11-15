import Link from "next/link";
import { Lock, Trash2 } from "lucide-react";
import { getEngineCustomer, listExternalServers } from "@garden/services";
import { requireEngineAdmin } from "@/lib/engine-auth";
import { dateTime } from "@/lib/format";
import { Panel } from "../../../../components/ui";
import { deleteExternalServerAction, setExternalServerStatusAction } from "../../actions";
import { WorkspaceHeader } from "../../header";

export const dynamic = "force-dynamic";

/** A list of what this customer has connected themselves. What the agent may DO with it is decided on the Tools screen. */
export default async function IntegrationsPage({ params }: { params: Promise<{ id: string }> }) {
  await requireEngineAdmin();
  const { id } = await params;
  const [customer, servers] = await Promise.all([getEngineCustomer(id), listExternalServers(id)]);
  const waiting = servers.reduce((n, s) => n + s.tools.filter((t) => !t.enabled).length, 0);

  return (
    <div className="space-y-5">
      <WorkspaceHeader
        customer={customer}
        title="Integrations"
        subtitle={`The outside tools ${customer.name} has connected from their own app. Their tools are switched on or off for ${customer.agent.name} on the Tools screen.`}
        action={
          <Link href={`/engine/${id}/agent/tools`} className="btn btn-primary h-11 px-5">
            Review tools →
          </Link>
        }
      />

      {servers.length === 0 ? (
        <Panel title="Connected integrations">
          <p className="text-sm text-ink-muted">
            {customer.name} hasn&apos;t connected anything yet. They connect integrations from Integrations in their own app.
          </p>
        </Panel>
      ) : (
        <Panel title="Connected integrations" aside={`${servers.length} connected · ${waiting} tool${waiting === 1 ? "" : "s"} not switched on`}>
          <div className="-mx-5 overflow-x-auto">
            <table className="table min-w-[760px]">
              <thead>
                <tr>
                  <th>Integration</th>
                  <th>Address</th>
                  <th>Added by</th>
                  <th>Status</th>
                  <th className="text-right">Tools on</th>
                  <th>Last checked</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {servers.map((s) => (
                  <tr key={s.id}>
                    <td className="font-semibold">
                      <span className="font-mono">{s.name}</span>
                      {s.lastError ? <span className="mt-0.5 block text-xs font-normal text-danger-600">{s.lastError}</span> : null}
                    </td>
                    <td className="font-mono text-xs text-ink-muted">
                      {s.host}
                      {s.hasToken ? (
                        <span className="ml-2 inline-flex items-center gap-1">
                          <Lock className="size-3" /> token
                        </span>
                      ) : null}
                    </td>
                    <td>{s.addedBy === "customer" ? "Customer" : "Palda team"}</td>
                    <td>
                      <span className={`pill ${s.status === "active" ? "bg-lime-100 text-brand-800" : "bg-surface-muted text-ink-muted"}`}>
                        {s.status === "active" ? "connected" : "paused"}
                      </span>
                    </td>
                    <td className="text-right tabular">
                      {s.enabledCount} / {s.tools.length}
                    </td>
                    <td className="text-xs text-ink-muted">{s.lastSyncedAt ? dateTime(s.lastSyncedAt) : "never"}</td>
                    <td>
                      <div className="flex items-center justify-end gap-1">
                        <form action={setExternalServerStatusAction}>
                          <input type="hidden" name="tenantId" value={id} />
                          <input type="hidden" name="serverId" value={s.id} />
                          <input type="hidden" name="status" value={s.status === "active" ? "disabled" : "active"} />
                          <button className="btn btn-secondary h-9 px-3 text-xs">{s.status === "active" ? "Pause" : "Resume"}</button>
                        </form>
                        <form action={deleteExternalServerAction}>
                          <input type="hidden" name="tenantId" value={id} />
                          <input type="hidden" name="serverId" value={s.id} />
                          <button aria-label={`Remove ${s.name}`} className="grid size-9 place-items-center rounded-full text-ink-muted hover:bg-surface-muted hover:text-danger-600">
                            <Trash2 className="size-4" />
                          </button>
                        </form>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs text-ink-muted">
            Pausing or removing here is for support (for example if a server misbehaves). The customer can also pause or remove their own integrations.
          </p>
        </Panel>
      )}
    </div>
  );
}
