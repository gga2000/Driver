import type { LatLng } from '@driver/contracts';
import { distanceM } from './geo';
import type { TFn } from './timeline';

/** Closer than this, he is "at your door" rather than "N metres from your door". */
export const AT_DOOR_M = 15;

/**
 * Joy f18 (L-10): how far the waiting courier stands from the customer's door, rounded to 5 m so the
 * number reads as a guide, not a GPS readout. Null without his fix or the door pin.
 */
export function metresFromDoor(courier: LatLng | null, door: LatLng | null): number | null {
  if (!courier || !door) return null;
  return Math.round(distanceM(courier, door) / 5) * 5;
}

/**
 * «حيدر واقف هنا · 40 متر من بابك», or «حيدر واقف عند بابك» when he is right there or unknown. An
 * order placed «بالشارع» (HUNT-02) is met on the street near the pin: «حيدر ينطرك بالشارع قريب من الدبوس».
 */
export function standingLine(t: TFn, name: string | null, metres: number | null, street = false): string {
  const who = name ?? t('track.courier_fallback');
  if (street) return t('unreachable.standing_street', { name: who });
  return metres !== null && metres >= AT_DOOR_M ? t('unreachable.standing_far', { name: who, metres }) : t('unreachable.standing_door', { name: who });
}

/** Milliseconds until the courier may leave (the server's `failAllowedAt`, already extended by «أني نازل»). */
export function unreachableLeftMs(failAllowedAt: Date, now: number): number {
  return Math.max(0, failAllowedAt.getTime() - now);
}
