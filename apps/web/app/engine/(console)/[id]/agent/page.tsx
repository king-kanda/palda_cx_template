import { WAMBO, applyAgentProfile } from "@garden/engine";
import { getEngineCustomer } from "@garden/services";
import { getPreset } from "@garden/verticals";
import { requireEngineAdmin } from "@/lib/engine-auth";
import { Panel } from "../../../components/ui";
import { AgentForm } from "../agent-form";
import { WorkspaceHeader } from "../header";

export const dynamic = "force-dynamic";

export default async function AgentPage({ params }: { params: Promise<{ id: string }> }) {
  await requireEngineAdmin();
  const { id } = await params;
  const customer = await getEngineCustomer(id);

  // Exactly what the customer-facing agent is given as its persona, built the same way the live agent builds it.
  const persona = applyAgentProfile(WAMBO, {
    agentName: customer.agent.name,
    businessName: customer.name,
    tone: customer.agent.tone,
    verticalInstructions: getPreset(customer.vertical).agent.personaExtras,
    notes: customer.agent.notes,
    intro: customer.agent.intro,
  }).persona;

  return (
    <>
      <WorkspaceHeader
        customer={customer}
        title="Agent"
        subtitle="Its name, picture and voice, and anything this customer needs it to know or do differently."
      />
      <div className="grid gap-5 xl:grid-cols-[1fr_1fr]">
        <Panel title="Profile & voice">
          <AgentForm tenantId={customer.id} agent={customer.agent} />
        </Panel>
        <Panel title="What the agent is told" aside="saved changes appear here">
          <p className="mb-3 text-xs text-ink-muted">
            This is the opening of the agent&apos;s instructions for {customer.name}: the name you chose, the rules that come with a{" "}
            {customer.verticalTitle.toLowerCase()}, then your voice and notes. It also gets the business facts, prices and the safety rules
            every time.
          </p>
          <pre className="max-h-[560px] overflow-auto whitespace-pre-wrap rounded-2xl bg-surface-muted p-4 font-mono text-[12.5px] leading-relaxed text-ink">
            {persona}
          </pre>
        </Panel>
      </div>
    </>
  );
}
