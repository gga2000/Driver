import { Injectable } from '@nestjs/common';
import type { LatLng, Place } from '@driver/contracts';
import { distanceKm, pointInRing, type ZonePolygon } from './zones.js';

/** Learned/landmark places (courier reinforcement, nearby search). Customers' saved places: `SavedPlacesService`. */
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

  /** The city's landmark places (shared city knowledge), by name. */
  landmarks(cityId: string): Place[] {
    return [...this.places.values()].filter((p) => p.cityId === cityId && p.landmark).sort((a, b) => a.name.localeCompare(b.name, 'ar'));
  }

  nearby(cityId: string, pin: LatLng, radiusKm: number): Array<Place & { distanceKm: number }> {
    return [...this.places.values()]
      .filter((p) => p.cityId === cityId)
      .map((p) => ({ ...p, distanceKm: distanceKm(pin, p.pin) }))
      .filter((p) => p.distanceKm <= radiusKm)
      .sort((a, b) => a.distanceKm - b.distanceKm);
  }
}
