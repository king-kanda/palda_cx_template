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
        <p className="mb-4 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{params.error}</p>
      ) : null}

      <div className="space-y-5">
        <Section title="Business facts">
          <form action={saveWamboAction} className="space-y-3">
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-[#78716c]">
                Facts Wambo must know
              </label>
              <textarea
                className="input min-h-32"
                name="facts"
                defaultValue={String(business.facts ?? settings.businessFacts)}
              />
              <p className="mt-1 text-xs text-[#a8a29e]">
                Location, access, parking, noise rules, catering policy, anything customers ask.
              </p>
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-[#78716c]">
                FAQ (blank line between entries)
              </label>
              <textarea className="input min-h-40 font-mono text-xs" name="faq" defaultValue={faqText} />
              <p className="mt-1 text-xs text-[#a8a29e]">
                Format: <span className="font-mono">Q: question</span> then{" "}
                <span className="font-mono">A: answer</span>, separated by a blank line.
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-[#78716c]">
                  Review link
                </label>
                <input className="input" name="reviewLink" defaultValue={settings.reviewLink} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-[#78716c]">
                  Guest arrival time
                </label>
                <input className="input" name="arrivalTime" defaultValue={settings.arrivalTime} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-[#78716c]">
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
            </div>

            <div className="flex justify-end">
              <button className="btn btn-primary">Save Wambo settings</button>
            </div>
          </form>
        </Section>

        <Section title="Voice & brand">
          <form action={saveBrandAction} className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-[#78716c]">
                Agent name
              </label>
              <input className="input" name="agentName" defaultValue={settings.agentName} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-[#78716c]">
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
            <div className="rounded-xl bg-[#fafaf9] p-3">
              <dt className="text-xs text-[#78716c]">Deposit</dt>
              <dd className="font-semibold">{settings.depositPct}%</dd>
            </div>
            <div className="rounded-xl bg-[#fafaf9] p-3">
              <dt className="text-xs text-[#78716c]">Tax</dt>
              <dd className="font-semibold">{settings.taxPct}%</dd>
            </div>
            <div className="rounded-xl bg-[#fafaf9] p-3">
              <dt className="text-xs text-[#78716c]">Hold expiry</dt>
              <dd className="font-semibold">{settings.holdHours} hours</dd>
            </div>
            <div className="rounded-xl bg-[#fafaf9] p-3">
              <dt className="text-xs text-[#78716c]">Cancellation notice</dt>
              <dd className="font-semibold">{settings.cancellationNoticeHours} hours</dd>
            </div>
          </dl>
          <p className="mt-3 text-xs text-[#a8a29e]">
            Change these in <Link className="underline" href="/settings">Settings → Policies</Link>.
          </p>
        </Section>
      </div>
    </div>
  );
}
