import { getEngineCustomer } from "@garden/services";
import { requireEngineAdmin } from "@/lib/engine-auth";
import { Panel } from "../../../components/ui";
import { BusinessForm } from "../business-form";
import { WorkspaceHeader } from "../header";

export const dynamic = "force-dynamic";

export default async function BusinessPage({ params }: { params: Promise<{ id: string }> }) {
  await requireEngineAdmin();
  const { id } = await params;
  const customer = await getEngineCustomer(id);
  return (
    <>
      <WorkspaceHeader
        customer={customer}
        title="Details & hours"
        subtitle="What the agent says about this business, when they're open, and their deposit and cancellation rules."
      />
      <Panel>
        <BusinessForm
          tenantId={customer.id}
          values={{
            name: customer.name,
            location: customer.business.location,
            description: customer.business.description,
            reviewLink: customer.business.reviewLink,
            workingHours: Object.fromEntries(Object.entries(customer.business.workingHours).map(([k, v]) => [String(k), v ?? null])),
            depositPct: customer.business.depositPct,
            cancellationNoticeHours: customer.business.cancellationNoticeHours,
          }}
        />
      </Panel>
    </>
  );
}
