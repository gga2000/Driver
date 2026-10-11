import type { LatLng } from '@driver/contracts';
import type { SafeStop } from '@driver/map/pieces/walk';
import type { Spot } from './logic';

/**
 * Map idea N10 «امشي دقيقة للشارع العام»: when the pickup pin is in an alley, the choose screen
 * offers the nearest safe stop on a main road (a landmark when one is there) and a dotted walk to it.
 * The stop itself comes from the map (`safeStopFor` in `@driver/map/pieces/walk`, fed the roads the map
 * has drawn); this file holds the ride-side rules: how it reads and what the pickup becomes.
 */

/** A road as the map hands it over (`BaseMap`'s `onRoads`) and the stop the map finds (`safeStopFor`). */
export type { Road as WalkRoad, SafeStop } from '@driver/map/pieces/walk';

/** A calm walking pace with a bag or a child, metres a minute. */
export const WALK_M_PER_MIN = 70;

export function stopLatLng(s: Pick<SafeStop, 'stop'>): LatLng {
  return { lng: s.stop[0], lat: s.stop[1] };
}

/** Whole minutes of walking, at least one («امشي دقيقة»). */
export function walkMinutes(walkM: number): number {
  return Math.max(1, Math.round(walkM / WALK_M_PER_MIN));
}

/** The walk as people say it: to the nearest 10 m, at least 10. */
export function walkMetres(walkM: number): number {
  return Math.max(10, Math.round(walkM / 10) * 10);
}

/**
 * How many minutes sooner the nearest free car reaches the stop than the pin, or null when it isn't
 * sooner by a whole minute (or either clock is unknown): «أسرع بـ» is said only when it is true.
 */
export function fasterBy(pinMinutes: number | null | undefined, stopMinutes: number | null | undefined): number | null {
  if (pinMinutes == null || stopMinutes == null) return null;
  const d = Math.round(pinMinutes - stopMinutes);
  return d >= 1 ? d : null;
}

/** The offer shows on street pickup only, never in simple mode, and not after «خليني بمكاني». */
export function showWalkOffer(i: { stop: SafeStop | null; mode: 'street' | 'door'; simple: boolean; dismissed: boolean; walking: boolean }): boolean {
  return i.stop !== null && i.mode === 'street' && !i.simple && !i.dismissed && !i.walking;
}

/**
 * The pickup the rider walks to: the stop's pin in the stop's own zone (it prices the ride, and a
 * stop can sit across a zone line), named after the landmark facing it when there is one.
 */
export function walkStopSpot(stop: SafeStop, zoneId: string, title: string, subtitle: string): Spot {
  const pin = stopLatLng(stop);
  return { id: `walk:${pin.lat.toFixed(5)},${pin.lng.toFixed(5)}`, kind: 'pin', title, subtitle, zoneId, pin };
}

/** A pickup made by «تمام، أمشي هسة» (its id says so), so the screen can offer the way back. */
export function isWalkStop(spot: Pick<Spot, 'id'> | null | undefined): boolean {
  return !!spot && spot.id.startsWith('walk:');
}
