import { getEngineCustomer, readinessOf } from "@garden/services";
import { requireEngineAdmin } from "@/lib/engine-auth";
import { Panel } from "../../../components/ui";
import { setStatusAction } from "../actions";
import { WorkspaceHeader } from "../header";
import { RolloutPanel } from "../rollout-panel";

export const dynamic = "force-dynamic";

export default async function RolloutPage({ params }: { params: Promise<{ id: string }> }) {
  await requireEngineAdmin();
  const { id } = await params;
  const customer = await getEngineCustomer(id);
  const checks = readinessOf(customer);
  const appUrl = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");

  return (
    <>
      <WorkspaceHeader
        customer={customer}
        title="Rollout"
        subtitle={
          customer.status === "setup"
            ? "Everything required must be done first. Rolling out switches the account on and creates the owner's password."
            : customer.status === "active"
              ? "This customer is live. The checklist shows what is still missing."
              : "This customer is suspended and can't sign in."
        }
        action={<span />}
      />
      <Panel title="Checklist">
        <RolloutPanel
          tenantId={customer.id}
          status={customer.status}
          checks={checks}
          appUrl={appUrl}
          businessName={customer.name}
          agentName={customer.agent.name}
        />
        {customer.status === "suspended" ? (
          <form action={setStatusAction} className="mt-5">
            <input type="hidden" name="tenantId" value={customer.id} />
            <input type="hidden" name="status" value="active" />
            <button className="btn btn-primary h-11 px-5">Reactivate</button>
          </form>
        ) : null}
      </Panel>
    </>
  );
}
