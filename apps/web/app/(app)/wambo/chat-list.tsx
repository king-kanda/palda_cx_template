import Link from "next/link";
import { CheckCheck, Search, Settings2, ShieldCheck } from "lucide-react";
import { listConversations } from "@garden/services";
import { shortDate, shortTime } from "@/lib/format";

type Row = Awaited<ReturnType<typeof listConversations>>[number];

export type InboxFilter = "all" | "wambo" | "human";

/** The two-pane inbox frame, identical with or without a chat open so nothing jumps when one is selected. */
export const INBOX_FRAME =
  "grid h-[calc(100vh-8.5rem)] min-h-[32rem] overflow-hidden rounded-2xl border border-line bg-surface lg:grid-cols-[22rem_1fr]";

export function parseFilter(value: string | undefined): InboxFilter {
  return value === "wambo" || value === "human" ? value : "all";
}

function initials(name: string) {
  return (
    name
      .split(" ")
      .map((part) => part[0])
      .slice(0, 2)
      .join("")
      .toUpperCase() || "?"
  );
}

/** WhatsApp shows today's chats by time and older ones by date. */
function stamp(value: Date | string | null | undefined) {
  if (!value) return "";
  const d = typeof value === "string" ? new Date(value) : value;
  return shortDate(d) === shortDate(new Date()) ? shortTime(d) : shortDate(d);
}

/** Soft, readable tints from the palette; the same name always gets the same one. */
const TINTS = [
  "bg-lime-100 text-brand-800",
  "bg-info-100 text-info-600",
  "bg-warning-100 text-warning-600",
  "bg-success-100 text-success-600",
  "bg-danger-100 text-danger-600",
  "bg-neutral-100 text-neutral-600",
];

function tint(name: string) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return TINTS[h % TINTS.length];
}

export function Avatar({ name, size = "size-11" }: { name: string; size?: string }) {
  return (
    <div className={`grid ${size} shrink-0 place-items-center rounded-full text-sm font-semibold ${tint(name)}`}>{initials(name)}</div>
  );
}

export function needsHuman(row: Row) {
  return row.conversation.state === "waiting_human";
}

/** Applies the inbox tab and search to the list. */
export function filterConversations(rows: Row[], filter: InboxFilter, q: string) {
  const query = q.trim().toLowerCase();
  return rows.filter((row) => {
    if (filter === "wambo" && row.conversation.handler !== "wambo") return false;
    if (filter === "human" && row.conversation.handler !== "human" && !needsHuman(row)) return false;
    if (!query) return true;
    return row.customer.name.toLowerCase().includes(query) || row.customer.phoneE164.includes(query.replace(/\s/g, ""));
  });
}

function StatusChip({ row, agentName }: { row: Row; agentName: string }) {
  if (needsHuman(row)) return <span className="pill border-warning-600/30 bg-warning-100 text-warning-600">Needs you</span>;
  if (row.conversation.handler === "human") return <span className="pill border-line bg-surface-muted text-ink-muted">You</span>;
  return <span className="pill border-transparent bg-brand-100 text-brand-800">{agentName}</span>;
}

