"use client";

import { useActionState, useRef } from "react";
import { DOCUMENT_ACCEPT, DOCUMENT_KINDS } from "@garden/services/documents-meta";
import { addDocumentAction, type EngineFormState } from "../../actions";

export function DocumentForm({ tenantId }: { tenantId: string }) {
  const formRef = useRef<HTMLFormElement>(null);
  const [state, action, pending] = useActionState<EngineFormState, FormData>(async (prev, formData) => {
    const result = await addDocumentAction(prev, formData);
    if (result.ok) formRef.current?.reset();
    return result;
  }, {});

  return (
    <form ref={formRef} action={action} className="space-y-4">
      <input type="hidden" name="tenantId" value={tenantId} />
      <div className="grid gap-4 sm:grid-cols-[2fr_1fr]">
        <div>
          <label htmlFor="doc-title" className="mb-1.5 block text-sm font-medium">
            Title
          </label>
          <input id="doc-title" name="title" className="input" maxLength={120} placeholder="e.g. 2026 price list" required />
        </div>
        <div>
          <label htmlFor="doc-kind" className="mb-1.5 block text-sm font-medium">
            Type
          </label>
          <select id="doc-kind" name="kind" className="input" defaultValue="other">
            {DOCUMENT_KINDS.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div>
        <label htmlFor="doc-file" className="mb-1.5 block text-sm font-medium">
          File
        </label>
        <input id="doc-file" name="file" type="file" accept={DOCUMENT_ACCEPT} required className="input h-auto py-2.5" />
        <p className="mt-1 text-xs text-ink-muted">PDF, Word, Excel, images, text or CSV. Up to 5 MB.</p>
      </div>
      {state.error ? (
        <p role="alert" className="rounded-xl border border-danger-600/30 bg-danger-100 px-3 py-2 text-sm text-danger-600">
          {state.error}
        </p>
      ) : null}
      {state.ok ? <p className="rounded-xl bg-lime-100 px-3 py-2 text-sm text-brand-900">{state.message}</p> : null}
      <button className="btn btn-primary h-11 px-5" disabled={pending}>
        {pending ? "Uploading…" : "Upload document"}
      </button>
    </form>
  );
}
