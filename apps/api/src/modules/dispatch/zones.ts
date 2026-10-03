import { Injectable } from '@nestjs/common';
import { AZIZIYAH_ZONES, type LatLng, type ZoneTier } from '@driver/contracts';
import { ConfigService } from '../config/index.js';
import { haversineKm } from './geo.js';

interface ZoneGeo {
  id: string;
  centre: LatLng;
  radiusKm: number;
  group: string;
}

/** Zones whose centroids are this close (plus both radii) count as adjacent for batching. */
export const ADJACENT_SLACK_KM = 0.4;

/**
 * What dispatch needs to know about zones: which zone a position falls in, a zone's tier, and
 * whether two zones are adjacent (batching). Draft geometry comes from the seed centroids in
 * `@driver/contracts` (AI-drafted until drivers verify them in Partner); tiers come from the city
 * config so pricing and dispatch agree. When PostGIS polygons land, only this file changes.
 */
@Injectable()
export class ZoneDirectory {
  private readonly geo = new Map<string, Map<string, ZoneGeo>>();

  constructor(private readonly config: ConfigService) {
    this.geo.set(
      'aziziyah',
      new Map(AZIZIYAH_ZONES.map((z) => [z.id, { id: z.id, centre: { lat: z.lat, lng: z.lng }, radiusKm: z.radiusM / 1000, group: z.group }])),
    );
  }

  tier(cityId: string, zoneId: string): ZoneTier | undefined {
    return this.config.city(cityId)?.zones.find((z) => z.id === zoneId)?.tier;
  }

  isEdge(cityId: string, zoneId: string | undefined): boolean {
    return zoneId !== undefined && this.tier(cityId, zoneId) === 'edge';
  }

  centre(cityId: string, zoneId: string): LatLng | undefined {
    return this.geo.get(cityId)?.get(zoneId)?.centre;
  }

  /** The city's first centre-tier zone: where a job with no known place is anchored (and flagged by its caller). */
  defaultZone(cityId: string): string | undefined {
    const zones = this.config.city(cityId)?.zones ?? [];
    return (zones.find((z) => z.tier === 'centre') ?? zones[0])?.id;
  }

  /** Nearest zone centroid to a position (draft: centroid-nearest until polygons are verified). */
  zoneAt(cityId: string, at: LatLng): string | undefined {
    let best: { id: string; d: number } | undefined;
    for (const z of this.geo.get(cityId)?.values() ?? []) {
      const d = haversineKm(at, z.centre) - z.radiusKm;
      if (!best || d < best.d) best = { id: z.id, d };
    }
    return best?.id;
  }

  /** Same zone, same named group (e.g. the four حواس zones) or touching draft circles. */
  adjacent(cityId: string, a: string, b: string): boolean {
    if (a === b) return true;
    const zones = this.geo.get(cityId);
    const za = zones?.get(a);
    const zb = zones?.get(b);
    if (!za || !zb) return false;
    if (za.group === zb.group && za.group !== 'near' && za.group !== 'mid' && za.group !== 'edge') return true;
    return haversineKm(za.centre, zb.centre) <= za.radiusKm + zb.radiusKm + ADJACENT_SLACK_KM;
  }
}
