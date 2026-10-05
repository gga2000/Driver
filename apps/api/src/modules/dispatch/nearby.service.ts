import { createHmac, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { NEARBY_RULES, type LatLng, type NearbyVehicles, type NearbyVehiclesInput, type VehicleClass } from '@driver/contracts';
import { CLOCK, type Clock } from '../../shared/clock.js';
import { EtaService } from '../routing/index.js';
import { offsetPin } from './geo.js';
import { OfferOrchestrator } from './offer.orchestrator.js';
import { PresenceService } from './presence.service.js';
import { vehicleFit } from './vehicles.js';

export const NEARBY_SECRET = Symbol('NEARBY_SECRET');

/** What the customer's map draws for each vertical (the one ETA's vehicle too). */
const DRAWN_AS: Record<NearbyVehiclesInput['vertical'], VehicleClass> = { taxi: 'car', tuktuk: 'tuktuk' };

/** The 10-minute window `nowMs` falls in: inside it a driver's blur stays put. */
export function jitterBucket(nowMs: number): number {
  return Math.floor(nowMs / (NEARBY_RULES.jitterBucketMin * 60_000));
}

/**
 * Where a free vehicle is drawn for customers (maps program c10): moved 50–100 m in a direction only
 * the server can work out (HMAC of the driver and the window). The same offset for the whole window,
 * so refreshes do not make him jump and many reads cannot average the blur away; a new window, a new
 * offset.
 */
export function jitterPin(pin: LatLng, driverId: string, bucket: number, secret: string): LatLng {
  const h = createHmac('sha256', secret).update(`nearby:${driverId}:${bucket}`).digest();
  const dist = NEARBY_RULES.jitterMinM + (h.readUInt16BE(0) / 0xffff) * (NEARBY_RULES.jitterMaxM - NEARBY_RULES.jitterMinM);
  const dir = (h.readUInt16BE(2) / 0x10000) * 360;
  return offsetPin(pin, dist, dir);
}

/**
 * Free taxis and tuktuks around a customer about to book (`dispatch.nearby`, maps program c10).
 * Free = online, vehicle and roles fit the vertical, no job. Nearest first, at most eight within
 * 3 km, blurred, never named; the nearest one's minutes to the pickup come from his real position on
 * the one ETA.
 */
@Injectable()
export class NearbyService {
  constructor(
    private readonly presence: PresenceService,
    @Inject(OfferOrchestrator) private readonly jobs: Pick<OfferOrchestrator, 'idle'>,
    private readonly eta: EtaService,
    @Inject(NEARBY_SECRET) private readonly secret: string,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async nearby(input: NearbyVehiclesInput): Promise<NearbyVehicles> {
    const now = this.clock.now();
    const around = await this.presence.nearby(input.cityId, input.pin, NEARBY_RULES.radiusM / 1000);
    const free: Array<{ driverId: string; pin: LatLng; heading: number | null }> = [];
    for (const { presence: p } of around) {
      if (free.length >= NEARBY_RULES.max) break;
      if (vehicleFit(input.vertical, p.vehicle) === 0) continue;
      if (p.verticals && !p.verticals.includes(input.vertical)) continue;
      if (!(await this.jobs.idle(p.driverId))) continue;
      free.push({ driverId: p.driverId, pin: { lat: p.lat, lng: p.lng }, heading: p.heading ?? null });
    }
    const bucket = jitterBucket(now.getTime());
    const minutes = free.length > 0 ? await this.eta.fromMany(free.map((f) => f.pin), input.pin, DRAWN_AS[input.vertical]) : [];
    const known = minutes.filter((m): m is NonNullable<typeof m> => m !== null).map((m) => m.minutes);
    return {
      vehicles: free.map((f) => ({ ...jitterPin(f.pin, f.driverId, bucket, this.secret), heading: f.heading })),
      nearestMinutes: known.length > 0 ? Math.min(...known) : null,
      at: now,
    };
  }
}

/** A per-process secret when none is configured (the blur then changes across instances — dev only). */
export function nearbySecret(): string {
  return process.env['NEARBY_JITTER_SECRET'] ?? process.env['JWT_SECRET'] ?? randomBytes(32).toString('hex');
}
