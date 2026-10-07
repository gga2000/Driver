import { CLASS_FEATURES, LOUD_FEATURES, sortFeatures, VehicleColour, type FleetVehicle, type VehicleClass, type VehicleFeature } from '@driver/contracts';
import type { MessageKey } from '@driver/i18n';

/**
 * Pure rules behind «مميزات سيارتك» and the model/colour fields of a new vehicle (ride step 3: d1,
 * n1, n2). Plain Node, unit-tested.
 */

/** Colours in the order the picker shows them: the common Iraqi car colours first. */
export const COLOUR_ORDER: readonly VehicleColour[] = VehicleColour.options;

export function colourKey(c: VehicleColour): MessageKey {
  return `vehicle.colour.${c}`;
}

export function featureKey(f: VehicleFeature): MessageKey {
  return `vehicle.feature.${f}`;
}

/** One line under each feature: what ticking it promises the rider. */
export const FEATURE_HINT_KEY: Record<VehicleFeature, MessageKey> = {
  ac: 'partner.vehicle_feature_ac_hint',
  heating: 'partner.vehicle_feature_heating_hint',
  family: 'partner.vehicle_feature_family_hint',
  no_smoking: 'partner.vehicle_feature_no_smoking_hint',
  big_boot: 'partner.vehicle_feature_big_boot_hint',
  child_seat: 'partner.vehicle_feature_child_seat_hint',
};

/** What his kind of vehicle can offer, split into the loud pair (AC, heating) and the quiet rest. */
export function offeredFeatures(vehicleClass: VehicleClass): { loud: VehicleFeature[]; quiet: VehicleFeature[] } {
  const all = sortFeatures(CLASS_FEATURES[vehicleClass]);
  return { loud: all.filter((f) => LOUD_FEATURES.includes(f)), quiet: all.filter((f) => !LOUD_FEATURES.includes(f)) };
}

/** A car with nothing to offer (a bike) has no «مميزات سيارتك». */
export function hasFeatures(vehicleClass: VehicleClass): boolean {
  return CLASS_FEATURES[vehicleClass].length > 0;
}

/** Where a saved feature stands: riders see it (`confirmed`), it waits for the car check, or it is off. */
export type FeatureState = 'confirmed' | 'pending' | 'off';

export function featureState(v: Pick<FleetVehicle, 'features' | 'featuresConfirmed'>, f: VehicleFeature): FeatureState {
  if (v.featuresConfirmed.includes(f)) return 'confirmed';
  return v.features.includes(f) ? 'pending' : 'off';
}

/** Ticks or unticks one feature; the list stays in display order. */
export function toggleFeature(picked: readonly VehicleFeature[], f: VehicleFeature): VehicleFeature[] {
  return sortFeatures(picked.includes(f) ? picked.filter((x) => x !== f) : [...picked, f]);
}

/** The ticks differ from what is saved (the save button wakes up). */
export function featuresChanged(saved: readonly VehicleFeature[], picked: readonly VehicleFeature[]): boolean {
  const a = sortFeatures(saved);
  const b = sortFeatures(picked);
  return a.length !== b.length || a.some((f, i) => f !== b[i]);
}

/** The account row: what riders see now, and what waits for the car check. */
export function featuresSummary(v: Pick<FleetVehicle, 'features' | 'featuresConfirmed'>): { confirmed: VehicleFeature[]; pending: VehicleFeature[] } {
  return { confirmed: v.features.filter((f) => v.featuresConfirmed.includes(f)), pending: v.features.filter((f) => !v.featuresConfirmed.includes(f)) };
}

/** Riders look for a car by model and colour; a bike needs neither, a tuktuk only its colour. */
export function modelRequired(vehicleClass: VehicleClass): boolean {
  return vehicleClass !== 'bike' && vehicleClass !== 'tuktuk';
}

export function colourRequired(vehicleClass: VehicleClass): boolean {
  return vehicleClass !== 'bike';
}

export const MODEL_MAX = 40;

/** Trimmed, single-spaced model text ("تويوتا  كورولا " → "تويوتا كورولا"). */
export function normalizeModel(model: string): string {
  return model.replace(/\s+/g, ' ').trim();
}

/** Empty is fine where the model is optional; anything typed needs 2–40 characters. */
export function isModelValid(model: string, vehicleClass: VehicleClass): boolean {
  const m = normalizeModel(model);
  if (m.length === 0) return !modelRequired(vehicleClass);
  return m.length >= 2 && m.length <= MODEL_MAX;
}
