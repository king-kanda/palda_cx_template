import { redirect } from "next/navigation";
import { CalendarDays, Calculator, FileText, MessageSquare, Plug, Users } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { getCustomerIntegrations, getSettings, withPrincipal } from "@garden/services";
import { getSession } from "@/lib/auth";
import { principalOf } from "@/lib/principal";
import { dateTime } from "@/lib/format";
import { EmptyState, PageHeader } from "@/components/ui";

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
  const [settings, apps] = await Promise.all([
    withPrincipal(principalOf(session), (ctx) => getSettings(ctx)),
    getCustomerIntegrations(session.tenantId),
  ]);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Integrations"
        subtitle={`The apps connected to your business, so ${settings.agentName} can work with them.`}
      />

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
