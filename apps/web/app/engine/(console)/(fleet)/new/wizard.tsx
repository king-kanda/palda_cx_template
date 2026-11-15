"use client";

import Link from "next/link";
import { startTransition, useActionState, useMemo, useState } from "react";
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
import { AvatarPicker } from "../../../components/avatar-picker";
import { HoursEditor, hoursProblem, type Hours } from "../../../components/hours-editor";
import { createCustomerAction, type NewCustomerState } from "./actions";
import type { PresetDTO } from "./types";

const ICONS: Record<string, LucideIcon> = {
  venue: PartyPopper,
  salon: Scissors,
  dental: Smile,
  consultancy: Briefcase,
  cleaning: SprayCan,
};

const STEPS = ["Type", "Business", "Agent", "Team & services", "Hours & policies", "Owner"];
const NAME_IDEAS = ["Zuri", "Amani", "Imani", "Neema", "Baraka", "Tumaini", "Wambo"];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Resource = { name: string; kind: string; capacity: number | null };
type Offering = PresetDTO["offerings"][number];

function Label({ children, htmlFor }: { children: React.ReactNode; htmlFor?: string }) {
  return (
    <label htmlFor={htmlFor} className="mb-1.5 block text-sm font-medium">
      {children}
    </label>
  );
}

export function NewCustomerWizard({ presets }: { presets: PresetDTO[] }) {
  const [step, setStep] = useState(0);
  const [verticalId, setVerticalId] = useState<string | null>(null);
  const [businessName, setBusinessName] = useState("");
  const [location, setLocation] = useState("");
  const [description, setDescription] = useState("");
  const [reviewLink, setReviewLink] = useState("");
  const [agentName, setAgentName] = useState("");
  const [agentTone, setAgentTone] = useState("");
  const [agentNotes, setAgentNotes] = useState("");
  const [avatar, setAvatar] = useState<string | null>(null);
  const [resources, setResources] = useState<Resource[]>([]);
  const [offerings, setOfferings] = useState<Offering[]>([]);
  const [hours, setHours] = useState<Hours>({});
  const [depositPct, setDepositPct] = useState(0);
  const [cancellationNoticeHours, setCancellationNoticeHours] = useState(24);
  const [ownerName, setOwnerName] = useState("");
  const [ownerEmail, setOwnerEmail] = useState("");

  const [state, run, pending] = useActionState<NewCustomerState, FormData>(createCustomerAction, {});
  const preset = useMemo(() => presets.find((p) => p.id === verticalId) ?? null, [presets, verticalId]);

  function chooseVertical(next: PresetDTO) {
    setVerticalId(next.id);
    setResources(next.resources.map((r) => ({ ...r })));
    setOfferings(next.offerings.map((o) => ({ ...o })));
    setHours(JSON.parse(JSON.stringify(next.workingHours)) as Hours);
    setDepositPct(next.depositPct);
    setCancellationNoticeHours(next.cancellationNoticeHours);
  }

  function problem(forStep: number): string | null {
    if (forStep === 0 && !preset) return "Choose the type of business.";
    if (forStep === 1) {
      if (businessName.trim().length < 2) return "Enter the business name.";
      if (reviewLink && !/^https?:\/\/\S+$/i.test(reviewLink)) return "The review link must start with https://";
    }
    if (forStep === 2 && agentName.trim().length < 2) return "Give the agent a name.";
    if (forStep === 3) {
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
    if (forStep === 4) return hoursProblem(hours);
    if (forStep === 5) {
      if (ownerName.trim().length < 2) return "Enter the owner's name.";
      if (!EMAIL_RE.test(ownerEmail.trim())) return "Enter the owner's email address.";
    }
    return null;
  }

  const currentProblem = problem(step);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    for (let i = 0; i < STEPS.length; i += 1) {
      if (problem(i)) {
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
      agent: { name: agentName.trim(), tone: agentTone.trim(), notes: agentNotes.trim(), avatar },
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
      // No password: the customer's login is issued at rollout.
      owner: { name: ownerName.trim(), email: ownerEmail.trim() },
    };
    const formData = new FormData();
    formData.set("payload", JSON.stringify(payload));
    startTransition(() => run(formData));
  }

  const hasBuffers = offerings.some((o) => o.bufferBeforeMin > 0);
  const newResourceKind = preset?.resources[0]?.kind ?? preset?.resourceKinds[0] ?? "staff";

  return (
    <div className="mx-auto max-w-3xl p-4 md:p-6">
      <Link href="/engine" className="text-sm font-medium text-brand-700 hover:underline">
        ← All customers
      </Link>
      <h1 className="mt-2 text-2xl font-bold">New customer</h1>
      <p className="mt-1 text-sm text-ink-muted">
        Set everything up for them. They won&apos;t be able to sign in until you roll them out.
      </p>

      <ol className="my-6 flex items-center gap-2" aria-label="Progress">
        {STEPS.map((label, index) => {
          const done = index < step;
          const active = index === step;
          return (
            <li key={label} className="flex flex-1 items-center gap-2">
              <span
                className={`grid size-7 shrink-0 place-items-center rounded-full text-xs font-bold ${
                  done ? "bg-brand-800 text-white" : active ? "bg-lime-400 text-brand-900" : "bg-neutral-100 text-ink-muted"
                }`}
                aria-current={active ? "step" : undefined}
              >
                {done ? <Check className="size-4" /> : index + 1}
              </span>
              <span className={`hidden text-xs font-medium lg:block ${active ? "text-ink" : "text-ink-muted"}`}>{label}</span>
              {index < STEPS.length - 1 ? <span className="h-px flex-1 bg-line" /> : null}
            </li>
          );
        })}
      </ol>

      <form onSubmit={submit} className="card p-5 md:p-6">
        {step === 0 && (
          <div>
            <h2 className="text-lg font-semibold">What kind of business is it?</h2>
            <p className="mb-4 mt-1 text-sm text-ink-muted">This sets the words, services, reminders and the agent&apos;s instructions.</p>
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

        {step === 1 && preset && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold">The business</h2>
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
              <Label htmlFor="location">Where are they based?</Label>
              <input
                id="location"
                className="input"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="e.g. Kilimani, Nairobi"
              />
            </div>
            <div>
              <Label htmlFor="description">What should the agent say about them?</Label>
              <textarea
                id="description"
                className="input min-h-24"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="One or two sentences customers should know. Leave blank for a short default."
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
                placeholder="https://g.page/r/their-business/review"
              />
            </div>
          </div>
        )}

        {step === 2 && preset && (
          <div className="space-y-5">
            <div>
              <h2 className="text-lg font-semibold">Their agent</h2>
              <p className="mt-1 text-sm text-ink-muted">
                The name and picture customers see, and how it should sound. {preset.title} instructions are added automatically.
              </p>
            </div>
            <div>
              <Label htmlFor="agentName">Agent name</Label>
              <input
                id="agentName"
                className="input"
                value={agentName}
                onChange={(e) => setAgentName(e.target.value)}
                placeholder="e.g. Zuri"
                maxLength={40}
              />
              <div className="mt-2 flex flex-wrap gap-2">
                {NAME_IDEAS.map((idea) => (
                  <button
                    key={idea}
                    type="button"
                    onClick={() => setAgentName(idea)}
                    className="rounded-full border border-line bg-surface px-3 py-1 text-xs font-medium text-ink-muted hover:bg-surface-muted hover:text-ink"
                  >
                    {idea}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <Label>Picture</Label>
              <AvatarPicker value={avatar} onChange={setAvatar} name={agentName} />
            </div>
            <div>
              <Label htmlFor="agentTone">Voice (optional)</Label>
              <input
                id="agentTone"
                className="input"
                value={agentTone}
                onChange={(e) => setAgentTone(e.target.value)}
                placeholder="warm, concise, Kenyan English with a little Swahili"
              />
            </div>
            <div>
              <Label htmlFor="agentNotes">Extra instructions (optional)</Label>
              <textarea
                id="agentNotes"
                className="input min-h-24"
                value={agentNotes}
                onChange={(e) => setAgentNotes(e.target.value)}
                maxLength={1500}
                placeholder="Anything specific to this customer: never offer discounts, always ask about parking, mention the weekend special…"
              />
            </div>
          </div>
        )}

        {step === 3 && preset && (
          <div className="space-y-6">
            <section>
              <h2 className="text-lg font-semibold">{preset.labels.resources}</h2>
              <p className="mb-3 mt-1 text-sm text-ink-muted">Who or what can be booked. Use the customer&apos;s real names.</p>
              <ul className="space-y-2">
                {resources.map((r, index) => (
                  <li key={index} className="flex items-center gap-2">
                    <input
                      className="input"
                      aria-label={`${preset.labels.resource} ${index + 1} name`}
                      value={r.name}
                      onChange={(e) => setResources((prev) => prev.map((x, i) => (i === index ? { ...x, name: e.target.value } : x)))}
                    />
                    {preset.resourceKinds.length > 1 ? (
                      <select
                        className="input max-w-32"
                        aria-label="Type"
                        value={r.kind}
                        onChange={(e) => setResources((prev) => prev.map((x, i) => (i === index ? { ...x, kind: e.target.value } : x)))}
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
                            prev.map((x, i) => (i === index ? { ...x, capacity: e.target.value ? Number(e.target.value) : null } : x)),
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
              <p className="mb-3 mt-1 text-sm text-ink-muted">What they sell, in KES. These are starting points: match them to the customer.</p>
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
                            <input className="input" aria-label="Service name" value={o.name} onChange={(e) => set({ name: e.target.value })} />
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

        {step === 4 && preset && (
          <div className="space-y-6">
            <section>
              <h2 className="text-lg font-semibold">Opening hours</h2>
              <p className="mb-3 mt-1 text-sm text-ink-muted">Customers can only book inside these hours.</p>
              <HoursEditor value={hours} onChange={setHours} />
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
                <p className="mt-1 text-xs text-ink-muted">0 means no deposit.</p>
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
              </div>
            </section>
          </div>
        )}

        {step === 5 && preset && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold">The owner&apos;s login</h2>
            <div className="rounded-xl border border-line bg-surface-muted p-3 text-sm text-ink-muted">
              <strong className="text-ink">{businessName || "This customer"}</strong> · {preset.title} · agent{" "}
              <strong className="text-ink">{agentName || "—"}</strong> · {resources.length} {preset.labels.resources.toLowerCase()} ·{" "}
              {offerings.length} {preset.labels.offerings.toLowerCase()}
            </div>
            <div>
              <Label htmlFor="ownerName">Owner&apos;s name</Label>
              <input id="ownerName" className="input" value={ownerName} onChange={(e) => setOwnerName(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="ownerEmail">Owner&apos;s email</Label>
              <input
                id="ownerEmail"
                className="input"
                type="email"
                value={ownerEmail}
                onChange={(e) => setOwnerEmail(e.target.value)}
              />
              <p className="mt-1 text-xs text-ink-muted">
                This is what they sign in with. Their password is created when you roll them out, not now.
              </p>
            </div>
            {state.error ? (
              <p role="alert" className="rounded-xl border border-danger-600/30 bg-danger-100 px-3 py-2 text-sm text-danger-600">
                {state.error}
              </p>
            ) : null}
          </div>
        )}

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
            {currentProblem && step > 0 ? <span className="hidden text-xs text-ink-muted sm:block">{currentProblem}</span> : null}
            {step < STEPS.length - 1 ? (
              <button type="button" className="btn btn-primary" disabled={currentProblem !== null} onClick={() => setStep((s) => s + 1)}>
                Continue <ArrowRight className="size-4" />
              </button>
            ) : (
              <button type="submit" className="btn btn-primary" disabled={currentProblem !== null || pending}>
                {pending ? "Creating…" : "Create customer"}
              </button>
            )}
          </div>
        </div>
      </form>
    </div>
  );
}
