import Link from "next/link";
import { Bot, CheckCheck, UserRound } from "lucide-react";
import { listConversations } from "@garden/services";
import { shortDate, shortTime } from "@/lib/format";

type Row = Awaited<ReturnType<typeof listConversations>>[number];

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

export function Avatar({ name, size = "size-12" }: { name: string; size?: string }) {
  return (
    <div
      className={`grid ${size} shrink-0 place-items-center rounded-full bg-[#dfe5e7] text-sm font-semibold text-[#54656f]`}
    >
      {initials(name)}
    </div>
  );
}

export function ChatList({ conversations, activeId }: { conversations: Row[]; activeId?: string }) {
  return (
    <div className="flex h-full min-h-0 flex-col bg-white">
      <div className="flex h-[59px] shrink-0 items-center justify-between bg-[#f0f2f5] px-4">
        <h2 className="text-lg font-bold text-[#111b21]">Chats</h2>
        <span className="rounded-full bg-white px-2.5 py-1 text-xs font-medium text-[#54656f]">
          {conversations.length}
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {conversations.length === 0 ? (
          <p className="px-6 py-12 text-center text-sm text-[#667781]">
            No conversations yet. When a customer messages your WhatsApp number, the chat appears here.
          </p>
        ) : (
          conversations.map((row) => {
            const active = row.conversation.id === activeId;
            const needsHuman = row.conversation.state === "waiting_human";
            const last = row.lastMessage;
            const outbound = last?.direction === "outbound";
            return (
              <Link
                key={row.conversation.id}
                href={`/wambo/${row.conversation.id}`}
                className={`flex items-center gap-3 pl-3 transition-colors ${
                  active ? "bg-[#f0f2f5]" : "hover:bg-[#f5f6f6]"
                }`}
              >
                <Avatar name={row.customer.name} />
                <div className="min-w-0 flex-1 border-b border-[#e9edef] py-3 pr-4">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="truncate text-base text-[#111b21]">{row.customer.name}</p>
                    <span
                      className={`shrink-0 text-xs ${needsHuman ? "font-medium text-[#1fa855]" : "text-[#667781]"}`}
                    >
                      {stamp(last?.createdAt ?? row.conversation.lastInboundAt)}
                    </span>
                  </div>
                  <div className="mt-0.5 flex items-center gap-1 text-sm text-[#667781]">
                    {outbound ? <CheckCheck className="size-4 shrink-0 text-[#53bdeb]" /> : null}
                    <p className="min-w-0 flex-1 truncate">{last?.body ?? "No messages yet."}</p>
                    {needsHuman ? (
                      <span
                        title="Needs a human"
                        className="grid size-5 shrink-0 place-items-center rounded-full bg-[#25d366] text-[11px] font-semibold text-white"
                      >
                        1
                      </span>
                    ) : row.conversation.handler === "human" ? (
                      <UserRound className="size-4 shrink-0 text-[#667781]" aria-label="Handled by a human" />
                    ) : (
                      <Bot className="size-4 shrink-0 text-[#667781]" aria-label="Handled by Wambo" />
                    )}
                  </div>
                </div>
              </Link>
            );
          })
        )}
      </div>
    </div>
  );
}

