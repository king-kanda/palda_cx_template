import Link from "next/link";
import { CheckCheck, Search, Settings2, ShieldCheck } from "lucide-react";
import { listConversations } from "@garden/services";
import { shortDate, shortTime } from "@/lib/format";

type Row = Awaited<ReturnType<typeof listConversations>>[number];

export type InboxFilter = "all" | "unanswered" | "wambo" | "human";

/** The two-pane inbox frame, identical with or without a chat open so nothing jumps when one is selected. */
export const INBOX_FRAME =
  "grid h-[calc(100vh-8.5rem)] min-h-[32rem] overflow-hidden rounded-2xl border border-line bg-surface lg:grid-cols-[24rem_1fr]";

export function parseFilter(value: string | undefined): InboxFilter {
  return value === "unanswered" || value === "wambo" || value === "human" ? value : "all";
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

/** WhatsApp shows today's chats by time, this week's by weekday and older ones by date. */
export function stamp(value: Date | string | null | undefined) {
  if (!value) return "";
  const d = typeof value === "string" ? new Date(value) : value;
  if (shortDate(d) === shortDate(new Date())) return shortTime(d);
  if (shortDate(d) === shortDate(new Date(Date.now() - 86_400_000))) return "Yesterday";
  if (Date.now() - d.getTime() < 6 * 86_400_000) {
    return new Intl.DateTimeFormat("en-GB", { weekday: "long", timeZone: "Africa/Nairobi" }).format(d);
  }
  return shortDate(d);
}

/** Soft, readable tints from the palette; the same name always gets the same one. */
const TINTS = [
  "bg-lime-100 text-brand-800",
  "bg-info-100 text-info-600",
  "bg-warning-100 text-warning-600",
  "bg-success-100 text-success-600",
  "bg-danger-100 text-danger-600",
  "bg-brand-100 text-brand-800",
];

function tint(name: string) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return TINTS[h % TINTS.length];
}

export function Avatar({ name, size = "size-12" }: { name: string; size?: string }) {
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
    if (filter === "unanswered" && row.unanswered === 0) return false;
    if (filter === "wambo" && row.conversation.handler !== "wambo") return false;
    if (filter === "human" && row.conversation.handler !== "human" && !needsHuman(row)) return false;
    if (!query) return true;
    return (
      row.customer.name.toLowerCase().includes(query) ||
      row.customer.phoneE164.includes(query.replace(/\s/g, "")) ||
      (row.lastMessage?.body ?? "").toLowerCase().includes(query)
    );
  });
}

/** Who is looking after the chat, as a short label beside the name. */
function Handler({ row, agentName }: { row: Row; agentName: string }) {
  if (needsHuman(row)) return <span className="shrink-0 text-xs font-medium text-warning-600">Needs you</span>;
  if (row.conversation.handler === "human") return <span className="shrink-0 text-xs text-ink-subtle">You</span>;
  return <span className="shrink-0 text-xs text-ink-subtle">{agentName}</span>;
}

