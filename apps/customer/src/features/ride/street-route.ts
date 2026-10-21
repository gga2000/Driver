import type { WalkRoad } from './walk-stop';

/**
 * The line from the pickup to the pin, along the streets (Ali 2026-10-20): a small router over the
 * streets the map itself has drawn (`BaseMap`'s `onRoads`), so the line follows the pin while it moves,
 * costs no server call and works offline. Not the fare: the server still prices the ride by its zones.
 * Pure and flat-earth (Aziziyah is a few km across).
 */

export type LngLat = [number, number];

const M_PER_DEG_LAT = 110_540;
const mPerDegLng = (lat: number) => 111_320 * Math.cos((lat * Math.PI) / 180);

/** Points closer than this are one street corner (tile seams cut a street into pieces that nearly touch). */
const JOIN_M = 2;
/** A pin further than this from any street is not on the street map: no route, the straight hint shows. */
export const MAX_SNAP_M = 150;

export interface StreetGraph {
  /** Node positions. */
  at: LngLat[];
  /** Adjacency: for node i, pairs of [neighbour, metres]. */
  next: Array<Array<[number, number]>>;
  /** Every street segment as node pairs (for snapping a point onto the nearest street). */
  segs: Array<[number, number]>;
}

export interface StreetRoute {
  /** From the pickup's spot on its street to the pin's spot on its street. */
  path: LngLat[];
  metres: number;
  /** The ends as given (the pin may stand in a yard a few metres off the street). */
  from: LngLat;
  to: LngLat;
}

function metres(a: LngLat, b: LngLat): number {
  return Math.hypot((b[0] - a[0]) * mPerDegLng((a[1] + b[1]) / 2), (b[1] - a[1]) * M_PER_DEG_LAT);
}

/** Joins the streets into one graph, merging ends that meet at tile seams. */
export function buildStreetGraph(roads: readonly WalkRoad[]): StreetGraph {
  const at: LngLat[] = [];
  const next: Array<Array<[number, number]>> = [];
  const segs: Array<[number, number]> = [];
  const cells = new Map<string, number[]>();
  const lat0 = roads[0]?.coords[0]?.[1] ?? 32.9;
  const cx = JOIN_M / mPerDegLng(lat0);
  const cy = JOIN_M / M_PER_DEG_LAT;
  const nodeFor = (p: LngLat): number => {
    const gx = Math.floor(p[0] / cx);
    const gy = Math.floor(p[1] / cy);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const i of cells.get(`${gx + dx}:${gy + dy}`) ?? []) if (metres(at[i]!, p) <= JOIN_M) return i;
      }
    }
    const i = at.length;
    at.push(p);
    next.push([]);
    const key = `${gx}:${gy}`;
    const list = cells.get(key);
    if (list) list.push(i);
    else cells.set(key, [i]);
    return i;
  };
  for (const r of roads) {
    let prev = -1;
    for (const c of r.coords) {
      const i = nodeFor(c);
      if (prev >= 0 && prev !== i) {
        const m = metres(at[prev]!, at[i]!);
        next[prev]!.push([i, m]);
        next[i]!.push([prev, m]);
        segs.push([prev, i]);
      }
      prev = i;
    }
  }
  return { at, next, segs };
}

interface Snap {
  seg: [number, number];
  at: LngLat;
  /** Metres from the point to the street. */
  off: number;
}

function snap(g: StreetGraph, p: LngLat): Snap | null {
  const kx = mPerDegLng(p[1]);
  let best: Snap | null = null;
  for (const seg of g.segs) {
    const a = g.at[seg[0]]!;
    const b = g.at[seg[1]]!;
    const ax = (a[0] - p[0]) * kx, ay = (a[1] - p[1]) * M_PER_DEG_LAT;
    const bx = (b[0] - p[0]) * kx, by = (b[1] - p[1]) * M_PER_DEG_LAT;
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2));
    const x = ax + dx * t, y = ay + dy * t;
    const off = Math.hypot(x, y);
    if (!best || off < best.off) best = { seg, at: [p[0] + x / kx, p[1] + y / M_PER_DEG_LAT], off };
  }
  return best && best.off <= MAX_SNAP_M ? best : null;
}

/** A small binary heap of [cost, node]. */
class Heap {
  private items: Array<[number, number]> = [];
  get size() {
    return this.items.length;
  }
  push(x: [number, number]) {
    const a = this.items;
    a.push(x);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p]![0] <= a[i]![0]) break;
      [a[p], a[i]] = [a[i]!, a[p]!];
      i = p;
    }
  }
  pop(): [number, number] {
    const a = this.items;
    const top = a[0]!;
    const last = a.pop()!;
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < a.length && a[l]![0] < a[m]![0]) m = l;
        if (r < a.length && a[r]![0] < a[m]![0]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i]!, a[m]!];
        i = m;
      }
    }
    return top;
  }
}

/**
 * The shortest way along the streets from `from` to `to` (A*), or null when either end is off the
 * street map or no street joins them (a part of town whose tiles the map has not drawn yet).
 */
export function streetRoute(g: StreetGraph, from: LngLat, to: LngLat): StreetRoute | null {
  const s = snap(g, from);
  const e = snap(g, to);
  if (!s || !e) return null;
  // Same street piece: straight along it.
  if ((s.seg[0] === e.seg[0] && s.seg[1] === e.seg[1]) || (s.seg[0] === e.seg[1] && s.seg[1] === e.seg[0])) {
    return { path: [s.at, e.at], metres: metres(s.at, e.at), from, to };
  }
  const n = g.at.length;
  const S = n, E = n + 1; // two virtual nodes: the snapped ends
  const pos = (i: number): LngLat => (i === S ? s.at : i === E ? e.at : g.at[i]!);
  const out = (i: number): Array<[number, number]> => {
    if (i === S) return s.seg.map((k) => [k, metres(s.at, g.at[k]!)] as [number, number]);
    const list = i === E ? [] : g.next[i]!.slice();
    if (i === e.seg[0] || i === e.seg[1]) list.push([E, metres(g.at[i]!, e.at)]);
    return list;
  };
  const dist = new Map<number, number>([[S, 0]]);
  const prev = new Map<number, number>();
  const heap = new Heap();
  heap.push([metres(s.at, e.at), S]);
  while (heap.size) {
    const [, i] = heap.pop();
    if (i === E) break;
    const di = dist.get(i)!;
    for (const [j, m] of out(i)) {
      const dj = di + m;
      if (dj < (dist.get(j) ?? Infinity)) {
        dist.set(j, dj);
        prev.set(j, i);
        heap.push([dj + metres(pos(j), e.at), j]);
      }
    }
  }
  const total = dist.get(E);
  if (total === undefined) return null;
  const path: LngLat[] = [];
  for (let i: number | undefined = E; i !== undefined; i = prev.get(i)) path.push(pos(i));
  path.reverse();
  return { path, metres: total, from, to };
}

/** The distance as people say it: metres to the nearest 50 under 1 km, else km with one decimal. */
export function distanceWords(m: number): { value: string; unit: 'm' | 'km' } {
  if (m < 950) return { value: String(Math.max(50, Math.round(m / 50) * 50)), unit: 'm' };
  return { value: (Math.round(m / 100) / 10).toFixed(1), unit: 'km' };
}
