import { PRESETS, VERTICAL_IDS } from "@garden/verticals";
import { requireEngineAdmin } from "@/lib/engine-auth";
import { NewCustomerWizard } from "./wizard";
import type { PresetDTO } from "./types";

export const metadata = { title: "New customer · Engine · Palda CX" };

export default async function NewCustomerPage() {
  await requireEngineAdmin();
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
  return <NewCustomerWizard presets={presets} />;
}
