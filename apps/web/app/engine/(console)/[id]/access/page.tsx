import { getCustomerPeople, getEngineCustomer } from "@garden/services";
import { requireEngineAdmin } from "@/lib/engine-auth";
import { shortDate } from "@/lib/format";
import { Panel } from "../../../components/ui";
import { setStatusAction } from "../actions";
import { WorkspaceHeader } from "../header";
import { ResetPasswordPanel } from "../rollout-panel";

export const dynamic = "force-dynamic";

export default async function AccessPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  await requireEngineAdmin();
  const { id } = await params;
  const query = await searchParams;
  const [customer, people] = await Promise.all([getEngineCustomer(id), getCustomerPeople(id)]);
  const appUrl = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");

  return (
    <>
      <WorkspaceHeader customer={customer} title="Access" subtitle="Who can sign in to this customer's app, their password, and whether the account is switched on." />

      {query.error ? (
        <p role="alert" className="mb-4 rounded-2xl border border-danger-600/30 bg-danger-100 px-4 py-3 text-sm text-danger-600">
          {query.error}
        </p>
      ) : null}

      <div className="grid gap-5 xl:grid-cols-[1.3fr_1fr]">
        <div className="space-y-5">
          <Panel title="People" aside={`${people.length} with a login`}>
            <ul className="divide-y divide-line">
              {people.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-3 py-3">
                  <span className="min-w-0">
                    <span className="block truncate text-[15px] font-medium">{p.name}</span>
                    <span className="block truncate font-mono text-xs text-ink-muted">{p.email}</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    <span className="pill bg-neutral-100 text-neutral-600">{p.role}</span>
                    {!p.active ? <span className="pill bg-danger-100 text-danger-600">disabled</span> : null}
                    <span className="hidden font-mono text-xs text-ink-muted sm:inline">since {shortDate(p.createdAt)}</span>
                  </span>
                </li>
              ))}
            </ul>
          </Panel>

          <Panel title="Owner's password">
            <p className="mb-4 text-sm text-ink-muted">
              Issues a fresh one-time password for {customer.owner?.name ?? "the owner"}. The old one stops working straight away. Nothing is emailed:
              copy it and send it yourself.
            </p>
            <ResetPasswordPanel
              tenantId={customer.id}
              appUrl={appUrl}
              businessName={customer.name}
              agentName={customer.agent.name}
              disabledReason={customer.status === "setup" ? "Roll the customer out first. Rollout issues their first password." : undefined}
            />
          </Panel>
        </div>

        <Panel title="Account status">
          <p className="mb-4 text-sm text-ink-muted">
            {customer.status === "active"
              ? "Live. Their people can sign in."
              : customer.status === "suspended"
                ? "Suspended. Nobody can sign in. Their data is kept."
                : "In setup. Nobody can sign in until you roll the customer out."}
          </p>
          <div className="flex flex-wrap gap-2">
            {customer.status === "active" ? (
              <>
                <form action={setStatusAction}>
                  <input type="hidden" name="tenantId" value={customer.id} />
                  <input type="hidden" name="status" value="suspended" />
                  <button className="btn btn-danger">Suspend</button>
                </form>
                <form action={setStatusAction}>
                  <input type="hidden" name="tenantId" value={customer.id} />
                  <input type="hidden" name="status" value="setup" />
                  <button className="btn btn-secondary">Move back to setup</button>
                </form>
              </>
            ) : null}
            {customer.status === "suspended" ? (
              <form action={setStatusAction}>
                <input type="hidden" name="tenantId" value={customer.id} />
                <input type="hidden" name="status" value="active" />
                <button className="btn btn-primary">Reactivate</button>
              </form>
            ) : null}
          </div>
        </Panel>
      </div>
    </>
  );
}
