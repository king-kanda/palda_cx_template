"use client";

import { useActionState, useRef, useState } from "react";
import { RefreshCw, TriangleAlert } from "lucide-react";
import {
  addExternalServerAction,
  saveExternalToolsAction,
  syncExternalServerAction,
  type EngineFormState,
} from "../../actions";

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

export function AddServerForm({ tenantId }: { tenantId: string }) {
  const formRef = useRef<HTMLFormElement>(null);
  const [state, action, pending] = useActionState<EngineFormState, FormData>(async (prev, formData) => {
    const result = await addExternalServerAction(prev, formData);
    if (result.ok) formRef.current?.reset();
    return result;
  }, {});

  return (
    <form ref={formRef} action={action} className="space-y-4">
      <input type="hidden" name="tenantId" value={tenantId} />
      <div className="grid gap-4 sm:grid-cols-[1fr_2fr]">
        <div>
          <label htmlFor="mcp-name" className="mb-1.5 block text-sm font-medium">
            Name
          </label>
          <input id="mcp-name" name="name" className="input" placeholder="calendar" maxLength={16} required autoComplete="off" />
          <p className="mt-1 text-xs text-ink-muted">Lowercase, used to label its tools.</p>
        </div>
        <div>
          <label htmlFor="mcp-url" className="mb-1.5 block text-sm font-medium">
            Server address
          </label>
          <input id="mcp-url" name="url" type="url" className="input" placeholder="https://mcp.example.com/mcp" required autoComplete="off" />
          <p className="mt-1 text-xs text-ink-muted">Must be https. Addresses inside private networks are refused.</p>
        </div>
      </div>
      <div>
        <label htmlFor="mcp-token" className="mb-1.5 block text-sm font-medium">
          Access token <span className="font-normal text-ink-muted">(if the server needs one)</span>
        </label>
        <input id="mcp-token" name="token" type="password" className="input" autoComplete="new-password" placeholder="Sent as a Bearer token. Stored encrypted, never shown again." />
      </div>
      <Notice state={state} />
      <button className="btn btn-primary h-11 px-5" disabled={pending}>
        {pending ? "Connecting…" : "Connect and read tools"}
      </button>
    </form>
  );
}

export function SyncButton({ tenantId, serverId }: { tenantId: string; serverId: string }) {
  const [state, action, pending] = useActionState<EngineFormState, FormData>(syncExternalServerAction, {});
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="tenantId" value={tenantId} />
      <input type="hidden" name="serverId" value={serverId} />
      <button className="btn btn-secondary h-10 px-4" disabled={pending}>
        <RefreshCw className={`size-4 ${pending ? "animate-spin" : ""}`} /> {pending ? "Syncing…" : "Sync tools"}
      </button>
      <Notice state={state} />
    </form>
  );
}

export type ReviewTool = { name: string; description: string; enabled: boolean; changed: boolean; params: string[] };

export function ToolReview({ tenantId, serverId, serverName, tools }: { tenantId: string; serverId: string; serverName: string; tools: ReviewTool[] }) {
  const [state, action, pending] = useActionState<EngineFormState, FormData>(saveExternalToolsAction, {});
  const [on, setOn] = useState<Set<string>>(new Set(tools.filter((t) => t.enabled).map((t) => t.name)));
  const toggle = (name: string) =>
    setOn((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="tenantId" value={tenantId} />
      <input type="hidden" name="serverId" value={serverId} />
      {[...on].map((n) => (
        <input key={n} type="hidden" name="enabled" value={n} />
      ))}
      <ul className="divide-y divide-line rounded-2xl border border-line">
        {tools.map((t) => {
          const checked = on.has(t.name);
          return (
            <li key={t.name} className="flex items-start gap-3 px-4 py-3">
              <button
                type="button"
                role="switch"
                aria-checked={checked}
                aria-label={`${serverName} ${t.name}: ${checked ? "on" : "off"}`}
                onClick={() => toggle(t.name)}
                className={`mt-0.5 h-6 w-11 shrink-0 rounded-full p-0.5 transition-colors ${checked ? "bg-brand-800" : "bg-ink-subtle"}`}
              >
                <span className={`block size-5 rounded-full bg-white transition-transform ${checked ? "translate-x-5" : ""}`} />
              </button>
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-sm font-medium">{t.name}</span>
                  {t.changed ? (
                    <span className="pill flex items-center gap-1 bg-warning-100 text-warning-600">
                      <TriangleAlert className="size-3" /> changed by the server, review before switching on
                    </span>
                  ) : null}
                </span>
                <span className="mt-0.5 block break-words text-xs text-ink-muted">{t.description}</span>
                {t.params.length ? <span className="mt-1 block font-mono text-[11px] text-ink-subtle">inputs: {t.params.join(", ")}</span> : null}
              </span>
            </li>
          );
        })}
      </ul>
      <Notice state={state} />
      <div className="flex items-center gap-3">
        <button className="btn btn-primary h-10 px-5" disabled={pending}>
          {pending ? "Saving…" : "Save tool choices"}
        </button>
        <span className="text-xs text-ink-muted">
          {on.size} of {tools.length} on
        </span>
      </div>
    </form>
  );
}
