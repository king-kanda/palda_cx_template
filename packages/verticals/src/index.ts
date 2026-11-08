import { consultancyPreset } from "./consultancy";
import { dentalPreset } from "./dental";
import { salonPreset } from "./salon";
import type { Preset, VerticalId } from "./types";
import { venuePreset } from "./venue";

export * from "./types";
export { venuePreset, salonPreset, dentalPreset, consultancyPreset };

export const PRESETS: Record<VerticalId, Preset> = {
  venue: venuePreset,
  salon: salonPreset,
  dental: dentalPreset,
  consultancy: consultancyPreset,
};

export function isVerticalId(value: string): value is VerticalId {
  return value in PRESETS;
}

export function getPreset(vertical: string): Preset {
  if (!isVerticalId(vertical)) {
    throw new Error(`Unknown vertical preset: ${vertical}`);
  }
  return PRESETS[vertical];
}
