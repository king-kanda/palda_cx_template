import type { ProviderView } from "@garden/services";
import { Section } from "@/components/ui";
import {
  moveProviderAction,
  refreshTemplatesAction,
  removeProviderAction,
  saveProviderAction,
  setupTemplatesAction,
  toggleProviderAction,
} from "./actions";

const TEMPLATE_LABEL: Record<string, string> = {
  payment_options_v1: "Payment message with M-Pesa button and link",
  payment_link_v1: "Payment message with link only",
};

function Keys({ provider }: { provider: ProviderView["id"] }) {
  if (provider === "tuma")
    return (
      <>
        <input className="input" name="email" placeholder="Tuma account email" autoComplete="off" required />
        <input className="input" name="apiKey" type="password" placeholder="Tuma API key" autoComplete="off" required />
      </>
    );
  if (provider === "paystack")
    return <input className="input" name="secretKey" type="password" placeholder="Secret key (sk_live_… or sk_test_…)" autoComplete="off" required />;
  return (
    <>
      <input className="input" name="consumerKey" placeholder="Consumer key" autoComplete="off" required />
      <input className="input" name="consumerSecret" type="password" placeholder="Consumer secret" autoComplete="off" required />
      <select className="input" name="environment" defaultValue="live">
        <option value="live">Live</option>
        <option value="sandbox">Sandbox (testing)</option>
      </select>
    </>
  );
}

/**
 * The business's payment providers. Several can be on at once; they are tried in this order and the next one is used when one
 * fails. Keys are only ever typed in here, saved encrypted, and shown back as the last four characters.
 */
