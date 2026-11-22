import { ChevronDown, RefreshCw, Search, Trash2 } from "lucide-react";
import { getEngineCustomer, listKnowledgeDocuments, searchKnowledge } from "@garden/services";
import { vectorHealth } from "@garden/integrations";
import { requireEngineAdmin } from "@/lib/engine-auth";
import { shortDate } from "@/lib/format";
import { deleteKnowledgeAction, reindexKnowledgeAction } from "../../actions";
import { WorkspaceHeader } from "../../header";
import { KnowledgeForm } from "./knowledge-form";

export const dynamic = "force-dynamic";

const STATUS: Record<string, { label: string; cls: string }> = {
  ready: { label: "Ready", cls: "bg-success-100 text-success-600" },
  indexing: { label: "Indexing", cls: "bg-info-100 text-info-600" },
  failed: { label: "Failed", cls: "bg-danger-100 text-danger-600" },
};

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="card min-w-0 p-4">
      <p className="text-xs text-ink-muted">{label}</p>
      <p className="truncate text-lg font-bold leading-tight tabular">{value}</p>
      {hint ? <p className="truncate text-xs text-ink-subtle">{hint}</p> : null}
    </div>
  );
}

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
  const sections = docs.reduce((n, d) => n + d.chunkCount, 0);
  const words = docs.reduce((n, d) => n + d.words, 0);
  const failed = docs.filter((d) => d.status === "failed").length;
  const searchLabel = !health.ok ? "Offline" : health.mode === "mock" ? "Test mode" : "Qdrant";

  return (
    <div className="space-y-5">
      <WorkspaceHeader
        customer={customer}
        title="Knowledge"
        subtitle={`Policies, FAQs and how-tos ${customer.agent.name} searches to answer questions about ${customer.name}. Only this customer's agent can see them.`}
        action={
          <form action={reindexKnowledgeAction}>
            <input type="hidden" name="tenantId" value={id} />
            <button className="btn btn-secondary h-11 px-4" title="Rebuild the search index from the saved documents">
              <RefreshCw className="size-4" /> Reindex
            </button>
          </form>
        }
      />

      {!health.ok ? (
        <p role="alert" className="rounded-2xl border border-warning-600/20 bg-warning-100 px-4 py-3 text-sm text-warning-600">
          The search engine isn&apos;t reachable ({health.detail}). Documents are saved but can&apos;t be searched until it is back; then press Reindex.
        </p>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Documents" value={String(docs.length)} hint={failed ? `${failed} failed to index` : `${words.toLocaleString("en-KE")} words`} />
        <Stat label="Searchable sections" value={sections.toLocaleString("en-KE")} />
        <Stat label="Search engine" value={searchLabel} />
      </div>

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        {/* Library */}
        <section className="space-y-3">
          <h2 className="px-1 text-lg font-semibold">Library</h2>
          {docs.length === 0 ? (
            <div className="grid place-items-center rounded-2xl border border-dashed border-line bg-surface px-6 py-14 text-center">
              <h3 className="font-semibold">No documents yet</h3>
              <p className="mt-1 max-w-sm text-sm text-ink-muted">
                Add the cancellation policy, an FAQ or house rules. {customer.agent.name} can use it from the very next message.
              </p>
            </div>
          ) : (
            <ul className="space-y-2">
              {docs.map((d) => {
                const status = STATUS[d.status] ?? STATUS.indexing!;
                return (
                  <li key={d.id}>
                    <details className="group overflow-hidden rounded-2xl border border-line bg-surface open:shadow-sm">
                      <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-4 hover:bg-surface-muted/60 [&::-webkit-details-marker]:hidden">
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-semibold">{d.title}</span>
                          <span className="block text-xs text-ink-muted">
                            {d.chunkCount} section{d.chunkCount === 1 ? "" : "s"} · {d.words.toLocaleString("en-KE")} words · added {shortDate(d.createdAt)}
                          </span>
                        </span>
                        <span className={`pill border-transparent ${status.cls}`}>{status.label}</span>
                        <ChevronDown className="size-4 shrink-0 text-ink-subtle transition-transform group-open:rotate-180" />
                      </summary>
                      <div className="border-t border-line px-4 py-4">
                        {d.error ? <p className="mb-3 rounded-xl bg-danger-100 px-3 py-2 text-xs text-danger-600">{d.error}</p> : null}
                        <div className="relative max-h-72 overflow-hidden">
                          <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink">{d.preview}</p>
                          {d.chars > d.preview.length ? (
                            <div className="absolute inset-x-0 bottom-0 h-16 bg-linear-to-t from-surface to-transparent" aria-hidden />
                          ) : null}
                        </div>
                        <div className="mt-3 flex items-center justify-between gap-3 border-t border-line pt-3">
                          <span className="text-xs text-ink-subtle">
                            {d.chars > d.preview.length ? `Showing the start of ${d.chars.toLocaleString("en-KE")} characters` : `${d.chars.toLocaleString("en-KE")} characters`}
                          </span>
                          <form action={deleteKnowledgeAction}>
                            <input type="hidden" name="tenantId" value={id} />
                            <input type="hidden" name="docId" value={d.id} />
                            <button className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-ink-muted hover:bg-danger-100 hover:text-danger-600">
                              <Trash2 className="size-3.5" /> Delete “{d.title.length > 30 ? `${d.title.slice(0, 30)}…` : d.title}”
                            </button>
                          </form>
                        </div>
                      </div>
                    </details>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <div className="space-y-5">
          <section className="card p-5">
            <h2 className="text-lg font-semibold">Add to knowledge</h2>
            <p className="mb-4 mt-0.5 text-xs text-ink-muted">Split into sections and indexed straight away.</p>
            <KnowledgeForm tenantId={id} />
          </section>

          <section className="card p-5">
            <h2 className="text-lg font-semibold">Test a question</h2>
            <form method="get" className="relative mt-4">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-ink-subtle" />
              <input name="q" defaultValue={q} className="input !pl-10 !pr-24" placeholder="e.g. can I cancel the day before?" maxLength={300} />
              <button className="btn btn-primary absolute right-1 top-1/2 !min-h-9 -translate-y-1/2 px-4 text-xs">Search</button>
            </form>
            {searchError ? <p className="mt-3 text-sm text-danger-600">{searchError}</p> : null}
            {q && !searchError ? (
              hits.length === 0 ? (
                <p className="mt-4 rounded-xl bg-surface-muted px-3 py-3 text-sm text-ink-muted">
                  Nothing relevant. {customer.agent.name} would say it will check with the team.
                </p>
              ) : (
                <ol className="mt-4 space-y-3">
                  {hits.map((h, i) => {
                    const pct = Math.max(4, Math.min(100, Math.round(h.score * 100)));
                    return (
                      <li key={i} className="rounded-xl border border-line p-3">
                        <div className="flex items-center justify-between gap-3">
                          <span className="truncate text-sm font-semibold">{h.title}</span>
                          <span className="shrink-0 text-xs tabular text-ink-muted">{pct}% match</span>
                        </div>
                        <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-surface-muted" aria-hidden>
                          <div className="h-full rounded-full bg-brand-800" style={{ width: `${pct}%` }} />
                        </div>
                        <blockquote className="mt-2.5 border-l-2 border-lime-400 pl-3 text-sm leading-relaxed text-ink-muted">
                          <p className="line-clamp-6 whitespace-pre-wrap">{h.text}</p>
                        </blockquote>
                      </li>
                    );
                  })}
                </ol>
              )
            ) : null}
          </section>
        </div>
      </div>
    </div>
  );
}
