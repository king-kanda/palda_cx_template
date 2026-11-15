import Link from "next/link";
import { Lock, Trash2 } from "lucide-react";
import { INTEGRATION_PROVIDERS, getEngineCustomer, listExternalServers } from "@garden/services";
import { requireEngineAdmin } from "@/lib/engine-auth";
import { dateTime } from "@/lib/format";
import { Panel } from "../../../../components/ui";
import { deleteExternalServerAction, setExternalServerStatusAction } from "../../actions";
import { WorkspaceHeader } from "../../header";
import { ConnectForm } from "./connect-form";

export const dynamic = "force-dynamic";

/**
 * The apps the Palda team has connected for this customer (Zoho Books, Google Workspace, ...). The customer sees a read-only list
 * of the same apps and never touches the technical side. What the agent may DO with each is decided on the Tools screen.
 */
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
        subtitle={`The apps you have connected for ${customer.name}, such as accounting or Google Workspace. ${customer.name} sees them as a read-only list. What ${customer.agent.name} may do with each is set on the Tools screen.`}
        action={
          <Link href={`/engine/${id}/agent/tools`} className="btn btn-primary h-11 px-5">
            Review tools →
          </Link>
        }
      />

      <div className="grid items-start gap-5 xl:grid-cols-[1fr_1.7fr]">
        <Panel title="Connect an app">
          <ConnectForm
            tenantId={id}
            providers={INTEGRATION_PROVIDERS.map((p) => ({ id: p.id, name: p.name, category: p.category, defaultName: p.defaultName }))}
          />
        </Panel>
        <div className="space-y-5">
      {servers.length === 0 ? (
        <Panel title="Connected apps">
          <p className="text-sm text-ink-muted">Nothing connected for {customer.name} yet. Use the form to connect their first app.</p>
        </Panel>
      ) : (
        <Panel title="Connected apps" aside={`${servers.length} connected · ${waiting} tool${waiting === 1 ? "" : "s"} not switched on`}>
          <div className="-mx-5 overflow-x-auto">
            <table className="table min-w-[760px]">
              <thead>
                <tr>
                  <th>App</th>
                  <th>Address</th>
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
                      <span>{s.displayName}</span>
                      <span className="ml-2 font-mono text-xs font-normal text-ink-muted">{s.name}</span>
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
            Pausing hides all of an app's tools from the agent at once. The customer can't change any of this.
          </p>
        </Panel>
      )}
        </div>
      </div>
    </div>
  );
}
