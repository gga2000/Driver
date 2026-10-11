import { Injectable } from '@nestjs/common';
import type { AvoidedStreet, LatLng } from '@driver/contracts';

/**
 * N20 «شارع مسدود» (Ali, 2026-10-11): a street field ops closed for today. Routing only needs where it
 * is and until when; who closed it and why live in the closures module, which keeps this book current.
 */
export interface RouteClosure {
  id: string;
  /** The closed stretch along the street, two or more points. */
  path: readonly LatLng[];
  endsAt: Date;
  /** Carried for the maps that show it (customer, courier): why, and what ops called it. */
  reason: 'works' | 'funeral' | 'water' | 'other';
  nameAr: string | null;
}

/** One closure a route was sent around, and the seconds the way around adds. */
export interface AvoidedClosure {
  id: string;
  extraS: number;
}

export const CLOSURE_RULES = {
  /** Points along a path are compared this far apart. */
  stepM: 10,
  /** A route within this of a closure's inside runs through it. */
  nearM: 12,
  /** A closure's last metres at each end are its junctions: a route may cross there. */
  endsM: 20,
  /** A trip that starts or ends this close to a closure has to use it: nothing to go around. */
  touchM: 30,
  /** How far beside a closure (a route running along it takes a parallel street) the ways around are tried. */
  detourM: [150, 300] as const,
  /** How far past a closure's ends (a route crossing it goes round its end) the ways around are tried. */
  pastEndM: [100, 250] as const,
  /** Rounds of going around (one per closure met on the way). */
  maxRounds: 2,
} as const;

export type ClosureRules = typeof CLOSURE_RULES;

/**
 * Today's closures, as routing sees them. The closures module sets them when one is closed or opened and
 * reloads them from the database every few seconds (so every API machine agrees); expired ones drop out
 * here on their own at their end time.
 */
@Injectable()
export class RouteClosures {
  private list: readonly RouteClosure[] = [];
  private changed = 0;

  set(list: readonly RouteClosure[]): void {
    const key = (l: readonly RouteClosure[]) => l.map((c) => `${c.id}@${c.endsAt.getTime()}`).sort().join('|');
    if (key(list) !== key(this.list)) this.changed += 1;
    this.list = list;
  }

  active(now: Date): readonly RouteClosure[] {
    return this.list.filter((c) => c.endsAt.getTime() > now.getTime());
  }

  /** Today's closures by id (the maps that show the ones a route went around). */
  byId(ids: readonly string[]): RouteClosure[] {
    return this.list.filter((c) => ids.includes(c.id));
  }

  /** Changes whenever the set of closures does: part of every cached route's key. */
  get version(): number {
    return this.changed;
  }
}

// ───────────────────────── geometry (metres on a local flat plane; a town is small) ─────────────────────────

const M_PER_DEG_LAT = 111_320;

function toXY(origin: LatLng, p: LatLng): { x: number; y: number } {
  return { x: (p.lng - origin.lng) * M_PER_DEG_LAT * Math.cos((origin.lat * Math.PI) / 180), y: (p.lat - origin.lat) * M_PER_DEG_LAT };
}

function fromXY(origin: LatLng, x: number, y: number): LatLng {
  return { lat: origin.lat + y / M_PER_DEG_LAT, lng: origin.lng + x / (M_PER_DEG_LAT * Math.cos((origin.lat * Math.PI) / 180)) };
}

function distM(a: LatLng, b: LatLng): number {
  const q = toXY(a, b);
  return Math.hypot(q.x, q.y);
}

/** Points along `path` no more than `stepM` apart, each with its distance from the start. */
export function samplePath(path: readonly LatLng[], stepM: number): Array<{ p: LatLng; atM: number }> {
  const out: Array<{ p: LatLng; atM: number }> = [];
  let run = 0;
  path.forEach((p, i) => {
    if (i === 0) {
      out.push({ p, atM: 0 });
      return;
    }
    const prev = path[i - 1]!;
    const len = distM(prev, p);
    const cuts = Math.max(1, Math.ceil(len / stepM));
    for (let k = 1; k <= cuts; k++) {
      const t = k / cuts;
      out.push({ p: k === cuts ? p : { lat: prev.lat + (p.lat - prev.lat) * t, lng: prev.lng + (p.lng - prev.lng) * t }, atM: run + len * t });
    }
    run += len;
  });
  return out;
}

