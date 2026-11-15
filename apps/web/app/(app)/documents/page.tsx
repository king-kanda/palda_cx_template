import { redirect } from "next/navigation";
import { Download, FileText } from "lucide-react";
import { formatBytes, kindLabel, listBusinessDocuments } from "@garden/services";
import { getSession } from "@/lib/auth";
import { dateTime } from "@/lib/format";
import { EmptyState, PageHeader, Section } from "@/components/ui";

export const dynamic = "force-dynamic";

/** The business's own documents, set up by the Palda team: brochures, price lists, terms, contract and quote templates. */
export default async function DocumentsPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  const docs = await listBusinessDocuments(session.tenantId);

  // Group by type so a price list isn't lost among contracts.
  const groups = new Map<string, typeof docs>();
  for (const d of docs) groups.set(d.kind, [...(groups.get(d.kind) ?? []), d]);

  return (
    <div className="space-y-5">
      <PageHeader title="Documents" subtitle="Your brochures, price lists, terms and templates, ready to download." />
      {docs.length === 0 ? (
        <EmptyState title="No documents yet" body="Documents the Palda team adds for your business will appear here." />
      ) : (
        [...groups.entries()].map(([kind, rows]) => (
          <Section key={kind} title={kindLabel(kind)}>
            <ul className="divide-y divide-line">
              {rows.map((d) => (
                <li key={d.id} className="flex items-center gap-3 py-3">
                  <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-surface-muted text-brand-800">
                    <FileText className="size-5" strokeWidth={1.75} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{d.title}</span>
                    <span className="block truncate text-xs text-ink-muted">
                      {d.filename} · {formatBytes(d.sizeBytes)} · added {dateTime(d.createdAt)}
                    </span>
                  </span>
                  <a href={`/api/documents/${d.id}`} className="btn btn-secondary h-10 px-4">
                    <Download className="size-4" /> Download
                  </a>
                </li>
              ))}
            </ul>
          </Section>
        ))
      )}
    </div>
  );
}
