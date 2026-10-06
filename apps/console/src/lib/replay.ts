import type { OrderReplay } from '@driver/contracts';

/**
 * The order replay (maps program o2), free of the map so it is unit-tested: where the courier was at
 * any moment, how much of his path is behind him, and how fast the replay runs.
 */
export type ReplayPoint = OrderReplay['legs'][number]['points'][number];

/** Playback speeds as multiples of real time: a 30-minute delivery takes 3 min, 1 min or 30 s. */
export const REPLAY_SPEEDS = [10, 30, 60] as const;
export type ReplaySpeed = (typeof REPLAY_SPEEDS)[number];

/** Every leg's points as one time-ordered path (a reassigned order shows both couriers in turn). */
export function replayPath(r: OrderReplay): ReplayPoint[] {
  return r.legs.flatMap((l) => l.points).sort((a, b) => a.at.getTime() - b.at.getTime());
}

/** Where he was at `t` (ms): interpolated between the two fixes around it, clamped to the ends. */
export function positionAt(path: readonly ReplayPoint[], t: number): { lat: number; lng: number } | null {
  if (path.length === 0) return null;
  const first = path[0]!;
  const last = path[path.length - 1]!;
  if (t <= first.at.getTime()) return { lat: first.lat, lng: first.lng };
  if (t >= last.at.getTime()) return { lat: last.lat, lng: last.lng };
  let lo = 0;
  let hi = path.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (path[mid]!.at.getTime() <= t) lo = mid;
    else hi = mid;
  }
  const a = path[lo]!;
  const b = path[hi]!;
  const span = b.at.getTime() - a.at.getTime();
  const k = span > 0 ? (t - a.at.getTime()) / span : 0;
  return { lat: a.lat + (b.lat - a.lat) * k, lng: a.lng + (b.lng - a.lng) * k };
}

/** The path driven by `t`, ending exactly where he is (the replay's bright line). */
export function pathUntil(path: readonly ReplayPoint[], t: number): Array<[number, number]> {
  const out: Array<[number, number]> = path.filter((p) => p.at.getTime() <= t).map((p) => [p.lng, p.lat]);
  const here = positionAt(path, t);
  if (here && out.length > 0) out.push([here.lng, here.lat]);
  return out;
}

/** The replay's time span: first fix (or first mark) to last. */
export function replaySpan(r: OrderReplay): { from: number; to: number } | null {
  const times = [...replayPath(r).map((p) => p.at.getTime()), ...r.marks.map((m) => m.at.getTime())];
  if (times.length === 0) return null;
  return { from: Math.min(...times), to: Math.max(...times) };
}
