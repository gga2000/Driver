import { intercityRoad, roadProgress, type IntercityRoad, type RoadCity, type RoadDirection, type RoadGarage } from '@driver/map/pieces/road';
import { garageKey } from './garage-cars';
import type { LatLngLike } from './logic';

/**
 * «طريق بغداد» (map idea N13): the الرجعة trip on the real road. Which road (from the booking's garage,
 * city and direction), the towns on it in passing order with their times, the rider's own stop and the
 * checkpoints that sit on it, where the car is, and what comes next. Times are the corridor's minutes on
 * the road spread over the distance along the real road (the same pace rule as `road.ts`, by metres
 * instead of the straight line); once the car sends its position, from how far along it is. Pure.
 */

const MIN = 60_000;
/** A checkpoint counts as "on the road" this close to it; within this of a town it is that town's note. */
const ON_ROAD_M = 1500;
/** The strip on the pass shows about this much road each side of the car. */
export const STRIP_HALF_M = 10_000;

type LngLat = [number, number];

/** The road for a trip: the Aziziyah garage (where it leaves from, or where a trip back ends), the far city and the way. */
export function roadKeyOf({ garageId, endGarageId, cityId, direction }: { garageId: string; endGarageId: string | null; cityId: string; direction: RoadDirection }): { garage: RoadGarage; city: RoadCity; direction: RoadDirection } | null {
  if (cityId !== 'baghdad' && cityId !== 'kut') return null;
  const home = direction === 'from_aziziyah' ? garageId : endGarageId;
  // Each city's own garage at home when the trip names none we know («كراج بغداد», «كراج الكوت»).
  const garage = garageKey(home ?? '') ?? (cityId === 'kut' ? 'bab2' : 'bab1');
  return { garage, city: cityId, direction };
}

/** The road for the share page, which knows only the two cities: each city's own garage at home. */
export function roadForCities(fromCityId: string, toCityId: string): IntercityRoad | null {
  const direction: RoadDirection = fromCityId === 'aziziyah' ? 'from_aziziyah' : 'to_aziziyah';
  const city = direction === 'from_aziziyah' ? toCityId : fromCityId;
  const key = roadKeyOf({ garageId: '', endGarageId: null, cityId: city, direction });
  return key ? intercityRoad(key.garage, key.city, key.direction) : null;
}

export type TripStopKind = 'start' | 'town' | 'checkpoint' | 'my_stop' | 'end';
export type TripPoint = LatLngLike & { id: string; kind: 'checkpoint' | 'my_stop'; name: string };
export type TripStop = { id: string; kind: TripStopKind; name: string; m: number; at: Date; passed: boolean; checkpoint?: boolean };

export interface RoadTrip {
  road: IntercityRoad;
  /** Garage, towns, the rider's stop and checkpoints on the road, the far end; in passing order. */
  stops: TripStop[];
  /** Metres driven; null before the car has left (or without a fix). */
  carM: number | null;
  arriveAt: Date;
  minutesLeft: number;
  /** The next stop ahead (a town, the rider's stop or the end) and the minutes to it. */
  next: TripStop | null;
  nextInMin: number | null;
  /** The last town (or the garage) behind the car. */
  lastPassed: TripStop | null;
  /** How the road is going, only from the car's own pace since it left; null when that says nothing. */
  pace: 'moving' | 'slow' | null;
}

/** Local flat metres from `o`, good over a few hundred km at this latitude. */
function local(o: LngLat, p: LngLat): [number, number] {
  return [(p[0] - o[0]) * 111320 * Math.cos((o[1] * Math.PI) / 180), (p[1] - o[1]) * 110540];
}

/** Metres from `p` to the nearest point of the road. */
export function offRoadM(path: readonly LngLat[], p: LngLat): number {
  let best = Infinity;
  for (let i = 1; i < path.length; i++) {
    const a = local(p, path[i - 1]!);
    const b = local(p, path[i]!);
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, -(a[0] * dx + a[1] * dy) / len2));
    best = Math.min(best, Math.hypot(a[0] + t * dx, a[1] + t * dy));
  }
  return best;
}

function cumulative(path: readonly LngLat[]): number[] {
  const out = [0];
  for (let i = 1; i < path.length; i++) {
    const d = local(path[i - 1]!, path[i]!);
    out.push(out[i - 1]! + Math.hypot(d[0], d[1]));
  }
  return out;
}

