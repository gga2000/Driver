import { z } from 'zod';
import { baghdadHour } from './household-budget.js';

/**
 * What a rider sees about the car before and after a driver accepts (ride ideas d1, n1, n2, n6): its
 * real colour, and what it offers. Drivers claim features in the partner app; ops confirm them at the
 * car check; customers only ever see confirmed ones.
 */

/** Car body colours, as riders name them in the street. */
export const VehicleColour = z.enum(['white', 'black', 'silver', 'grey', 'red', 'maroon', 'blue', 'green', 'beige', 'gold', 'brown', 'yellow', 'orange']);
export type VehicleColour = z.infer<typeof VehicleColour>;

/** The colour dot beside the car model: the paint itself, not a brand colour. */
export const VEHICLE_COLOUR_HEX: Record<VehicleColour, string> = {
  white: '#F7F5F0',
  black: '#1C1C1E',
  silver: '#C4C7CC',
  grey: '#7D8085',
  red: '#C62828',
  maroon: '#6E1E2A',
  blue: '#1F4E9C',
  green: '#2E6B3F',
  beige: '#D8C7A3',
  gold: '#C9A24B',
  brown: '#6B4A2F',
  yellow: '#F2C318',
  orange: '#E5731C',
};

/** i18n key of a colour's name («أبيض»…). */
export function vehicleColourKey(c: VehicleColour): `vehicle.colour.${VehicleColour}` {
  return `vehicle.colour.${c}`;
}

/** What a car offers: AC and heating are the loud ones (n1); the rest stay quiet (n2). */
export const VehicleFeature = z.enum(['ac', 'heating', 'family', 'no_smoking', 'big_boot', 'child_seat']);
export type VehicleFeature = z.infer<typeof VehicleFeature>;
export const LOUD_FEATURES: readonly VehicleFeature[] = ['ac', 'heating'];
/** Display order on a card: loud first, then the quiet ones. */
export const FEATURE_ORDER: readonly VehicleFeature[] = ['ac', 'heating', 'family', 'no_smoking', 'big_boot', 'child_seat'];

export function sortFeatures(features: readonly VehicleFeature[]): VehicleFeature[] {
  return FEATURE_ORDER.filter((f) => features.includes(f));
}

/** 1–12, the Baghdad month of an instant. */
function baghdadMonthOf(at: Date): number {
  return new Date(at.getTime() + 3 * 3_600_000).getUTCMonth() + 1;
}

/**
 * Aziziyah's weather by the calendar and the clock (n6; no weather feed): summer afternoons are hot
 * (May–Sep, 10:00–19:59), winter is cold all day (Dec–Feb), and the edge months are cold at night
 * (Nov and Mar, 18:00–07:59). On those days cars with AC or heating are offered rides first.
 */
export function climateAt(at: Date): 'hot' | 'cold' | null {
  const m = baghdadMonthOf(at);
  const h = baghdadHour(at);
  if (m >= 5 && m <= 9 && h >= 10 && h < 20) return 'hot';
  if (m === 12 || m <= 2) return 'cold';
  if ((m === 11 || m === 3) && (h >= 18 || h < 8)) return 'cold';
  return null;
}

/** Night for safety (trip code, «وصل بالسلامة», auto-share): 21:00–05:59 Baghdad. */
export function isNightAt(at: Date): boolean {
  const h = baghdadHour(at);
  return h >= 21 || h < 6;
}
