import Link from "next/link";
import { redirect } from "next/navigation";
import {
  approvalTitle,
  kes,
  listApprovals,
  withPrincipal,
} from "@garden/services";
import { getSession } from "@/lib/auth";
import { principalOf } from "@/lib/principal";
import { dateTime, timeAgo } from "@/lib/format";
import { EmptyState, PageHeader, StatCard, StatusPill } from "@/components/ui";
import { approveAction, rejectAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function ApprovalsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; error?: string; requested?: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  const params = await searchParams;
  const principal = principalOf(session);

  const approvals = await withPrincipal(principal, (ctx) =>
    listApprovals(ctx, { status: params.status }),
  );

  const pending = approvals.filter((row) => row.status === "pending");
  const executed = approvals.filter((row) => row.status === "executed");
  const totalValue = pending.reduce((sum, row) => {
    const payload = row.payload as Record<string, unknown>;
    return sum + Number(payload.amountKes ?? payload.discountKes ?? payload.totalKes ?? 0);
  }, 0);

  return (
    <div>
      <PageHeader
        title="Approvals"
        subtitle="Refunds, discounts, out-of-policy cancellations and bulk sends wait here."
        action={
          <div className="flex gap-1">
            {["", "pending", "executed", "rejected", "expired"].map((status) => (
              <Link
                key={status || "all"}
                className={`btn ${
                  (params.status ?? "") === status ? "btn-primary" : "btn-secondary"
                } !px-3 !py-1.5 text-xs capitalize`}
                href={status ? `/approvals?status=${status}` : "/approvals"}
              >
                {status || "all"}
              </Link>
            ))}
          </div>
        }
      />

      {params.error ? (
        <p className="mb-4 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{params.error}</p>
      ) : null}

      {params.requested ? (
        <p className="mb-4 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Approval request {params.requested.slice(0, 8)} created. A customer or system action is
          waiting for your decision.
        </p>
      ) : null}

      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <StatCard label="Pending" value={pending.length} accent />
        <StatCard label="Value at stake" value={kes(totalValue)} />
        <StatCard label="Executed" value={executed.length} />
      </div>

      {approvals.length === 0 ? (
        <EmptyState
          title="Nothing waiting"
          body="Wambo is operating within policy. New sensitive requests will appear here."
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {approvals.map((approval) => {
            const payload = approval.payload as Record<string, unknown>;
            return (
              <section key={approval.id} className="card p-5">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <StatusPill status={approval.status} />
                  <span className="pill bg-slate-100 capitalize text-slate-600">
                    {approval.kind.replace(/_/g, " ")}
                  </span>
                  <span className="text-xs text-[#a8a29e]">asked {timeAgo(approval.createdAt)}</span>
                </div>

                <h2 className="text-base font-semibold">{approvalTitle(approval.kind, payload)}</h2>
                <p className="mt-1 text-xs text-[#78716c]">
                  Requested by <span className="font-mono">{approval.requestedBy}</span>
                  {approval.expiresAt ? ` · expires ${dateTime(approval.expiresAt)}` : ""}
                </p>

                <pre className="mt-3 max-h-40 overflow-auto rounded-lg bg-[#fafaf9] p-3 text-[11px] leading-relaxed text-[#57534e]">
                  {JSON.stringify(payload, null, 2)}
                </pre>

                {typeof payload.tool === "string" ? (
                  <p className="mt-2 text-xs text-[#78716c]">
                    This executes the MCP tool <span className="font-mono">{payload.tool}</span> once.
                  </p>
                ) : null}

                {approval.status === "pending" ? (
                  <div className="mt-4 flex gap-2">
                    <form action={approveAction} className="flex-1">
                      <input type="hidden" name="approvalId" value={approval.id} />
                      <button className="btn btn-primary w-full text-xs">Approve & execute</button>
                    </form>
                    <form action={rejectAction} className="flex-1">
                      <input type="hidden" name="approvalId" value={approval.id} />
                      <button className="btn btn-danger w-full text-xs">Reject</button>
                    </form>
                  </div>
                ) : (
                  <p className="mt-4 text-xs text-[#a8a29e]">
                    Decided {dateTime(approval.decidedAt)} by {approval.decidedBy ?? "—"}.
                  </p>
                )}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
