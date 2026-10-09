/**
 * The car under the garage seat map: the same flat saloon the rider sees, seats in the same places
 * (a test keeps this file equal to the customer app's `car-art-layouts.ts`). Partner check-up item 5,
 * Ali 2026-10-09: no glossy pictures. Drawn by `scripts/art/flat-car.py`; front up, driver on the
 * left; points are percent of the picture.
 */
import type { IntercitySeatLayout, IntercityVehicle } from '@driver/contracts';
import type { CarArtLayout } from '@driver/ui';

export interface CarArtEntry extends CarArtLayout {
  /** The seat layout the picture shows. */
  layout: IntercitySeatLayout;
}

/** One flat car per seat layout; a layout with no picture yet keeps the drawn seat map. */
export const CAR_ART_LAYOUTS: Partial<Record<IntercitySeatLayout, CarArtEntry>> = {
  4: {
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

/** The flat car for this run's seat layout, or null so the screen draws the plain `SeatMap` of the same size. */
export function pickCarArt<S>(
  vehicle: Pick<IntercityVehicle, 'layout'> | null | undefined,
  sources: Partial<Record<IntercitySeatLayout, S>>,
  layouts: Partial<Record<IntercitySeatLayout, CarArtEntry>> = CAR_ART_LAYOUTS,
): (CarArtEntry & { source: S }) | null {
  if (!vehicle) return null;
  const entry = layouts[vehicle.layout];
  const source = sources[vehicle.layout];
  if (!entry || source === undefined) return null;
  return { ...entry, source };
}
