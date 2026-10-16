import { z } from 'zod';

/**
 * The cars Aziziyah's intercity drivers actually run (Ali, 2026-10-07: "most taxi cars are Hyundai
 * Elantra or Toyota Corolla"). A driver picks his model when he puts his car on a run; the rider's
 * seat screen then draws that exact car under the seats. A model nobody listed is `other`: the
 * driver types it, and the rider sees the plain drawn car of the same size.
 *
 * `layouts` are the seat maps the model can carry (`SEAT_ROWS` in `@driver/ui`): a saloon is 4,
 * a captain-chair SUV 6, a bench van 7. The API refuses a model on a layout it can't have.
 */
export const VehicleModelKey = z.enum(['elantra', 'corolla', 'cerato', 'sonata', 'accent', 'tahoe', 'gmc', 'starex', 'other']);
export type VehicleModelKey = z.infer<typeof VehicleModelKey>;

export type VehicleModelKind = 'saloon' | 'suv' | 'van';

export interface VehicleModelInfo {
  key: VehicleModelKey;
  kind: VehicleModelKind | null;
  /** Seat layouts this model can carry; empty for `other` (any). */
  layouts: readonly (4 | 6 | 7)[];
}

/** Most common first: the partner picker lists them in this order. */
export const VEHICLE_MODELS: readonly VehicleModelInfo[] = [
  { key: 'elantra', kind: 'saloon', layouts: [4] },
  { key: 'corolla', kind: 'saloon', layouts: [4] },
  { key: 'cerato', kind: 'saloon', layouts: [4] },
  { key: 'sonata', kind: 'saloon', layouts: [4] },
  { key: 'accent', kind: 'saloon', layouts: [4] },
  { key: 'tahoe', kind: 'suv', layouts: [6] },
  { key: 'gmc', kind: 'van', layouts: [7] },
  { key: 'starex', kind: 'van', layouts: [7] },
  { key: 'other', kind: null, layouts: [] },
];

export function vehicleModelInfo(key: VehicleModelKey): VehicleModelInfo {
  return VEHICLE_MODELS.find((m) => m.key === key)!;
}

/** Whether a model can carry this seat layout (`other` carries any). */
export function modelFitsLayout(key: VehicleModelKey, layout: 4 | 6 | 7): boolean {
  const m = vehicleModelInfo(key);
  return m.layouts.length === 0 || m.layouts.includes(layout);
}

/** The listed models a car of this layout can be, in picker order (`other` last). */
export function modelsForLayout(layout: 4 | 6 | 7): VehicleModelKey[] {
  return VEHICLE_MODELS.filter((m) => modelFitsLayout(m.key, layout)).map((m) => m.key);
}
