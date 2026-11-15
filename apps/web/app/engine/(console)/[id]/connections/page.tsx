import Link from "next/link";
import { customerTelemetry, getEngineCustomer, langfuseConfigured } from "@garden/services";
import { requireEngineAdmin } from "@/lib/engine-auth";
import { Panel } from "../../../components/ui";
import { WorkspaceHeader } from "../header";

export const dynamic = "force-dynamic";

function Status({ ok, on, off }: { ok: boolean; on: string; off: string }) {
  return <span className={`pill ${ok ? "bg-success-100 text-success-600" : "bg-neutral-100 text-neutral-600"}`}>{ok ? on : off}</span>;
}

export default async function ConnectionsPage({ params }: { params: Promise<{ id: string }> }) {
  await requireEngineAdmin();
  const { id } = await params;
  const [customer, t] = await Promise.all([getEngineCustomer(id), customerTelemetry(id, "month")]);
  const lf = langfuseConfigured();

  return (
    <>
      <WorkspaceHeader customer={customer} title="Connections" subtitle="The channels and tools behind this customer's agent." />
      <div className="space-y-5">
        <Panel title="WhatsApp" aside={<Status ok={customer.whatsappConnected} on="Number connected" off="Not connected" />}>
          <p className="text-sm text-ink-muted">
            Customers reach the agent on WhatsApp. Inbound messages are matched to this business by the WhatsApp number linked to it.
            {customer.whatsappConnected
              ? " A number is linked, so messages to it reach this agent."
              : " No number is linked yet, so the agent can't receive customer messages. Linking a number isn't something the Engine can do yet: it has to be added to the customer's integrations record."}
          </p>
        </Panel>

        <Panel title="Langfuse traces" aside={<Status ok={lf} on="Configured" off="Not configured" />}>
          <p className="text-sm text-ink-muted">
            {t.langfuseRuns > 0
              ? `${t.langfuseRuns} of this customer's runs in the last 30 days carry a Langfuse trace, and each shows an “Open trace” link under Runs.`
              : lf
                ? "Langfuse is configured, but none of this customer's runs in the last 30 days carry a trace yet."
                : "Langfuse isn't configured on this server, so runs have no trace links."}{" "}
            See{" "}
            <Link href="/engine/sources" className="font-medium text-brand-800 hover:underline">
              Data sources
            </Link>{" "}
            for what the Engine can and can&apos;t see.
          </p>
        </Panel>
      </div>
    </>
  );
}
