import type { DepartureCard } from '@driver/contracts';
import { compareDepartures, isBookable } from './logic';

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

/** The cars the lot shows: this garage's bookable departures (as the board lists them), soonest first. */
export function garageLot(departures: readonly DepartureCard[], garageId: string, now: Date): DepartureCard[] {
  return departures.filter((d) => d.garageId === garageId && isBookable(d, now)).sort(compareDepartures);
}

/**
 * `n` bays spread evenly over the lot instead of the first `n` side by side (3.6 m apart, a few px on
 * screen), so each car's bar and its time chip stand clear of the next. Order is kept (soonest first).
 */
export function spreadBays<B extends GarageBay>(bays: readonly B[], n: number): B[] {
  const k = Math.min(Math.max(0, Math.floor(n)), bays.length);
  if (k === 0) return [];
  if (k === bays.length) return [...bays];
  if (k === 1) return [bays[Math.floor((bays.length - 1) / 4)]!];
  return Array.from({ length: k }, (_, i) => bays[Math.round((i * (bays.length - 1)) / (k - 1))]!);
}

/** The top of a seat bar above the ground, as the map package draws it (8.8–10 m, over Gate 1's wave roof). */
export const SEAT_TOP_M = 10;
type Expr = readonly unknown[];
const SEAT_BASE: Expr = ['get', 'base'];
const SEAT_TOP: Expr = ['get', 'hm'];

/**
 * `fill-extrusion-base` / `-height` for the seat bars. `rise` (0 → 1 + stagger·seats) grows each seat from
 * its base to its top, one seat after the next (`stagger` per seat); without it the bars stand full.
 */
export function seatBarPaint(rise?: { t: number; stagger: number }): { base: Expr; height: Expr } {
  if (!rise) return { base: SEAT_BASE, height: SEAT_TOP };
  const p = ['min', 1, ['max', 0.02, ['-', rise.t, ['*', rise.stagger, ['get', 'seat']]]]];
  return { base: SEAT_BASE, height: ['+', SEAT_BASE, ['*', p, ['-', SEAT_TOP, SEAT_BASE]]] };
}

/**
 * About how many screen px the top of a seat bar shows above its car's spot on the ground, so a car's
 * time chip can sit just over its bar (MapLibre projects ground points only). 512 px tiles.
 */
export function barLiftPx(zoom: number, pitchDeg: number, lat: number): number {
  const metresPerPx = (78271.517 * Math.cos((lat * Math.PI) / 180)) / 2 ** zoom;
  return (SEAT_TOP_M / metresPerPx) * Math.sin((pitchDeg * Math.PI) / 180);
}

export const LOT_PITCH = 55;
export const LOT_ZOOM = 18.8;
/**
 * How far the camera turns off looking straight at the hall. Straight on, it looks along every car
 * (the seat bars lie along the cars) and sees each bar end-on; at 40° the bars show their length and
 * the two rows still read apart, with the hall across the lot.
 */
export const LOT_TURN = 40;
/** The one glide into the lot on arrival; then the camera holds still. */
export const LOT_GLIDE_MS = 3000;

/**
 * Where the camera settles over the lot: the middle of the bays, pitched and turned so it looks across
 * the cars toward the hall (the first row stands by the hall and faces away from it, so the hall lies
 * opposite the first bay's heading), a little off straight (`LOT_TURN`). Null without bays.
 */
export function lotCamera(bays: readonly GarageBay[]): { center: [number, number]; bearing: number; pitch: number; zoom: number } | null {
  if (!bays.length) return null;
  const lng = bays.reduce((s, b) => s + b.at[0], 0) / bays.length;
  const lat = bays.reduce((s, b) => s + b.at[1], 0) / bays.length;
  return { center: [lng, lat], bearing: (bays[0]!.bearing + 180 + LOT_TURN) % 360, pitch: LOT_PITCH, zoom: LOT_ZOOM };
}
