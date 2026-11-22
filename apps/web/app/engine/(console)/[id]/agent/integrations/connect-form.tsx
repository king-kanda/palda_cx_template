"use client";

import { startTransition, useActionState, useRef, type FormEvent } from "react";
import { addExternalServerAction, saveOdooAction, type EngineFormState } from "../../actions";

function Notice({ state }: { state: EngineFormState }) {
  if (state.error) {
    return (
      <p role="alert" className="rounded-xl border border-danger-600/30 bg-danger-100 px-3 py-2 text-sm text-danger-600">
        {state.error}
      </p>
    );
  }
  if (state.ok) return <p className="rounded-xl bg-lime-100 px-3 py-2 text-sm text-brand-900">{state.message}</p>;
  return null;
}

/**
 * Submits by hand (not `action={action}`): React 19 clears every field after an action returns, even on an error, which would
 * wipe what was typed. Success resets the form on purpose.
 */
function useKeepFieldsAction(fn: (prev: EngineFormState, data: FormData) => Promise<EngineFormState>, resetOnOk: boolean) {
  const formRef = useRef<HTMLFormElement>(null);
  const [state, action, pending] = useActionState<EngineFormState, FormData>(async (prev, data) => {
    const result = await fn(prev, data);
    if (result.ok && resetOnOk) formRef.current?.reset();
    return result;
  }, {});
  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    startTransition(() => action(data));
  };
  return { formRef, state, pending, onSubmit };
}

/** A custom MCP server, for one-off apps Palda CX has no native tools for. */
export function ConnectForm({ tenantId }: { tenantId: string }) {
  const { formRef, state, pending, onSubmit } = useKeepFieldsAction(addExternalServerAction, true);
  return (
    <form ref={formRef} onSubmit={onSubmit} className="space-y-4">
      <input type="hidden" name="tenantId" value={tenantId} />
      <input type="hidden" name="provider" value="custom" />
      <div className="grid gap-4 sm:grid-cols-[2fr_1fr]">
        <div>
          <label htmlFor="int-label" className="mb-1.5 block text-sm font-medium">
            Name the customer will see
          </label>
          <input id="int-label" name="label" className="input" maxLength={40} placeholder="e.g. Our booking system" required />
        </div>
        <div>
          <label htmlFor="int-name" className="mb-1.5 block text-sm font-medium">
            Short name
          </label>
          <input id="int-name" name="name" className="input font-mono" maxLength={16} pattern="[a-z][a-z0-9]{1,15}" placeholder="e.g. erp" required autoComplete="off" />
        </div>
      </div>
      <div>
        <label htmlFor="int-url" className="mb-1.5 block text-sm font-medium">
          MCP server address
        </label>
        <input id="int-url" name="url" type="url" className="input" placeholder="https://…" required autoComplete="off" />
        <p className="mt-1 text-xs text-ink-muted">Must be https. Private network addresses are refused.</p>
      </div>
      <div>
        <label htmlFor="int-token" className="mb-1.5 block text-sm font-medium">
          Access token <span className="font-normal text-ink-muted">(if the server needs one)</span>
        </label>
        <input id="int-token" name="token" type="password" className="input" autoComplete="new-password" placeholder="Stored encrypted. Never shown again." />
      </div>
      <Notice state={state} />
      <button className="btn btn-primary h-11 px-5" disabled={pending}>
        {pending ? "Connecting…" : "Connect server"}
      </button>
    </form>
  );
}

/** Odoo with an API key. A blank key keeps the saved one, so the address or login can be changed without re-entering it. */
export function OdooForm({
  tenantId,
  saved,
}: {
  tenantId: string;
  saved: { url: string; db: string; username: string; hasKey: boolean } | null;
}) {
  const { formRef, state, pending, onSubmit } = useKeepFieldsAction(saveOdooAction, false);
  return (
    <form ref={formRef} onSubmit={onSubmit} className="space-y-4">
      <input type="hidden" name="tenantId" value={tenantId} />
      <div>
        <label htmlFor="odoo-url" className="mb-1.5 block text-sm font-medium">
          Odoo address
        </label>
        <input id="odoo-url" name="url" type="url" className="input" defaultValue={saved?.url ?? ""} placeholder="https://yourcompany.odoo.com" required autoComplete="off" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="odoo-db" className="mb-1.5 block text-sm font-medium">
            Database
          </label>
          <input id="odoo-db" name="db" className="input font-mono" defaultValue={saved?.db ?? ""} placeholder="yourcompany" required autoComplete="off" />
        </div>
        <div>
          <label htmlFor="odoo-user" className="mb-1.5 block text-sm font-medium">
            Login
          </label>
          <input id="odoo-user" name="username" className="input" defaultValue={saved?.username ?? ""} placeholder="you@company.com" required autoComplete="off" />
        </div>
      </div>
      <div>
        <label htmlFor="odoo-key" className="mb-1.5 block text-sm font-medium">
          API key
        </label>
        <input
          id="odoo-key"
          name="apiKey"
          type="password"
          className="input"
          autoComplete="new-password"
          required={!saved?.hasKey}
          placeholder={saved?.hasKey ? "Saved. Leave blank to keep it." : "Odoo > Preferences > Account Security > New API key"}
        />
        <p className="mt-1 text-xs text-ink-muted">Use a dedicated Odoo user with only the access the assistant needs.</p>
      </div>
      <Notice state={state} />
      <button className="btn btn-primary h-11 px-5" disabled={pending}>
        {pending ? "Testing…" : saved ? "Test and update" : "Test and connect"}
      </button>
    </form>
  );
}
