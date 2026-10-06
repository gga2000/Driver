import { Inject, Injectable } from '@nestjs/common';
import {
  AZIZIYAH_ZONES,
  DEMAND_MAP_RULES,
  demandZones,
  DriverError,
  forecastWindows,
  NUDGE_RULES,
  WAITING_STATUSES,
  type NudgeZoneInput,
  type NudgeZoneResult,
  type PartnerDemandMap,
} from '@driver/contracts';
import { CLOCK, type Clock } from '../../shared/clock.js';
import { TripsService } from '../trips/index.js';
import { DISPATCH_EVENTS, type DispatchEventEmitter } from './events.adapter.js';
import { haversineKm } from './geo.js';
import { OfferOrchestrator } from './offer.orchestrator.js';
import { PresenceService } from './presence.service.js';
import { ZoneDirectory } from './zones.js';

const MIN_MS = 60_000;
/** The forecast is re-read at most this often per city (history does not move). */
const FORECAST_CACHE_MS = 5 * MIN_MS;

/**
 * Where the work is, for the Console (maps program o5): per zone the jobs waiting now, the pickups
 * this hour usually brings and the drivers there (the same rule the driver's home map uses), and
 * "send drivers here": a push to the free drivers around a busy zone, at most once per zone per
 * `NUDGE_RULES.cooldownMin`.
 */
@Injectable()
export class ZoneDemandService {
  private readonly forecasts = new Map<string, { bucket: number; byZone: Map<string, number> }>();
  private readonly lastNudge = new Map<string, number>();

  constructor(
    @Inject(PresenceService) private readonly presence: Pick<PresenceService, 'list'>,
    @Inject(OfferOrchestrator) private readonly orchestrator: Pick<OfferOrchestrator, 'board' | 'idle'>,
    @Inject(TripsService) private readonly trips: Pick<TripsService, 'pickupsByZone'>,
    @Inject(ZoneDirectory) private readonly zones: Pick<ZoneDirectory, 'centre'>,
    @Inject(DISPATCH_EVENTS) private readonly events: DispatchEventEmitter,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async demand(cityId: string): Promise<PartnerDemandMap> {
    const now = this.clock.now();
    const [board, drivers, expected] = await Promise.all([this.orchestrator.board(cityId), this.presence.list(cityId), this.expected(cityId, now)]);
    const waiting = board.cards.filter((c) => WAITING_STATUSES.has(c.status)).map((c) => c.zoneId);
    return { zones: demandZones(waiting, drivers.map((d) => d.zoneId), expected), at: now };
  }

  async nudge(actorId: string, input: NudgeZoneInput): Promise<NudgeZoneResult> {
    const now = this.clock.now();
    const key = `${input.cityId}:${input.zoneId}`;
    const last = this.lastNudge.get(key);
    const cooldown = NUDGE_RULES.cooldownMin * MIN_MS;
    if (last !== undefined && now.getTime() - last < cooldown) throw new DriverError('nudge_too_soon');
    const centre = this.zones.centre(input.cityId, input.zoneId);
    if (!centre) throw new DriverError('zone_unknown');
    const near: Array<{ driverId: string; km: number }> = [];
    for (const p of await this.presence.list(input.cityId)) {
      if (p.zoneId === input.zoneId) continue;
      const km = haversineKm(centre, p);
      if (km > NUDGE_RULES.radiusKm || !(await this.orchestrator.idle(p.driverId))) continue;
      near.push({ driverId: p.driverId, km });
    }
    const driverIds = near
      .sort((a, b) => a.km - b.km)
      .slice(0, NUDGE_RULES.maxDrivers)
      .map((d) => d.driverId);
    this.lastNudge.set(key, now.getTime());
    const zoneName = AZIZIYAH_ZONES.find((z) => z.id === input.zoneId)?.name_ar ?? input.zoneId;
    // The notify subscriber turns this into one `partner_zone_nudge` push per driver.
    await this.events.emit(undefined, { actorId, type: 'dispatch.zone_nudged', occurredAt: now, payload: { cityId: input.cityId, zoneId: input.zoneId, zoneName_ar: zoneName, driverIds } }, { name: 'zone', id: input.zoneId });
    return { sent: driverIds.length, nextAt: new Date(now.getTime() + cooldown) };
  }

  /** Pickups this coming hour, same weekday, averaged over the last weeks; five minutes per city. */
  private async expected(cityId: string, now: Date): Promise<Map<string, number>> {
    const bucket = Math.floor(now.getTime() / FORECAST_CACHE_MS);
    const hit = this.forecasts.get(cityId);
    if (hit && hit.bucket === bucket) return hit.byZone;
    const byZone = new Map<string, number>();
    for (const w of forecastWindows(now, DEMAND_MAP_RULES.weeks)) {
      for (const [zone, n] of await this.trips.pickupsByZone(cityId, w.from, w.to)) byZone.set(zone, (byZone.get(zone) ?? 0) + n / DEMAND_MAP_RULES.weeks);
    }
    this.forecasts.set(cityId, { bucket, byZone });
    return byZone;
  }
}
