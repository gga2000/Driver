import { GARAGE_ORDER, type LatLngLike } from './logic';

/**
 * The trip as a line (Baghdad/Kut ideas r1, r2, Ali 2026-10-07): the garage, the checkpoints and the
 * rider's own stop in road order, the far end, each with its time, and the car on it. Times come from
 * the corridor's minutes on the road spread over the distance; once the car sends its position, from
 * how far along it is. Pure: the pass passes the points and the clock. Never other riders' stops.
 */

const MIN = 60_000;

export type RoadStopKind = 'start' | 'checkpoint' | 'my_stop' | 'end';
export type RoadPoint = LatLngLike & { id: string; kind: RoadStopKind; name: string };
export type RoadStop = RoadPoint & { frac: number; at: Date; passed: boolean };

/** How far along start → end a point sits (0 at the start, 1 at the end), on a flat local frame. */
export function alongRoad(start: LatLngLike, end: LatLngLike, p: LatLngLike): number {
  const k = Math.cos((((start.lat + end.lat) / 2) * Math.PI) / 180);
  const ex = (end.lng - start.lng) * k;
  const ey = end.lat - start.lat;
  const px = (p.lng - start.lng) * k;
  const py = p.lat - start.lat;
  const len2 = ex * ex + ey * ey;
  if (len2 === 0) return 0;
  return Math.min(1, Math.max(0, (px * ex + py * ey) / len2));
}

export type RoadLine = { stops: RoadStop[]; carFrac: number | null; arriveAt: Date; minutesLeft: number };

export function roadLine({
  start,
  end,
  between,
  departAt,
  departedAt = null,
  travelMin,
  car,
  now,
}: {
  start: RoadPoint;
  end: RoadPoint;
  /** Checkpoints and the rider's own stop, any order. */
  between: readonly RoadPoint[];
  departAt: Date;
  /** When the car actually left; with the car's fix, the passed stops are timed between it and now. */
  departedAt?: Date | null;
  travelMin: number;
  /** The car's last fix while it is on the road; null before it leaves or without a fix. */
  car: LatLngLike | null;
  now: Date;
}): RoadLine {
  const travelMs = travelMin * MIN;
  const carFrac = car ? alongRoad(start, end, car) : null;
  // When the car "left" the start: from where it is now, else the announced time (or now, if later).
  const t0 = carFrac !== null ? now.getTime() - carFrac * travelMs : Math.max(departAt.getTime(), now.getTime());
  const mid = between.map((p) => ({ p, frac: alongRoad(start, end, p) })).sort((a, b) => a.frac - b.frac);
  const all = [{ p: start, frac: 0 }, ...mid, { p: end, frac: 1 }];
  // Ahead of the car: the rest of the road at the corridor's pace from now. Behind it: between the
  // real leave time and now, in proportion (so the garage reads the time the car really left).
  const at = (frac: number): number => {
    if (carFrac === null) return t0 + frac * travelMs;
    if (frac > carFrac) return now.getTime() + (frac - carFrac) * travelMs;
    const left = departedAt ? departedAt.getTime() : t0;
    return carFrac === 0 ? left : left + (frac / carFrac) * (now.getTime() - left);
  };
  const stops = all.map(({ p, frac }) => ({ ...p, frac, at: new Date(at(frac)), passed: carFrac !== null && frac <= carFrac }));
  const arriveAt = new Date(at(1));
  return { stops, carFrac, arriveAt, minutesLeft: Math.max(0, Math.ceil((arriveAt.getTime() - now.getTime()) / MIN)) };
}

/** Where the line ends: the far city's main garage (garage order: النهضة for Baghdad, باب 1 for Aziziyah). */
export function endGarageFor<G extends LatLngLike & { id: string; cityId: string }>(garages: readonly G[], cityId: string): G | null {
  const order = GARAGE_ORDER as readonly string[];
  const rank = (id: string) => (order.includes(id) ? order.indexOf(id) : order.length);
  return [...garages].filter((g) => g.cityId === cityId).sort((a, b) => rank(a.id) - rank(b.id))[0] ?? null;
}
