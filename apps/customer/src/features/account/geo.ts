import { AZIZIYAH_ZONES, type LatLng } from '@driver/contracts';

/**
 * The pin picker's schematic map of Aziziyah: an equirectangular box around the 34 zone centroids
 * (with a margin), mapped onto a W×H canvas. Pure, so it runs in the Node tests.
 */
export interface MapBox {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

const MARGIN = 0.004;

/** The town and its near/mid ring (where nearly every door is); far villages are picked by zone. */
export const AZIZIYAH_BOX: MapBox = (() => {
  const inner = AZIZIYAH_ZONES.filter((z) => z.tier !== 'far' && z.tier !== 'edge');
  const lats = inner.map((z) => z.lat);
  const lngs = inner.map((z) => z.lng);
  return { minLat: Math.min(...lats) - MARGIN, maxLat: Math.max(...lats) + MARGIN, minLng: Math.min(...lngs) - MARGIN, maxLng: Math.max(...lngs) + MARGIN };
})();

/** Metres per degree of latitude/longitude around Aziziyah: keeps the canvas aspect true to the ground. */
const M_PER_DEG_LAT = 110_900;
const M_PER_DEG_LNG = 93_400;

/** Height for a canvas of `width` that keeps the box's real aspect. */
export function canvasHeight(width: number, box: MapBox = AZIZIYAH_BOX): number {
  const w = (box.maxLng - box.minLng) * M_PER_DEG_LNG;
  const h = (box.maxLat - box.minLat) * M_PER_DEG_LAT;
  return Math.round((width * h) / w);
}

/** North up, east right (maps are not mirrored in RTL). */
export function project(p: LatLng, width: number, height: number, box: MapBox = AZIZIYAH_BOX): { x: number; y: number } {
  return {
    x: ((p.lng - box.minLng) / (box.maxLng - box.minLng)) * width,
    y: ((box.maxLat - p.lat) / (box.maxLat - box.minLat)) * height,
  };
}

export function unproject(x: number, y: number, width: number, height: number, box: MapBox = AZIZIYAH_BOX): LatLng {
  const round = (n: number) => Math.round(n * 1e6) / 1e6;
  return {
    lat: round(box.maxLat - (y / height) * (box.maxLat - box.minLat)),
    lng: round(box.minLng + (x / width) * (box.maxLng - box.minLng)),
  };
}

/** Zone the pin is nearest to (centroid distance minus draft radius) — a preview; the server decides. */
export function nearestZone(p: LatLng): string {
  let best = AZIZIYAH_ZONES[0]!;
  let bestD = Infinity;
  for (const z of AZIZIYAH_ZONES) {
    const dy = (p.lat - z.lat) * M_PER_DEG_LAT;
    const dx = (p.lng - z.lng) * M_PER_DEG_LNG;
    const d = Math.hypot(dx, dy) - z.radiusM;
    if (d < bestD) {
      bestD = d;
      best = z;
    }
  }
  return best.id;
}

export function zoneCentre(zoneId: string): LatLng | null {
  const z = AZIZIYAH_ZONES.find((x) => x.id === zoneId);
  return z ? { lat: z.lat, lng: z.lng } : null;
}

/** Resolves a URL the API returned (photo, upload) against the API origin when it is relative. */
export function absoluteUrl(url: string, apiUrl: string): string {
  if (/^https?:\/\//i.test(url) || url.startsWith('blob:') || url.startsWith('data:') || url.startsWith('file:')) return url;
  try {
    return new URL(url, new URL(apiUrl).origin).toString();
  } catch {
    return url;
  }
}
