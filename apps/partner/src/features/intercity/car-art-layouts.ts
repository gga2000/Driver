/**
 * Where the seats sit on each car picture: the same painted cars the rider sees on his seat screen
 * (Ali, 2026-10-07), so the driver's garage page shows his own car exactly as his riders see it.
 * Pure data for plain Node tests; the pictures are bundled in `car-art.ts`. The points match the
 * customer app's `car-art-layouts.ts` (a test keeps the two equal).
 *
 * Every picture is a top-down painting, front up, driver on the left, on a flat cream backdrop.
 * Points are percent of the picture (0–100).
 */
import type { IntercitySeatLayout, IntercityVehicle, VehicleModelKey } from '@driver/contracts';
import type { CarArtLayout } from '@driver/ui';

export interface CarArtEntry extends CarArtLayout {
  /** The seat layout the picture shows; a run on another layout keeps the drawn seat map. */
  layout: IntercitySeatLayout;
}

export const CAR_ART_LAYOUTS: Partial<Record<VehicleModelKey, CarArtEntry>> = {
  elantra: {
    layout: 4,
    aspect: 688 / 1024,
    background: '#FEF6E4',
    driver: { x: 36.3, y: 43.5 },
    seats: {
      front: { x: 63.2, y: 43.5 },
      back_left: { x: 35.5, y: 64.5 },
      back_middle: { x: 49.5, y: 64.5 },
      back_right: { x: 64, y: 64.5 },
    },
  },
};

/** The picture for this run's car, or null (no model, no picture yet, or another seat layout). */
export function pickCarArt<S>(
  vehicle: Pick<IntercityVehicle, 'modelKey' | 'layout'> | null | undefined,
  sources: Partial<Record<VehicleModelKey, S>>,
  layouts: Partial<Record<VehicleModelKey, CarArtEntry>> = CAR_ART_LAYOUTS,
): (CarArtEntry & { source: S }) | null {
  const key = vehicle?.modelKey;
  if (!vehicle || !key) return null;
  const entry = layouts[key];
  const source = sources[key];
  if (!entry || source === undefined || entry.layout !== vehicle.layout) return null;
  return { ...entry, source };
}