/** The point `m` metres along the road (scaled to the road's own length). */
export function pointAt(road: IntercityRoad, m: number): LngLat {
  const cum = cumulative(road.path);
  const total = cum[cum.length - 1]!;
  const target = (Math.max(0, Math.min(road.totalM, m)) / road.totalM) * total;
  for (let i = 1; i < road.path.length; i++) {
    if (cum[i]! >= target) {
      const a = road.path[i - 1]!, b = road.path[i]!;
      const f = cum[i] === cum[i - 1] ? 0 : (target - cum[i - 1]!) / (cum[i]! - cum[i - 1]!);
      return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
    }
  }
  return road.path[road.path.length - 1]!;
}

/** Bounds of the road between two distances along it: [[west, south], [east, north]]. */
export function stretchBounds(road: IntercityRoad, fromM: number, toM: number): [LngLat, LngLat] {
  const cum = cumulative(road.path);
  const k = cum[cum.length - 1]! / road.totalM;
  const pts: LngLat[] = [pointAt(road, fromM), pointAt(road, toM)];
  road.path.forEach((p, i) => {
    if (cum[i]! >= fromM * k && cum[i]! <= toM * k) pts.push(p);
  });
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  return [[Math.min(...xs), Math.min(...ys)], [Math.max(...xs), Math.max(...ys)]];
}

/** The strip on the pass: about 20 km of road around the car (the first 20 km before it leaves). */
export function stripBounds(road: IntercityRoad, carM: number | null): [LngLat, LngLat] {
  const m = carM ?? 0;
  const from = Math.max(0, Math.min(m - STRIP_HALF_M, road.totalM - 2 * STRIP_HALF_M));
  return stretchBounds(road, from, Math.min(road.totalM, from + 2 * STRIP_HALF_M));
}

/** Compass bearing (degrees) of the road ahead of `m`: the window view looks this way. */
export function bearingAhead(road: IntercityRoad, m: number, aheadM = 2500): number {
  const a = pointAt(road, Math.min(m, road.totalM - 50));
  const b = pointAt(road, Math.min(road.totalM, m + aheadM));
  const [x, y] = local(a, b);
  return ((Math.atan2(x, y) * 180) / Math.PI + 360) % 360;
}

export function roadTrip({
  road,
  startName,
  points,
  departAt,
  departedAt = null,
  travelMin,
  car,
  now,
}: {
  road: IntercityRoad;
  /** The garage's name (the road's first town is where it leaves from). */
  startName: string;
  /** The corridor's checkpoints and the rider's own stop (a stop off the fast road still shows, at its place along it). */
  points: readonly TripPoint[];
  departAt: Date;
  /** When the car actually left; with the car's fix the stops behind are timed between it and now. */
  departedAt?: Date | null;
  travelMin: number;
  /** The car's fix once it has left; null before that. */
  car: LatLngLike | null;
  now: Date;
}): RoadTrip {
  const travelMs = travelMin * MIN;
  const carM = car ? roadProgress(road, [car.lng, car.lat]).m : null;
  const carFrac = carM === null ? null : carM / road.totalM;
  const t0 = carFrac !== null ? now.getTime() - carFrac * travelMs : Math.max(departAt.getTime(), now.getTime());
  // Ahead of the car: the corridor's pace from now. Behind it: between the real leave time and now, in proportion.
  const at = (m: number): number => {
    const frac = m / road.totalM;
    if (carFrac === null) return t0 + frac * travelMs;
    if (frac > carFrac) return now.getTime() + (frac - carFrac) * travelMs;
    const left = departedAt ? departedAt.getTime() : t0;
    return carFrac === 0 ? left : left + (frac / carFrac) * (now.getTime() - left);
  };
  const stop = (id: string, kind: TripStopKind, name: string, m: number): TripStop => ({ id, kind, name, m, at: new Date(at(m)), passed: carM !== null && m <= carM });

  const stops: TripStop[] = [stop('start', 'start', startName, 0)];
  road.towns.forEach((tw, i) => stops.push(stop(`town_${i}`, tw.kind === 'city' ? 'end' : 'town', tw.nameAr, tw.m)));
  for (const p of points) {
    const ll: LngLat = [p.lng, p.lat];
    if (p.kind === 'checkpoint' && offRoadM(road.path, ll) > ON_ROAD_M) continue;
    const m = roadProgress(road, ll).m;
    // A checkpoint at a town is that town's note, not a row of its own.
    const town = p.kind === 'checkpoint' ? stops.find((s) => s.kind !== 'start' && Math.abs(s.m - m) < ON_ROAD_M) : undefined;
    if (town) {
      town.checkpoint = true;
      continue;
    }
    stops.push(stop(p.id, p.kind, p.name, Math.min(m, road.totalM - 1)));
  }
  stops.sort((a, b) => a.m - b.m || (a.kind === 'start' ? -1 : b.kind === 'start' ? 1 : 0));

  const arriveAt = new Date(at(road.totalM));
  const progress = carM === null ? null : roadProgress(road, { m: carM });
  // The next stop: the first one ahead of the car (a town the car is at counts as passed, like the piece's).
  const nextM = progress?.next?.town.m ?? null;
  const next = carM === null ? (stops[1] ?? null) : (stops.find((s) => !s.passed && s.m > carM && (nextM === null || s.m <= nextM)) ?? null);
  const behind = stops.filter((s) => s.passed && s.kind !== 'checkpoint');
  const lastPassed = carM === null ? null : (behind[behind.length - 1] ?? stops[0]!);
  // The car's own average since it left, against the corridor's: only said when it is clear either way.
  let pace: RoadTrip['pace'] = null;
  if (carM !== null && departedAt && carM > 5000) {
    const elapsedMin = (now.getTime() - departedAt.getTime()) / MIN;
    if (elapsedMin >= 10) {
      const ratio = carM / elapsedMin / (road.totalM / travelMin);
      pace = ratio >= 0.85 ? 'moving' : ratio < 0.6 ? 'slow' : null;
    }
  }
  return {
    road,
    stops,
    carM,
    arriveAt,
    minutesLeft: Math.max(0, Math.ceil((arriveAt.getTime() - now.getTime()) / MIN)),
    next,
    nextInMin: next ? Math.max(1, Math.ceil((next.at.getTime() - now.getTime()) / MIN)) : null,
    lastPassed,
    pace,
  };
}

