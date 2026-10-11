import type { DepartureCard } from '@driver/contracts';
import { compareDepartures } from './logic';

/** A parking bay in a 3D garage: where a car stands and which way it faces (`[lng, lat]`). */
export interface GarageBay {
  at: [number, number];
  bearing: number;
}

/** One car standing in the garage, as the seat bars draw it. `id` is the departure id (tap → book it). */
export interface GarageCar {
  id: string;
  at: [number, number];
  bearing: number;
  seats: number;
  taken: number;
}

/** Our garage ids → the map's garage keys (`GARAGE_BAYS`). Garages without a 3D model draw no cars. */
export function garageKey(garageId: string): 'bab1' | 'bab2' | 'souq' | null {
  if (garageId === 'mp_garage_bab1') return 'bab1';
  if (garageId === 'mp_garage_bab2') return 'bab2';
  if (garageId === 'mp_garage_souq') return 'souq';
  return null;
}

/**
 * Map idea N12 «مقاعد تشوفها بالكراج»: the garage's bookable cars in board order (soonest first), one
 * per bay. More cars than bays: the later ones stay on the list below the map. Free and taken come
 * from the board's own seat counts, so the bars never say more than the booking sheet.
 */
export function garageCars(departures: readonly DepartureCard[], garageId: string, bays: readonly GarageBay[]): GarageCar[] {
  const here = departures.filter((d) => d.garageId === garageId).sort(compareDepartures);
  return here.slice(0, bays.length).map((d, i) => ({
    id: d.id,
    at: bays[i]!.at,
    bearing: bays[i]!.bearing,
    seats: d.fill.seatsTotal,
    taken: Math.max(0, d.fill.seatsTotal - d.fill.free),
  }));
}