/** The closure's inside: its samples without the junction metres at each end. */
function inside(c: RouteClosure, rules: ClosureRules): LatLng[] {
  const s = samplePath(c.path, rules.stepM);
  const total = s[s.length - 1]?.atM ?? 0;
  const mid = s.filter((q) => q.atM >= rules.endsM && q.atM <= total - rules.endsM).map((q) => q.p);
  // A very short closure (a single junction-to-junction block under 40 m) is all inside.
  return mid.length > 0 ? mid : s.map((q) => q.p);
}

/** Does a route along `line` run through closure `c`? */
export function runsThrough(line: readonly LatLng[], c: RouteClosure, rules: ClosureRules = CLOSURE_RULES): boolean {
  if (line.length < 2) return false;
  const route = samplePath(line, rules.stepM).map((q) => q.p);
  return inside(c, rules).some((p) => route.some((r) => distM(p, r) <= rules.nearM));
}

/** True when the trip starts or ends at the closure itself (a door on the closed street): no way around. */
export function touches(points: readonly LatLng[], c: RouteClosure, rules: ClosureRules = CLOSURE_RULES): boolean {
  const ends = [points[0], points[points.length - 1]].filter((p): p is LatLng => p !== undefined);
  const along = samplePath(c.path, rules.stepM).map((q) => q.p);
  return ends.some((e) => along.some((p) => distM(e, p) <= rules.touchM));
}

/**
 * Ways around closure `c` for a trip through `points`: the trip with one extra stop put into the leg that
 * passes nearest the closure — beside its middle on either side (for a route that ran along it, a parallel
 * street), or just past either end (for a route that crossed it, round its end).
 */
export function detourCandidates(points: readonly LatLng[], c: RouteClosure, rules: ClosureRules = CLOSURE_RULES): LatLng[][] {
  const s = samplePath(c.path, rules.stepM);
  const total = s[s.length - 1]?.atM ?? 0;
  const mid = s.reduce((best, q) => (Math.abs(q.atM - total / 2) < Math.abs(best.atM - total / 2) ? q : best), s[0]!).p;
  const a = toXY(mid, c.path[0]!);
  const b = toXY(mid, c.path[c.path.length - 1]!);
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const u = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
  const n = { x: -u.y, y: u.x };
  // The leg whose straight line passes nearest the closure's middle gets the extra stop.
  let leg = 0;
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i + 1 < points.length; i++) {
    const d = segmentDistM(mid, points[i]!, points[i + 1]!);
    if (d < best) {
      best = d;
      leg = i;
    }
  }
  const vias: LatLng[] = [];
  for (const d of rules.detourM) for (const side of [1, -1]) vias.push(fromXY(mid, n.x * d * side, n.y * d * side));
  for (const d of rules.pastEndM) {
    vias.push(fromXY(mid, a.x - u.x * d, a.y - u.y * d));
    vias.push(fromXY(mid, b.x + u.x * d, b.y + u.y * d));
  }
  return vias.map((via) => [...points.slice(0, leg + 1), via, ...points.slice(leg + 1)]);
}

function segmentDistM(p: LatLng, a: LatLng, b: LatLng): number {
  const A = toXY(p, a);
  const B = toXY(p, b);
  const dx = B.x - A.x;
  const dy = B.y - A.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, -(A.x * dx + A.y * dy) / len2));
  return Math.hypot(A.x + dx * t, A.y + dy * t);
}

/**
 * The closed streets a route went around, as the maps show them, with the minutes each way around adds
 * (`factor`: the vehicle's time factor over the router's car seconds). Ones that ended since are left out.
 */
export function avoidedStreets(book: RouteClosures, avoided: readonly AvoidedClosure[] | undefined, factor = 1): AvoidedStreet[] {
  if (!avoided || avoided.length === 0) return [];
  return book.byId(avoided.map((a) => a.id)).map((c) => ({
    id: c.id,
    path: [...c.path],
    reason: c.reason,
    nameAr: c.nameAr,
    endsAt: c.endsAt,
    extraMin: Math.round(((avoided.find((a) => a.id === c.id)?.extraS ?? 0) * factor) / 60),
  }));
}
