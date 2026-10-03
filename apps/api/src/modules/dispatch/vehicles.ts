import type { VehicleClass, Vertical } from '@driver/contracts';

interface Fit {
  preferred: readonly VehicleClass[];
  acceptable: readonly VehicleClass[];
}

/** Which vehicles serve which vertical. Preferred scores 1 on the 10-point "vehicle fit" term, acceptable 0.5. */
export const VEHICLE_FIT: Record<Vertical, Fit> = {
  taxi: { preferred: ['car'], acceptable: ['car', 'suv'] },
  tuktuk: { preferred: ['tuktuk'], acceptable: ['tuktuk'] },
  parcel: { preferred: ['bike', 'tuktuk'], acceptable: ['bike', 'tuktuk', 'car'] },
  food: { preferred: ['bike'], acceptable: ['bike', 'tuktuk', 'car'] },
  grocery: { preferred: ['bike', 'tuktuk'], acceptable: ['bike', 'tuktuk', 'car'] },
  errand: { preferred: ['bike'], acceptable: ['bike', 'tuktuk', 'car'] },
  intercity: { preferred: ['intercity', 'car'], acceptable: ['intercity', 'car', 'suv', 'van'] },
  khat: { preferred: ['van', 'tuktuk'], acceptable: ['van', 'tuktuk', 'car', 'suv'] },
};

/** 1 preferred, 0.5 acceptable, 0 cannot serve. */
export function vehicleFit(vertical: Vertical, vehicle: VehicleClass): number {
  const fit = VEHICLE_FIT[vertical];
  if (fit.preferred.includes(vehicle)) return 1;
  if (fit.acceptable.includes(vehicle)) return 0.5;
  return 0;
}

/** Spec §3 batching: max 2 orders per bike, 3 per tuktuk; other vehicles fall back to the city config's `maxBatch`. */
export const VEHICLE_BATCH_LIMIT: Partial<Record<VehicleClass, number>> = { bike: 2, tuktuk: 3 };

export function batchLimit(vehicle: VehicleClass, configMaxBatch: number): number {
  return VEHICLE_BATCH_LIMIT[vehicle] ?? configMaxBatch;
}
