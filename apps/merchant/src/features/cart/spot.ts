import { AZIZIYAH_ZONES, type CartSpot } from '@driver/contracts';

export interface Point {
  lat: number;
  lng: number;
}

/** Metres between two points (haversine); plenty for a town. */
export function metersBetween(a: Point, b: Point): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** The town zone whose centre is nearest, for «إنت هنا: يم {zone}» (the server does the same for the cart's zone). */
export function nearestZone(at: Point): { id: string; name_ar: string; name_en: string } {
  let best = AZIZIYAH_ZONES[0]!;
  let bestM = Infinity;
  for (const z of AZIZIYAH_ZONES) {
    const m = metersBetween(at, z);
    if (m < bestM) {
      best = z;
      bestM = m;
    }
  }
  return best;
}

/** Within this of last night's spot, it is «نفس المكان» and keeps its name. */
export const SAME_SPOT_M = 150;

/** The name to start the field with: last night's when he stands where he stood, else empty. */
export function startingLabel(at: Point, last: CartSpot | null): string {
  return last?.label && metersBetween(at, last) <= SAME_SPOT_M ? last.label : '';
}