function preview(row: Row, agentName: string) {
  const last = row.lastMessage;
  if (!last) return "No messages yet";
  if (last.direction === "outbound") {
    const staff = Array.isArray(last.toolCalls) && last.toolCalls.some((c) => (c as { staff?: boolean })?.staff);
    const who = staff || last.type === "app_reply" ? "You" : agentName;
    return `${who}: ${last.body ?? ""}`;
  }
  return last.body ?? "";
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
  const unanswered = all.filter((r) => r.unanswered > 0).length;
  const waiting = all.filter(needsHuman).length;
  const base = activeId ? `/wambo/${activeId}` : "/wambo";
  const tabs: { id: InboxFilter; label: string; count?: number; urgent?: boolean }[] = [
    { id: "all", label: "All" },
    { id: "unanswered", label: "Unanswered", count: unanswered },
    { id: "human", label: "Needs you", count: waiting, urgent: true },
    { id: "wambo", label: agentName },
  ];
  const iconLink =
    "grid size-[2.875rem] shrink-0 place-items-center rounded-2xl border border-line bg-surface text-ink-muted transition-colors hover:border-brand-800/30 hover:text-brand-800";

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface-muted">
      <div className="shrink-0 space-y-3 px-4 pb-2 pt-4">
        <div className="flex items-center gap-2">
          <form action={base} className="relative min-w-0 flex-1" role="search">
            {filter !== "all" ? <input type="hidden" name="filter" value={filter} /> : null}
            <Search className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-ink-subtle" />
            <input
              name="q"
              defaultValue={q}
              aria-label="Search chats"
              placeholder="Search chats"
              className="h-[2.875rem] w-full rounded-2xl border border-line bg-surface pl-10 pr-3 text-sm outline-none placeholder:text-ink-subtle focus:border-brand-700"
            />
          </form>
          <Link href="/approvals" title="Approvals" aria-label="Approvals" className={iconLink}>
            <ShieldCheck className="size-[1.125rem]" />
          </Link>
          <Link href="/wambo/settings" title={`${agentName} settings`} aria-label={`${agentName} settings`} className={iconLink}>
            <Settings2 className="size-[1.125rem]" />
          </Link>
        </div>

        <nav className="flex flex-wrap gap-1" aria-label="Filter chats">
          {tabs.map((t) => {
            const on = filter === t.id;
            return (
              <Link
                key={t.id}
                href={`${base}${query(t.id)}`}
                aria-current={on ? "page" : undefined}
                className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm transition-colors ${
                  on ? "bg-surface font-semibold text-ink shadow-sm" : "text-ink-muted hover:text-ink"
                }`}
              >
                {t.label}
                {t.count ? (
                  <span className={`text-xs font-semibold ${t.urgent ? "text-warning-600" : "text-brand-700"}`}>{t.count}</span>
                ) : null}
              </Link>
            );
          })}
        </nav>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {conversations.length === 0 ? (
          <p className="px-6 py-12 text-center text-sm text-ink-muted">
            {all.length === 0
              ? "No conversations yet. When a customer messages your WhatsApp number, the chat appears here."
              : q
                ? `No chats match “${q}”.`
                : filter === "unanswered"
                  ? "Every customer has had a reply."
                  : filter === "human"
                    ? `Nothing needs you. ${agentName} has it.`
                    : "Nothing here right now."}
          </p>
        ) : (
          <ul className="space-y-0.5">
            {conversations.map((row) => {
              const active = row.conversation.id === activeId;
              const last = row.lastMessage;
              const outbound = last?.direction === "outbound";
              const fresh = row.unanswered > 0;
              return (
                <li key={row.conversation.id}>
                  <Link
                    href={`/wambo/${row.conversation.id}${query(filter)}`}
                    aria-current={active ? "page" : undefined}
                    className={`flex items-center gap-3 rounded-2xl px-3 py-3 transition-colors ${
                      active ? "bg-surface shadow-sm" : "hover:bg-surface/70"
                    }`}
                  >
                    <div className="relative">
                      <Avatar name={row.customer.name} />
                      {needsHuman(row) ? (
                        <span
                          className="absolute -right-0.5 -top-0.5 size-3 rounded-full bg-warning-600 ring-2 ring-surface-muted"
                          aria-label="Needs you"
                        />
                      ) : null}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline gap-2">
                        <p className={`truncate text-[0.9375rem] ${fresh ? "font-bold" : "font-semibold"}`}>{row.customer.name}</p>
                        <Handler row={row} agentName={agentName} />
                        <span className={`ml-auto shrink-0 text-xs ${fresh ? "font-semibold text-brand-700" : "text-ink-subtle"}`}>
                          {stamp(last?.createdAt ?? row.conversation.lastInboundAt)}
                        </span>
                      </div>
                      <div className="mt-1 flex items-center gap-2">
                        <p className={`flex min-w-0 flex-1 items-center gap-1 text-sm ${fresh ? "font-medium text-ink" : "text-ink-muted"}`}>
                          {outbound ? <CheckCheck className="size-3.5 shrink-0 text-brand-700" aria-hidden /> : null}
                          <span className="truncate">{preview(row, agentName)}</span>
                        </p>
                        {fresh ? (
                          <span
                            className="grid min-w-5 shrink-0 place-items-center rounded-full bg-brand-800 px-1.5 text-[0.6875rem] font-bold leading-5 text-white"
                            aria-label={`${row.unanswered} unanswered`}
                          >
                            {row.unanswered}
                          </span>
                        ) : null}
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
