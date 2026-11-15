import Link from "next/link";
import { PRESETS, VERTICAL_IDS } from "@garden/verticals";
import { LogoMark } from "@/components/ui";
import { onboardingStatus } from "@/lib/onboarding";
import { OnboardingWizard } from "./wizard";
import type { PresetDTO } from "./types";

export const metadata = { title: "Set up your business · Palda CX" };
export const dynamic = "force-dynamic";

export default function OnboardingPage() {
  const status = onboardingStatus();

  if (!status.enabled) {
    return (
      <main className="grid min-h-screen place-items-center px-4">
        <div className="card max-w-md p-8 text-center">
          <LogoMark className="mx-auto mb-3 size-12 text-brand-800" />
          <h1 className="text-xl font-semibold">Setup is invite-only</h1>
          <p className="mt-2 text-sm text-ink-muted">
            New businesses can't sign up on this server. Ask the team for access, or sign in if you already have an
            account.
          </p>
          <Link className="btn btn-primary mt-5" href="/login">
            Sign in
          </Link>
        </div>
      </main>
    );
  }

  const presets: PresetDTO[] = VERTICAL_IDS.map((id) => {
    const preset = PRESETS[id];
    return {
      id,
      title: preset.title,
      tagline: preset.tagline,
      labels: {
        resource: preset.labels.resource,
        resources: preset.labels.resources,
        offering: preset.labels.offering,
        offerings: preset.labels.offerings,
      },
      resourceKinds: preset.resourceKinds,
      resources: preset.starterResources.map((r) => ({ name: r.name, kind: r.kind, capacity: r.capacity ?? null })),
      offerings: preset.offerings.map((o) => ({
        name: o.name,
        resourceKind: o.resourceKind,
        durationMin: o.durationMin,
        basePriceKes: o.basePriceKes,
        bufferBeforeMin: o.bufferBeforeMin ?? 0,
        bufferAfterMin: o.bufferAfterMin ?? 0,
        attributes: o.attributes ?? {},
      })),
      workingHours: Object.fromEntries(
        Object.entries(preset.defaults.workingHours).map(([day, hours]) => [day, hours ?? null]),
      ),
      depositPct: preset.defaults.depositPct,
      cancellationNoticeHours: preset.defaults.cancellationNoticeHours,
    };
  });

  return <OnboardingWizard presets={presets} codeRequired={status.codeRequired} />;
}
