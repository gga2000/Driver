/* eslint-disable @typescript-eslint/no-require-imports -- Metro bundles assets through require() */
import type { ImageSourcePropType } from 'react-native';
import type { IntercitySeatLayout, IntercityVehicle } from '@driver/contracts';
import { pickCarArt } from './car-art-layouts';

/** One `require` per flat car so Metro bundles it (seat positions live in `car-art-layouts.ts`). */
const CAR_PICTURES: Partial<Record<IntercitySeatLayout, ImageSourcePropType>> = {
  4: require('../../../assets/cars/sedan.webp') as number,
};

/** The flat car under the seats, or null for the plain drawn map. */
export function carArtFor(vehicle: Pick<IntercityVehicle, 'layout'> | null | undefined) {
  return pickCarArt(vehicle, CAR_PICTURES);
}
