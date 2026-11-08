import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  getConversationThread,
  listHandoffs,
  withPrincipal,
} from "@garden/services";
import { getSession } from "@/lib/auth";
import { principalOf } from "@/lib/principal";
import { dateTime, timeAgo } from "@/lib/format";
import { PageHeader, StatusPill } from "@/components/ui";
import {
  agentReplyAction,
  handBackAction,
  resolveHandoffAction,
  staffMessageAction,
  takeOverAction,
} from "../actions";

export const dynamic = "force-dynamic";

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

  const handoffs = await withPrincipal(principal, (ctx) =>
    listHandoffs(ctx, { status: "open" }),
  );
  const openHandoff = handoffs.find((row) => row.conversation.id === id)?.handoff ?? null;

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title={thread.customer?.name ?? "Conversation"}
        subtitle={`${thread.customer?.phoneE164 ?? ""} · ${thread.conversation.channel} · ${
          thread.conversation.handler === "human" ? "handled by a human" : "handled by Wambo"
        }`}
        action={
          <div className="flex flex-wrap gap-2">
            <Link className="btn btn-secondary" href="/wambo">
              ← Inbox
            </Link>
            {thread.conversation.handler === "wambo" ? (
              <form action={takeOverAction}>
                <input type="hidden" name="conversationId" value={id} />
                <button className="btn btn-primary">Take over</button>
              </form>
            ) : (
              <form action={handBackAction}>
                <input type="hidden" name="conversationId" value={id} />
                <button className="btn btn-primary">Hand back to Wambo</button>
              </form>
            )}
          </div>
        }
      />

      {query.error ? (
        <p className="mb-4 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{query.error}</p>
      ) : null}

      {openHandoff ? (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900">
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

      <section className="card mb-4 overflow-hidden">
        <div className="flex items-center justify-between border-b border-[#e7e5e0] px-4 py-3">
          <div className="flex items-center gap-2">
            <StatusPill status={thread.conversation.handler} />
            <StatusPill status={thread.conversation.state} />
          </div>
          <span className="text-xs text-[#a8a29e]">
            Last inbound {timeAgo(thread.conversation.lastInboundAt)}
          </span>
        </div>

        <div className="max-h-[55vh] space-y-3 overflow-y-auto bg-[#fafaf9] p-4">
          {thread.messages.length === 0 ? (
            <p className="py-8 text-center text-sm text-[#78716c]">No messages yet.</p>
          ) : (
            thread.messages.map((message) => {
              const inbound = message.direction === "inbound";
              const system = message.type === "system";
              return (
                <div key={message.id} className={`flex ${inbound ? "justify-start" : "justify-end"}`}>
                  <div
                    className={`max-w-[80%] rounded-2xl px-3.5 py-2 text-sm ${
                      system
                        ? "bg-slate-100 text-slate-600"
                        : inbound
                          ? "bg-white text-[#1c1917] shadow-sm"
                          : "bg-[#c2410c] text-white"
                    }`}
                  >
                    <p className="whitespace-pre-wrap">{message.body}</p>
                    <p
                      className={`mt-1 text-[10px] ${
                        inbound || system ? "text-[#a8a29e]" : "text-white/70"
                      }`}
                    >
                      {dateTime(message.createdAt)}
                      {Array.isArray(message.toolCalls) && message.toolCalls.length > 0
                        ? " · tools used"
                        : ""}
                    </p>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </section>

      <div className="grid gap-4 md:grid-cols-2">
        <section className="card p-5">
          <h2 className="mb-2 text-sm font-semibold">Staff reply</h2>
          <p className="mb-2 text-xs text-[#78716c]">
            Sends on {thread.conversation.channel} and pauses automation until you hand back.
          </p>
          <form action={staffMessageAction} className="space-y-2">
            <input type="hidden" name="conversationId" value={id} />
            <textarea
              className="input min-h-20"
              name="text"
              placeholder="Type your reply…"
              required
            />
            <button className="btn btn-primary w-full">Send as staff</button>
          </form>
        </section>

        <section className="card p-5">
          <h2 className="mb-2 text-sm font-semibold">Ask Wambo</h2>
          <p className="mb-2 text-xs text-[#78716c]">
            Simulates a customer message and runs the agent. Uses the mock model unless
            OPENROUTER_API_KEY is configured.
          </p>
          <form action={agentReplyAction} className="space-y-2">
            <input type="hidden" name="conversationId" value={id} />
            <textarea
              className="input min-h-20"
              name="text"
              placeholder="e.g. Is the gazebo free on Saturday?"
              required
            />
            <button className="btn btn-secondary w-full">Run Wambo</button>
          </form>
        </section>
      </div>
    </div>
  );
}
