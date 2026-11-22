import Link from "next/link";
import type { ReactNode } from "react";
import { Lock, Trash2 } from "lucide-react";
import { getEngineCustomer, getOdooSettings, listAppConnections, listExternalServers, type AppConnectionView } from "@garden/services";
import { requireEngineAdmin } from "@/lib/engine-auth";
import { dateTime } from "@/lib/format";
import { Panel } from "../../../../components/ui";
import { deleteExternalServerAction, removeAppAction, setExternalServerStatusAction } from "../../actions";
import { WorkspaceHeader } from "../../header";
import { ConnectForm, OdooForm } from "./connect-form";

export const dynamic = "force-dynamic";

const STATUS = {
  connected: { label: "Connected", cls: "bg-success-100 text-success-600" },
  attention: { label: "Needs attention", cls: "bg-warning-100 text-warning-600" },
  not_connected: { label: "Not connected", cls: "bg-neutral-100 text-neutral-600" },
} as const;

function Mark({ app }: { app: AppConnectionView }) {
  return (
    <span className="grid size-11 shrink-0 place-items-center rounded-xl text-sm font-bold text-white" style={{ background: app.colour }} aria-hidden>
      {app.mark}
    </span>
  );
}

function AppCard({ app, tenantId, owner, children }: { app: AppConnectionView; tenantId: string; owner: string; children?: ReactNode }) {
  const status = STATUS[app.status];
  return (
    <section className="card flex min-w-0 flex-col p-5">
      <div className="flex items-start gap-3">
        <Mark app={app} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-semibold">{app.name}</h3>
            <span className={`pill border-transparent ${status.cls}`}>{status.label}</span>
            {app.mock && app.status !== "not_connected" ? <span className="pill border-transparent bg-info-100 text-info-600">sample data</span> : null}
          </div>
          <p className="text-xs text-ink-muted">{app.category}</p>
        </div>
      </div>
      <p className="mt-3 text-sm text-ink-muted">{app.capabilities}</p>

      <div className="mt-4 rounded-xl bg-surface-muted px-3 py-3 text-xs">
        {app.status === "not_connected" ? (
          app.auth === "oauth2" ? (
            <span className="text-ink-muted">
              {owner}&apos;s owner connects this from Integrations in their app.
              {!app.canConnect ? " The platform's OAuth client isn't set yet (Engine > Settings)." : ""}
            </span>
          ) : (
            <span className="text-ink-muted">Not connected yet.</span>
          )
        ) : (
          <span className="block text-ink">
            {app.account ?? "Connected"}
            {app.connectedAt ? <span className="text-ink-muted"> · since {dateTime(app.connectedAt)}</span> : null}
            {app.lastError ? <span className="mt-1 block text-warning-600">{app.lastError}</span> : null}
          </span>
        )}
      </div>

      {children}

      {app.status !== "not_connected" ? (
        <div className="mt-4 flex items-center justify-between gap-2 border-t border-line pt-3">
          <Link href={`/engine/${tenantId}/agent/tools`} className="text-sm font-medium text-brand-700 hover:underline">
            Choose its tools
          </Link>
          <form action={removeAppAction}>
            <input type="hidden" name="tenantId" value={tenantId} />
            <input type="hidden" name="app" value={app.id} />
            <button className="text-xs text-ink-muted hover:text-danger-600">Disconnect</button>
          </form>
        </div>
      ) : null}
    </section>
  );
}

/**
 * The apps this customer's agent can work with. Apps that sign in with OAuth (Google, Zoho) are connected by the business owner
 * in their own app and only shown here. Apps that need an API key (Odoo) and custom MCP servers are set up here by the Palda team.
 */
export default async function IntegrationsPage({ params }: { params: Promise<{ id: string }> }) {
  await requireEngineAdmin();
  const { id } = await params;
  const [customer, servers, apps, odoo] = await Promise.all([getEngineCustomer(id), listExternalServers(id), listAppConnections(id), getOdooSettings(id)]);
  const oauth = apps.filter((a) => a.auth === "oauth2");
  const keyed = apps.filter((a) => a.auth === "api_key");

  return (
    <div className="space-y-6">
      <WorkspaceHeader
        customer={customer}
        title="Integrations"
        subtitle={`Sign-in apps are connected by ${customer.name}'s owner. Apps that need a key are set up here.`}
        action={
          <Link href={`/engine/${id}/agent/tools`} className="btn btn-primary h-11 px-5">
            Choose tools
          </Link>
        }
      />

      <section className="space-y-3">
        <div className="px-1">
          <h2 className="text-base font-semibold">Connected by the owner</h2>
          <p className="text-xs text-ink-muted">The tokens stay with the business. You only see the status.</p>
        </div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {oauth.map((app) => (
            <AppCard key={app.id} app={app} tenantId={id} owner={customer.name} />
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <div className="px-1">
          <h2 className="text-base font-semibold">Connected by the Palda team</h2>
          <p className="text-xs text-ink-muted">Keys are tested, then stored encrypted and never shown again.</p>
        </div>
        <div className="grid items-start gap-4 xl:grid-cols-2">
          {keyed.map((app) => (
            <AppCard key={app.id} app={app} tenantId={id} owner={customer.name}>
              <div className="mt-4">
                <OdooForm tenantId={id} saved={odoo} />
              </div>
            </AppCard>
          ))}

          <Panel
            title="Custom MCP server"
          >
            <p className="mb-4 text-sm text-ink-muted">
              For a system Palda CX has no tools for. Its tools start off and are reviewed on Tools. If the server changes a tool, it switches off
              again.
            </p>
            <ConnectForm tenantId={id} />
          </Panel>
        </div>
      </section>

      {servers.length ? (
        <Panel title="Custom MCP servers" aside={`${servers.length} connected`}>
          <div className="-mx-5 overflow-x-auto">
            <table className="table min-w-[47.5rem]">
              <thead>
                <tr>
                  <th>Server</th>
                  <th>Address</th>
                  <th>Status</th>
                  <th className="!text-right">Tools on</th>
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
        </Panel>
      ) : null}
    </div>
  );
}
