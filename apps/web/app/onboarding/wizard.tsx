"use client";

import Link from "next/link";
import { useActionState, useMemo, useState, startTransition } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Briefcase,
  Check,
  PartyPopper,
  Plus,
  Scissors,
  Smile,
  SprayCan,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import { LogoMark } from "@/components/ui";
import { createBusinessAction, type OnboardingState } from "./actions";
import type { PresetDTO } from "./types";

const ICONS: Record<string, LucideIcon> = {
  venue: PartyPopper,
  salon: Scissors,
  dental: Smile,
  consultancy: Briefcase,
  cleaning: SprayCan,
};

const STEPS = ["Business type", "Your business", "Team & services", "Hours & policies", "Your account"];
const DAY_ORDER = ["1", "2", "3", "4", "5", "6", "0"] as const;
const DAY_NAMES: Record<string, string> = {
  "0": "Sunday",
  "1": "Monday",
  "2": "Tuesday",
  "3": "Wednesday",
  "4": "Thursday",
  "5": "Friday",
  "6": "Saturday",
};

type Resource = { name: string; kind: string; capacity: number | null };
type Offering = PresetDTO["offerings"][number];
type Hours = Record<string, { open: string; close: string } | null>;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function Label({ children, htmlFor }: { children: React.ReactNode; htmlFor?: string }) {
  return (
    <label htmlFor={htmlFor} className="mb-1.5 block text-sm font-medium">
      {children}
    </label>
  );
}

