import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, Bot, CheckCheck, UserRound } from "lucide-react";
import {
  getConversationThread,
  getSettings,
  listConversations,
  listHandoffs,
  withPrincipal,
} from "@garden/services";
import { getSession } from "@/lib/auth";
import { principalOf } from "@/lib/principal";
import { shortDate, shortTime, timeAgo } from "@/lib/format";
import {
  agentReplyAction,
  handBackAction,
  resolveHandoffAction,
  staffMessageAction,
  takeOverAction,
} from "../actions";
import { Avatar, ChatList } from "../chat-list";
import { Composer, ThreadScroller } from "../thread-client";

export const dynamic = "force-dynamic";

function dayLabel(value: Date | string) {
  const d = shortDate(value);
  if (d === shortDate(new Date())) return "Today";
  if (d === shortDate(new Date(Date.now() - 86_400_000))) return "Yesterday";
  return d;
}

export default async function WamboThreadPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  const { id } = await params;
  const query = await searchParams;
  const principal = principalOf(session);

  let thread: Awaited<ReturnType<typeof getConversationThread>>;
  try {
    thread = await withPrincipal(principal, (ctx) => getConversationThread(ctx, id, 200));
  } catch {
    notFound();
  }

  const [conversations, handoffs, settings] = await Promise.all([
    withPrincipal(principal, (ctx) => listConversations(ctx)),
    withPrincipal(principal, (ctx) => listHandoffs(ctx, { status: "open" })),
    withPrincipal(principal, (ctx) => getSettings(ctx)),
  ]);
  const openHandoff = handoffs.find((row) => row.conversation.id === id)?.handoff ?? null;

  const name = thread.customer?.name ?? "Conversation";
  const human = thread.conversation.handler === "human";

  // Group messages by day so we can render WhatsApp-style date chips.
  let lastDay = "";
  let lastDirection = "";

  return (
    <div>
      <div className="grid h-[calc(100vh-9rem)] min-h-[560px] overflow-hidden rounded-2xl border border-line bg-white lg:grid-cols-[minmax(320px,400px)_1fr]">
        <div className="hidden min-h-0 border-r border-[#e9edef] lg:block">
          <ChatList conversations={conversations} activeId={id} />
        </div>

        <section className="flex min-h-0 min-w-0 flex-col">
          {/* Conversation header */}
          <div className="flex h-[59px] shrink-0 items-center gap-3 bg-[#f0f2f5] px-3 md:px-4">
            <Link
              href="/wambo"
              aria-label="Back to inbox"
              className="grid size-9 place-items-center rounded-full text-[#54656f] hover:bg-black/5 lg:hidden"
            >
              <ArrowLeft className="size-5" />
            </Link>
            <Avatar name={name} size="size-10" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-base font-medium text-[#111b21]">{name}</p>
              <p className="flex items-center gap-1 truncate text-xs text-[#667781]">
                {human ? <UserRound className="size-3.5" /> : <Bot className="size-3.5" />}
                {human ? "Handled by a human" : `Handled by ${settings.agentName}`}
                {thread.customer?.phoneE164 ? ` · ${thread.customer.phoneE164}` : ""}
              </p>
            </div>
            <form action={human ? handBackAction : takeOverAction}>
              <input type="hidden" name="conversationId" value={id} />
              <button className="rounded-full bg-[#00a884] px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-[#008069]">
                {human ? `Hand back to ${settings.agentName}` : "Take over"}
              </button>
            </form>
          </div>

          {/* Banners */}
          {query.error ? (
            <p className="shrink-0 bg-danger-100 px-4 py-2 text-sm text-danger-600">{query.error}</p>
          ) : null}
          {openHandoff ? (
            <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 bg-[#fff3c4] px-4 py-2 text-sm text-[#54440a]">
              <span>
                Open handoff: <span className="font-medium">{openHandoff.reason}</span>
              </span>
              <form action={resolveHandoffAction}>
                <input type="hidden" name="handoffId" value={openHandoff.id} />
                <input type="hidden" name="conversationId" value={id} />
                <button className="text-xs font-semibold underline">Resolve handoff</button>
              </form>
            </div>
          ) : null}

          {/* Messages */}
          <ThreadScroller>
            {thread.messages.length === 0 ? (
              <p className="mx-auto mt-8 w-fit rounded-lg bg-white/90 px-3 py-1.5 text-xs text-[#54656f] shadow-sm">
                No messages yet.
              </p>
            ) : (
              thread.messages.map((message) => {
                const inbound = message.direction === "inbound";
                const system = message.type === "system";
                const day = dayLabel(message.createdAt);
                const showDay = day !== lastDay;
                lastDay = day;
                const direction = system ? "system" : inbound ? "in" : "out";
                const tail = showDay || direction !== lastDirection;
                lastDirection = direction;
                const usedTools = Array.isArray(message.toolCalls) && message.toolCalls.length > 0;

                return (
                  <div key={message.id}>
                    {showDay ? (
                      <div className="my-3 flex justify-center">
                        <span className="rounded-lg bg-white/90 px-3 py-1 text-xs uppercase text-[#54656f] shadow-sm">
                          {day}
                        </span>
                      </div>
                    ) : null}

                    {system ? (
                      <div className="my-2 flex justify-center">
                        <span className="max-w-[85%] rounded-lg bg-[#fff3c4] px-3 py-1.5 text-center text-xs text-[#54440a] shadow-sm">
                          {message.body}
                        </span>
                      </div>
                    ) : (
                      <div className={`flex ${inbound ? "justify-start" : "justify-end"} ${tail ? "mt-2" : "mt-0.5"}`}>
                        <div className={`wa-bubble ${inbound ? "wa-in" : "wa-out"} ${tail ? "wa-tail" : ""}`}>
                          <p className="whitespace-pre-wrap break-words pr-14">{message.body}</p>
                          <span className="float-right -mt-3.5 flex items-center gap-1 text-[11px] text-[#667781]">
                            {usedTools ? <span title="Wambo used tools">⚙</span> : null}
                            {shortTime(message.createdAt)}
                            {!inbound ? <CheckCheck className="size-4 text-[#53bdeb]" /> : null}
                          </span>
                          <span className="clear-both block h-0" />
                        </div>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </ThreadScroller>

          {/* Reply bar */}
          <Composer
            action={staffMessageAction}
            conversationId={id}
            placeholder={`Reply to ${name.split(" ")[0]} as staff (pauses Wambo)`}
          />

          <details className="shrink-0 border-t border-[#e9edef] bg-white px-4 py-2 text-sm">
            <summary className="cursor-pointer select-none text-xs font-medium text-[#54656f]">
              Ask Wambo · last customer message {timeAgo(thread.conversation.lastInboundAt)}
            </summary>
            <p className="mb-2 mt-2 text-xs text-[#667781]">
              Simulates a customer message and runs the agent. Uses the mock model unless
              OPENROUTER_API_KEY is configured.
            </p>
            <form action={agentReplyAction} className="flex gap-2 pb-1">
              <input type="hidden" name="conversationId" value={id} />
              <input
                className="input"
                name="text"
                placeholder="e.g. Is the gazebo free on Saturday?"
                required
              />
              <button className="btn btn-secondary shrink-0">Run Wambo</button>
            </form>
          </details>
        </section>
      </div>
    </div>
  );
}
