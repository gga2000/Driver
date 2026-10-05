import { AZIZIYAH_ZONES, pointInRing, type LatLng } from '@driver/contracts';

/** Haversine distance in km. */
export function distanceKm(a: LatLng, b: LatLng): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const la = (a.lat * Math.PI) / 180;
  const lb = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la) * Math.cos(lb) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export const distanceM = (a: LatLng, b: LatLng): number => distanceKm(a, b) * 1000;

/** Shared with the zone outline tool (`@driver/contracts`). */
export { pointInRing };

export interface ZonePolygon {
  zoneId: string;
  /** Closed or open ring of [lat, lng]; the last point need not repeat the first. */
  ring: LatLng[];
}

export interface ZoneSeed {
  id: string;
  name_ar: string;
  name_en: string;
  centre: LatLng;
  radiusKm: number;
}

/** Beyond this distance past the nearest zone's edge a pin is outside the service area. */
export const OUT_OF_SERVICE_KM = 2;

const SEEDS: ReadonlyMap<string, readonly ZoneSeed[]> = new Map([
  ['aziziyah', AZIZIYAH_ZONES.map((z) => ({ id: z.id, name_ar: z.name_ar, name_en: z.name_en, centre: { lat: z.lat, lng: z.lng }, radiusKm: z.radiusM / 1000 }))],
]);

/** Seed names carry Eastern digits ("شارع ٣٠"); the voice guide wants 0–9 everywhere. */
function westernDigits(s: string): string {
  return s.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));
}

/**
 * Pin → zone, server side (customer spec §10: never trusted from the client). Verified polygons
 * win when registered; otherwise the nearest seed centroid (distance minus the draft radius), as
 * dispatch's `ZoneDirectory` does until the PostGIS polygons are verified. Null = outside service.
 */
export class ZoneResolver {
  private readonly polygons = new Map<string, ZonePolygon[]>();

  register(cityId: string, zones: ZonePolygon[]): void {
    this.polygons.set(cityId, zones);
  }

  resolve(cityId: string, pin: LatLng): string | null {
    for (const z of this.polygons.get(cityId) ?? []) if (pointInRing(pin, z.ring)) return z.zoneId;
    let best: { id: string; d: number } | null = null;
    for (const z of SEEDS.get(cityId) ?? []) {
      const d = distanceKm(pin, z.centre) - z.radiusKm;
      if (!best || d < best.d) best = { id: z.id, d };
    }
    return best && best.d <= OUT_OF_SERVICE_KM ? best.id : null;
  }

  names(cityId: string, zoneId: string): { ar: string; en: string } {
    const z = SEEDS.get(cityId)?.find((x) => x.id === zoneId);
    return z ? { ar: westernDigits(z.name_ar), en: z.name_en } : { ar: zoneId, en: zoneId };
  }

  centre(cityId: string, zoneId: string): LatLng | null {
    return SEEDS.get(cityId)?.find((x) => x.id === zoneId)?.centre ?? null;
  }
}
