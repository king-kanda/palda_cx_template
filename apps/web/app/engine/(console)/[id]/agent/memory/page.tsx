import { Trash2 } from "lucide-react";
import { MEMORY_MAX_PER_CUSTOMER, getEngineCustomer, listRecentMemories } from "@garden/services";
import { requireEngineAdmin } from "@/lib/engine-auth";
import { dateTime } from "@/lib/format";
import { Panel } from "../../../../components/ui";
import { deleteMemoryAction } from "../../actions";
import { WorkspaceHeader } from "../../header";

export const dynamic = "force-dynamic";

export default async function MemoryPage({ params }: { params: Promise<{ id: string }> }) {
  await requireEngineAdmin();
  const { id } = await params;
  const [customer, memories] = await Promise.all([getEngineCustomer(id), listRecentMemories(id, 100)]);

  // Group by end-customer so a reviewer sees each person's saved details together.
  const byPerson = new Map<string, { name: string; rows: typeof memories }>();
  for (const m of memories) {
    const entry = byPerson.get(m.customerId) ?? { name: m.customerName, rows: [] };
    entry.rows.push(m);
    byPerson.set(m.customerId, entry);
  }

  return (
    <div className="space-y-5">
      <WorkspaceHeader
        customer={customer}
        title="Memory"
        subtitle={`Short facts ${customer.agent.name} has saved about ${customer.name}'s customers, so it doesn't start from nothing each chat. Remove anything wrong or unwanted.`}
      />
      <Panel title="How it works">
        <ul className="list-disc space-y-1 pl-5 text-sm text-ink-muted">
          <li>The agent saves one short fact at a time (a preference, a pet, an access note). It is refused if it looks like an instruction, a link, a number, or something the customer is owed.</li>
          <li>Each customer keeps at most {MEMORY_MAX_PER_CUSTOMER} facts, and only that customer&apos;s own chats can see them.</li>
          <li>Facts are shown to the agent as background, never as instructions. Deleting one here removes it from the agent&apos;s recall straight away.</li>
        </ul>
      </Panel>

      {memories.length === 0 ? (
        <Panel title="Saved details">
          <p className="text-sm text-ink-muted">Nothing saved yet. Facts appear here after the agent learns something worth keeping.</p>
        </Panel>
      ) : (
        <div className="grid gap-5 lg:grid-cols-2">
          {[...byPerson.entries()].map(([customerId, person]) => (
            <Panel key={customerId} title={person.name} aside={`${person.rows.length} saved`}>
              <ul className="divide-y divide-line">
                {person.rows.map((m) => (
                  <li key={m.id} className="flex items-center gap-3 py-2.5">
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm">{m.fact}</span>
                      <span className="block font-mono text-xs text-ink-muted">
                        {m.source} · {dateTime(m.createdAt)}
                      </span>
                    </span>
                    <form action={deleteMemoryAction}>
                      <input type="hidden" name="tenantId" value={id} />
                      <input type="hidden" name="memoryId" value={m.id} />
                      <button aria-label={`Delete: ${m.fact}`} className="grid size-9 place-items-center rounded-full text-ink-muted hover:bg-surface-muted hover:text-danger-600">
                        <Trash2 className="size-4" />
                      </button>
                    </form>
                  </li>
                ))}
              </ul>
            </Panel>
          ))}
        </div>
      )}
    </div>
  );
}
