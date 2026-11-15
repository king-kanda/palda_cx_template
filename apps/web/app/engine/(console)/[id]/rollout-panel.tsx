"use client";

import { useActionState, useState } from "react";
import { Check, CircleAlert, Circle, Copy } from "lucide-react";
import type { Credentials } from "@garden/services";
import { resetPasswordAction, rolloutAction, type EngineFormState } from "./actions";

type ReadinessItem = { key: string; label: string; ok: boolean; required: boolean; hint: string };

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="btn btn-secondary"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch {
          /* clipboard blocked: the text is selectable on screen */
        }
      }}
    >
      {copied ? <Check className="size-4" /> : <Copy className="size-4" />} {copied ? "Copied" : label}
    </button>
  );
}

/** The one-time credentials, with copy buttons and a ready-to-send message. Shown once; the password is never stored readable. */
function CredentialsCard({
  credentials,
  headline,
  appUrl,
  businessName,
  agentName,
}: {
  credentials: Credentials;
  headline: string;
  appUrl: string;
  businessName: string;
  agentName: string;
}) {
  const message = `Hi ${credentials.name.split(" ")[0]}, your Palda CX account for ${businessName} is ready. ${agentName} is set up and waiting.\n\nSign in at ${appUrl}/login\nEmail: ${credentials.email}\nPassword: ${credentials.password}\n\nPlease keep this password safe.`;
  return (
    <div className="mt-5 rounded-2xl border border-lime-400 bg-lime-100 p-4">
      <p className="text-sm font-semibold text-brand-900">{headline} Share this now. It won&apos;t be shown again.</p>
      <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-[auto_1fr]">
        <dt className="text-ink-muted">Sign in at</dt>
        <dd className="font-mono">{appUrl}/login</dd>
        <dt className="text-ink-muted">Email</dt>
        <dd className="font-mono">{credentials.email}</dd>
        <dt className="text-ink-muted">Password</dt>
        <dd className="select-all font-mono text-base font-semibold">{credentials.password}</dd>
      </dl>
      <div className="mt-3 flex flex-wrap gap-2">
        <CopyButton text={credentials.password} label="Copy password" />
        <CopyButton text={message} label="Copy message for WhatsApp" />
      </div>
    </div>
  );
}

export function RolloutPanel({
  tenantId,
  status,
  checks,
  appUrl,
  businessName,
  agentName,
}: {
  tenantId: string;
  status: "setup" | "active" | "suspended";
  checks: ReadinessItem[];
  appUrl: string;
  businessName: string;
  agentName: string;
}) {
  const [rollout, rolloutFormAction, rolling] = useActionState<EngineFormState, FormData>(rolloutAction, {});
  const blocked = checks.filter((c) => c.required && !c.ok);
  const warnings = checks.filter((c) => !c.required && !c.ok);

  return (
    <div>
      <ul className="space-y-2">
        {checks.map((c) => (
          <li key={c.key} className="flex items-start gap-3 text-sm">
            <span className="mt-0.5">
              {c.ok ? (
                <Check className="size-4 text-success-600" aria-label="Done" />
              ) : c.required ? (
                <CircleAlert className="size-4 text-danger-600" aria-label="Needs doing" />
              ) : (
                <Circle className="size-4 text-ink-subtle" aria-label="Optional" />
              )}
            </span>
            <span>
              <span className={c.ok ? "text-ink" : "font-medium"}>{c.label}</span>
              {!c.required ? <span className="ml-2 text-xs text-ink-subtle">optional</span> : null}
              {!c.ok ? <span className="block text-xs text-ink-muted">{c.hint}</span> : null}
            </span>
          </li>
        ))}
      </ul>

      {rollout.credentials ? (
        <CredentialsCard
          credentials={rollout.credentials}
          headline={`${businessName} is live.`}
          appUrl={appUrl}
          businessName={businessName}
          agentName={agentName}
        />
      ) : null}

      {rollout.error ? (
        <p role="alert" className="mt-4 rounded-xl border border-danger-600/30 bg-danger-100 px-3 py-2 text-sm text-danger-600">
          {rollout.error}
        </p>
      ) : null}

      {status === "setup" ? (
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <form action={rolloutFormAction}>
            <input type="hidden" name="tenantId" value={tenantId} />
            <button className="btn btn-primary h-11 px-5" disabled={rolling || blocked.length > 0 || Boolean(rollout.credentials)}>
              {rolling ? "Rolling out…" : "Roll out to customer"}
            </button>
          </form>
          {blocked.length > 0 ? (
            <span className="text-xs text-danger-600">
              {blocked.length} required item{blocked.length > 1 ? "s" : ""} left
            </span>
          ) : warnings.length > 0 && !rollout.credentials ? (
            <span className="text-xs text-ink-muted">
              Ready. {warnings.length} optional item{warnings.length > 1 ? "s" : ""} can be done after.
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** Issue a fresh one-time password for the owner. The old one stops working immediately. */
export function ResetPasswordPanel({
  tenantId,
  appUrl,
  businessName,
  agentName,
  disabledReason,
}: {
  tenantId: string;
  appUrl: string;
  businessName: string;
  agentName: string;
  disabledReason?: string;
}) {
  const [state, action, pending] = useActionState<EngineFormState, FormData>(resetPasswordAction, {});
  return (
    <div>
      {state.credentials ? (
        <CredentialsCard
          credentials={state.credentials}
          headline="New password issued."
          appUrl={appUrl}
          businessName={businessName}
          agentName={agentName}
        />
      ) : null}
      {state.error ? (
        <p role="alert" className="mt-4 rounded-xl border border-danger-600/30 bg-danger-100 px-3 py-2 text-sm text-danger-600">
          {state.error}
        </p>
      ) : null}
      <form action={action} className={state.credentials || state.error ? "mt-4" : ""}>
        <input type="hidden" name="tenantId" value={tenantId} />
        <button className="btn btn-secondary" disabled={pending || Boolean(disabledReason)}>
          {pending ? "Issuing…" : "Reset owner password"}
        </button>
        {disabledReason ? <span className="ml-3 text-xs text-ink-muted">{disabledReason}</span> : null}
      </form>
    </div>
  );
}