export function OnboardingWizard({ presets, codeRequired }: { presets: PresetDTO[]; codeRequired: boolean }) {
  const [step, setStep] = useState(0);
  const [verticalId, setVerticalId] = useState<string | null>(null);
  const [businessName, setBusinessName] = useState("");
  const [location, setLocation] = useState("");
  const [description, setDescription] = useState("");
  const [reviewLink, setReviewLink] = useState("");
  const [resources, setResources] = useState<Resource[]>([]);
  const [offerings, setOfferings] = useState<Offering[]>([]);
  const [hours, setHours] = useState<Hours>({});
  const [depositPct, setDepositPct] = useState(0);
  const [cancellationNoticeHours, setCancellationNoticeHours] = useState(24);
  const [ownerName, setOwnerName] = useState("");
  const [ownerEmail, setOwnerEmail] = useState("");
  const [ownerPassword, setOwnerPassword] = useState("");
  const [code, setCode] = useState("");

  const [state, run, pending] = useActionState<OnboardingState, FormData>(createBusinessAction, {});
  const preset = useMemo(() => presets.find((p) => p.id === verticalId) ?? null, [presets, verticalId]);

  function chooseVertical(next: PresetDTO) {
    // Changing the type resets the starter team, services and hours to that type's defaults.
    setVerticalId(next.id);
    setResources(next.resources.map((r) => ({ ...r })));
    setOfferings(next.offerings.map((o) => ({ ...o })));
    setHours(JSON.parse(JSON.stringify(next.workingHours)) as Hours);
    setDepositPct(next.depositPct);
    setCancellationNoticeHours(next.cancellationNoticeHours);
  }

  /** Returns a message when the current step isn't ready to continue. */
  function problem(forStep: number): string | null {
    if (forStep === 0 && !preset) return "Choose the type of business you run.";
    if (forStep === 1) {
      if (businessName.trim().length < 2) return "Enter your business name.";
      if (reviewLink && !/^https?:\/\/\S+$/i.test(reviewLink)) return "The review link must start with https://";
    }
    if (forStep === 2) {
      if (resources.length === 0) return `Add at least one ${preset?.labels.resource.toLowerCase()}.`;
      if (resources.some((r) => r.name.trim().length < 2)) return "Give every team member or space a name.";
      if (offerings.length === 0) return `Add at least one ${preset?.labels.offering.toLowerCase()}.`;
      if (offerings.some((o) => o.name.trim().length < 2)) return "Give every service a name.";
      if (offerings.some((o) => !(o.durationMin >= 5))) return "Each service needs a duration of at least 5 minutes.";
      if (offerings.some((o) => !(o.basePriceKes >= 0))) return "Prices can't be negative.";
      for (const o of offerings) {
        if (!resources.some((r) => r.kind === o.resourceKind)) {
          return `"${o.name}" needs at least one ${o.resourceKind} (add one above or change the service).`;
        }
      }
    }
    if (forStep === 3) {
      for (const day of DAY_ORDER) {
        const h = hours[day];
        if (h && !(h.close > h.open)) return `${DAY_NAMES[day]}: closing time must be after opening time.`;
      }
      if (Object.values(hours).every((h) => h === null)) return "Open on at least one day.";
    }
    if (forStep === 4) {
      if (ownerName.trim().length < 2) return "Enter your name.";
      if (!EMAIL_RE.test(ownerEmail.trim())) return "Enter a valid email address.";
      if (ownerPassword.length < 8) return "Use a password with at least 8 characters.";
      if (codeRequired && !code.trim()) return "Enter your invite code.";
    }
    return null;
  }

  const currentProblem = problem(step);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    for (let i = 0; i < STEPS.length; i += 1) {
      const message = problem(i);
      if (message) {
        setStep(i);
        return;
      }
    }
    const payload = {
      vertical: verticalId,
      businessName: businessName.trim(),
      location: location.trim(),
      description: description.trim(),
      reviewLink: reviewLink.trim(),
      resources: resources.map((r) => ({
        name: r.name.trim(),
        kind: r.kind,
        capacity: r.kind === "space" && r.capacity ? r.capacity : null,
      })),
      offerings: offerings.map((o) => ({
        ...o,
        name: o.name.trim(),
        durationMin: Math.round(o.durationMin),
        basePriceKes: Math.round(o.basePriceKes),
      })),
      workingHours: hours,
      depositPct,
      cancellationNoticeHours,
      owner: { name: ownerName.trim(), email: ownerEmail.trim(), password: ownerPassword },
    };
    const formData = new FormData();
    formData.set("payload", JSON.stringify(payload));
    formData.set("code", code);
    startTransition(() => run(formData));
  }

  const hasBuffers = offerings.some((o) => o.bufferBeforeMin > 0);
  const newResourceKind = preset?.resources[0]?.kind ?? preset?.resourceKinds[0] ?? "staff";

  return (
    <div className="min-h-screen bg-canvas">
      <header className="flex items-center justify-between px-4 py-5 md:px-8">
        <div className="flex items-center gap-2">
          <LogoMark />
          <span className="text-lg font-bold tracking-tight">PALDA CX</span>
        </div>
        <Link href="/login" className="text-sm font-medium text-brand-700 hover:underline">
          Already have an account? Sign in
        </Link>
      </header>

      <main className="mx-auto w-full max-w-3xl px-4 pb-16">
        <h1 className="text-2xl font-bold md:text-3xl">Set up your business</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Pick your type of business and we&apos;ll pre-fill services, hours, reminders and your WhatsApp assistant.
          You can change everything later in Settings.
        </p>

        {/* Progress */}
        <ol className="my-6 flex items-center gap-2" aria-label="Progress">
          {STEPS.map((label, index) => {
            const done = index < step;
            const active = index === step;
            return (
              <li key={label} className="flex flex-1 items-center gap-2">
                <span
                  className={`grid size-7 shrink-0 place-items-center rounded-full text-xs font-bold ${
                    done
                      ? "bg-brand-800 text-white"
                      : active
                        ? "bg-lime-400 text-brand-900"
                        : "bg-neutral-100 text-ink-muted"
                  }`}
                  aria-current={active ? "step" : undefined}
                >
                  {done ? <Check className="size-4" /> : index + 1}
                </span>
                <span className={`hidden text-xs font-medium md:block ${active ? "text-ink" : "text-ink-muted"}`}>
                  {label}
                </span>
                {index < STEPS.length - 1 ? <span className="h-px flex-1 bg-line" /> : null}
              </li>
            );
          })}
        </ol>

        <form onSubmit={submit} className="card p-5 md:p-6">
          {/* STEP 1 */}
          {step === 0 && (
            <div>
              <h2 className="text-lg font-semibold">What kind of business do you run?</h2>
              <p className="mb-4 mt-1 text-sm text-ink-muted">This sets up the right words, services and reminders.</p>
              <div className="grid gap-3 sm:grid-cols-2">
                {presets.map((p) => {
                  const Icon = ICONS[p.id] ?? Briefcase;
                  const selected = p.id === verticalId;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => chooseVertical(p)}
                      aria-pressed={selected}
                      className={`flex items-start gap-3 rounded-2xl border p-4 text-left transition-colors ${
                        selected ? "border-brand-800 bg-lime-100" : "border-line bg-surface hover:bg-surface-muted"
                      }`}
                    >
                      <span
                        className={`grid size-10 shrink-0 place-items-center rounded-xl ${
                          selected ? "bg-brand-800 text-white" : "bg-surface-muted text-brand-800"
                        }`}
                      >
                        <Icon className="size-5" strokeWidth={1.75} />
                      </span>
                      <span>
                        <span className="block font-semibold">{p.title}</span>
                        <span className="mt-0.5 block text-sm text-ink-muted">{p.tagline}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* STEP 2 */}
          {step === 1 && preset && (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold">Tell us about your business</h2>
              <div>
                <Label htmlFor="businessName">Business name</Label>
                <input
                  id="businessName"
                  className="input"
                  value={businessName}
                  onChange={(e) => setBusinessName(e.target.value)}
                  placeholder="e.g. Sparkle Cleaners"
                  autoFocus
                />
              </div>
              <div>
                <Label htmlFor="location">Where are you based?</Label>
                <input
                  id="location"
                  className="input"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  placeholder="e.g. Kilimani, Nairobi"
                />
              </div>
              <div>
                <Label htmlFor="description">What should the assistant say about you?</Label>
                <textarea
                  id="description"
                  className="input min-h-24"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="One or two sentences customers should know. Leave blank to start with a short default."
                />
              </div>
              <div>
                <Label htmlFor="reviewLink">Google review link (optional)</Label>
                <input
                  id="reviewLink"
                  className="input"
                  type="url"
                  value={reviewLink}
                  onChange={(e) => setReviewLink(e.target.value)}
                  placeholder="https://g.page/r/your-business/review"
                />
                <p className="mt-1 text-xs text-ink-muted">
                  Happy customers are sent here. Skip it for now and add it later in Settings.
                </p>
              </div>
            </div>
          )}

          {/* STEP 3 */}
          {step === 2 && preset && (
            <div className="space-y-6">
              <section>
                <h2 className="text-lg font-semibold">{preset.labels.resources}</h2>
                <p className="mb-3 mt-1 text-sm text-ink-muted">
                  Who or what customers can book. Rename these to match your team.
                </p>
                <ul className="space-y-2">
                  {resources.map((r, index) => (
                    <li key={index} className="flex items-center gap-2">
                      <input
                        className="input"
                        aria-label={`${preset.labels.resource} ${index + 1} name`}
                        value={r.name}
                        onChange={(e) =>
                          setResources((prev) => prev.map((x, i) => (i === index ? { ...x, name: e.target.value } : x)))
                        }
                      />
                      {preset.resourceKinds.length > 1 ? (
                        <select
                          className="input max-w-32"
                          aria-label="Type"
                          value={r.kind}
                          onChange={(e) =>
                            setResources((prev) => prev.map((x, i) => (i === index ? { ...x, kind: e.target.value } : x)))
                          }
                        >
                          {preset.resourceKinds.map((kind) => (
                            <option key={kind} value={kind}>
                              {kind}
                            </option>
                          ))}
                        </select>
                      ) : null}
                      {r.kind === "space" ? (
                        <input
                          className="input max-w-28"
                          type="number"
                          min={1}
                          aria-label="Capacity"
                          placeholder="Capacity"
                          value={r.capacity ?? ""}
                          onChange={(e) =>
                            setResources((prev) =>
                              prev.map((x, i) =>
                                i === index ? { ...x, capacity: e.target.value ? Number(e.target.value) : null } : x,
                              ),
                            )
                          }
                        />
                      ) : null}
                      <button
                        type="button"
                        aria-label="Remove"
                        className="grid size-10 shrink-0 place-items-center rounded-xl text-ink-muted hover:bg-danger-100 hover:text-danger-600"
                        onClick={() => setResources((prev) => prev.filter((_, i) => i !== index))}
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </li>
                  ))}
                </ul>
                <button
                  type="button"
                  className="btn btn-secondary mt-3"
                  onClick={() => setResources((prev) => [...prev, { name: "", kind: newResourceKind, capacity: null }])}
                >
                  <Plus className="size-4" /> Add {preset.labels.resource.toLowerCase()}
                </button>
              </section>

              <section>
                <h2 className="text-lg font-semibold">{preset.labels.offerings}</h2>
                <p className="mb-3 mt-1 text-sm text-ink-muted">
                  What you sell. Prices are in KES. These are starting points, so change them to match your business.
                </p>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[34rem] text-sm">
                    <thead>
                      <tr className="text-left text-xs text-ink-muted">
                        <th className="pb-1.5 pr-2 font-medium">Name</th>
                        <th className="pb-1.5 pr-2 font-medium">Minutes</th>
                        <th className="pb-1.5 pr-2 font-medium">Price (KES)</th>
                        {hasBuffers ? <th className="pb-1.5 pr-2 font-medium">Travel buffer</th> : null}
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {offerings.map((o, index) => {
                        const set = (patch: Partial<Offering>) =>
                          setOfferings((prev) => prev.map((x, i) => (i === index ? { ...x, ...patch } : x)));
                        return (
                          <tr key={index}>
                            <td className="pb-2 pr-2">
                              <input
                                className="input"
                                aria-label="Service name"
                                value={o.name}
                                onChange={(e) => set({ name: e.target.value })}
                              />
                            </td>
                            <td className="pb-2 pr-2">
                              <input
                                className="input w-24"
                                type="number"
                                min={5}
                                aria-label="Duration in minutes"
                                value={o.durationMin}
                                onChange={(e) => set({ durationMin: Number(e.target.value) })}
                              />
                            </td>
                            <td className="pb-2 pr-2">
                              <input
                                className="input w-28"
                                type="number"
                                min={0}
                                aria-label="Price in KES"
                                value={o.basePriceKes}
                                onChange={(e) => set({ basePriceKes: Number(e.target.value) })}
                              />
                            </td>
                            {hasBuffers ? (
                              <td className="pb-2 pr-2">
                                <input
                                  className="input w-24"
                                  type="number"
                                  min={0}
                                  aria-label="Travel buffer in minutes"
                                  value={o.bufferBeforeMin}
                                  onChange={(e) => set({ bufferBeforeMin: Number(e.target.value) })}
                                />
                              </td>
                            ) : null}
                            <td className="pb-2">
                              <button
                                type="button"
                                aria-label="Remove"
                                className="grid size-10 place-items-center rounded-xl text-ink-muted hover:bg-danger-100 hover:text-danger-600"
                                onClick={() => setOfferings((prev) => prev.filter((_, i) => i !== index))}
                              >
                                <Trash2 className="size-4" />
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <button
                  type="button"
                  className="btn btn-secondary mt-1"
                  onClick={() =>
                    setOfferings((prev) => [
                      ...prev,
                      {
                        name: "",
                        resourceKind: prev[0]?.resourceKind ?? newResourceKind,
                        durationMin: 60,
                        basePriceKes: 0,
                        bufferBeforeMin: hasBuffers ? 30 : 0,
                        bufferAfterMin: 0,
                        attributes: {},
                      },
                    ])
                  }
                >
                  <Plus className="size-4" /> Add {preset.labels.offering.toLowerCase()}
                </button>
              </section>
            </div>
          )}

          {/* STEP 4 */}
          {step === 3 && preset && (
            <div className="space-y-6">
              <section>
                <h2 className="text-lg font-semibold">Opening hours</h2>
                <p className="mb-3 mt-1 text-sm text-ink-muted">Customers can only book inside these hours.</p>
                <ul className="space-y-2">
                  {DAY_ORDER.map((day) => {
                    const h = hours[day] ?? null;
                    return (
                      <li key={day} className="flex flex-wrap items-center gap-3">
                        <label className="flex w-36 items-center gap-2 text-sm font-medium">
                          <input
                            type="checkbox"
                            className="size-4 accent-brand-800"
                            checked={h !== null}
                            onChange={(e) =>
                              setHours((prev) => ({
                                ...prev,
                                [day]: e.target.checked ? { open: "09:00", close: "17:00" } : null,
                              }))
                            }
                          />
                          {DAY_NAMES[day]}
                        </label>
                        {h ? (
                          <div className="flex items-center gap-2">
                            <input
                              type="time"
                              className="input w-32"
                              aria-label={`${DAY_NAMES[day]} opens`}
                              value={h.open}
                              onChange={(e) => setHours((prev) => ({ ...prev, [day]: { ...h, open: e.target.value } }))}
                            />
                            <span className="text-ink-muted">to</span>
                            <input
                              type="time"
                              className="input w-32"
                              aria-label={`${DAY_NAMES[day]} closes`}
                              value={h.close}
                              onChange={(e) => setHours((prev) => ({ ...prev, [day]: { ...h, close: e.target.value } }))}
                            />
                          </div>
                        ) : (
                          <span className="text-sm text-ink-subtle">Closed</span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </section>

              <section className="grid gap-4 sm:grid-cols-2">
                <div>
                  <Label htmlFor="depositPct">Deposit to confirm a booking (%)</Label>
                  <input
                    id="depositPct"
                    className="input"
                    type="number"
                    min={0}
                    max={100}
                    value={depositPct}
                    onChange={(e) => setDepositPct(Number(e.target.value))}
                  />
                  <p className="mt-1 text-xs text-ink-muted">0 means no deposit. Payment collection is set up later.</p>
                </div>
                <div>
                  <Label htmlFor="cancel">Cancellation notice (hours)</Label>
                  <input
                    id="cancel"
                    className="input"
                    type="number"
                    min={0}
                    max={720}
                    value={cancellationNoticeHours}
                    onChange={(e) => setCancellationNoticeHours(Number(e.target.value))}
                  />
                  <p className="mt-1 text-xs text-ink-muted">Later changes need your approval.</p>
                </div>
              </section>
            </div>
          )}

          {/* STEP 5 */}
          {step === 4 && preset && (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold">Create your owner account</h2>
              <div className="rounded-xl border border-line bg-surface-muted p-3 text-sm text-ink-muted">
                <strong className="text-ink">{businessName || "Your business"}</strong> · {preset.title} ·{" "}
                {resources.length} {preset.labels.resources.toLowerCase()} · {offerings.length}{" "}
                {preset.labels.offerings.toLowerCase()} · you will sign in with your email
              </div>
              <div>
                <Label htmlFor="ownerName">Your name</Label>
                <input
                  id="ownerName"
                  className="input"
                  value={ownerName}
                  onChange={(e) => setOwnerName(e.target.value)}
                  autoComplete="name"
                />
              </div>
              <div>
                <Label htmlFor="ownerEmail">Email</Label>
                <input
                  id="ownerEmail"
                  className="input"
                  type="email"
                  value={ownerEmail}
                  onChange={(e) => setOwnerEmail(e.target.value)}
                  autoComplete="email"
                />
              </div>
              <div>
                <Label htmlFor="ownerPassword">Password</Label>
                <input
                  id="ownerPassword"
                  className="input"
                  type="password"
                  value={ownerPassword}
                  onChange={(e) => setOwnerPassword(e.target.value)}
                  autoComplete="new-password"
                />
                <p className="mt-1 text-xs text-ink-muted">At least 8 characters.</p>
              </div>
              {codeRequired ? (
                <div>
                  <Label htmlFor="code">Invite code</Label>
                  <input id="code" className="input" value={code} onChange={(e) => setCode(e.target.value)} />
                </div>
              ) : null}
              {state.error ? (
                <div
                  role="alert"
                  className="rounded-xl border border-danger-600/30 bg-danger-100 px-3 py-2 text-sm text-danger-600"
                >
                  {state.error}
                </div>
              ) : null}
            </div>
          )}

          {/* Footer */}
          <div className="mt-6 flex items-center justify-between gap-3 border-t border-line pt-4">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setStep((s) => Math.max(0, s - 1))}
              disabled={step === 0 || pending}
            >
              <ArrowLeft className="size-4" /> Back
            </button>
            <div className="flex items-center gap-3">
              {currentProblem && step > 0 ? (
                <span className="hidden text-xs text-ink-muted sm:block">{currentProblem}</span>
              ) : null}
              {step < STEPS.length - 1 ? (
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={currentProblem !== null}
                  onClick={() => setStep((s) => s + 1)}
                >
                  Continue <ArrowRight className="size-4" />
                </button>
              ) : (
                <button type="submit" className="btn btn-primary" disabled={currentProblem !== null || pending}>
                  {pending ? "Setting things up…" : "Create my account"}
                </button>
              )}
            </div>
          </div>
        </form>
      </main>
    </div>
  );
}