/**
 * The family page's road (it has no corridor minutes): the car's fix and the server's arrival time give
 * the pace for the road ahead (the times behind are at that pace too). Null without a fix or an arrival.
 */
export function sharedRoadTrip({ road, startName, car, eta, now }: { road: IntercityRoad; startName: string; car: (LatLngLike & { at: Date }) | null; eta: Date | null; now: Date }): RoadTrip | null {
  if (!car || !eta) return null;
  const carM = roadProgress(road, [car.lng, car.lat]).m;
  const leftM = Math.max(1, road.totalM - carM);
  // The live stream can hand the dates over as strings: read them either way.
  const fixAt = Math.min(new Date(car.at).getTime(), now.getTime());
  const msPerM = Math.max(0, new Date(eta).getTime() - fixAt) / leftM;
  const travelMin = (msPerM * road.totalM) / MIN;
  if (!Number.isFinite(travelMin) || travelMin <= 0) return null;
  // Timed from the fix: what is ahead of the car is "now + the rest at this pace".
  return roadTrip({ road, startName, points: [], departAt: now, departedAt: null, travelMin, car, now: new Date(fixAt) });
}

/** What a booking's road needs from the network: the corridor (city, minutes, checkpoints) and the garages. */
export interface RoadNetwork {
  corridors: readonly { id: string; cityId: string; travelMin: number; checkpoints: readonly (LatLngLike & { id: string; nameAr: string })[] }[];
  garages: readonly (LatLngLike & { id: string; cityId: string })[];
}

/**
 * The real road for a الرجعة booking, or null when its corridor has none (or the network is not read
 * yet). `endGarageId` is the far end's garage (the trip back ends at one of Aziziyah's).
 */
export function bookingRoadTrip({
  departure,
  pickup,
  network,
  endGarageId,
  car,
  now,
  startName,
  stopName,
  checkpointName,
}: {
  departure: { garageId: string; corridorId: string; direction: RoadDirection; departAt: Date; departedAt: Date | null; state: string };
  pickup: LatLngLike & { kind: string };
  network: RoadNetwork | null | undefined;
  endGarageId: string | null;
  car: LatLngLike | null;
  now: Date;
  startName: string;
  stopName: string;
  checkpointName: (nameAr: string) => string;
}): RoadTrip | null {
  const corridor = network?.corridors.find((c) => c.id === departure.corridorId);
  if (!corridor) return null;
  const key = roadKeyOf({ garageId: departure.garageId, endGarageId, cityId: corridor.cityId, direction: departure.direction });
  if (!key) return null;
  const road = intercityRoad(key.garage, key.city, key.direction);
  const points: TripPoint[] = [
    ...corridor.checkpoints.map((c): TripPoint => ({ id: c.id, kind: 'checkpoint', name: checkpointName(c.nameAr), lat: c.lat, lng: c.lng })),
    ...(pickup.kind !== 'garage' ? [{ id: 'my_stop', kind: 'my_stop' as const, name: stopName, lat: pickup.lat, lng: pickup.lng }] : []),
  ];
  // The car's fix counts only once it has left (before that it is driving to the garage).
  const departed = departure.state === 'departed';
  return roadTrip({ road, startName, points, departAt: departure.departAt, departedAt: departure.departedAt, travelMin: corridor.travelMin, car: departed ? car : null, now });
}
