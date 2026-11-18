import { getPlatformSettingsView, platformSettingsUpdatedAt, type PlatformSettingView } from "@garden/services";
import { requireEngineAdmin } from "@/lib/engine-auth";
import { PageHeader, Panel, ago } from "../../../components/ui";
import { checkMetaAppAction, saveMetaSettingsAction } from "./actions";

export const dynamic = "force-dynamic";

const HELP: Record<string, string> = {
  WHATSAPP_MODE: "Mock answers everything locally (safe for demos without Meta). Live sends real WhatsApp messages.",
  META_APP_ID: "Meta app > Settings > Basic > App ID.",
  META_APP_SECRET: "Meta app > Settings > Basic > App secret. Verifies Meta's webhooks and finishes customers' sign-ups.",
  META_ES_CONFIG_ID: "Facebook Login for Business > Configurations: the Embedded Signup configuration ID.",
  WHATSAPP_VERIFY_TOKEN: "Any long random text (12+ characters). Paste the same value into Meta's webhook setup, or tick “Generate a new one”.",
  WHATSAPP_GRAPH_VERSION: 'The Graph API version to call, e.g. "v21.0". Raise it when Meta retires the one in use.',
};

function Source({ s }: { s: PlatformSettingView["source"] }) {
  const map = {
    engine: ["Saved here", "bg-success-100 text-success-600"],
    env: ["From server .env", "bg-neutral-100 text-neutral-600"],
    unset: ["Not set", "bg-warning-100 text-warning-600"],
  } as const;
  const [label, cls] = map[s];
  return <span className={`pill ${cls}`}>{label}</span>;
}

/**
 * Platform settings for the Meta app behind WhatsApp. Saved values are encrypted in the database and win over the server's
 * .env, so the platform can be configured (and switched live) from the browser without touching the server.
 */
export default async function EngineSettingsPage({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  await requireEngineAdmin();
  const query = await searchParams;
  const settings = getPlatformSettingsView();
  const updated = await platformSettingsUpdatedAt();
  const get = (k: string) => settings.find((s) => s.key === k)!;
  const mode = get("WHATSAPP_MODE").value === "cloud" ? "cloud" : "mock";
  const appUrl = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/+$/, "");
  const verify = get("WHATSAPP_VERIFY_TOKEN");

  return (
    <main className="mx-auto w-full max-w-[68.75rem] p-4 md:p-6">
      <PageHeader
        title="Settings"
        subtitle="The Meta app that powers WhatsApp for every customer. Saved here, encrypted, and used instead of the server's .env."
      />

      {query.ok ? <p className="mb-4 rounded-xl border border-line bg-surface-muted px-4 py-3 text-sm">{query.ok}</p> : null}
      {query.error ? (
        <p className="mb-4 rounded-xl border border-danger-600/30 bg-danger-100 px-4 py-3 text-sm text-danger-600">{query.error}</p>
      ) : null}

      <div className="space-y-5">
        <Panel
          title="Meta & WhatsApp"
          aside={
            <span className={`pill ${mode === "cloud" ? "bg-success-100 text-success-600" : "bg-neutral-100 text-neutral-600"}`}>
              {mode === "cloud" ? "Live" : "Mock mode"}
            </span>
          }
        >
          <form action={saveMetaSettingsAction} className="space-y-5">
            {settings.map((s) => (
              <div key={s.key} className="grid gap-2 border-b border-line pb-4 last:border-0 md:grid-cols-[220px_1fr]">
                <div>
                  <label htmlFor={s.key} className="text-sm font-semibold">
                    {s.label}
                  </label>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <Source s={s.source} />
                    {updated[s.key] ? <span className="text-xs text-ink-muted">updated {ago(updated[s.key]!.at)}</span> : null}
                  </div>
                </div>
                <div className="min-w-0 space-y-2">
                  {s.key === "WHATSAPP_MODE" ? (
                    <select id={s.key} name={s.key} className="input" defaultValue={mode}>
                      <option value="mock">Mock (no real messages)</option>
                      <option value="cloud">Live (WhatsApp Cloud API)</option>
                    </select>
                  ) : s.secret ? (
                    <input
                      id={s.key}
                      name={s.key}
                      type="password"
                      className="input"
                      autoComplete="off"
                      placeholder={s.hint ? `Saved (${s.hint}). Leave blank to keep it.` : "Not set"}
                    />
                  ) : (
                    <input id={s.key} name={s.key} className="input" autoComplete="off" defaultValue={s.value ?? ""} placeholder="Not set" />
                  )}
                  <p className="text-xs text-ink-muted">{HELP[s.key]}</p>
                  <div className="flex flex-wrap gap-4 text-xs">
                    {s.key === "WHATSAPP_VERIFY_TOKEN" ? (
                      <label className="flex items-center gap-1.5">
                        <input type="checkbox" name="generateVerifyToken" value="1" /> Generate a new one
                      </label>
                    ) : null}
                    {s.source === "engine" ? (
                      <label className="flex items-center gap-1.5 text-ink-muted">
                        <input type="checkbox" name={`clear_${s.key}`} value="1" /> Remove from here (use the server&apos;s .env)
                      </label>
                    ) : null}
                  </div>
                </div>
              </div>
            ))}
            <div className="flex flex-wrap gap-2">
              <button className="btn btn-primary">Save settings</button>
            </div>
          </form>
          <form action={checkMetaAppAction} className="mt-3">
            <button className="btn btn-secondary">Check app ID and secret with Meta</button>
          </form>
        </Panel>

        <Panel title="What to paste into Meta">
          <dl className="space-y-3 text-sm">
            <div>
              <dt className="font-semibold">Webhook callback URL</dt>
              <dd className="mt-1 break-all">
                <code className="rounded bg-surface-muted px-1">{`${appUrl}/webhooks/whatsapp`}</code>
              </dd>
              <dd className="mt-1 text-xs text-ink-muted">
                The web app forwards it to the agent service, so only this one address has to be public. APP_URL must be a public https:// address.
              </dd>
            </div>
            <div>
              <dt className="font-semibold">Verify token</dt>
              <dd className="mt-1 text-xs text-ink-muted">
                {verify.value ? <code className="break-all rounded bg-surface-muted px-1 text-ink">{verify.value}</code> : "Not set yet. Tick “Generate a new one” above and save."}
              </dd>
            </div>
            <div>
              <dt className="font-semibold">Webhook fields to subscribe</dt>
              <dd className="mt-1 font-mono text-xs">messages, smb_message_echoes, history, smb_app_state_sync, account_update</dd>
            </div>
          </dl>
        </Panel>
      </div>
    </main>
  );
}
