import Link from "next/link";
import { redirect } from "next/navigation";
import {
  listConversations,
  listOpenHandoffsWithConversations,
  openHandoffCount,
  withPrincipal,
} from "@garden/services";
import { getSession } from "@/lib/auth";
import { principalOf } from "@/lib/principal";
import { shortTime, timeAgo } from "@/lib/format";
import { EmptyState, PageHeader, StatCard, StatusPill } from "@/components/ui";
import { resolveHandoffAction } from "./actions";

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
        <p className="mb-4 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{params.error}</p>
      ) : null}

      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <StatCard label="Conversations" value={conversations.length} />
        <StatCard label="Wambo handling" value={activeAgent} accent />
        <StatCard label="With a human" value={waitingHuman} hint={`${handoffCount} open handoff(s)`} />
      </div>

      <div className="grid gap-5 xl:grid-cols-[1.5fr_1fr]">
        <section className="card overflow-hidden">
          <h2 className="border-b border-[#e7e5e0] px-4 py-3 text-sm font-semibold">Inbox</h2>
          {conversations.length === 0 ? (
            <div className="p-6">
              <EmptyState
                title="No conversations yet"
                body="When a customer messages your WhatsApp number, the thread appears here."
              />
            </div>
          ) : (
            <div className="divide-y divide-[#f5f5f4]">
              {conversations.map((row) => (
                <Link
                  key={row.conversation.id}
                  href={`/wambo/${row.conversation.id}`}
                  className="flex items-start gap-3 p-4 transition hover:bg-[#fcfcfb]"
                >
                  <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#fff7ed] text-sm font-semibold text-[#c2410c]">
                    {row.customer.name
                      .split(" ")
                      .map((part) => part[0])
                      .slice(0, 2)
                      .join("")}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate text-sm font-medium">{row.customer.name}</p>
                      <span className="shrink-0 text-[11px] text-[#a8a29e]">
                        {shortTime(row.conversation.lastInboundAt)}
                      </span>
                    </div>
                    <p className="mt-0.5 truncate text-xs text-[#78716c]">
                      {row.lastMessage?.body ?? "No messages yet."}
                    </p>
                    <div className="mt-1.5 flex items-center gap-1.5">
                      <StatusPill status={row.conversation.channel} />
                      <StatusPill status={row.conversation.handler} />
                      {row.conversation.state === "waiting_human" ? (
                        <span className="text-[10px] font-medium text-rose-600">needs a human</span>
                      ) : null}
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>

        <div className="space-y-5">
          <section className="card p-5">
            <h2 className="mb-3 text-sm font-semibold">Handoff queue</h2>
            {handoffs.length === 0 ? (
              <p className="text-sm text-[#78716c]">No open handoffs. Wambo has it covered.</p>
            ) : (
              <ul className="space-y-3">
                {handoffs.map((row) => (
                  <li key={row.handoff.id} className="rounded-xl border border-[#f5f5f4] p-3">
                    <div className="flex items-center justify-between gap-2">
                      <Link
                        className="text-sm font-medium hover:text-[#c2410c]"
                        href={`/wambo/${row.conversation.id}`}
                      >
                        {row.customer.name}
                      </Link>
                      <StatusPill status={row.handoff.priority} />
                    </div>
                    <p className="mt-1 text-xs text-[#57534e]">{row.handoff.reason}</p>
                    <div className="mt-2 flex items-center justify-between">
                      <span className="text-[10px] text-[#a8a29e]">{timeAgo(row.handoff.createdAt)}</span>
                      <form action={resolveHandoffAction}>
                        <input type="hidden" name="handoffId" value={row.handoff.id} />
                        <input type="hidden" name="conversationId" value={row.conversation.id} />
                        <button className="text-[11px] font-medium text-emerald-700">Resolve</button>
                      </form>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="card p-5">
            <h2 className="mb-2 text-sm font-semibold">How it works</h2>
            <ul className="space-y-1.5 text-xs text-[#57534e]">
              <li>• Wambo answers WhatsApp using only tools, never invented prices.</li>
              <li>• Sensitive requests (refunds, discounts, out-of-policy cancels) become approvals.</li>
              <li>• “Take over” silences automation; “Hand back” returns the thread to Wambo.</li>
              <li>• Staff replies go out on WhatsApp and are logged in the thread.</li>
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}
