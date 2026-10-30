import { haversineM, type LatLng } from '@driver/contracts';
import type { Spot } from './logic';

/**
 * The map-led booking (Ali 2026-10-17, the "Mix" concept): the map fills the screen and asks one
 * thing at a time, the pickup under the pin, then the drop-off, then taxi or tuktuk. This file holds
 * the rules those steps share: what the place under the pin is called and when it is still the place
 * he already had.
 */

export type RideStep = 'pickup' | 'dropoff';

/** The three steps the dots count: pickup, drop-off, the vehicle (on the choose screen). */
export const RIDE_STEPS = 3;

/** A pin left within this of the place he had (his home, a saved place) is still that place. */
export const KEEP_SPOT_M = 25;

/** A landmark this close names the pin: «قرب جامع شارع 30». */
export const NAME_NEAR_M = 150;

/** The nearest named place within `maxM` of the pin, or null. */
export function nearestNamed(pin: LatLng, spots: readonly Spot[], maxM = NAME_NEAR_M): Spot | null {
  let best: Spot | null = null;
  let bestM = maxM;
  for (const s of spots) {
    const m = haversineM(pin, s.pin);
    if (m <= bestM) {
      best = s;
      bestM = m;
    }
  }
  return best;
}

/**
 * The place the pin stands on: the place he already had when the pin is still on it (so «البيت»
 * stays his home), else a pin spot named after the landmark beside it, or after its area.
 */
export function spotAtPin(i: {
  pin: LatLng;
  zoneId: string;
  keep: Spot | null;
  named: Spot | null;
  zoneName: string;
  nearLabel: (place: string) => string;
  pinLabel: string;
}): Spot {
  if (i.keep && haversineM(i.keep.pin, i.pin) <= KEEP_SPOT_M) return i.keep;
  return {
    id: `pin:${i.pin.lat.toFixed(5)},${i.pin.lng.toFixed(5)}`,
    kind: 'pin',
    title: i.named ? i.nearLabel(i.named.title) : i.zoneName,
    subtitle: i.named ? i.zoneName : i.pinLabel,
    zoneId: i.zoneId,
    pin: i.pin,
  };
}

/** The quick places under the drop-off search: the smart picks first, then saved and recent, three at most, never where he stands. */
export function quickPlaces(i: { picks: readonly Spot[]; saved: readonly Spot[]; recent: readonly Spot[]; pickup: Spot | null; max?: number }): Spot[] {
  const out: Spot[] = [];
  for (const s of [...i.picks, ...i.saved, ...i.recent]) {
    if (out.length >= (i.max ?? 3)) break;
    if (out.some((o) => o.id === s.id || haversineM(o.pin, s.pin) < KEEP_SPOT_M)) continue;
    if (i.pickup && haversineM(i.pickup.pin, s.pin) < 150) continue;
    out.push(s);
  }
  return out;
}
