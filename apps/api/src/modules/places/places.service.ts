import { Inject, Injectable, Optional } from '@nestjs/common';
import type { LatLng, Place } from '@driver/contracts';
import { InMemoryPlacesRepository, PLACES_REPOSITORY, type PlacesRepository } from './places.repository.js';
import { pointInRing, type ZonePolygon } from './zones.js';

/**
 * Learned/landmark places (courier reinforcement, nearby search), behind `PlacesRepository` (Prisma
 * `places` with DATABASE_URL, in memory otherwise). Customers' saved places: `SavedPlacesService`.
 */
@Injectable()
export class PlacesService {
  private readonly zonesByCity = new Map<string, ZonePolygon[]>();
  private readonly repo: PlacesRepository;

  constructor(@Optional() @Inject(PLACES_REPOSITORY) repo?: PlacesRepository) {
    this.repo = repo ?? new InMemoryPlacesRepository();
  }

  registerZones(cityId: string, zones: ZonePolygon[]): void {
    this.zonesByCity.set(cityId, zones);
  }

  /** Resolves the zone a pin falls into; `fallback` (the city's edge zone by convention) when no polygon matches. */
  zoneFor(cityId: string, pin: LatLng, fallback = 'edge'): string {
    for (const z of this.zonesByCity.get(cityId) ?? []) if (pointInRing(pin, z.ring)) return z.zoneId;
    return fallback;
  }

  save(input: Omit<Place, 'id'>): Promise<Place> {
    return this.repo.save(input);
  }

  async get(id: string): Promise<Place | undefined> {
    return (await this.repo.get(id)) ?? undefined;
  }

  /** Learned places gain confidence when a courier completes a stop there without correction. */
  async reinforce(id: string, delta = 0.1): Promise<Place | undefined> {
    const p = await this.repo.get(id);
    if (!p) return undefined;
    return (await this.repo.setConfidence(id, Math.min(1, Math.max(0, p.confidence + delta)))) ?? undefined;
  }

  /** The city's landmark places (shared city knowledge), by name. */
  async landmarks(cityId: string): Promise<Place[]> {
    return (await this.repo.landmarks(cityId)).sort((a, b) => a.name.localeCompare(b.name, 'ar') || a.id.localeCompare(b.id));
  }

  nearby(cityId: string, pin: LatLng, radiusKm: number): Promise<Array<Place & { distanceKm: number }>> {
    return this.repo.nearby(cityId, pin, radiusKm);
  }
}
