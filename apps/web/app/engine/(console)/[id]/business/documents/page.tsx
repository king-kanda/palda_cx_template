import { Download, FileText, Trash2 } from "lucide-react";
import { formatBytes, getEngineCustomer, kindLabel, listBusinessDocuments } from "@garden/services";
import { requireEngineAdmin } from "@/lib/engine-auth";
import { dateTime } from "@/lib/format";
import { Panel } from "../../../../components/ui";
import { deleteDocumentAction } from "../../actions";
import { WorkspaceHeader } from "../../header";
import { DocumentForm } from "./documents-form";

export const dynamic = "force-dynamic";

export default async function DocumentsPage({ params }: { params: Promise<{ id: string }> }) {
  await requireEngineAdmin();
  const { id } = await params;
  const [customer, docs] = await Promise.all([getEngineCustomer(id), listBusinessDocuments(id)]);

  return (
    <div className="space-y-5">
      <WorkspaceHeader
        customer={customer}
        title="Documents & templates"
        subtitle={`Brochures, price lists, terms, and contract or quote templates for ${customer.name}. They show in the customer's app under Documents, to download.`}
      />
      <div className="grid items-start gap-5 xl:grid-cols-[1fr_1.4fr]">
        <Panel title="Upload a document">
          <DocumentForm tenantId={id} />
        </Panel>

        <Panel title="Documents" aside={`${docs.length}`}>
          {docs.length === 0 ? (
            <p className="text-sm text-ink-muted">Nothing uploaded yet.</p>
          ) : (
            <ul className="divide-y divide-line">
              {docs.map((d) => (
                <li key={d.id} className="flex items-center gap-3 py-3">
                  <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-surface-muted text-brand-800">
                    <FileText className="size-5" strokeWidth={1.75} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{d.title}</span>
                    <span className="block truncate font-mono text-xs text-ink-muted">
                      {kindLabel(d.kind)} · {d.filename} · {formatBytes(d.sizeBytes)} · {dateTime(d.createdAt)}
                    </span>
                  </span>
                  <a
                    href={`/engine/download/${id}/${d.id}`}
                    aria-label={`Download ${d.title}`}
                    className="grid size-9 place-items-center rounded-full text-ink-muted hover:bg-surface-muted hover:text-ink"
                  >
                    <Download className="size-4" />
                  </a>
                  <form action={deleteDocumentAction}>
                    <input type="hidden" name="tenantId" value={id} />
                    <input type="hidden" name="documentId" value={d.id} />
                    <button aria-label={`Delete ${d.title}`} className="grid size-9 place-items-center rounded-full text-ink-muted hover:bg-surface-muted hover:text-danger-600">
                      <Trash2 className="size-4" />
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}
