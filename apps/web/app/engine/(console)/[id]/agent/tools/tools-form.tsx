"use client";

import { useActionState, useMemo, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { ChevronDown, Lock, Search } from "lucide-react";
import { publishToolsAction, type EngineFormState } from "../../actions";
import { SyncButton, ToolReview, type ReviewTool } from "../integrations/integrations-forms";

export type ToolRow = {
  name: string;
  group: string;
  tier: "read" | "write-safe" | "write-sensitive" | "escalate";
  description: string;
  /** A shipped safety block. It is shown but cannot be switched on. */
  locked: boolean;
};

export type AppSection = {
  id: string;
  name: string;
  mark: string;
  colour: string;
  auth: "oauth2" | "api_key";
  status: "connected" | "attention" | "not_connected";
  account: string | null;
  capabilities: string;
  tools: ToolRow[];
};

export type McpSection = {
  id: string;
  name: string;
  displayName: string;
  host: string;
  active: boolean;
  lastError: string | null;
  tools: ReviewTool[];
};

const TIER: Record<ToolRow["tier"], { label: string; cls: string }> = {
  read: { label: "reads", cls: "bg-surface-muted text-ink-muted" },
  "write-safe": { label: "writes", cls: "bg-info-100 text-info-600" },
  "write-sensitive": { label: "needs approval", cls: "bg-warning-100 text-warning-600" },
  escalate: { label: "hands over", cls: "bg-surface-muted text-ink-muted" },
};

const GROUP_LABELS: Record<string, string> = {
  addons: "Add-ons",
  approvals: "Approvals",
  blocks: "Blocked dates",
  bookings: "Bookings",
  catalogue: "Services & prices",
  conversations: "Conversations",
  customers: "Customers",
  handoffs: "Handing over to a person",
  intake: "Intake forms",
  invoices: "Invoices",
  knowledge: "Knowledge",
  meetings: "Meetings",
  memory: "Memory",
  messages: "Messages",
  payments: "Payments",
  recalls: "Recalls",
  reminders: "Reminders",
  reports: "Reports",
  reviews: "Reviews",
  walkins: "Walk-ins",
};
const groupLabel = (g: string) => GROUP_LABELS[g] ?? g.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

type Filter = "all" | "builtin" | "apps" | "custom";

function Switch({ on, disabled, label, onClick, small }: { on: boolean; disabled?: boolean; label: string; onClick: () => void; small?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={`shrink-0 rounded-full p-0.5 transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
        small ? "h-5 w-9" : "h-6 w-11"
      } ${on ? "bg-brand-800" : "bg-neutral-100 ring-1 ring-inset ring-line"}`}
    >
      <span
        className={`block rounded-full bg-white shadow-sm transition-transform ${small ? "size-4" : "size-5"} ${
          on ? (small ? "translate-x-4" : "translate-x-5") : ""
        }`}
      />
    </button>
  );
}

function ToolLine({ tool, on, onToggle, note }: { tool: ToolRow; on: boolean; onToggle: () => void; note?: ReactNode }) {
  return (
    <li className="flex items-start gap-3 px-4 py-3">
      <Switch on={on} disabled={tool.locked} label={`${tool.name}: ${on ? "on" : "off"}`} onClick={onToggle} />
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-[0.8125rem] font-medium">{tool.name}</span>
          <span className={`pill border-transparent ${TIER[tool.tier].cls}`}>{TIER[tool.tier].label}</span>
          {tool.locked ? (
            <span className="flex items-center gap-1 text-xs text-ink-muted">
              <Lock className="size-3" /> always off for safety
            </span>
          ) : null}
          {note}
        </span>
        <span className="mt-0.5 block text-xs leading-relaxed text-ink-muted">{tool.description}</span>
      </span>
    </li>
  );
}

/** A collapsible block of tools with an "all on/off" switch in its header. */
function Block({
  title,
  icon,
  subtitle,
  badge,
  count,
  allOn,
  onAll,
  defaultOpen,
  forceOpen,
  children,
}: {
  title: string;
  icon?: ReactNode;
  subtitle?: ReactNode;
  badge?: ReactNode;
  count: string;
  allOn?: boolean;
  onAll?: (on: boolean) => void;
  defaultOpen?: boolean;
  forceOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(Boolean(defaultOpen));
  const shown = open || forceOpen;
  return (
    <section className="overflow-hidden rounded-2xl border border-line bg-surface">
      <div className="flex items-center gap-3 px-4 py-3">
        <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={shown} className="flex min-w-0 flex-1 items-center gap-3 text-left">
          {icon}
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center gap-2">
              <span className="font-semibold">{title}</span>
              {badge}
            </span>
            {subtitle ? <span className="mt-0.5 block truncate text-xs text-ink-muted">{subtitle}</span> : null}
          </span>
          <span className="shrink-0 text-xs tabular text-ink-muted">{count}</span>
          <ChevronDown className={`size-4 shrink-0 text-ink-subtle transition-transform ${shown ? "rotate-180" : ""}`} />
        </button>
        {onAll ? (
          <Switch small on={Boolean(allOn)} label={`${title}: switch all ${allOn ? "off" : "on"}`} onClick={() => onAll(!allOn)} />
        ) : (
          <span className="w-9 shrink-0" aria-hidden />
        )}
      </div>
      {shown ? <div className="border-t border-line">{children}</div> : null}
    </section>
  );
}

function Mark({ text, colour }: { text: string; colour: string }) {
  return (
    <span
      className="grid size-9 shrink-0 place-items-center rounded-xl text-xs font-bold text-white"
      style={{ background: colour }}
      aria-hidden
    >
      {text}
    </span>
  );
}

const STATUS = {
  connected: { label: "Connected", cls: "bg-success-100 text-success-600" },
  attention: { label: "Needs attention", cls: "bg-warning-100 text-warning-600" },
  not_connected: { label: "Not connected", cls: "bg-neutral-100 text-neutral-600" },
} as const;

export function ToolsForm({
  tenantId,
  businessName,
  tools,
  apps,
  mcp,
  initialBlocked,
  initialEnabled,
  initialMax,
}: {
  tenantId: string;
  businessName: string;
  tools: ToolRow[];
  apps: AppSection[];
  mcp: McpSection[];
  initialBlocked: string[];
  initialEnabled: string[];
  initialMax: number;
}) {
  const [state, action, pending] = useActionState<EngineFormState, FormData>(publishToolsAction, {});
  const [off, setOff] = useState<Set<string>>(new Set(initialBlocked));
  const [on, setOn] = useState<Set<string>>(new Set(initialEnabled));
  const [max, setMax] = useState(initialMax);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");

  const query = q.trim().toLowerCase();
  const match = (t: { name: string; description: string }, ...extra: string[]) =>
    !query || [t.name, t.description, ...extra].some((s) => s.toLowerCase().includes(query));

  const groups = useMemo(() => {
    const map = new Map<string, ToolRow[]>();
    for (const t of tools) map.set(t.group, [...(map.get(t.group) ?? []), t]);
    return [...map.entries()];
  }, [tools]);

  const flip = (set: Dispatch<SetStateAction<Set<string>>>, names: string[], add: boolean) =>
    set((prev) => {
      const next = new Set(prev);
      for (const n of names) {
        if (add) next.add(n);
        else next.delete(n);
      }
      return next;
    });

  const builtinOn = (t: ToolRow) => !t.locked && !off.has(t.name);
  const changes =
    [...off].filter((n) => !initialBlocked.includes(n)).length +
    initialBlocked.filter((n) => !off.has(n)).length +
    [...on].filter((n) => !initialEnabled.includes(n)).length +
    initialEnabled.filter((n) => !on.has(n)).length +
    (max !== initialMax ? 1 : 0);

  const builtinCount = tools.filter(builtinOn).length;
  const appTools = apps.flatMap((a) => a.tools);
  const appCount = appTools.filter((t) => on.has(t.name)).length;
  const mcpTotal = mcp.reduce((n, s) => n + s.tools.length, 0);
  const mcpOn = mcp.reduce((n, s) => n + s.tools.filter((t) => t.enabled).length, 0);

  const chips: { id: Filter; label: string; count: string }[] = [
    { id: "all", label: "All", count: `${builtinCount + appCount + mcpOn}/${tools.filter((t) => !t.locked).length + appTools.length + mcpTotal}` },
    { id: "builtin", label: "Built in", count: `${builtinCount}/${tools.filter((t) => !t.locked).length}` },
    { id: "apps", label: "Apps", count: `${appCount}/${appTools.length}` },
    { id: "custom", label: "Custom MCP", count: `${mcpOn}/${mcpTotal}` },
  ];

  const show = (f: Filter) => filter === "all" || filter === f;
  let visibleSections = 0;

  const builtinBlocks = show("builtin")
    ? groups
        .map(([group, rows]) => {
          const visible = rows.filter((t) => match(t, groupLabel(group), "built in", "palda"));
          if (!visible.length) return null;
          visibleSections += 1;
          const switchable = rows.filter((t) => !t.locked);
          const allOn = switchable.every(builtinOn);
          return (
            <Block
              key={group}
              title={groupLabel(group)}
              count={`${switchable.filter(builtinOn).length}/${switchable.length} on`}
              allOn={allOn}
              onAll={(v) => flip(setOff, switchable.map((t) => t.name), !v)}
              forceOpen={Boolean(query)}
            >
              <ul className="divide-y divide-line">
                {visible.map((t) => (
                  <ToolLine key={t.name} tool={t} on={builtinOn(t)} onToggle={() => flip(setOff, [t.name], builtinOn(t))} />
                ))}
              </ul>
            </Block>
          );
        })
        .filter(Boolean)
    : [];

  const appBlocks = show("apps")
    ? apps
        .map((app) => {
          const visible = app.tools.filter((t) => match(t, app.name, app.id));
          if (!visible.length) return null;
          visibleSections += 1;
          const allOn = app.tools.every((t) => on.has(t.name));
          const status = STATUS[app.status];
          return (
            <Block
              key={app.id}
              title={app.name}
              icon={<Mark text={app.mark} colour={app.colour} />}
              badge={<span className={`pill border-transparent ${status.cls}`}>{status.label}</span>}
              subtitle={
                app.status === "connected"
                  ? `${app.account ?? "Connected"} · ${app.capabilities}`
                  : app.status === "attention"
                    ? `The connection stopped working. ${app.auth === "oauth2" ? `${businessName}'s owner reconnects it in their app.` : "Re-enter the details on Integrations."}`
                    : app.auth === "oauth2"
                      ? `${businessName}'s owner connects this from Integrations in their app. Tools you switch on start working as soon as they do.`
                      : "Set up on the Integrations screen with an API key."
              }
              count={`${app.tools.filter((t) => on.has(t.name)).length}/${app.tools.length} on`}
              allOn={allOn}
              onAll={(v) => flip(setOn, app.tools.map((t) => t.name), v)}
              defaultOpen={app.status === "connected"}
              forceOpen={Boolean(query)}
            >
              <ul className="divide-y divide-line">
                {visible.map((t) => (
                  <ToolLine key={t.name} tool={t} on={on.has(t.name)} onToggle={() => flip(setOn, [t.name], !on.has(t.name))} />
                ))}
              </ul>
            </Block>
          );
        })
        .filter(Boolean)
    : [];

  const mcpBlocks = show("custom")
    ? mcp
        .map((srv) => {
          const visible = srv.tools.filter((t) => match(t, srv.displayName, srv.name, "mcp"));
          if (!visible.length) return null;
          visibleSections += 1;
          return (
            <Block
              key={srv.id}
              title={srv.displayName}
              badge={
                <span className={`pill border-transparent ${srv.active ? "bg-success-100 text-success-600" : "bg-neutral-100 text-neutral-600"}`}>
                  {srv.active ? "Custom MCP" : "Paused"}
                </span>
              }
              subtitle={srv.lastError ? `Last problem: ${srv.lastError}` : srv.host}
              count={`${srv.tools.filter((t) => t.enabled).length}/${srv.tools.length} on`}
              forceOpen={Boolean(query)}
            >
              <div className="space-y-3 p-4">
                <div className="flex justify-end">
                  <SyncButton tenantId={tenantId} serverId={srv.id} />
                </div>
                <ToolReview tenantId={tenantId} serverId={srv.id} serverName={srv.name} tools={visible} />
              </div>
            </Block>
          );
        })
        .filter(Boolean)
    : [];

  return (
    <div className="space-y-5 pb-28">
      {/* Search and filter */}
      <div className="card flex flex-wrap items-center gap-3 p-3">
        <label className="relative min-w-[14rem] flex-1">
          <span className="sr-only">Search tools</span>
          <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-ink-subtle" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search tools: zoho, odoo, google, refund, invoice…"
            className="input !pl-10"
          />
        </label>
        <nav className="flex flex-wrap gap-1" aria-label="Show">
          {chips.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setFilter(c.id)}
              aria-pressed={filter === c.id}
              className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm transition-colors ${
                filter === c.id ? "bg-brand-800 font-semibold text-white" : "text-ink-muted hover:bg-surface-muted hover:text-ink"
              }`}
            >
              {c.label}
              <span className={`text-xs tabular ${filter === c.id ? "text-white/70" : "text-ink-subtle"}`}>{c.count}</span>
            </button>
          ))}
        </nav>
      </div>

      {builtinBlocks.length ? (
        <div className="space-y-2.5">
          <h2 className="flex items-baseline gap-2 px-1">
            <span className="text-base font-semibold">Built in · Palda CX</span>
            <span className="text-xs text-ink-muted">On unless switched off.</span>
          </h2>
          {builtinBlocks}
        </div>
      ) : null}

      {appBlocks.length ? (
        <div className="space-y-2.5">
          <h2 className="flex items-baseline gap-2 px-1">
            <span className="text-base font-semibold">Apps</span>
            <span className="text-xs text-ink-muted">Off until you switch them on.</span>
          </h2>
          {appBlocks}
        </div>
      ) : null}

      {mcpBlocks.length ? (
        <div className="space-y-2.5">
          <h2 className="flex items-baseline gap-2 px-1">
            <span className="text-base font-semibold">Custom MCP servers</span>
            <span className="text-xs text-ink-muted">Saved per server.</span>
          </h2>
          {mcpBlocks}
        </div>
      ) : null}

      {visibleSections === 0 ? (
        <p className="rounded-2xl border border-dashed border-line px-6 py-10 text-center text-sm text-ink-muted">
          No tools match “{q}”.
        </p>
      ) : null}

      {/* Publish bar */}
      <form
        action={action}
        className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 px-4 py-3 backdrop-blur md:left-auto md:right-6 md:bottom-4 md:w-[min(48rem,calc(100%-3rem))] md:rounded-2xl md:border md:shadow-lg"
      >
        <input type="hidden" name="tenantId" value={tenantId} />
        <input type="hidden" name="agentId" value="wambo" />
        {[...off].map((n) => (
          <input key={`b-${n}`} type="hidden" name="blocked" value={n} />
        ))}
        {[...on].map((n) => (
          <input key={`e-${n}`} type="hidden" name="enabledIntegration" value={n} />
        ))}
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-xs text-ink-muted" title="Stops a runaway loop. Shipped limit 6, up to 12.">
            Max calls per message
            <input
              name="maxToolCalls"
              type="number"
              min={1}
              max={12}
              value={max}
              onChange={(e) => setMax(Number(e.target.value))}
              className="input !min-h-9 !w-16 text-center"
            />
          </label>
          <input name="note" maxLength={200} aria-label="Note for the audit log" className="input !min-h-9 min-w-[10rem] flex-1 text-sm" placeholder="Note for the audit log (optional)" />
          <span className={`text-xs ${changes ? "font-semibold text-warning-600" : "text-ink-subtle"}`}>
            {changes ? `${changes} unpublished change${changes === 1 ? "" : "s"}` : "No changes"}
          </span>
          <button className="btn btn-primary !min-h-9" disabled={pending || changes === 0}>
            {pending ? "Publishing…" : "Publish as new version"}
          </button>
        </div>
        {state.error ? <p role="alert" className="mt-2 text-sm text-danger-600">{state.error}</p> : null}
        {state.ok ? <p className="mt-2 text-sm text-brand-800">{state.message}</p> : null}
      </form>
    </div>
  );
}
