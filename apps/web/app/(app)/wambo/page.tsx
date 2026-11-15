import Link from "next/link";
import { redirect } from "next/navigation";
import { MessageCircle } from "lucide-react";
import {
  listConversations,
  listOpenHandoffsWithConversations,
  openHandoffCount,
  withPrincipal,
} from "@garden/services";
import { getSession } from "@/lib/auth";
import { principalOf } from "@/lib/principal";
import { timeAgo } from "@/lib/format";
import { PageHeader, StatCard, StatusPill } from "@/components/ui";
import { resolveHandoffAction } from "./actions";
import { ChatList } from "./chat-list";

export const dynamic = "force-dynamic";

export default async function WamboInboxPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  const params = await searchParams;
  const principal = principalOf(session);

  const [conversations, handoffs, handoffCount] = await Promise.all([
    withPrincipal(principal, (ctx) => listConversations(ctx)),
    withPrincipal(principal, (ctx) => listOpenHandoffsWithConversations(ctx)),
    withPrincipal(principal, (ctx) => openHandoffCount(ctx)),
  ]);

  const waitingHuman = conversations.filter((row) => row.conversation.handler === "human").length;
  const activeAgent = conversations.filter((row) => row.conversation.handler === "wambo").length;

  return (
    <div>
      <PageHeader
        title="Wambo"
        subtitle="Live inbox, human handoffs and the agent's configuration."
        action={
          <div className="flex gap-2">
            <Link className="btn btn-secondary" href="/wambo/settings">
              Wambo settings
            </Link>
            <Link className="btn btn-primary" href="/approvals">
              Approvals
            </Link>
          </div>
        }
      />

      {params.error ? (
        <p className="mb-4 rounded-xl border border-danger-600/30 bg-danger-100 px-4 py-3 text-sm text-danger-600">
          {params.error}
        </p>
      ) : null}

      <div className="mb-5 grid gap-5 sm:grid-cols-3">
        <StatCard icon={MessageCircle} label="Conversations" value={conversations.length} />
        <StatCard label="Wambo handling" value={activeAgent} accent />
        <StatCard label="With a human" value={waitingHuman} hint={`${handoffCount} open handoff(s)`} />
      </div>

      {/* WhatsApp Web style: chat list on the left, conversation on the right */}
      <div className="grid h-[calc(100vh-14rem)] min-h-[520px] overflow-hidden rounded-2xl border border-line bg-white lg:grid-cols-[minmax(320px,400px)_1fr]">
        <div className="min-h-0 border-r border-[#e9edef]">
          <ChatList conversations={conversations} />
        </div>
        <div className="hidden flex-col items-center justify-center gap-3 border-b-[6px] border-[#25d366] bg-[#f0f2f5] px-8 text-center lg:flex">
          <span className="grid size-20 place-items-center rounded-full bg-white text-[#25d366]">
            <MessageCircle className="size-10" strokeWidth={1.5} />
          </span>
          <h2 className="text-3xl font-light text-[#41525d]">Wambo inbox</h2>
          <p className="max-w-sm text-sm text-[#667781]">
            Select a chat to read the conversation, take over from Wambo, or reply as staff. Replies go
            out on WhatsApp.
          </p>
        </div>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <section className="card p-5">
          <h2 className="mb-4 text-lg font-semibold">Handoff queue</h2>
          {handoffs.length === 0 ? (
            <p className="text-sm text-ink-muted">No open handoffs. Wambo has it covered.</p>
          ) : (
            <ul className="space-y-3">
              {handoffs.map((row) => (
                <li key={row.handoff.id} className="rounded-xl border border-line p-3">
                  <div className="flex items-center justify-between gap-2">
                    <Link
                      className="text-sm font-medium hover:text-brand-800"
                      href={`/wambo/${row.conversation.id}`}
                    >
                      {row.customer.name}
                    </Link>
                    <StatusPill status={row.handoff.priority} />
                  </div>
                  <p className="mt-1 text-xs text-ink-muted">{row.handoff.reason}</p>
                  <div className="mt-2 flex items-center justify-between">
                    <span className="text-[10px] text-ink-subtle">{timeAgo(row.handoff.createdAt)}</span>
                    <form action={resolveHandoffAction}>
                      <input type="hidden" name="handoffId" value={row.handoff.id} />
                      <input type="hidden" name="conversationId" value={row.conversation.id} />
                      <button className="text-[11px] font-medium text-success-600">Resolve</button>
                    </form>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card p-5">
          <h2 className="mb-3 text-lg font-semibold">How it works</h2>
          <ul className="space-y-1.5 text-sm text-ink-muted">
            <li>• Wambo answers WhatsApp using only tools, never invented prices.</li>
            <li>• Sensitive requests (refunds, discounts, out-of-policy cancels) become approvals.</li>
            <li>• “Take over” silences automation; “Hand back” returns the thread to Wambo.</li>
            <li>• Staff replies go out on WhatsApp and are logged in the thread.</li>
          </ul>
        </section>
      </div>
    </div>
  );
}
