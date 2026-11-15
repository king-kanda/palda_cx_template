"use client";

import { useActionState, useMemo, useState } from "react";
import { Check, TriangleAlert } from "lucide-react";
import { BRAND_PRESETS, LOGO_MAX_CHARS, checkBrandColors, deriveTheme } from "@garden/services/brand";
import { LogoPicker } from "../../../../components/logo-picker";
import { saveBrandAction, type EngineFormState } from "../../actions";

export type BrandValues = {
  logo: string | null;
  primary: string;
  accent: string;
  website: string;
  tagline: string;
  instagram: string;
  facebook: string;
  tiktok: string;
  linkedin: string;
  email: string;
  phone: string;
};

const FIELD = "input";

function Colour({ id, label, value, onChange }: { id: string; label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium">
        {label}
      </label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          aria-label={`${label} picker`}
          value={/^#[0-9a-fA-F]{6}$/.test(value) ? value : "#000000"}
          onChange={(e) => onChange(e.target.value.toUpperCase())}
          className="size-11 shrink-0 cursor-pointer rounded-xl border border-line bg-surface p-1"
        />
        <input id={id} value={value} onChange={(e) => onChange(e.target.value.toUpperCase())} className={`${FIELD} font-mono`} maxLength={7} spellCheck={false} />
      </div>
    </div>
  );
}

export function BrandForm({ tenantId, businessName, initial }: { tenantId: string; businessName: string; initial: BrandValues }) {
  const [state, action, pending] = useActionState<EngineFormState, FormData>(saveBrandAction, {});
  const [v, setV] = useState<BrandValues>(initial);
  const [logoChanged, setLogoChanged] = useState(false);
  const set = <K extends keyof BrandValues>(key: K, value: BrandValues[K]) => setV((prev) => ({ ...prev, [key]: value }));

  const problems = useMemo(() => checkBrandColors(v.primary, v.accent), [v.primary, v.accent]);
  const theme = useMemo(() => (problems.length ? null : deriveTheme(v.primary, v.accent)), [problems, v.primary, v.accent]);
  // The preview applies the brand to a small mock of the customer's app, using the same variable names the real app uses.
  const previewStyle = (theme ?? {}) as React.CSSProperties;

  return (
    <form action={action} className="grid items-start gap-5 xl:grid-cols-[1.3fr_1fr]">
      <input type="hidden" name="tenantId" value={tenantId} />
      <input type="hidden" name="logoChanged" value={logoChanged ? "1" : "0"} />
      <input type="hidden" name="logo" value={v.logo ?? ""} />

      <div className="space-y-5">
        <section className="card p-5">
          <h2 className="mb-4 text-lg font-semibold">Logo and colours</h2>
          <div className="space-y-5">
            <div>
              <span className="mb-1.5 block text-sm font-medium">Logo</span>
              <LogoPicker value={v.logo} maxChars={LOGO_MAX_CHARS} onChange={(next) => { set("logo", next); setLogoChanged(true); }} />
            </div>

            <div>
              <span className="mb-2 block text-sm font-medium">Palette</span>
              <div className="flex flex-wrap gap-2">
                {BRAND_PRESETS.map((p) => {
                  const active = p.primary.toLowerCase() === v.primary.toLowerCase() && p.accent.toLowerCase() === v.accent.toLowerCase();
                  return (
                    <button
                      key={p.name}
                      type="button"
                      aria-pressed={active}
                      onClick={() => setV((prev) => ({ ...prev, primary: p.primary, accent: p.accent }))}
                      className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium ${active ? "border-ink bg-surface-muted" : "border-line bg-surface hover:bg-surface-muted"}`}
                    >
                      <span className="flex">
                        <span className="size-4 rounded-full" style={{ background: p.primary }} />
                        <span className="-ml-1 size-4 rounded-full" style={{ background: p.accent }} />
                      </span>
                      {p.name}
                      {active ? <Check className="size-3" /> : null}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Colour id="brand-primary" label="Main colour" value={v.primary} onChange={(x) => set("primary", x)} />
              <Colour id="brand-accent" label="Accent colour" value={v.accent} onChange={(x) => set("accent", x)} />
            </div>
            <input type="hidden" name="primary" value={v.primary} />
            <input type="hidden" name="accent" value={v.accent} />
            {problems.length ? (
              <p role="alert" className="flex items-start gap-2 rounded-xl bg-warning-100 px-3 py-2 text-sm text-warning-600">
                <TriangleAlert className="mt-0.5 size-4 shrink-0" /> {problems[0]}
              </p>
            ) : (
              <p className="text-xs text-ink-muted">The main colour is used for buttons, links and the sidebar. The accent marks the page you are on.</p>
            )}
          </div>
        </section>

        <section className="card p-5">
          <h2 className="mb-4 text-lg font-semibold">Website, social and contact</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label htmlFor="b-tagline" className="mb-1.5 block text-sm font-medium">
                Tagline
              </label>
              <input id="b-tagline" name="tagline" className={FIELD} value={v.tagline} maxLength={90} onChange={(e) => set("tagline", e.target.value)} placeholder="e.g. Gardens for every occasion" />
            </div>
            <div className="sm:col-span-2">
              <label htmlFor="b-website" className="mb-1.5 block text-sm font-medium">
                Website
              </label>
              <input id="b-website" name="website" type="url" className={FIELD} value={v.website} onChange={(e) => set("website", e.target.value)} placeholder="https://www.example.co.ke" />
            </div>
            {(
              [
                ["instagram", "Instagram", "https://instagram.com/…"],
                ["facebook", "Facebook", "https://facebook.com/…"],
                ["tiktok", "TikTok", "https://tiktok.com/@…"],
                ["linkedin", "LinkedIn", "https://linkedin.com/company/…"],
              ] as const
            ).map(([key, label, ph]) => (
              <div key={key}>
                <label htmlFor={`b-${key}`} className="mb-1.5 block text-sm font-medium">
                  {label}
                </label>
                <input id={`b-${key}`} name={key} type="url" className={FIELD} value={v[key]} onChange={(e) => set(key, e.target.value)} placeholder={ph} />
              </div>
            ))}
            <div>
              <label htmlFor="b-email" className="mb-1.5 block text-sm font-medium">
                Business email
              </label>
              <input id="b-email" name="email" type="email" className={FIELD} value={v.email} onChange={(e) => set("email", e.target.value)} />
            </div>
            <div>
              <label htmlFor="b-phone" className="mb-1.5 block text-sm font-medium">
                Business phone
              </label>
              <input id="b-phone" name="phone" className={FIELD} value={v.phone} onChange={(e) => set("phone", e.target.value)} placeholder="+254 700 000 000" />
            </div>
          </div>
        </section>

        {state.error ? (
          <p role="alert" className="rounded-xl border border-danger-600/30 bg-danger-100 px-3 py-2 text-sm text-danger-600">
            {state.error}
          </p>
        ) : null}
        {state.ok ? <p className="rounded-xl bg-lime-100 px-3 py-2 text-sm text-brand-900">{state.message}</p> : null}
        <button className="btn btn-primary h-11 px-5" disabled={pending || problems.length > 0}>
          {pending ? "Saving…" : "Save branding"}
        </button>
      </div>

      {/* Live preview: a small mock of the customer's app wearing the brand. */}
      <aside className="xl:sticky xl:top-24">
        <p className="mb-2 font-mono text-[11px] uppercase tracking-[0.08em] text-ink-muted">Preview</p>
        <div className="overflow-hidden rounded-2xl border border-line bg-canvas" style={previewStyle} data-testid="brand-preview">
          <div className="flex">
            <div className="w-40 shrink-0 border-r border-line bg-surface p-3">
              <div className="mb-3 flex items-center gap-2">
                {v.logo ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={v.logo} alt="" className="size-7 rounded-md object-contain" />
                ) : (
                  <span className="size-7 rounded-md" style={{ background: theme?.["--color-brand-800"] ?? v.primary }} />
                )}
                <span className="truncate text-xs font-bold tracking-tight">{businessName.toUpperCase()}</span>
              </div>
              <div className="space-y-1 text-xs">
                <div className="rounded-lg px-2 py-1.5 font-medium" style={{ background: theme?.["--color-lime-400"] ?? v.accent, color: theme?.["--color-brand-900"] ?? "#000" }}>
                  Dashboard
                </div>
                <div className="px-2 py-1.5 text-ink-muted">Bookings</div>
                <div className="px-2 py-1.5 text-ink-muted">Customers</div>
              </div>
            </div>
            <div className="min-w-0 flex-1 space-y-3 p-4">
              <p className="text-sm font-bold">Good morning</p>
              <div className="rounded-xl border border-line bg-surface p-3">
                <p className="text-xs text-ink-muted">Pipeline value</p>
                <p className="text-xl font-bold" style={{ color: theme?.["--color-brand-800"] ?? v.primary }}>
                  KES 184,000
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full px-3 py-1.5 text-xs font-semibold text-white" style={{ background: theme?.["--color-brand-800"] ?? v.primary }}>
                  New booking
                </span>
                <span className="rounded-full px-3 py-1.5 text-xs font-medium" style={{ background: theme?.["--color-brand-100"] ?? "#eee", color: theme?.["--color-brand-800"] ?? v.primary }}>
                  Confirmed
                </span>
              </div>
            </div>
          </div>
          {v.tagline ? <p className="border-t border-line bg-surface px-4 py-2 text-xs text-ink-muted">{v.tagline}</p> : null}
        </div>
        <p className="mt-2 text-xs text-ink-muted">Shown in {businessName}&apos;s app, its public forms and its invoices.</p>
      </aside>
    </form>
  );
}
