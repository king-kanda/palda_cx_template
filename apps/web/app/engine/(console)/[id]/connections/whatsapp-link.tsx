"use client";

import { useActionState, useState } from "react";
import { Check, Copy, ExternalLink } from "lucide-react";
import { createWhatsappLinkAction, type EngineFormState } from "../actions";

export function WhatsappLink({ tenantId }: { tenantId: string }) {
  const [state, action, pending] = useActionState<EngineFormState, FormData>(createWhatsappLinkAction, {});
  const [copied, setCopied] = useState(false);

  return (
    <div className="space-y-3">
      <form action={action}>
        <input type="hidden" name="tenantId" value={tenantId} />
        <button className="btn btn-primary h-10 px-4" disabled={pending}>
          {pending ? "Making the link…" : "Make a connect link"}
        </button>
      </form>
      {state.error ? (
        <p role="alert" className="rounded-xl border border-danger-600/30 bg-danger-100 px-3 py-2 text-sm text-danger-600">
          {state.error}
        </p>
      ) : null}
      {state.url ? (
        <div className="space-y-2">
          <p className="text-xs text-ink-muted">{state.message}</p>
          <div className="flex gap-2">
            <input readOnly value={state.url} aria-label="Connect link" className="input font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
            <button
              type="button"
              className="btn btn-secondary h-11 shrink-0 px-4"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(state.url!);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                } catch {
                  /* the link is selectable */
                }
              }}
            >
              {copied ? <Check className="size-4" /> : <Copy className="size-4" />} {copied ? "Copied" : "Copy"}
            </button>
            <a href={state.url} target="_blank" rel="noreferrer" className="btn btn-secondary h-11 shrink-0 px-4" aria-label="Open the connect page">
              <ExternalLink className="size-4" />
            </a>
          </div>
        </div>
      ) : null}
    </div>
  );
}
