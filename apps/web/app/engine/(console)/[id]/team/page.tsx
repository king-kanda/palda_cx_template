import { ExternalLink } from "lucide-react";
import { getCustomerLists, getEngineCustomer } from "@garden/services";
import { requireEngineAdmin } from "@/lib/engine-auth";
import { Panel, fmtKes } from "../../../components/ui";
import { openCustomerAppAction } from "../actions";
import { WorkspaceHeader } from "../header";

export const dynamic = "force-dynamic";

export default async function TeamPage({ params }: { params: Promise<{ id: string }> }) {
  await requireEngineAdmin();
  const { id } = await params;
  const [customer, lists] = await Promise.all([getEngineCustomer(id), getCustomerLists(id)]);

  return (
    <>
      <WorkspaceHeader
        customer={customer}
        title="Team & services"
        subtitle="Who or what can be booked, what they sell, and the add-ons. Edit these in the customer's own Settings."
        action={
          <form action={openCustomerAppAction}>
            <input type="hidden" name="tenantId" value={customer.id} />
            <input type="hidden" name="to" value="/settings" />
            <button className="btn btn-primary h-11 px-5">
              Edit in their Settings <ExternalLink className="size-4" />
            </button>
          </form>
        }
      />

      <div className="grid gap-5 xl:grid-cols-3">
        <Panel title="Team" aside={lists.team.length}>
          {lists.team.length === 0 ? (
            <p className="text-sm text-ink-muted">None yet. Rollout needs at least one.</p>
          ) : (
            <ul className="divide-y divide-line">
              {lists.team.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-3 py-2.5 text-[0.9375rem]">
                  <span>{r.name}</span>
                  <span className="font-mono text-xs text-ink-muted">
                    {r.kind}
                    {r.capacity ? ` · ${r.capacity}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Services" aside={lists.services.length} className="xl:col-span-1">
          {lists.services.length === 0 ? (
            <p className="text-sm text-ink-muted">None yet. Rollout needs at least one.</p>
          ) : (
            <ul className="divide-y divide-line">
              {lists.services.map((o) => (
                <li key={o.id} className="py-2.5">
                  <div className="flex items-baseline justify-between gap-3 text-[0.9375rem]">
                    <span>{o.name}</span>
                    <span className="font-mono text-xs">{fmtKes(o.basePriceKes)}</span>
                  </div>
                  <p className="font-mono text-xs text-ink-muted">
                    {o.durationMin} min{o.bufferBeforeMin ? ` · ${o.bufferBeforeMin} min travel` : ""}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Add-ons" aside={lists.addons.length}>
          {lists.addons.length === 0 ? (
            <p className="text-sm text-ink-muted">None for this type of business.</p>
          ) : (
            <ul className="divide-y divide-line">
              {lists.addons.map((a) => (
                <li key={a.id} className="flex items-baseline justify-between gap-3 py-2.5 text-[0.9375rem]">
                  <span>{a.name}</span>
                  <span className="font-mono text-xs">{fmtKes(a.priceKes)}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </>
  );
}
