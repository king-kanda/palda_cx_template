import { PLATFORM_KEY_SECTION } from "@garden/integrations";
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
  INTEGRATIONS_MODE:
    "Mock lets owners “connect” Google and Zoho without leaving the app, and every app tool answers with sample data. Live sends owners to Google / Zoho to sign in for real.",
  GOOGLE_CLIENT_ID: "Google Cloud > APIs & Services > Credentials > OAuth client (type: Web application).",
  GOOGLE_CLIENT_SECRET: "The secret of the same OAuth client.",
  ZOHO_CLIENT_ID: "Zoho API Console (api-console.zoho.com) > Add client > Server-based Applications. One client serves Zoho Books and Zoho CRM.",
  ZOHO_CLIENT_SECRET: "The secret of the same Zoho client.",
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

function Fields({ settings, updated }: { settings: PlatformSettingView[]; updated: Record<string, { at: Date }> }) {
  return (
    <>
      {settings.map((s) => (
        <div key={s.key} className="grid gap-2 border-b border-line pb-4 last:border-0 md:grid-cols-[13.75rem_1fr]">
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
              <select id={s.key} name={s.key} className="input" defaultValue={s.value === "cloud" ? "cloud" : "mock"}>
                <option value="mock">Mock (no real messages)</option>
                <option value="cloud">Live (WhatsApp Cloud API)</option>
              </select>
            ) : s.key === "INTEGRATIONS_MODE" ? (
              <select id={s.key} name={s.key} className="input" defaultValue={s.value === "live" ? "live" : "mock"}>
                <option value="mock">Mock (sample data, no real sign-in)</option>
                <option value="live">Live (real Google and Zoho sign-in)</option>
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
    </>
  );
}

function Copy({ value }: { value: string }) {
  return <code className="break-all rounded bg-surface-muted px-1.5 py-0.5 text-xs text-ink">{value}</code>;
}

/**
 * Platform settings: the Meta app behind WhatsApp, and the Google / Zoho OAuth clients behind the apps owners connect. Saved
 * values are encrypted in the database and win over the server's .env, so the platform can be configured from the browser.
 */
export default async function EngineSettingsPage({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  await requireEngineAdmin();
  const query = await searchParams;
  const settings = getPlatformSettingsView();
  const updated = await platformSettingsUpdatedAt();
  const get = (k: string) => settings.find((s) => s.key === k)!;
  const whatsapp = settings.filter((s) => PLATFORM_KEY_SECTION[s.key] === "whatsapp");
  const apps = settings.filter((s) => PLATFORM_KEY_SECTION[s.key] === "apps");
  const mode = get("WHATSAPP_MODE").value === "cloud" ? "cloud" : "mock";
  const appsLive = get("INTEGRATIONS_MODE").value === "live";
  const appUrl = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/+$/, "");
  const verify = get("WHATSAPP_VERIFY_TOKEN");

  return (
    <main className="mx-auto w-full max-w-[68.75rem] p-4 md:p-6">
      <PageHeader
        title="Settings"
        subtitle="Platform-wide setup shared by every customer: WhatsApp, and the apps owners connect. Saved here, encrypted, and used instead of the server's .env."
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
            <input type="hidden" name="section" value="whatsapp" />
            <Fields settings={whatsapp} updated={updated} />
            <button className="btn btn-primary">Save WhatsApp settings</button>
          </form>
          <form action={checkMetaAppAction} className="mt-3">
            <button className="btn btn-secondary">Check app ID and secret with Meta</button>
          </form>
        </Panel>

        <Panel title="What to paste into Meta">
          <dl className="space-y-3 text-sm">
            <div>
              <dt className="font-semibold">Webhook callback URL</dt>
              <dd className="mt-1">
                <Copy value={`${appUrl}/webhooks/whatsapp`} />
              </dd>
              <dd className="mt-1 text-xs text-ink-muted">
                The web app forwards it to the agent service, so only this one address has to be public. APP_URL must be a public https:// address.
              </dd>
            </div>
            <div>
              <dt className="font-semibold">Verify token</dt>
              <dd className="mt-1 text-xs text-ink-muted">
                {verify.value ? <Copy value={verify.value} /> : "Not set yet. Tick “Generate a new one” above and save."}
              </dd>
            </div>
            <div>
              <dt className="font-semibold">Webhook fields to subscribe</dt>
              <dd className="mt-1 font-mono text-xs">messages, smb_message_echoes, history, smb_app_state_sync, account_update</dd>
            </div>
          </dl>
        </Panel>

        <Panel
          title="Google & Zoho"
          aside={
            <span className={`pill ${appsLive ? "bg-success-100 text-success-600" : "bg-neutral-100 text-neutral-600"}`}>
              {appsLive ? "Live" : "Mock mode"}
            </span>
          }
        >
          <p className="mb-4 text-sm text-ink-muted">
            Business owners connect Google Workspace, Zoho Books and Zoho CRM themselves, from Integrations in their own app. Odoo and custom MCP
            servers are set up per customer in their workspace.
          </p>
          <form action={saveMetaSettingsAction} className="space-y-5">
            <input type="hidden" name="section" value="apps" />
            <Fields settings={apps} updated={updated} />
            <button className="btn btn-primary">Save app settings</button>
          </form>
        </Panel>

        <Panel title="What to paste into Google and Zoho">
          <dl className="space-y-4 text-sm">
            <div>
              <dt className="font-semibold">Google: Authorised redirect URIs (add both)</dt>
              <dd className="mt-1 space-y-1">
                <div>
                  <Copy value={`${appUrl}/integrations/callback/google_workspace`} />
                </div>
                <div>
                  <Copy value={`${appUrl}/auth/google/callback`} />
                </div>
              </dd>
              <dd className="mt-1 text-xs text-ink-muted">The second one is “Continue with Google” on the sign-in screens.</dd>
              <dd className="mt-1 text-xs text-ink-muted">
                Enable the Google Calendar API and Gmail API. Scopes used: calendar.events, calendar.freebusy, gmail.send, userinfo.email. Gmail
                sending is a “sensitive” scope: Google verifies the app before more than 100 people can use it.
              </dd>
            </div>
            <div>
              <dt className="font-semibold">Zoho: Authorized Redirect URIs (add both)</dt>
              <dd className="mt-1 space-y-1">
                <div>
                  <Copy value={`${appUrl}/integrations/callback/zoho_books`} />
                </div>
                <div>
                  <Copy value={`${appUrl}/integrations/callback/zoho_crm`} />
                </div>
              </dd>
              <dd className="mt-1 text-xs text-ink-muted">
                In the client&apos;s settings, turn on “Use the same OAuth credentials for all data centers” so customers on zoho.eu, zoho.in and
                others can connect.
              </dd>
            </div>
          </dl>
        </Panel>
      </div>
    </main>
  );
}
