"use client";

import { useActionState, useMemo, useState } from "react";
import { Lock } from "lucide-react";
import { publishToolsAction, type EngineFormState } from "../../actions";

export type ToolRow = {
  name: string;
  group: string;
  tier: "read" | "write-safe" | "write-sensitive" | "escalate";
  description: string;
  /** A shipped safety block. It is shown but cannot be switched on. */
  locked: boolean;
};

const TIER: Record<ToolRow["tier"], { label: string; cls: string }> = {
  read: { label: "read", cls: "bg-surface-muted text-ink-muted" },
  "write-safe": { label: "writes", cls: "bg-brand-50 text-brand-800" },
  "write-sensitive": { label: "needs approval", cls: "bg-warning-100 text-warning-600" },
  escalate: { label: "hands over", cls: "bg-surface-muted text-ink-muted" },
};

export function ToolsForm({
  tenantId,
  tools,
  initialBlocked,
  initialMax,
}: {
  tenantId: string;
  tools: ToolRow[];
  initialBlocked: string[];
  initialMax: number;
}) {
  const [state, action, pending] = useActionState<EngineFormState, FormData>(publishToolsAction, {});
  const [off, setOff] = useState<Set<string>>(new Set(initialBlocked));
  const [max, setMax] = useState(initialMax);

  const groups = useMemo(() => {
    const map = new Map<string, ToolRow[]>();
    for (const t of tools) map.set(t.group, [...(map.get(t.group) ?? []), t]);
    return [...map.entries()];
  }, [tools]);

  const toggle = (name: string) =>
    setOff((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  const enabled = tools.filter((t) => !t.locked && !off.has(t.name)).length;

  return (
    <form action={action} className="space-y-5">
      <input type="hidden" name="tenantId" value={tenantId} />
      <input type="hidden" name="agentId" value="wambo" />
      {[...off].map((n) => (
        <input key={n} type="hidden" name="blocked" value={n} />
      ))}

      {groups.map(([group, rows]) => (
        <section key={group}>
          <h3 className="mb-1 font-mono text-[11px] uppercase tracking-[0.08em] text-ink-muted">{group}</h3>
          <ul className="divide-y divide-line rounded-2xl border border-line">
            {rows.map((t) => {
              const on = !t.locked && !off.has(t.name);
              return (
                <li key={t.name} className="flex items-start gap-3 px-4 py-3">
                  <button
                    type="button"
                    role="switch"
                    aria-checked={on}
                    aria-label={`${t.name}: ${on ? "on" : "off"}`}
                    disabled={t.locked}
                    onClick={() => toggle(t.name)}
                    className={`mt-0.5 h-6 w-11 shrink-0 rounded-full p-0.5 transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${on ? "bg-brand-800" : "bg-ink-subtle"}`}
                  >
                    <span className={`block size-5 rounded-full bg-white transition-transform ${on ? "translate-x-5" : ""}`} />
                  </button>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-sm font-medium">{t.name}</span>
                      <span className={`pill ${TIER[t.tier].cls}`}>{TIER[t.tier].label}</span>
                      {t.locked ? (
                        <span className="flex items-center gap-1 text-xs text-ink-muted">
                          <Lock className="size-3" /> always off for safety
                        </span>
                      ) : null}
                    </span>
                    <span className="mt-0.5 block text-xs text-ink-muted">{t.description}</span>
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="maxToolCalls" className="mb-1.5 block text-sm font-medium">
            Most tool calls per message
          </label>
          <input
            id="maxToolCalls"
            name="maxToolCalls"
            type="number"
            min={1}
            max={12}
            value={max}
            onChange={(e) => setMax(Number(e.target.value))}
            className="input"
          />
          <p className="mt-1 text-xs text-ink-muted">Stops a runaway loop. The shipped limit is 6; you can lower it, or raise it up to 12.</p>
        </div>
        <div>
          <label htmlFor="note" className="mb-1.5 block text-sm font-medium">
            Note for the audit log (optional)
          </label>
          <input id="note" name="note" maxLength={200} className="input" placeholder="e.g. no reschedules until staff are trained" />
        </div>
      </div>

      {state.error ? (
        <p role="alert" className="rounded-xl border border-danger-600/30 bg-danger-100 px-3 py-2 text-sm text-danger-600">
          {state.error}
        </p>
      ) : null}
      {state.ok ? <p className="rounded-xl bg-lime-100 px-3 py-2 text-sm text-brand-900">{state.message}</p> : null}

      <div className="flex items-center gap-3">
        <button className="btn btn-primary h-11 px-5" disabled={pending}>
          {pending ? "Publishing…" : "Publish as a new version"}
        </button>
        <span className="text-xs text-ink-muted">
          {enabled} of {tools.filter((t) => !t.locked).length} tools on
        </span>
      </div>
    </form>
  );
}
