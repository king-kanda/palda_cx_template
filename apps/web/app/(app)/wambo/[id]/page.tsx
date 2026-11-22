import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, CheckCheck, UserRound, Wrench } from "lucide-react";
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
import { Avatar, ChatList, INBOX_FRAME, filterConversations, parseFilter, stamp } from "../chat-list";
import { Composer, ThreadScroller } from "../thread-client";

export const dynamic = "force-dynamic";

type Message = Awaited<ReturnType<typeof getConversationThread>>["messages"][number];
type Author = "customer" | "test" | "agent" | "staff" | "app";

/** A new run starts when the sender changes, the day changes, or the same sender pauses for this long. */
const RUN_GAP_MS = 10 * 60_000;

type Block =
  | { kind: "day"; label: string }
  | { kind: "system"; message: Message }
  | { kind: "run"; author: Author; messages: Message[] };

function dayLabel(value: Date | string) {
  const d = shortDate(value);
  if (d === shortDate(new Date())) return "Today";
  if (d === shortDate(new Date(Date.now() - 86_400_000))) return "Yesterday";
  return d;
}

/** "today at 10:54", "yesterday", "on Monday", "on 12 Nov 2026". */
function when(value: Date) {
  const s = stamp(value);
  if (s.includes(":")) return `today at ${s}`;
  if (s === "Yesterday") return "yesterday";
  return `on ${s}`;
}

function authorOf(m: Message): Author {
  if (m.direction === "inbound") return m.type === "test" ? "test" : "customer";
  if (m.type === "app_reply") return "app";
  if (Array.isArray(m.toolCalls) && m.toolCalls.some((c) => (c as { staff?: boolean } | null)?.staff)) return "staff";
  return "agent";
}

function usedTools(m: Message) {
  return (
    Array.isArray(m.toolCalls) &&
    m.toolCalls.some((c) => c && typeof c === "object" && !("staff" in (c as Record<string, unknown>)))
  );
}

