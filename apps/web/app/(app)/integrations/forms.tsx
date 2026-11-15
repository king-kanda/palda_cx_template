"use client";

import { useActionState, useRef } from "react";
import { RefreshCw } from "lucide-react";
import { connectIntegrationAction, recheckIntegrationAction, type IntegrationFormState } from "./actions";

function Notice({ state }: { state: IntegrationFormState }) {
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

export function ConnectForm() {
  const formRef = useRef<HTMLFormElement>(null);
  const [state, action, pending] = useActionState<IntegrationFormState, FormData>(async (prev, formData) => {
    const result = await connectIntegrationAction(prev, formData);
    if (result.ok) formRef.current?.reset();
    return result;
  }, {});
  return (
    <form ref={formRef} action={action} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-[1fr_2fr]">
        <div>
          <label htmlFor="int-name" className="mb-1.5 block text-sm font-medium">
            Name
          </label>
          <input id="int-name" name="name" className="input" placeholder="calendar" maxLength={16} required autoComplete="off" />
          <p className="mt-1 text-xs text-ink-muted">Lowercase letters and digits.</p>
        </div>
        <div>
          <label htmlFor="int-url" className="mb-1.5 block text-sm font-medium">
            Server address
          </label>
          <input id="int-url" name="url" type="url" className="input" placeholder="https://mcp.example.com/mcp" required autoComplete="off" />
          <p className="mt-1 text-xs text-ink-muted">Must start with https://</p>
        </div>
      </div>
      <div>
        <label htmlFor="int-token" className="mb-1.5 block text-sm font-medium">
          Access token <span className="font-normal text-ink-muted">(if it needs one)</span>
        </label>
        <input id="int-token" name="token" type="password" className="input" autoComplete="new-password" placeholder="Stored encrypted. Never shown again." />
      </div>
      <Notice state={state} />
      <button className="btn btn-primary h-11 px-5" disabled={pending}>
        {pending ? "Connecting…" : "Connect"}
      </button>
    </form>
  );
}

export function RecheckButton({ serverId }: { serverId: string }) {
  const [state, action, pending] = useActionState<IntegrationFormState, FormData>(recheckIntegrationAction, {});
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="serverId" value={serverId} />
      <button className="btn btn-secondary h-10 px-4" disabled={pending}>
        <RefreshCw className={`size-4 ${pending ? "animate-spin" : ""}`} /> {pending ? "Checking…" : "Re-check"}
      </button>
      <Notice state={state} />
    </form>
  );
}
