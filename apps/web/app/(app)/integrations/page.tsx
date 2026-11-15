import { redirect } from "next/navigation";
import { Lock, Trash2 } from "lucide-react";
import { getSettings, listExternalServers, withPrincipal } from "@garden/services";
import { getSession } from "@/lib/auth";
import { principalOf } from "@/lib/principal";
import { dateTime } from "@/lib/format";
import { EmptyState, PageHeader, Section } from "@/components/ui";
import { removeIntegrationAction, setIntegrationStatusAction } from "./actions";
import { ConnectForm, RecheckButton } from "./forms";

export const dynamic = "force-dynamic";

export default async function IntegrationsPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  const [settings, servers] = await Promise.all([
    withPrincipal(principalOf(session), (ctx) => getSettings(ctx)),
    listExternalServers(session.tenantId),
  ]);
  const isOwner = session.role === "owner";

  return (
    <div className="space-y-5">
      <PageHeader
        title="Integrations"
        subtitle={`Connect the tools you already use, such as a calendar or CRM, so ${settings.agentName} can work with them.`}
      />

      <Section title="How it works">
        <ul className="list-disc space-y-1 pl-5 text-sm text-ink-muted">
          <li>Connect a tool with its address and, if it needs one, an access token.</li>
          <li>The Palda team reviews what each tool can do and switches on the ones that are right for you. Until then they are marked as waiting.</li>
          <li>You can pause or remove an integration at any time. Your token is stored encrypted and is never shown again.</li>
        </ul>
      </Section>

      {isOwner ? (
        <Section title="Connect a tool">
          <ConnectForm />
        </Section>
      ) : (
        <p className="rounded-2xl bg-surface-muted px-4 py-3 text-sm text-ink-muted">Only the account owner can connect or change integrations.</p>
      )}

      {servers.length === 0 ? (
        <EmptyState title="Nothing connected yet" body="Tools you connect will be listed here with their status." />
      ) : (
        servers.map((s) => (
          <Section key={s.id} title={s.name}>
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 text-sm">
                <span className={`pill ${s.status === "active" ? "bg-lime-100 text-brand-800" : "bg-surface-muted text-ink-muted"}`}>
                  {s.status === "active" ? "Connected" : "Paused"}
                </span>
                <p className="mt-2 truncate font-mono text-xs text-ink-muted">{s.host}</p>
                <p className="mt-1 flex flex-wrap items-center gap-1 text-xs text-ink-muted">
                  {s.hasToken ? (
                    <>
                      <Lock className="size-3" /> token saved
                    </>
                  ) : (
                    "no token"
                  )}
                  {" · "}added by {s.addedBy === "customer" ? "you" : "the Palda team"}
                  {s.lastSyncedAt ? ` · checked ${dateTime(s.lastSyncedAt)}` : ""}
                </p>
                {s.lastError ? <p className="mt-1 text-xs text-danger-600">Last problem: {s.lastError}</p> : null}
              </div>
              {isOwner ? (
                <div className="flex items-start gap-2">
                  <RecheckButton serverId={s.id} />
                  <form action={setIntegrationStatusAction}>
                    <input type="hidden" name="serverId" value={s.id} />
                    <input type="hidden" name="status" value={s.status === "active" ? "disabled" : "active"} />
                    <button className="btn btn-secondary h-10 px-4">{s.status === "active" ? "Pause" : "Resume"}</button>
                  </form>
                  <form action={removeIntegrationAction}>
                    <input type="hidden" name="serverId" value={s.id} />
                    <button aria-label={`Remove ${s.name}`} className="grid size-10 place-items-center rounded-full text-ink-muted hover:bg-surface-muted hover:text-danger-600">
                      <Trash2 className="size-4" />
                    </button>
                  </form>
                </div>
              ) : null}
            </div>
            <ul className="divide-y divide-line rounded-2xl border border-line">
              {s.tools.map((t) => (
                <li key={t.name} className="flex items-start justify-between gap-3 px-4 py-3">
                  <span className="min-w-0">
                    <span className="block font-mono text-sm font-medium">{t.name}</span>
                    <span className="mt-0.5 block break-words text-xs text-ink-muted">{t.description}</span>
                  </span>
                  <span className={`pill shrink-0 ${t.enabled ? "bg-lime-100 text-brand-800" : "bg-surface-muted text-ink-muted"}`}>
                    {t.enabled ? "active" : t.changed ? "paused: changed" : "waiting for review"}
                  </span>
                </li>
              ))}
            </ul>
          </Section>
        ))
      )}
    </div>
  );
}
