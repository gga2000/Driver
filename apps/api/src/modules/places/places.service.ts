import { Injectable } from '@nestjs/common';
import type { LatLng, Place } from '@driver/contracts';

export interface ZonePolygon {
  zoneId: string;
  /** Closed or open ring of [lat, lng]; the last point need not repeat the first. */
  ring: LatLng[];
}

/** Ray-casting point-in-polygon; sufficient for city zones until PostGIS takes over. */
export function pointInRing(p: LatLng, ring: readonly LatLng[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!;
    const b = ring[j]!;
    const intersects = a.lat > p.lat !== b.lat > p.lat && p.lng < ((b.lng - a.lng) * (p.lat - a.lat)) / (b.lat - a.lat) + a.lng;
    if (intersects) inside = !inside;
  }
  return inside;
}

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

@Injectable()
export class PlacesService {
  private readonly places = new Map<string, Place>();
  private readonly zonesByCity = new Map<string, ZonePolygon[]>();
  private seq = 0;

  registerZones(cityId: string, zones: ZonePolygon[]): void {
    this.zonesByCity.set(cityId, zones);
  }

  /** Resolves the zone a pin falls into; `fallback` (the city's edge zone by convention) when no polygon matches. */
  zoneFor(cityId: string, pin: LatLng, fallback = 'edge'): string {
    for (const z of this.zonesByCity.get(cityId) ?? []) if (pointInRing(pin, z.ring)) return z.zoneId;
    return fallback;
  }

  save(input: Omit<Place, 'id'>): Place {
    this.seq += 1;
    const place: Place = { ...input, id: `pl_${this.seq}` };
    this.places.set(place.id, place);
    return place;
  }

  get(id: string): Place | undefined {
    return this.places.get(id);
  }

  /** Learned places gain confidence when a courier completes a stop there without correction. */
  reinforce(id: string, delta = 0.1): Place | undefined {
    const p = this.places.get(id);
    if (!p) return undefined;
    const next = { ...p, confidence: Math.min(1, Math.max(0, p.confidence + delta)) };
    this.places.set(id, next);
    return next;
  }

  nearby(cityId: string, pin: LatLng, radiusKm: number): Array<Place & { distanceKm: number }> {
    return [...this.places.values()]
      .filter((p) => p.cityId === cityId)
      .map((p) => ({ ...p, distanceKm: distanceKm(pin, p.pin) }))
      .filter((p) => p.distanceKm <= radiusKm)
      .sort((a, b) => a.distanceKm - b.distanceKm);
  }
}
