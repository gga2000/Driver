/** Small metre helpers around Aziziyah (flat-earth at street scale: under 0.1 % off within a few km). */
export type LngLat = [number, number];

export const M_PER_DEG_LAT = 110540;
export const mPerDegLng = (lat: number) => 111320 * Math.cos((lat * Math.PI) / 180);

/** Metres between two points. */
export function metresBetween(a: LngLat, b: LngLat): number {
  return Math.hypot((b[0] - a[0]) * mPerDegLng((a[1] + b[1]) / 2), (b[1] - a[1]) * M_PER_DEG_LAT);
}

/** The point `east`, `north` metres from `p`. */
export function offsetMetres(p: LngLat, east: number, north: number): LngLat {
  return [p[0] + east / mPerDegLng(p[1]), p[1] + north / M_PER_DEG_LAT];
}

/** A closed ring of `n` points round `p`, `rM` metres out. */
export function circleRing(p: LngLat, rM: number, n = 16): LngLat[] {
  const ring: LngLat[] = [];
  for (let i = 0; i <= n; i++) {
    const a = ((i % n) / n) * Math.PI * 2;
    ring.push(offsetMetres(p, Math.cos(a) * rM, Math.sin(a) * rM));
  }
  return ring;
}

/** A box `lengthM` along `bearing` (degrees from north) by `widthM` across, centred on `p`. */
export function boxRing(p: LngLat, bearing: number, lengthM: number, widthM: number): LngLat[] {
  const r = (bearing * Math.PI) / 180;
  const ux = Math.sin(r), uy = Math.cos(r);
  const corners: [number, number][] = [[-1, -1], [1, -1], [1, 1], [-1, 1], [-1, -1]];
  return corners.map(([a, c]) => offsetMetres(p, ux * a * (lengthM / 2) + uy * c * (widthM / 2), uy * a * (lengthM / 2) - ux * c * (widthM / 2)));
}

/** The nearest point on segment a–b to p, with the distance in metres. */
export function nearestOnSegment(p: LngLat, a: LngLat, b: LngLat): { at: LngLat; m: number } {
  const kx = mPerDegLng(p[1]);
  const ax = (a[0] - p[0]) * kx, ay = (a[1] - p[1]) * M_PER_DEG_LAT;
  const bx = (b[0] - p[0]) * kx, by = (b[1] - p[1]) * M_PER_DEG_LAT;
  const dx = bx - ax, dy = by - ay;
  const L2 = dx * dx + dy * dy;
  const t = L2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / L2)) : 0;
  const x = ax + dx * t, y = ay + dy * t;
  return { at: [p[0] + x / kx, p[1] + y / M_PER_DEG_LAT], m: Math.hypot(x, y) };
}

/** Cumulative metres along a path, one entry per point (first is 0). */
export function pathMetres(path: readonly LngLat[]): number[] {
  const out = [0];
  for (let i = 1; i < path.length; i++) out.push(out[i - 1]! + metresBetween(path[i - 1]!, path[i]!));
  return out;
}

/** The part of a path between `fromM` and `toM` metres along it. */
export function slicePath(path: readonly LngLat[], fromM: number, toM: number): LngLat[] {
  const cum = pathMetres(path);
  const total = cum[cum.length - 1] ?? 0;
  const lo = Math.max(0, Math.min(fromM, toM)), hi = Math.min(total, Math.max(fromM, toM));
  if (path.length < 2 || hi <= lo) return [];
  const at = (m: number): LngLat => {
    let i = 1;
    while (i < cum.length - 1 && cum[i]! < m) i++;
    const a = path[i - 1]!, b = path[i]!;
    const span = cum[i]! - cum[i - 1]! || 1;
    const t = (m - cum[i - 1]!) / span;
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  };
  const out: LngLat[] = [at(lo)];
  for (let i = 1; i < path.length - 1; i++) if (cum[i]! > lo && cum[i]! < hi) out.push(path[i]!);
  out.push(at(hi));
  return out;
}
