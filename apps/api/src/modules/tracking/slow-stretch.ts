import { haversineM, type LatLng, type SlowStretch } from '@driver/contracts';

/**
 * N6 «ليش متأخر» (Ali, 2026-10-11): which part of a late delivery's road is slow, measured along the
 * same line the customer's map draws. Pure: the caller passes the route and the learned factors.
 */
export const SLOW_STRETCH_RULES = {
  /** The road is judged in pieces of about this length (long straight segments are cut to it). */
  pieceM: 300,
  /** A piece counts as slow when its learned minutes run this much over the router's. */
  minFactor: 1.15,
  /** Below this many extra minutes there is nothing worth pointing at. */
  minExtraMin: 1,
  /** A kitchen stretch spans this far either side of the kitchen. */
  kitchenHalfM: 60,
} as const;

export type SlowStretchRules = typeof SLOW_STRETCH_RULES;

/** Decodes Google's encoded polyline (OSRM `polyline6`) into points. */
export function decodePolyline(encoded: string, precision = 6): LatLng[] {
  const scale = 10 ** precision;
  const out: LatLng[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;
  const next = (): number => {
    let result = 0;
    let shift = 0;
    let byte: number;
    do {
      if (index >= encoded.length) throw new RangeError('polyline ends mid-number');
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };
  while (index < encoded.length) {
    lat += next();
    lng += next();
    out.push({ lat: lat / scale, lng: lng / scale });
  }
  return out;
}

/** The route as points no further than `pieceM` apart, with each point's distance along it. */
export function measuredPath(points: readonly LatLng[], pieceM: number): { points: LatLng[]; atM: number[] } {
  const out: LatLng[] = [];
  const atM: number[] = [];
  let run = 0;
  points.forEach((p, i) => {
    if (i === 0) {
      out.push(p);
      atM.push(0);
      return;
    }
    const prev = points[i - 1]!;
    const len = haversineM(prev, p);
    const cuts = Math.max(1, Math.ceil(len / pieceM));
    for (let k = 1; k <= cuts; k++) {
      const t = k / cuts;
      out.push(k === cuts ? p : { lat: prev.lat + (p.lat - prev.lat) * t, lng: prev.lng + (p.lng - prev.lng) * t });
      atM.push(run + len * t);
    }
    run += len;
  });
  return { points: out, atM };
}

/**
 * Traffic: the road is cut into pieces of about `pieceM`, each piece's learned factor is read, and the
 * longest-costing unbroken run of slow pieces (factor ≥ `minFactor`) is the stretch, with the minutes
 * it adds over the router's estimate. `baseMinutes` is the router's minutes for the whole route.
 */
export async function trafficStretch(
  path: { points: readonly LatLng[]; atM: readonly number[] },
  baseMinutes: number,
  factorOf: (from: LatLng, to: LatLng) => Promise<number>,
  rules: SlowStretchRules = SLOW_STRETCH_RULES,
): Promise<SlowStretch | null> {
  const total = path.atM[path.atM.length - 1] ?? 0;
  if (path.points.length < 2 || total <= 0 || baseMinutes <= 0) return null;
  // Piece boundaries: a piece takes segments (each at most `pieceM`, see `measuredPath`) until the next
  // one would take it past `pieceM`.
  const last = path.points.length - 1;
  const cuts = [0];
  for (let i = 1; i <= last; i++) {
    if (i === last || path.atM[i + 1]! - path.atM[cuts[cuts.length - 1]!]! > rules.pieceM) cuts.push(i);
  }
  const pieces = await Promise.all(
    cuts.slice(1).map(async (end, k) => {
      const start = cuts[k]!;
      const lenM = path.atM[end]! - path.atM[start]!;
      const factor = await factorOf(path.points[start]!, path.points[end]!);
      return { fromM: path.atM[start]!, toM: path.atM[end]!, factor, extraMin: baseMinutes * (lenM / total) * (factor - 1) };
    }),
  );
  let best: { fromM: number; toM: number; extraMin: number } | null = null;
  let run: { fromM: number; toM: number; extraMin: number } | null = null;
  for (const p of pieces) {
    if (p.factor < rules.minFactor) {
      run = null;
      continue;
    }
    run = run ? { fromM: run.fromM, toM: p.toM, extraMin: run.extraMin + p.extraMin } : { fromM: p.fromM, toM: p.toM, extraMin: p.extraMin };
    if (!best || run.extraMin > best.extraMin) best = { ...run };
  }
  if (!best || best.extraMin < rules.minExtraMin) return null;
  return { fromM: Math.round(best.fromM), toM: Math.round(best.toM), reason: 'traffic', minutes: Math.max(1, Math.round(best.extraMin)) };
}

/** Kitchen: the food is late; the stretch sits on the route where it passes closest to the kitchen. */
export function kitchenStretch(
  path: { points: readonly LatLng[]; atM: readonly number[] },
  kitchen: LatLng,
  lateMinutes: number,
  rules: SlowStretchRules = SLOW_STRETCH_RULES,
): SlowStretch | null {
  const total = path.atM[path.atM.length - 1] ?? 0;
  if (path.points.length < 2 || lateMinutes < 1) return null;
  let at = 0;
  let nearest = Number.POSITIVE_INFINITY;
  path.points.forEach((p, i) => {
    const d = haversineM(p, kitchen);
    if (d < nearest) {
      nearest = d;
      at = path.atM[i]!;
    }
  });
  return {
    fromM: Math.round(Math.max(0, at - rules.kitchenHalfM)),
    toM: Math.round(Math.min(total, at + rules.kitchenHalfM)),
    reason: 'kitchen',
    minutes: Math.max(1, Math.round(lateMinutes)),
  };
}
