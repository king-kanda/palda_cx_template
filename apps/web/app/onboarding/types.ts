/** Plain, serialisable preset data sent from the server page to the client wizard. */
export type PresetDTO = {
  id: string;
  title: string;
  tagline: string;
  labels: { resource: string; resources: string; offering: string; offerings: string };
  resourceKinds: string[];
  resources: { name: string; kind: string; capacity: number | null }[];
  offerings: {
    name: string;
    resourceKind: string;
    durationMin: number;
    basePriceKes: number;
    bufferBeforeMin: number;
    bufferAfterMin: number;
    attributes: Record<string, unknown>;
  }[];
  workingHours: Record<string, { open: string; close: string } | null>;
  depositPct: number;
  cancellationNoticeHours: number;
};
