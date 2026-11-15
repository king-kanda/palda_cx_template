"use client";

import { useActionState, useRef } from "react";
import { addKnowledgeAction, type EngineFormState } from "../../actions";

export function KnowledgeForm({ tenantId }: { tenantId: string }) {
  const [state, action, pending] = useActionState<EngineFormState, FormData>(async (prev, formData) => {
    const result = await addKnowledgeAction(prev, formData);
    if (result.ok) formRef.current?.reset();
    return result;
  }, {});
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <form ref={formRef} action={action} className="space-y-4">
      <input type="hidden" name="tenantId" value={tenantId} />
      <div>
        <label htmlFor="kd-title" className="mb-1.5 block text-sm font-medium">
          Title
        </label>
        <input id="kd-title" name="title" className="input" maxLength={120} placeholder="e.g. Cancellation and rescheduling policy" required />
      </div>
      <div>
        <label htmlFor="kd-body" className="mb-1.5 block text-sm font-medium">
          Text
        </label>
        <textarea
          id="kd-body"
          name="body"
          className="input min-h-48"
          placeholder="Paste the policy, FAQ or how-to. Separate topics with a blank line."
          required
        />
        <p className="mt-1 text-xs text-ink-muted">Up to 40,000 characters. Facts that change often (prices, hours) belong in Business details, not here.</p>
      </div>
      {state.error ? (
        <p role="alert" className="rounded-xl border border-danger-600/30 bg-danger-100 px-3 py-2 text-sm text-danger-600">
          {state.error}
        </p>
      ) : null}
      {state.ok ? <p className="rounded-xl bg-lime-100 px-3 py-2 text-sm text-brand-900">{state.message}</p> : null}
      <button className="btn btn-primary h-11 px-5" disabled={pending}>
        {pending ? "Indexing…" : "Add document"}
      </button>
    </form>
  );
}