/** Day chips, system notes, and runs of consecutive messages from the same sender, like a modern chat app. */
function toBlocks(messages: Message[]): Block[] {
  const blocks: Block[] = [];
  let day = "";
  let run: Extract<Block, { kind: "run" }> | null = null;
  for (const m of messages) {
    const d = dayLabel(m.createdAt);
    if (d !== day) {
      blocks.push({ kind: "day", label: d });
      day = d;
      run = null;
    }
    if (m.type === "system") {
      blocks.push({ kind: "system", message: m });
      run = null;
      continue;
    }
    const author = authorOf(m);
    const prev = run?.messages.at(-1);
    if (run && run.author === author && prev && m.createdAt.getTime() - prev.createdAt.getTime() < RUN_GAP_MS) {
      run.messages.push(m);
    } else {
      run = { kind: "run", author, messages: [m] };
      blocks.push(run);
    }
  }
  return blocks;
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
  const agentAvatar = settings.agentAvatar;
  const name = thread.customer?.name ?? "Conversation";
  const first = name.split(" ")[0] ?? name;
  const human = thread.conversation.handler === "human";
  const lastInbound = [...thread.messages].reverse().find((m) => m.direction === "inbound" && m.type !== "test");
  const blocks = toBlocks(thread.messages);

  const authorLabel: Record<Author, string> = {
    customer: name,
    test: "Test message (from your team)",
    agent,
    staff: "You",
    app: "You, from the WhatsApp app",
  };

  return (
    <div>
      <div className={INBOX_FRAME}>
        <div className="hidden min-h-0 border-r border-line lg:block">
          <ChatList conversations={filterConversations(conversations, filter, q)} all={conversations} activeId={id} filter={filter} q={q} agentName={agent} />
        </div>

        <section className="flex min-h-0 min-w-0 flex-col">
          {/* Conversation header */}
          <header className="flex shrink-0 items-center gap-3 border-b border-line bg-surface px-3 py-3 md:px-6">
            <Link
              href="/wambo"
              aria-label="Back to inbox"
              className="grid size-9 place-items-center rounded-full text-ink-muted hover:bg-surface-muted lg:hidden"
            >
              <ArrowLeft className="size-5" />
            </Link>
            <Avatar name={name} size="size-11" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-lg font-bold leading-tight">{name}</p>
              <p className="mt-0.5 truncate text-sm text-ink-muted">
                {lastInbound ? `Last message ${when(lastInbound.createdAt)}` : "No messages from them yet"}
                {thread.customer?.phoneE164 ? <span className="max-sm:hidden"> · {thread.customer.phoneE164}</span> : null}
              </p>
            </div>

            <span
              className={`pill max-md:!hidden ${human ? "border-line bg-surface-muted text-ink-muted" : "border-transparent bg-brand-100 text-brand-800"}`}
            >
              {human ? null : <span className="mr-1.5 inline-block size-1.5 rounded-full bg-brand-800" aria-hidden />}
              {human ? "You're replying" : `${agent} is replying`}
            </span>
            {thread.customer ? (
              <Link
                href={`/customers/${thread.customer.id}`}
                title="Customer profile"
                aria-label="Customer profile"
                className="grid size-9 place-items-center rounded-full text-ink-muted hover:bg-surface-muted hover:text-ink"
              >
                <UserRound className="size-[1.125rem]" />
              </Link>
            ) : null}
            <form action={human ? handBackAction : takeOverAction}>
              <input type="hidden" name="conversationId" value={id} />
              <button className={`btn ${human ? "btn-secondary" : "btn-primary"} !min-h-9 !text-xs`}>
                {human ? `Hand back to ${agent}` : "Take over"}
              </button>
            </form>
          </header>

          {/* Banners */}
          {query.error ? <p className="shrink-0 bg-danger-100 px-6 py-2 text-sm text-danger-600">{query.error}</p> : null}
          {openHandoff ? (
            <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-warning-600/20 bg-warning-100 px-6 py-2.5 text-sm text-warning-600">
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
                <p className="text-sm font-semibold">No messages with {first} yet</p>
                <p className="mt-1 max-w-xs text-xs text-ink-muted">
                  Send the first message below, or use “Test as customer” to see how {agent} answers.
                </p>
              </div>
            ) : (
              blocks.map((block, index) => {
                if (block.kind === "day") {
                  return (
                    <div key={`day-${index}`} className="my-5 flex justify-center">
                      <span className="text-xs font-medium text-ink-subtle">{block.label}</span>
                    </div>
                  );
                }
                if (block.kind === "system") {
                  return (
                    <div key={block.message.id} className="my-3 flex justify-center">
                      <span className="max-w-[85%] rounded-xl bg-warning-100 px-3 py-1.5 text-center text-xs text-warning-600">
                        {block.message.body}
                      </span>
                    </div>
                  );
                }

                const inbound = block.author === "customer" || block.author === "test";
                const firstMsg = block.messages[0]!;
                const lastMsg = block.messages.at(-1)!;
                const tools = block.author === "agent" && block.messages.some(usedTools);

                if (inbound) {
                  return (
                    <div key={firstMsg.id} className="mt-5 flex gap-3">
                      <Avatar name={name} size="size-9" />
                      <div className="min-w-0 flex-1">
                        <p className="mb-1.5 flex items-baseline gap-2 text-sm">
                          <span className={`font-semibold ${block.author === "test" ? "text-info-600" : ""}`}>{authorLabel[block.author]}</span>
                          <span className="text-xs text-ink-subtle">{shortTime(firstMsg.createdAt)}</span>
                        </p>
                        <div className="flex flex-col items-start gap-1.5">
                          {block.messages.map((m) => (
                            <div
                              key={m.id}
                              title={shortTime(m.createdAt)}
                              className={`wa-bubble wa-in ${block.author === "test" ? "border border-dashed border-info-600/40" : ""}`}
                            >
                              <p className="whitespace-pre-wrap break-words">{m.body}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  );
                }

                return (
                  <div key={firstMsg.id} className="mt-5 flex flex-col items-end">
                    <p className="mb-1.5 flex items-center gap-2 text-sm">
                      {tools ? (
                        <span className="flex items-center gap-1 text-xs text-ink-subtle" title={`${agent} checked your system before answering`}>
                          <Wrench className="size-3" /> checked your system ·
                        </span>
                      ) : null}
                      <span className="text-xs text-ink-subtle">{shortTime(firstMsg.createdAt)}</span>
                      <span className="font-semibold">{authorLabel[block.author]}</span>
                      {block.author === "agent" && agentAvatar ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={agentAvatar} alt="" className="size-6 rounded-full object-cover" />
                      ) : null}
                    </p>
                    <div className="flex flex-col items-end gap-1.5">
                      {block.messages.map((m) => (
                        <div key={m.id} title={shortTime(m.createdAt)} className={`wa-bubble wa-out ${block.author === "agent" ? "" : "wa-staff"}`}>
                          <p className="whitespace-pre-wrap break-words">{m.body}</p>
                        </div>
                      ))}
                    </div>
                    <CheckCheck className="mt-1 size-4 text-brand-700" aria-label={`Sent ${shortTime(lastMsg.createdAt)}`} />
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
