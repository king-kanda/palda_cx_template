"use client";

import { useActionState, useState } from "react";
import { RefreshCw, TriangleAlert } from "lucide-react";
import {
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
