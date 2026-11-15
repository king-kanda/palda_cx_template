import { redirect } from "next/navigation";
import { CalendarDays, Calculator, FileText, MessageSquare, Plug, Users } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { getCustomerIntegrations, getSettings, getWhatsappConnection, withPrincipal } from "@garden/services";
import { getSession } from "@/lib/auth";
import { principalOf } from "@/lib/principal";
import { dateTime } from "@/lib/format";
import { EmptyState, PageHeader, Section } from "@/components/ui";
import { startWhatsappConnectAction } from "./actions";

export const dynamic = "force-dynamic";

const ICONS: Record<string, LucideIcon> = {
  Accounting: Calculator,
  "Calendar and email": CalendarDays,
  CRM: Users,
  Documents: FileText,
  "Team chat": MessageSquare,
  Scheduling: CalendarDays,
  Other: Plug,
};

const STATUS = {
  connected: { label: "Connected", cls: "bg-lime-100 text-brand-800" },
  paused: { label: "Paused", cls: "bg-surface-muted text-ink-muted" },
  attention: { label: "Needs attention", cls: "bg-warning-100 text-warning-600" },
} as const;

/**
 * The apps connected to the business, set up by the Palda team. Read-only on purpose: customers never handle the technical side
 * (addresses, tokens, permissions), and the page shows none of it.
 */
export default async function IntegrationsPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  const [settings, apps, whatsapp] = await Promise.all([
    withPrincipal(principalOf(session), (ctx) => getSettings(ctx)),
    getCustomerIntegrations(session.tenantId),
    getWhatsappConnection(session.tenantId),
  ]);
  const isOwner = session.role === "owner";
  const waLive = whatsapp !== null && whatsapp.status !== "disconnected";

  return (
    <div className="space-y-5">
      <PageHeader
        title="Integrations"
        subtitle={`The apps connected to your business, so ${settings.agentName} can work with them.`}
      />

      <Section title="WhatsApp">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 text-sm">
            {waLive ? (
              <>
                <span className={`pill ${whatsapp.status === "active" ? "bg-lime-100 text-brand-800" : "bg-warning-100 text-warning-600"}`}>
                  {whatsapp.status === "active" ? "Connected" : "Needs attention"}
                </span>
                <p className="mt-2 font-semibold">
                  {whatsapp.displayPhone || "Your number"}
                  {whatsapp.verifiedName ? ` · ${whatsapp.verifiedName}` : ""}
                </p>
                <p className="mt-1 text-ink-muted">
                  {whatsapp.mode === "coexistence"
                    ? `${settings.agentName} works on your existing WhatsApp Business number. You can keep using the app. Replies you send from your phone show in your inbox, and ${settings.agentName} stays quiet in chats you answer yourself.`
                    : `${settings.agentName} chats with your customers on this number.`}
                </p>
              </>
            ) : whatsapp ? (
              <>
                <span className="pill bg-warning-100 text-warning-600">Disconnected</span>
                <p className="mt-2 text-ink-muted">WhatsApp ended the connection, so {settings.agentName} can&apos;t send or receive messages. Reconnect to start again.</p>
              </>
            ) : (
              <>
                <span className="pill bg-surface-muted text-ink-muted">Not connected</span>
                <p className="mt-2 text-ink-muted">
                  Connect your business WhatsApp number so {settings.agentName} can chat with your customers. It takes a few minutes and you
                  stay in control of the number.
                </p>
              </>
            )}
          </div>
          {isOwner ? (
            <form action={startWhatsappConnectAction}>
              <button className="btn btn-primary h-11 px-5">{waLive ? "Reconnect WhatsApp" : "Connect WhatsApp"}</button>
            </form>
          ) : (
            <p className="text-xs text-ink-muted">Only the account owner can connect WhatsApp.</p>
          )}
        </div>
      </Section>

      {apps.length === 0 ? (
        <EmptyState
          title="No apps connected yet"
          body="Want your accounting, calendar or CRM connected? Ask the Palda team and we will set it up for you."
        />
      ) : (
        <>
          <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
            {apps.map((app) => {
              const Icon = ICONS[app.category] ?? Plug;
              const status = STATUS[app.status];
              return (
                <section key={app.id} className="card min-w-0 p-5">
                  <div className="flex items-start justify-between gap-3">
                    <span className="grid size-11 place-items-center rounded-xl bg-surface-muted text-brand-800">
                      <Icon className="size-5" strokeWidth={1.75} />
                    </span>
                    <span className={`pill ${status.cls}`}>{status.label}</span>
                  </div>
                  <h2 className="mt-4 text-lg font-semibold">{app.name}</h2>
                  <p className="text-xs text-ink-muted">{app.category}</p>
                  <p className="mt-2 text-sm text-ink-muted">{app.summary}</p>
                  <p className="mt-4 border-t border-line pt-3 text-xs text-ink-muted">
                    {app.status === "paused"
                      ? "Switched off for now."
                      : app.capabilities > 0
                        ? `${settings.agentName} can use ${app.capabilities} ${app.capabilities === 1 ? "feature" : "features"} of this app.`
                        : "Being set up by the Palda team."}
                    {app.lastCheckedAt ? ` Checked ${dateTime(app.lastCheckedAt)}.` : ""}
                  </p>
                  {app.status === "attention" ? (
                    <p className="mt-2 text-xs text-warning-600">We couldn&apos;t reach this app at the last check. Please let the Palda team know.</p>
                  ) : null}
                </section>
              );
            })}
          </div>
          <p className="text-sm text-ink-muted">Want another app connected? Ask the Palda team and we will set it up for you.</p>
        </>
      )}
    </div>
  );
}
