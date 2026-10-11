import type { GuardianRunView } from '@driver/contracts';
import { decodePolyline } from '@driver/map';
import { countKey } from '@/lib/plural';

/** [lng, lat], as the map takes it. */
export type Pt = [number, number];

/** How often the screen asks for the run while it is open. */
export const BUS_POLL_MS = 10_000;
/** A bus fix older than this gets «آخر مكان قبل …». */
export const BUS_STALE_MS = 2 * 60_000;

const pt = (p: { lat: number; lng: number }): Pt => [p.lng, p.lat];

/**
 * The line the map draws: the server's road (`polyline6`, through the public points only), else straight
 * lines through the same points in driving order (bus when shown, then home and school in the leg's order).
 */
export function busRoute(v: GuardianRunView): Pt[] {
  if (v.polyline6) {
    const road = decodePolyline(v.polyline6).map(pt);
    if (road.length >= 2) return road;
  }
  const home = pt(v.home);
  const school = pt(v.school);
  const ends = v.leg === 'to_school' ? [home, school] : [school, home];
  if (!v.bus) return ends;
  const bus = pt(v.bus);
  // On board the bus heads straight for the child's next point: the school, or home in the afternoon.
  if (v.child === 'on_board') return [bus, ends[1]!];
  return [bus, ...ends];
}

const metres = (a: Pt, b: Pt) => {
  const k = 111_320;
  return Math.hypot((b[0] - a[0]) * k * Math.cos((a[1] * Math.PI) / 180), (b[1] - a[1]) * k);
};

/** Where `p` sits along `route`, 0–1 (the nearest vertex: the route runs through each public point). */
export function fractionAlong(route: readonly Pt[], p: Pt): number {
  if (route.length < 2) return 0;
  let total = 0;
  let best = Infinity;
  let at = 0;
  for (let i = 0; i < route.length; i++) {
    if (i > 0) total += metres(route[i - 1]!, route[i]!);
    const d = metres(route[i]!, p);
    if (d < best) {
      best = d;
      at = total;
    }
  }
  return total > 0 ? at / total : 0;
}

/** `n` points evenly inside (from, to), ends excluded; none when there is no room. */
export function spread(n: number, from: number, to: number): number[] {
  if (n <= 0 || !(to - from > 0.02)) return [];
  return Array.from({ length: n }, (_, i) => from + ((to - from) * (i + 1)) / (n + 1));
}

/**
 * The other children's stops as fractions along the route, for the blank dots.
 *
 * These are NOT where those stops are: the server never sends another child's position (privacy, N14),
 * only how many there are and which are done. The dots are spaced evenly on the client so a guardian
 * sees "the bus stops this many times before us" and nothing more. The `stopsBefore` still to come go
 * between the start of what is left (the bus, or the school in the afternoon) and this child's home;
 * the rest still to come after it. Done stops are not drawn: the bus has passed them, and a dot ahead of
 * it would read as a stop still to make. With no room on the line (the bus hidden in the morning, so
 * the line starts at home) the count lives in the sheet's headline only.
 */
export function otherStopFractions(v: GuardianRunView, route: readonly Pt[]): number[] {
  if (v.child === 'delivered' || v.child === 'absent') return [];
  const pending = v.others.filter((o) => !o.done).length;
  const before = Math.min(v.stopsBefore, pending);
  const after = pending - before;
  const mine = fractionAlong(route, pt(v.home));
  if (v.leg === 'to_school') return [...spread(before, 0, mine), ...spread(after, mine, fractionAlong(route, pt(v.school)))];
  // Afternoon: the others' homes lie between the school (or the bus once past it) and this home.
  const start = v.child === 'waiting' ? fractionAlong(route, pt(v.school)) : 0;
  return [...spread(before, start, mine), ...spread(after, mine, 1)];
}

/** The keys of the sheet's headline; the screen runs them through `t()`. */
export type BusHeadline = { key: string; params?: Record<string, string | number> };

const PROGRESS = new Set(['accepted', 'en_route_to_pickup', 'arrived_pickup', 'in_transit', 'arrived_dropoff']);

/** The sheet's headline for the run as it stands (copy in `khat_bus.*`). */
export function busHeadline(v: GuardianRunView): BusHeadline {
  const morning = v.leg === 'to_school';
  if (v.child === 'absent') return { key: 'khat_bus.absent' };
  if (v.child === 'delivered') return { key: morning ? 'khat_bus.delivered_school' : 'khat_bus.delivered_home' };
  if (v.busAway) {
    // On board in the morning: the bus fetches another child before the school.
    if (v.child === 'on_board' && morning) return { key: 'khat_bus.on_board_pickup' };
    const base = v.child === 'on_board' ? 'khat_bus.away_dropping' : 'khat_bus.away';
    return v.stopsBefore > 0 ? { key: countKey(base, v.stopsBefore), params: { n: v.stopsBefore } } : { key: `${base}_next` };
  }
  if (v.child === 'on_board') {
    if (morning) return { key: 'khat_bus.on_board_school' };
    return v.minutes !== null ? { key: 'khat_bus.coming_home', params: { n: v.minutes } } : { key: 'khat_bus.on_board_home' };
  }
  // Waiting: for the bus at home in the morning, at school in the afternoon.
  if (!PROGRESS.has(v.state)) return { key: 'khat_bus.not_started' };
  if (!v.bus) return { key: 'khat_bus.no_fix' };
  if (v.minutes !== null) return { key: morning ? 'khat_bus.coming_home' : 'khat_bus.coming_school', params: { n: v.minutes } };
  return { key: morning ? 'khat_bus.on_way_home' : 'khat_bus.on_way_school' };
}

/** Whole minutes since the bus's last fix when it is older than `BUS_STALE_MS`; else null. */
export function staleMinutes(v: GuardianRunView, now: number): number | null {
  if (!v.bus) return null;
  const age = now - new Date(v.bus.at).getTime();
  return age > BUS_STALE_MS ? Math.floor(age / 60_000) : null;
}

/** Within this of the bus, the home and school pins drop their labels so the bus pill sits clear of them. */
export const PIN_CROWD_M = 150;

/** What the map draws for a run: the line, the blank dots, and the three public points. */
export function khatScene(view: GuardianRunView) {
  const route = busRoute(view);
  const home: Pt = pt(view.home);
  const school: Pt = pt(view.school);
  const bus: Pt | undefined = view.bus ? pt(view.bus) : undefined;
  const crowds = (p: Pt) => bus !== undefined && metres(bus, p) < PIN_CROWD_M;
  return { route, home, school, bus, others: otherStopFractions(view, route), compactHome: crowds(home), compactSchool: crowds(school) };
}
