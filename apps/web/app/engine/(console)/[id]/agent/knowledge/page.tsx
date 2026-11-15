import { Search, Trash2 } from "lucide-react";
import { getEngineCustomer, listKnowledgeDocuments, searchKnowledge } from "@garden/services";
import { vectorHealth } from "@garden/integrations";
import { requireEngineAdmin } from "@/lib/engine-auth";
import { dateTime } from "@/lib/format";
import { Panel } from "../../../../components/ui";
import { deleteKnowledgeAction, reindexKnowledgeAction } from "../../actions";
import { WorkspaceHeader } from "../../header";
import { KnowledgeForm } from "./knowledge-form";

export const dynamic = "force-dynamic";

export default async function KnowledgePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ q?: string }>;
}) {
  await requireEngineAdmin();
  const { id } = await params;
  const q = ((await searchParams).q ?? "").trim().slice(0, 300);
  const [customer, docs, health] = await Promise.all([getEngineCustomer(id), listKnowledgeDocuments(id), vectorHealth()]);

  let hits: Awaited<ReturnType<typeof searchKnowledge>> = [];
  let searchError = "";
  if (q) {
    try {
      hits = await searchKnowledge(id, q, 5);
    } catch (error) {
      searchError = error instanceof Error ? error.message : "Search failed.";
    }
  }

  return (
    <div className="space-y-5">
      <WorkspaceHeader
        customer={customer}
        title="Knowledge"
        subtitle={`Documents ${customer.agent.name} can search to answer questions about ${customer.name}. Only this customer's agent can see them.`}
        action={
          <form action={reindexKnowledgeAction}>
            <input type="hidden" name="tenantId" value={id} />
            <button className="btn btn-secondary h-11 px-5">Reindex</button>
          </form>
        }
      />

      {!health.ok ? (
        <p role="alert" className="rounded-2xl bg-warning-100 px-4 py-3 text-sm text-warning-600">
          The vector database isn&apos;t reachable ({health.detail}). Documents are saved, but can&apos;t be searched until it is back. Use Reindex then.
        </p>
      ) : null}

      <div className="grid items-start gap-5 xl:grid-cols-[1fr_1.2fr]">
        <Panel title="Add a document">
          <KnowledgeForm tenantId={id} />
        </Panel>

        <div className="space-y-5">
          <Panel title="Documents" aside={`${docs.length} · ${health.mode === "mock" ? "in-memory search (test mode)" : "Qdrant"}`}>
            {docs.length === 0 ? (
              <p className="text-sm text-ink-muted">Nothing yet. Add a policy or FAQ and the agent can use it straight away.</p>
            ) : (
              <ul className="divide-y divide-line">
                {docs.map((d) => (
                  <li key={d.id} className="flex items-center gap-3 py-3">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">{d.title}</span>
                      <span className="block font-mono text-xs text-ink-muted">
                        {d.chunkCount} sections · {d.chars.toLocaleString("en-KE")} chars · {dateTime(d.createdAt)}
                      </span>
                      {d.error ? <span className="block text-xs text-danger-600">{d.error}</span> : null}
                    </span>
                    <span
                      className={`pill ${d.status === "ready" ? "bg-lime-100 text-brand-800" : d.status === "failed" ? "bg-danger-100 text-danger-600" : "bg-surface-muted text-ink-muted"}`}
                    >
                      {d.status}
                    </span>
                    <form action={deleteKnowledgeAction}>
                      <input type="hidden" name="tenantId" value={id} />
                      <input type="hidden" name="docId" value={d.id} />
                      <button aria-label={`Delete ${d.title}`} className="grid size-9 place-items-center rounded-full text-ink-muted hover:bg-surface-muted hover:text-danger-600">
                        <Trash2 className="size-4" />
                      </button>
                    </form>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="Try a question" aside="what the agent would find">
            <form method="get" className="flex gap-2">
              <input name="q" defaultValue={q} className="input" placeholder="e.g. can I cancel the day before?" maxLength={300} />
              <button className="btn btn-secondary h-11 shrink-0 px-4" aria-label="Search">
                <Search className="size-4" />
              </button>
            </form>
            {searchError ? <p className="mt-3 text-sm text-danger-600">{searchError}</p> : null}
            {q && !searchError ? (
              hits.length === 0 ? (
                <p className="mt-3 text-sm text-ink-muted">Nothing relevant found. The agent would say it will check with the team.</p>
              ) : (
                <ul className="mt-3 space-y-3">
                  {hits.map((h, i) => (
                    <li key={i} className="rounded-2xl bg-surface-muted p-3 text-sm">
                      <p className="mb-1 flex justify-between gap-3 text-xs text-ink-muted">
                        <span className="font-semibold text-ink">{h.title}</span>
                        <span className="font-mono">match {h.score.toFixed(2)}</span>
                      </p>
                      <p className="whitespace-pre-wrap">{h.text}</p>
                    </li>
                  ))}
                </ul>
              )
            ) : null}
          </Panel>
        </div>
      </div>
    </div>
  );
}
