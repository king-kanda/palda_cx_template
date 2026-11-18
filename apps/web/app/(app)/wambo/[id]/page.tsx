import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, CheckCheck, MessageCircle, Wrench } from "lucide-react";
import {
  getConversationThread,
  getSettings,
  listConversations,
  listHandoffs,
  withPrincipal,
} from "@garden/services";
import { whatsappMode } from "@garden/integrations";
import { getSession } from "@/lib/auth";
import { principalOf } from "@/lib/principal";
import { shortDate, shortTime } from "@/lib/format";
import { agentReplyAction, handBackAction, resolveHandoffAction, staffMessageAction, takeOverAction } from "../actions";
import { Avatar, ChatList, INBOX_FRAME, filterConversations, parseFilter } from "../chat-list";
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
  searchParams: Promise<{ error?: string; filter?: string; q?: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  const { id } = await params;
  const query = await searchParams;
  const principal = principalOf(session);
  const filter = parseFilter(query.filter);
  const q = (query.q ?? "").slice(0, 80);

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
  const agent = settings.agentName;
  const name = thread.customer?.name ?? "Conversation";
  const first = name.split(" ")[0] ?? name;
  const human = thread.conversation.handler === "human";

  // Group messages by day (date chips) and by sender (bubble tails), like WhatsApp.
  let lastDay = "";
  let lastDirection = "";

  return (
    <div>
      <div className={INBOX_FRAME}>
        <div className="hidden min-h-0 border-r border-line lg:block">
          <ChatList conversations={filterConversations(conversations, filter, q)} all={conversations} activeId={id} filter={filter} q={q} agentName={agent} />
        </div>

        <section className="flex min-h-0 min-w-0 flex-col">
          {/* Conversation header */}
          <header className="flex shrink-0 items-center gap-3 border-b border-line bg-surface px-3 py-3 md:px-5">
            <Link
              href="/wambo"
              aria-label="Back to inbox"
              className="grid size-9 place-items-center rounded-full text-ink-muted hover:bg-surface-muted lg:hidden"
            >
              <ArrowLeft className="size-5" />
            </Link>
            <Avatar name={name} size="size-10" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p className="truncate text-base font-semibold">{name}</p>
                {human ? (
                  <span className="pill border-line bg-surface-muted text-ink-muted max-sm:!hidden">You&apos;re replying</span>
                ) : (
                  <span className="pill border-transparent bg-brand-100 text-brand-800 max-sm:!hidden">
                    <span className="mr-1 inline-block size-1.5 rounded-full bg-brand-800" aria-hidden />
                    {agent} is replying
                  </span>
                )}
              </div>
              <p className="mt-0.5 truncate text-xs text-ink-muted">
                <span className="font-medium text-brand-800 sm:hidden">{human ? "You're replying · " : `${agent} is replying · `}</span>
                {thread.customer?.phoneE164 ?? ""}
                {thread.customer ? (
                  <>
                    {" · "}
                    <Link href={`/customers/${thread.customer.id}`} className="font-medium text-brand-700 hover:underline">
                      View customer
                    </Link>
                  </>
                ) : null}
              </p>
            </div>
            <form action={human ? handBackAction : takeOverAction}>
              <input type="hidden" name="conversationId" value={id} />
              <button className={`btn ${human ? "btn-secondary" : "btn-primary"} !min-h-9 !text-xs`}>
                {human ? `Hand back to ${agent}` : "Take over"}
              </button>
            </form>
          </header>

          {/* Banners */}
          {query.error ? <p className="shrink-0 bg-danger-100 px-5 py-2 text-sm text-danger-600">{query.error}</p> : null}
          {openHandoff ? (
            <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-warning-600/20 bg-warning-100 px-5 py-2.5 text-sm text-warning-600">
              <span>
                <span className="font-semibold">Needs you:</span> {openHandoff.reason}
              </span>
              <form action={resolveHandoffAction}>
                <input type="hidden" name="handoffId" value={openHandoff.id} />
                <input type="hidden" name="conversationId" value={id} />
                <button className="btn btn-secondary !min-h-8 !px-3 !text-xs">Mark resolved</button>
              </form>
            </div>
          ) : null}

          {/* Messages */}
          <ThreadScroller>
            {thread.messages.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center text-center">
                <span className="grid size-14 place-items-center rounded-full bg-surface text-brand-800 shadow-sm">
                  <MessageCircle className="size-7" strokeWidth={1.5} />
                </span>
                <p className="mt-3 text-sm font-semibold">No messages with {first} yet</p>
                <p className="mt-1 max-w-xs text-xs text-ink-muted">
                  Send the first message below, or use “Test as customer” to see how {agent} answers.
                </p>
              </div>
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
                      <div className="my-4 flex justify-center">
                        <span className="rounded-full bg-surface px-3 py-1 text-[0.6875rem] font-medium text-ink-muted shadow-sm">{day}</span>
                      </div>
                    ) : null}

                    {system ? (
                      <div className="my-2 flex justify-center">
                        <span className="max-w-[85%] rounded-lg bg-warning-100 px-3 py-1.5 text-center text-xs text-warning-600">{message.body}</span>
                      </div>
                    ) : (
                      <div className={`flex ${inbound ? "justify-start" : "justify-end"} ${tail ? "mt-3" : "mt-1"}`}>
                        <div className={`wa-bubble ${inbound ? "wa-in" : "wa-out"} ${tail ? "wa-tail" : ""} ${message.type === "test" ? "!border-dashed !border-info-600/40" : ""}`}>
                          {message.type === "test" ? (
                            <p className="mb-0.5 text-[0.6875rem] font-semibold text-info-600">Test message (from your team)</p>
                          ) : null}
                          <p className="whitespace-pre-wrap break-words pr-16">{message.body}</p>
                          <span className="float-right -mt-3.5 flex items-center gap-1 text-[0.6875rem] text-ink-subtle">
                            {usedTools ? (
                              <span title={`${agent} checked your system before answering`}>
                                <Wrench className="size-3" />
                              </span>
                            ) : null}
                            {shortTime(message.createdAt)}
                            {!inbound ? <CheckCheck className="size-3.5 text-brand-700" /> : null}
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

          <Composer
            replyAction={staffMessageAction}
            testAction={agentReplyAction}
            conversationId={id}
            customerFirstName={first}
            agentName={agent}
            human={human}
            live={whatsappMode() === "cloud"}
          />
        </section>
      </div>
    </div>
  );
}
