import { Inject, Injectable } from '@nestjs/common';
import type { LatLng, VehicleClass } from '@driver/contracts';
import { CLOCK, type Clock } from '../../shared/clock.js';
import { CITY_RADIUS_KM, GEO_INDEX, PRESENCE_TTL_SEC, type DriverPresence, type GeoIndex, type NearbyDriver } from './geo-index.js';
import { ZoneDirectory } from './zones.js';

export interface GoOnlineInput {
  cityId: string;
  at: LatLng;
  vehicle: VehicleClass;
  tier: DriverPresence['tier'];
  vetted?: boolean;
  edgeOptIn?: boolean;
  /** Overrides zone resolution from the position (e.g. the app already knows). */
  zoneId?: string;
}

/**
 * Who is online and where (plan Step 5). `online` registers a driver, `heartbeat` moves them and
 * refreshes the 90-s TTL, `offline` removes them, `nearby` is what every wave searches. A driver
 * whose heartbeats stop simply expires out of the index; their next heartbeat returns null and the
 * app calls `online` again.
 */
@Injectable()
export class PresenceService {
  constructor(
    @Inject(GEO_INDEX) private readonly geo: GeoIndex,
    private readonly zones: ZoneDirectory,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async online(driverId: string, input: GoOnlineInput): Promise<DriverPresence> {
    const now = this.clock.now().getTime();
    const zoneId = input.zoneId ?? this.zones.zoneAt(input.cityId, input.at) ?? null;
    const prev = await this.geo.get(driverId);
    const p: DriverPresence = {
      driverId,
      cityId: input.cityId,
      lat: input.at.lat,
      lng: input.at.lng,
      vehicle: input.vehicle,
      tier: input.tier,
      vetted: input.vetted ?? false,
      edgeOptIn: input.edgeOptIn ?? false,
      zoneId,
      zoneSince: prev && prev.zoneId === zoneId ? prev.zoneSince : now,
      lastSeenAt: now,
    };
    await this.geo.put(p, PRESENCE_TTL_SEC);
    return p;
  }

  /** Moves the driver and refreshes the TTL; a zone change restarts the anti-camping clock. */
  async heartbeat(driverId: string, at: LatLng, patch: { zoneId?: string; edgeOptIn?: boolean } = {}): Promise<DriverPresence | null> {
    const prev = await this.geo.get(driverId);
    if (!prev) return null;
    const now = this.clock.now().getTime();
    const zoneId = patch.zoneId ?? this.zones.zoneAt(prev.cityId, at) ?? null;
    const p: DriverPresence = {
      ...prev,
      lat: at.lat,
      lng: at.lng,
      zoneId,
      zoneSince: zoneId === prev.zoneId ? prev.zoneSince : now,
      edgeOptIn: patch.edgeOptIn ?? prev.edgeOptIn,
      lastSeenAt: now,
    };
    await this.geo.put(p, PRESENCE_TTL_SEC);
    return p;
  }

  async offline(driverId: string): Promise<void> {
    const prev = await this.geo.get(driverId);
    if (prev) await this.geo.remove(prev.cityId, driverId);
  }

  get(driverId: string): Promise<DriverPresence | null> {
    return this.geo.get(driverId);
  }

  /** Live drivers near a point, nearest first; no radius = the whole city. */
  nearby(cityId: string, at: LatLng, radiusKm: number = CITY_RADIUS_KM, count?: number): Promise<NearbyDriver[]> {
    return this.geo.search(cityId, at, radiusKm, count);
  }

  /** Taking or finishing a job is not camping: restart the zone clock. */
  async resetZoneClock(driverId: string): Promise<void> {
    const prev = await this.geo.get(driverId);
    if (prev) await this.geo.put({ ...prev, zoneSince: this.clock.now().getTime() }, PRESENCE_TTL_SEC);
  }

  minutesInZone(p: DriverPresence): number {
    return Math.max(0, (this.clock.now().getTime() - p.zoneSince) / 60_000);
  }
}
