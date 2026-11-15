"use client";

import { startTransition, useActionState, useRef, useState } from "react";
import { addExternalServerAction, type EngineFormState } from "../../actions";

export type ProviderOption = { id: string; name: string; category: string; defaultName: string };

/** The Palda team connects an app for the customer. The customer never sees addresses or tokens. */
export function ConnectForm({ tenantId, providers }: { tenantId: string; providers: ProviderOption[] }) {
  const formRef = useRef<HTMLFormElement>(null);
  const [provider, setProvider] = useState(providers[0]?.id ?? "custom");
  const [name, setName] = useState(providers[0]?.defaultName ?? "");
  const [state, action, pending] = useActionState<EngineFormState, FormData>(async (prev, formData) => {
    const result = await addExternalServerAction(prev, formData);
    if (result.ok) {
      formRef.current?.reset();
      setProvider(providers[0]?.id ?? "custom");
      setName(providers[0]?.defaultName ?? "");
    }
    return result;
  }, {});
  const custom = provider === "custom";

  return (
    <form
      ref={formRef}
      // Not `action={action}`: React 19 clears every field after an action returns, even when it returns an error, which would
      // wipe what was typed. Submitting by hand keeps the fields; the success path below resets them on purpose.
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        startTransition(() => action(data));
      }}
      className="space-y-4">
      <input type="hidden" name="tenantId" value={tenantId} />
      <div>
        <label htmlFor="int-provider" className="mb-1.5 block text-sm font-medium">
          App
        </label>
        <select
          id="int-provider"
          name="provider"
          className="input"
          value={provider}
          onChange={(e) => {
            const next = e.target.value;
            setProvider(next);
            setName(providers.find((p) => p.id === next)?.defaultName ?? "");
          }}
        >
          {providers.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} ({p.category})
            </option>
          ))}
          <option value="custom">Other app…</option>
        </select>
      </div>

      {custom ? (
        <div>
          <label htmlFor="int-label" className="mb-1.5 block text-sm font-medium">
            Name the customer will see
          </label>
          <input id="int-label" name="label" className="input" maxLength={40} placeholder="e.g. Our booking system" required />
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-[1fr_2fr]">
        <div>
          <label htmlFor="int-name" className="mb-1.5 block text-sm font-medium">
            Short name
          </label>
          <input id="int-name" name="name" className="input font-mono" value={name} onChange={(e) => setName(e.target.value.toLowerCase())} maxLength={16} required autoComplete="off" />
          <p className="mt-1 text-xs text-ink-muted">Labels its tools internally.</p>
        </div>
        <div>
          <label htmlFor="int-url" className="mb-1.5 block text-sm font-medium">
            MCP server address
          </label>
          <input id="int-url" name="url" type="url" className="input" placeholder="https://…" required autoComplete="off" />
          <p className="mt-1 text-xs text-ink-muted">Must be https. Private network addresses are refused.</p>
        </div>
      </div>
      <div>
        <label htmlFor="int-token" className="mb-1.5 block text-sm font-medium">
          Access token <span className="font-normal text-ink-muted">(if the server needs one)</span>
        </label>
        <input id="int-token" name="token" type="password" className="input" autoComplete="new-password" placeholder="Stored encrypted. Never shown again." />
      </div>

      {state.error ? (
        <p role="alert" className="rounded-xl border border-danger-600/30 bg-danger-100 px-3 py-2 text-sm text-danger-600">
          {state.error}
        </p>
      ) : null}
      {state.ok ? <p className="rounded-xl bg-lime-100 px-3 py-2 text-sm text-brand-900">{state.message}</p> : null}
      <button className="btn btn-primary h-11 px-5" disabled={pending}>
        {pending ? "Connecting…" : "Connect for the customer"}
      </button>
    </form>
  );
}