export function PaymentsSection({
  providers,
  source,
  templates,
  slug,
  isOwner,
  appUrl,
  whatsappConnected,
}: {
  providers: ProviderView[];
  source: "business" | "platform" | "none";
  templates: Record<string, string>;
  slug: string;
  isOwner: boolean;
  appUrl: string;
  whatsappConnected: boolean;
}) {
  const ordered = [...providers].sort((a, b) => (a.position ?? 99) - (b.position ?? 99));
  const enabledCount = providers.filter((p) => p.enabled).length;
  const hasStk = providers.some((p) => p.enabled && p.stk);
  const hasLink = providers.some((p) => p.enabled && p.link);

  return (
    <Section title="Payments">
      <div id="payments" />
      <p className="text-sm text-ink-muted">
        Choose how your customers pay. Turn on more than one and they are tried in the order shown, so if one provider has a problem the next one takes over
        automatically.
        {source === "platform" ? " Until you connect your own, payments use the shared M-Pesa account." : ""}
        {source === "none" ? " No provider is connected yet, so customers can't be asked to pay." : ""}
      </p>

      <ul className="mt-4 space-y-3">
        {ordered.map((p, i) => (
          <li key={p.id} className="rounded-xl border border-line p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-semibold">
                  {p.label}{" "}
                  {p.enabled ? (
                    <span className="pill bg-lime-100 text-brand-800">On{p.position ? ` · tried #${p.position}` : ""}</span>
                  ) : p.configured ? (
                    <span className="pill bg-surface-muted text-ink-muted">Off</span>
                  ) : (
                    <span className="pill bg-surface-muted text-ink-muted">Not connected</span>
                  )}
                </p>
                <p className="mt-1 text-sm text-ink-muted">{p.blurb}</p>
                {p.hint ? (
                  <p className="mt-1 text-xs text-ink-muted">
                    Key {p.hint}
                    {p.environment ? ` · ${p.environment}` : ""}
                  </p>
                ) : null}
              </div>
              {isOwner && p.configured && source === "business" ? (
                <div className="flex flex-wrap gap-2">
                  {p.enabled ? (
                    <>
                      <form action={moveProviderAction}>
                        <input type="hidden" name="provider" value={p.id} />
                        <input type="hidden" name="direction" value="up" />
                        <button className="btn btn-secondary px-3 text-xs" disabled={i === 0} aria-label={`Try ${p.label} earlier`}>
                          ↑
                        </button>
                      </form>
                      <form action={moveProviderAction}>
                        <input type="hidden" name="provider" value={p.id} />
                        <input type="hidden" name="direction" value="down" />
                        <button className="btn btn-secondary px-3 text-xs" disabled={i >= enabledCount - 1} aria-label={`Try ${p.label} later`}>
                          ↓
                        </button>
                      </form>
                    </>
                  ) : null}
                  <form action={toggleProviderAction}>
                    <input type="hidden" name="provider" value={p.id} />
                    <input type="hidden" name="on" value={p.enabled ? "0" : "1"} />
                    <button className="btn btn-secondary text-xs">{p.enabled ? "Turn off" : "Turn on"}</button>
                  </form>
                  <form action={removeProviderAction}>
                    <input type="hidden" name="provider" value={p.id} />
                    <button className="btn btn-secondary text-xs text-danger-600">Remove</button>
                  </form>
                </div>
              ) : null}
            </div>

            {isOwner ? (
              <details className="mt-3">
                <summary className="cursor-pointer text-sm font-medium text-brand-700">{p.configured && source === "business" ? "Change keys" : "Connect"}</summary>
                <form action={saveProviderAction} className="mt-3 grid max-w-md gap-2">
                  <input type="hidden" name="provider" value={p.id} />
                  <Keys provider={p.id} />
                  <button className="btn btn-primary">Save and turn on</button>
                </form>
                {p.id === "paystack" ? (
                  <p className="mt-3 break-all text-xs text-ink-muted">
                    In your Paystack dashboard (Settings, API Keys &amp; Webhooks) set the webhook URL to{" "}
                    <code className="rounded bg-surface-muted px-1">{`${appUrl}/api/payments/paystack?tenant=${slug}`}</code>
                  </p>
                ) : null}
                {p.id === "tuma" ? (
                  <p className="mt-3 break-all text-xs text-ink-muted">
                    Payment results come back to <code className="rounded bg-surface-muted px-1">{`${appUrl}/api/mpesa/callback?tenant=${slug}`}</code> (set for you automatically).
                  </p>
                ) : null}
                {p.id === "pesapal" ? (
                  <p className="mt-3 break-all text-xs text-ink-muted">
                    Nothing to set up on Pesapal&apos;s side. We register our notification address for you:{" "}
                    <code className="rounded bg-surface-muted px-1">{`${appUrl}/api/payments/pesapal?tenant=${slug}`}</code>
                  </p>
                ) : null}
              </details>
            ) : null}
          </li>
        ))}
      </ul>

      {hasLink && hasStk ? (
        <p className="mt-3 text-xs text-ink-muted">Customers will get a WhatsApp message with a &quot;Pay with M-Pesa&quot; button and a &quot;Pay online&quot; link.</p>
      ) : hasLink ? (
        <p className="mt-3 text-xs text-ink-muted">Customers will get a WhatsApp message with a payment link.</p>
      ) : hasStk ? (
        <p className="mt-3 text-xs text-ink-muted">Customers will get an M-Pesa prompt on their phone.</p>
      ) : null}

      {isOwner && source === "business" && (hasLink || hasStk) ? (
        <div className="mt-4 border-t border-line pt-4">
          <p className="text-sm font-semibold">WhatsApp payment messages</p>
          <p className="mt-1 text-sm text-ink-muted">
            WhatsApp must approve the payment message before it can carry buttons. Until it does, customers get the same message as plain text.
          </p>
          {Object.keys(templates).length > 0 ? (
            <ul className="mt-2 space-y-1 text-sm">
              {Object.entries(templates).map(([name, status]) => (
                <li key={name} className="flex justify-between gap-3">
                  <span>{TEMPLATE_LABEL[name] ?? name}</span>
                  <span className={`pill ${status === "APPROVED" ? "bg-lime-100 text-brand-800" : status === "REJECTED" ? "bg-danger-100 text-danger-600" : "bg-warning-100 text-warning-600"}`}>
                    {status.charAt(0) + status.slice(1).toLowerCase()}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
          <div className="mt-3 flex flex-wrap gap-2">
            {whatsappConnected ? (
              <>
                <form action={setupTemplatesAction}>
                  <button className="btn btn-secondary">Set up payment messages</button>
                </form>
                <form action={refreshTemplatesAction}>
                  <button className="btn btn-secondary">Check approval</button>
                </form>
              </>
            ) : (
              <p className="text-xs text-ink-muted">Connect WhatsApp above to set these up.</p>
            )}
          </div>
        </div>
      ) : null}
    </Section>
  );
}
