import Link from "next/link";
import { customerTelemetry, getEngineCustomer, getWhatsappConnection, langfuseConfigured } from "@garden/services";
import { requireEngineAdmin } from "@/lib/engine-auth";
import { dateTime } from "@/lib/format";
import { Panel } from "../../../components/ui";
import { WorkspaceHeader } from "../header";

export const dynamic = "force-dynamic";

function Status({ ok, on, off }: { ok: boolean; on: string; off: string }) {
  return <span className={`pill ${ok ? "bg-success-100 text-success-600" : "bg-neutral-100 text-neutral-600"}`}>{ok ? on : off}</span>;
}

export default async function ConnectionsPage({ params }: { params: Promise<{ id: string }> }) {
  await requireEngineAdmin();
  const { id } = await params;
  const [customer, t, wa] = await Promise.all([getEngineCustomer(id), customerTelemetry(id, "month"), getWhatsappConnection(id)]);
  const lf = langfuseConfigured();

  return (
    <>
      <WorkspaceHeader customer={customer} title="Connections" subtitle="The channels and tools behind this customer's agent." />
      <div className="space-y-5">
        <Panel
          title="WhatsApp"
          aside={
            wa ? (
              <Status ok={wa.status === "active"} on="Connected" off={wa.status === "disconnected" ? "Disconnected" : "Needs attention"} />
            ) : (
              <Status ok={false} on="" off="Not connected" />
            )
          }
        >
          {wa ? (
            <div className="space-y-4">
              <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-xs text-ink-muted">Number</dt>
                  <dd className="font-semibold">{wa.displayPhone || "unknown"}</dd>
                </div>
                <div>
                  <dt className="text-xs text-ink-muted">Verified name</dt>
                  <dd className="font-semibold">{wa.verifiedName || "not shown"}</dd>
                </div>
                <div>
                  <dt className="text-xs text-ink-muted">How it is connected</dt>
                  <dd>{wa.mode === "coexistence" ? "Alongside their WhatsApp Business app (coexistence)" : "Through us only (Cloud API)"}</dd>
                </div>
                <div>
                  <dt className="text-xs text-ink-muted">Quality</dt>
                  <dd>{wa.qualityRating ?? "not reported"}</dd>
                </div>
                <div>
                  <dt className="text-xs text-ink-muted">Connected</dt>
                  <dd>{wa.connectedAt ? dateTime(wa.connectedAt) : "unknown"}</dd>
                </div>
                <div>
                  <dt className="text-xs text-ink-muted">Last checked</dt>
                  <dd>{wa.lastCheckedAt ? dateTime(wa.lastCheckedAt) : "never"}</dd>
                </div>
                <div className="font-mono text-xs text-ink-muted sm:col-span-2">
                  number id {wa.phoneNumberId} · account {wa.wabaId}
                </div>
              </dl>
              {wa.lastError ? <p className="rounded-xl bg-warning-100 px-3 py-2 text-sm text-warning-600">Last problem: {wa.lastError}</p> : null}
              {wa.status === "disconnected" ? (
                <p className="rounded-xl bg-warning-100 px-3 py-2 text-sm text-warning-600">
                  WhatsApp ended this connection, so nothing is sent or received. The customer reconnects from Integrations in their own app.
                </p>
              ) : null}
              {wa.mode === "coexistence" ? (
                <p className="text-xs text-ink-muted">
                  Their WhatsApp Business app must be opened at least every couple of weeks or WhatsApp pauses the link. When someone replies from their phone, the
                  agent stays quiet in that chat until it is handed back in the inbox.
                  {wa.sync ? ` Contacts and history were requested from WhatsApp once, at connection (${wa.sync.history ? "history requested" : "history not requested"}).` : ""}
                </p>
              ) : null}
            </div>
          ) : (
            <p className="text-sm text-ink-muted">
              No WhatsApp number is connected for {customer.name}, so the agent can&apos;t receive customer messages. Their owner connects it themselves under Integrations in their own
              app: they sign in with Meta and choose their number, and it is linked to this business only. Nothing is entered on the Engine side.
            </p>
          )}

        </Panel>

        <Panel title="Langfuse traces" aside={<Status ok={lf} on="Configured" off="Not configured" />}>
          <p className="text-sm text-ink-muted">
            {t.langfuseRuns > 0
              ? `${t.langfuseRuns} of this customer's runs in the last 30 days carry a Langfuse trace, and each shows an “Open trace” link under Runs.`
              : lf
                ? "Langfuse is configured, but none of this customer's runs in the last 30 days carry a trace yet."
                : "Langfuse isn't configured on this server, so runs have no trace links."}{" "}
            See{" "}
            <Link href="/engine/sources" className="font-medium text-brand-800 hover:underline">
              Data sources
            </Link>{" "}
            for what the Engine can and can&apos;t see.
          </p>
        </Panel>
      </div>
    </>
  );
}
