import { dataSourcesStatus } from "@garden/services";
import { requireEngineAdmin } from "@/lib/engine-auth";
import { PageHeader, Panel, ago } from "../../../components/ui";

export const dynamic = "force-dynamic";

function Status({ ok, labelOn = "Connected", labelOff = "Not connected" }: { ok: boolean; labelOn?: string; labelOff?: string }) {
  return (
    <span className={`pill ${ok ? "bg-success-100 text-success-600" : "bg-neutral-100 text-neutral-600"}`}>{ok ? labelOn : labelOff}</span>
  );
}

export default async function DataSourcesPage() {
  await requireEngineAdmin();
  const sources = await dataSourcesStatus();
  const { runLog, langfuse } = sources;

  return (
    <main className="mx-auto w-full max-w-[68.75rem] p-4 md:p-6">
      <PageHeader
        title="Data sources"
        subtitle="Where the Engine's numbers come from, and what it can't see yet. Everything on the Overview is computed from these."
      />

      <div className="space-y-5">
        <Panel title="Agent run log" aside={<Status ok labelOn="Live" />}>
          <p className="text-sm text-ink-muted">
            Every time an agent answers, Palda CX records the outcome, tokens, estimated cost, how long it took, how many tools it used,
            whether the safety checks flagged the reply, and a trace id. This is the source for runs, attention, cost and response times, and
            it works whether or not Langfuse is set up.
          </p>
          <dl className="mt-4 grid gap-4 sm:grid-cols-3">
            <div>
              <dt className="font-mono text-[0.6875rem] uppercase tracking-wider text-ink-muted">Runs recorded</dt>
              <dd className="mt-1 font-mono text-[1.375rem]">{runLog.runs.toLocaleString("en-KE")}</dd>
            </div>
            <div>
              <dt className="font-mono text-[0.6875rem] uppercase tracking-wider text-ink-muted">Customers with runs</dt>
              <dd className="mt-1 font-mono text-[1.375rem]">{runLog.customersWithRuns}</dd>
            </div>
            <div>
              <dt className="font-mono text-[0.6875rem] uppercase tracking-wider text-ink-muted">Latest run</dt>
              <dd className="mt-1 text-[0.9375rem]">{ago(runLog.lastRunAt).replace("no recorded runs", "none yet")}</dd>
            </div>
          </dl>
        </Panel>

        <Panel title="Langfuse" aside={<Status ok={langfuse.configured} />}>
          <p className="text-sm text-ink-muted">
            Langfuse holds the full conversation behind each run: every prompt, tool call and model response. The Engine links to it from a run
            so you can open one trace when a number looks wrong. The Engine does <strong className="text-ink">not</strong> read Langfuse itself yet;
            its numbers come from the run log above.
          </p>
          <dl className="mt-4 grid gap-4 sm:grid-cols-3">
            <div>
              <dt className="font-mono text-[0.6875rem] uppercase tracking-wider text-ink-muted">Runs with a trace</dt>
              <dd className="mt-1 font-mono text-[1.375rem]">{langfuse.tracedRuns.toLocaleString("en-KE")}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="font-mono text-[0.6875rem] uppercase tracking-wider text-ink-muted">Host</dt>
              <dd className="mt-1 font-mono text-[0.9375rem]">{langfuse.host ?? "not set"}</dd>
            </div>
          </dl>
          {!langfuse.configured ? (
            <p className="mt-4 rounded-2xl bg-warning-100 px-4 py-3 text-xs text-warning-600">
              To switch it on, set <span className="font-mono">LANGFUSE_HOST</span>, <span className="font-mono">LANGFUSE_PUBLIC_KEY</span> and{" "}
              <span className="font-mono">LANGFUSE_SECRET_KEY</span> for the agent service. New runs will then carry a trace id and show an
              &ldquo;Open trace&rdquo; link here.
            </p>
          ) : null}
        </Panel>

        <Panel title="Business signals" aside={<Status ok labelOn="Live" />}>
          <p className="text-sm text-ink-muted">
            Handovers to a person and approvals waiting come straight from each customer&apos;s database, so &ldquo;a customer has been waiting a day
            for a person&rdquo; is always current.
          </p>
        </Panel>

        <Panel title="Not collected yet">
          <ul className="space-y-3 text-sm">
            {[
              ["Cached-prompt share", "Runs don't record how many prompt tokens were served from cache, so we can't show a cache chart or a cache target."],
              ["Real model spend", "Cost is an estimate from tokens. It is not reconciled against the model provider's invoice."],
              ["WhatsApp delivery receipts", "Sent / delivered / read events aren't stored yet, so we can't show delivery failures per customer."],
              ["Customer satisfaction", "Reviews and ratings exist in each customer's app but aren't rolled up into the Engine yet."],
            ].map(([title, body]) => (
              <li key={title} className="flex gap-3">
                <span className="mt-1.5 size-2 shrink-0 rounded-full bg-ink-subtle" />
                <span>
                  <span className="font-medium">{title}.</span> <span className="text-ink-muted">{body}</span>
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      </div>
    </main>
  );
}
