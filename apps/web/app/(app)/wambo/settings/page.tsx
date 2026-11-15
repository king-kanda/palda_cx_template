import Link from "next/link";
import { redirect } from "next/navigation";
import { getConfigMap, getSettings, withPrincipal } from "@garden/services";
import { getSession } from "@/lib/auth";
import { principalOf } from "@/lib/principal";
import { PageHeader, Section } from "@/components/ui";
import { saveBrandAction, saveWamboAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function WamboSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  const params = await searchParams;
  const principal = principalOf(session);

  const [settings, config] = await Promise.all([
    withPrincipal(principal, (ctx) => getSettings(ctx)),
    withPrincipal(principal, (ctx) => getConfigMap(ctx)),
  ]);

  const business = (config.business as Record<string, unknown> | undefined) ?? {};
  const brand = (config.brand as Record<string, unknown> | undefined) ?? {};
  const faqText = (settings.faq ?? [])
    .map((entry) => `Q: ${entry.q}\nA: ${entry.a}`)
    .join("\n\n");

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="Wambo settings"
        subtitle="What Wambo knows, how it sounds and whether it is answering."
        action={
          <Link className="btn btn-secondary" href="/wambo">
            ← Inbox
          </Link>
        }
      />

      {params.error ? (
        <p className="mb-4 rounded-xl border border-danger-600/30 bg-danger-100 px-4 py-3 text-sm text-danger-600">{params.error}</p>
      ) : null}

      <div className="space-y-5">
        <Section title="Business facts">
          <form action={saveWamboAction} className="space-y-3">
            <div>
              <label className="mb-1.5 block text-sm font-medium">
                Facts Wambo must know
              </label>
              <textarea
                className="input min-h-32"
                name="facts"
                defaultValue={String(business.facts ?? settings.businessFacts)}
              />
              <p className="mt-1 text-xs text-ink-subtle">
                Location, access, parking, noise rules, catering policy, anything customers ask.
              </p>
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium">
                FAQ (blank line between entries)
              </label>
              <textarea className="input min-h-40 font-mono text-xs" name="faq" defaultValue={faqText} />
              <p className="mt-1 text-xs text-ink-subtle">
                Format: <span className="font-mono">Q: question</span> then{" "}
                <span className="font-mono">A: answer</span>, separated by a blank line.
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1.5 block text-sm font-medium">
                  Review link
                </label>
                <input className="input" name="reviewLink" defaultValue={settings.reviewLink} />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium">
                  Guest arrival time
                </label>
                <input className="input" name="arrivalTime" defaultValue={settings.arrivalTime} />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium">
                  Manager phone (alerts)
                </label>
                <input
                  className="input"
                  name="managerPhone"
                  defaultValue={settings.managerPhone ?? ""}
                  placeholder="+2547…"
                />
              </div>
              <label className="flex items-center gap-2 pt-6 text-sm">
                <input
                  type="checkbox"
                  name="agentEnabled"
                  defaultChecked={business.agentEnabled !== false}
                  className="h-4 w-4"
                />
                Wambo answers new messages
              </label>
              <label className="flex items-start gap-2 pt-6 text-sm">
                <input
                  type="checkbox"
                  name="shadowMode"
                  defaultChecked={business.shadowMode === true}
                  className="mt-0.5 h-4 w-4"
                />
                <span>
                  Shadow mode: draft replies for staff approval
                  <span className="mt-0.5 block text-xs text-ink-subtle">
                    Use this for the pilot. Drafts wait in Approvals; nothing reaches the customer
                    until a staff member approves it.
                  </span>
                </span>
              </label>
            </div>

            <div className="flex justify-end">
              <button className="btn btn-primary">Save Wambo settings</button>
            </div>
          </form>
        </Section>

        <Section title="Voice & brand">
          <form action={saveBrandAction} className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-sm font-medium">
                Agent name
              </label>
              <input className="input" name="agentName" defaultValue={settings.agentName} />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium">
                Tone
              </label>
              <input
                className="input"
                name="tone"
                defaultValue={String(brand.tone ?? "warm, concise, Kenyan English with a little Swahili")}
              />
            </div>
            <div className="sm:col-span-2 flex justify-end">
              <button className="btn btn-secondary">Save brand</button>
            </div>
          </form>
        </Section>

        <Section title="Policies the agent follows">
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <div className="rounded-xl bg-surface-muted p-3">
              <dt className="text-xs text-ink-muted">Deposit</dt>
              <dd className="font-semibold">{settings.depositPct}%</dd>
            </div>
            <div className="rounded-xl bg-surface-muted p-3">
              <dt className="text-xs text-ink-muted">Tax</dt>
              <dd className="font-semibold">{settings.taxPct}%</dd>
            </div>
            <div className="rounded-xl bg-surface-muted p-3">
              <dt className="text-xs text-ink-muted">Hold expiry</dt>
              <dd className="font-semibold">{settings.holdHours} hours</dd>
            </div>
            <div className="rounded-xl bg-surface-muted p-3">
              <dt className="text-xs text-ink-muted">Cancellation notice</dt>
              <dd className="font-semibold">{settings.cancellationNoticeHours} hours</dd>
            </div>
          </dl>
          <p className="mt-3 text-xs text-ink-subtle">
            Change these in <Link className="underline" href="/settings">Settings → Policies</Link>.
          </p>
        </Section>
      </div>
    </div>
  );
}
