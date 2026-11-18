import Link from "next/link";
import { redirect } from "next/navigation";
import { CheckCircle2, MessageCircle } from "lucide-react";
import { getSettings, listConversations, listOpenHandoffsWithConversations, withPrincipal } from "@garden/services";
import { getSession } from "@/lib/auth";
import { principalOf } from "@/lib/principal";
import { timeAgo } from "@/lib/format";
import { StatusPill } from "@/components/ui";
import { resolveHandoffAction } from "./actions";
import { Avatar, ChatList, INBOX_FRAME, filterConversations, parseFilter } from "./chat-list";

export const dynamic = "force-dynamic";

/** The inbox with no chat open: the list on the left, and what needs a person on the right. */
export default async function WamboInboxPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; filter?: string; q?: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  const params = await searchParams;
  const principal = principalOf(session);
  const filter = parseFilter(params.filter);
  const q = (params.q ?? "").slice(0, 80);

  const [conversations, handoffs, settings] = await Promise.all([
    withPrincipal(principal, (ctx) => listConversations(ctx)),
    withPrincipal(principal, (ctx) => listOpenHandoffsWithConversations(ctx)),
    withPrincipal(principal, (ctx) => getSettings(ctx)),
  ]);
  const agent = settings.agentName;

  return (
    <div>
      {params.error ? (
        <p className="mb-4 rounded-xl border border-danger-600/30 bg-danger-100 px-4 py-3 text-sm text-danger-600">{params.error}</p>
      ) : null}

      <div className={INBOX_FRAME}>
        <div className="min-h-0 border-r border-line">
          <ChatList conversations={filterConversations(conversations, filter, q)} all={conversations} filter={filter} q={q} agentName={agent} />
        </div>

        <div className="hidden min-h-0 flex-col overflow-y-auto bg-surface-muted lg:flex">
          <div className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center px-8 py-10">
            {handoffs.length > 0 ? (
              <>
                <h2 className="text-lg font-semibold">Needs you</h2>
                <p className="mt-1 text-sm text-ink-muted">
                  {agent} handed these to a person. Open one to reply; resolve it when it&apos;s done.
                </p>
                <ul className="mt-5 space-y-2">
                  {handoffs.map((row) => (
                    <li key={row.handoff.id} className="card flex items-start gap-3 p-4">
                      <Avatar name={row.customer.name} size="size-9" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <Link className="truncate text-sm font-semibold hover:text-brand-800" href={`/wambo/${row.conversation.id}`}>
                            {row.customer.name}
                          </Link>
                          <StatusPill status={row.handoff.priority} />
                        </div>
                        <p className="mt-1 text-sm text-ink-muted">{row.handoff.reason}</p>
                        <div className="mt-3 flex items-center justify-between gap-2">
                          <span className="text-xs text-ink-subtle">{timeAgo(row.handoff.createdAt)}</span>
                          <div className="flex items-center gap-2">
                            <form action={resolveHandoffAction}>
                              <input type="hidden" name="handoffId" value={row.handoff.id} />
                              <input type="hidden" name="conversationId" value={row.conversation.id} />
                              <button className="btn btn-secondary !min-h-8 !px-3 !text-xs">Resolve</button>
                            </form>
                            <Link href={`/wambo/${row.conversation.id}`} className="btn btn-primary !min-h-8 !px-3 !text-xs">
                              Open chat
                            </Link>
                          </div>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <div className="text-center">
                <span className="mx-auto grid size-16 place-items-center rounded-full bg-brand-100 text-brand-800">
                  {conversations.length ? <CheckCircle2 className="size-8" strokeWidth={1.5} /> : <MessageCircle className="size-8" strokeWidth={1.5} />}
                </span>
                <h2 className="mt-4 text-xl font-semibold">{conversations.length ? "You're all caught up" : `${agent} is ready`}</h2>
                <p className="mx-auto mt-2 max-w-sm text-sm text-ink-muted">
                  {conversations.length
                    ? `${agent} is handling every chat. Anything that needs a person shows up here.`
                    : "When a customer messages your WhatsApp number, the chat appears on the left."}
                </p>
                <ul className="mx-auto mt-6 max-w-sm space-y-2 text-left text-sm text-ink-muted">
                  <li className="flex gap-2"><span className="text-brand-800">•</span>Prices and availability always come from your system, never guessed.</li>
                  <li className="flex gap-2"><span className="text-brand-800">•</span>Refunds, discounts and exceptions wait for your approval.</li>
                  <li className="flex gap-2"><span className="text-brand-800">•</span>Reply in any chat to take over; hand it back when you&apos;re done.</li>
                </ul>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
