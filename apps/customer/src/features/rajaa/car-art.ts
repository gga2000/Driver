/* eslint-disable @typescript-eslint/no-require-imports -- Metro bundles assets through require() */
import type { ImageSourcePropType } from 'react-native';
import type { IntercityVehicle, VehicleModelKey } from '@driver/contracts';
import { pickCarArt } from './car-art-layouts';

/** One `require` per painted car so Metro bundles it (seat positions live in `car-art-layouts.ts`). */
const CAR_PICTURES: Partial<Record<VehicleModelKey, ImageSourcePropType>> = {
  elantra: require('../../../assets/cars/elantra.webp') as number,
};

/** The driver's own car under the seats, or null for the plain drawn map. */
export function carArtFor(vehicle: Pick<IntercityVehicle, 'modelKey' | 'layout'> | null | undefined) {
  return pickCarArt(vehicle, CAR_PICTURES);
}