export function ChatList({
  conversations,
  all,
  activeId,
  filter,
  q,
  agentName,
}: {
  /** The rows to show (already filtered). */
  conversations: Row[];
  /** Every conversation, for the tab counts. */
  all: Row[];
  activeId?: string;
  filter: InboxFilter;
  q: string;
  agentName: string;
}) {
  const query = (f: InboxFilter) => {
    const p = new URLSearchParams();
    if (f !== "all") p.set("filter", f);
    if (q) p.set("q", q);
    const s = p.toString();
    return s ? `?${s}` : "";
  };
  const counts: Record<InboxFilter, number> = {
    all: all.length,
    wambo: all.filter((r) => r.conversation.handler === "wambo").length,
    human: all.filter((r) => r.conversation.handler === "human" || needsHuman(r)).length,
  };
  const waiting = all.filter(needsHuman).length;
  const base = activeId ? `/wambo/${activeId}` : "/wambo";
  const tabs: { id: InboxFilter; label: string }[] = [
    { id: "all", label: "All" },
    { id: "wambo", label: agentName },
    { id: "human", label: "Needs you" },
  ];

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface">
      <div className="shrink-0 space-y-3 border-b border-line px-4 pb-3 pt-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">Chats</h2>
          <div className="flex items-center gap-1">
            <Link
              href="/approvals"
              title="Approvals"
              className="grid size-9 place-items-center rounded-full text-ink-muted hover:bg-surface-muted hover:text-ink"
            >
              <ShieldCheck className="size-[1.125rem]" />
            </Link>
            <Link
              href="/wambo/settings"
              title={`${agentName} settings`}
              className="grid size-9 place-items-center rounded-full text-ink-muted hover:bg-surface-muted hover:text-ink"
            >
              <Settings2 className="size-[1.125rem]" />
            </Link>
          </div>
        </div>

        <form action={base} className="relative">
          {filter !== "all" ? <input type="hidden" name="filter" value={filter} /> : null}
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-subtle" />
          <input name="q" defaultValue={q} placeholder="Search name or number" className="input !min-h-[2.375rem] !pl-9" />
        </form>

        <nav className="flex gap-1" aria-label="Filter chats">
          {tabs.map((t) => {
            const on = filter === t.id;
            return (
              <Link
                key={t.id}
                href={`${base}${query(t.id)}`}
                className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                  on ? "bg-brand-800 text-white" : "text-ink-muted hover:bg-surface-muted hover:text-ink"
                }`}
              >
                {t.label}
                <span
                  className={`rounded-full px-1.5 text-[0.6875rem] ${
                    on ? "bg-white/20" : t.id === "human" && waiting > 0 ? "bg-warning-100 text-warning-600" : "bg-surface-muted"
                  }`}
                >
                  {counts[t.id]}
                </span>
              </Link>
            );
          })}
        </nav>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {conversations.length === 0 ? (
          <p className="px-6 py-12 text-center text-sm text-ink-muted">
            {all.length === 0
              ? "No conversations yet. When a customer messages your WhatsApp number, the chat appears here."
              : q
                ? `No chats match “${q}”.`
                : "Nothing here right now."}
          </p>
        ) : (
          <ul>
            {conversations.map((row) => {
              const active = row.conversation.id === activeId;
              const last = row.lastMessage;
              const outbound = last?.direction === "outbound";
              return (
                <li key={row.conversation.id}>
                  <Link
                    href={`/wambo/${row.conversation.id}${query(filter)}`}
                    aria-current={active ? "page" : undefined}
                    className={`relative flex items-center gap-3 border-b border-line px-4 py-3 transition-colors ${
                      active ? "bg-brand-100/60" : "hover:bg-surface-muted"
                    }`}
                  >
                    {active ? <span className="absolute inset-y-2 left-0 w-1 rounded-r-full bg-brand-800" aria-hidden /> : null}
                    <Avatar name={row.customer.name} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <p className={`truncate text-sm ${needsHuman(row) ? "font-semibold" : "font-medium"}`}>{row.customer.name}</p>
                        <span className="shrink-0 text-[0.6875rem] text-ink-subtle">{stamp(last?.createdAt ?? row.conversation.lastInboundAt)}</span>
                      </div>
                      <div className="mt-1 flex items-center gap-2">
                        <p className="flex min-w-0 flex-1 items-center gap-1 truncate text-xs text-ink-muted">
                          {outbound ? <CheckCheck className="size-3.5 shrink-0 text-brand-700" /> : null}
                          <span className="truncate">{last?.body ?? "No messages yet"}</span>
                        </p>
                        <StatusChip row={row} agentName={agentName} />
                      </div>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
