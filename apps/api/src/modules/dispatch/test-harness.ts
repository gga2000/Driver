import { AZIZIYAH_CENTRE, type LatLng, type VehicleClass, type Vertical } from '@driver/contracts';
import { FakeClock } from '../../shared/clock.js';
import { NoDatabaseRunner, UnitOfWork } from '../../shared/db/unit-of-work.js';
import { InMemoryQueue } from '../../shared/queue.js';
import { ConfigService } from '../config/index.js';
import { InMemoryDispatchRepository } from './dispatch.repository.js';
import { DispatchService } from './dispatch.service.js';
import { InMemoryDispatchStore } from './dispatch.store.js';
import { RecordingEventEmitter } from './events.adapter.js';
import { InMemoryGeoIndex, type DriverPresence } from './geo-index.js';
import { OfferOrchestrator, type TimerJob } from './offer.orchestrator.js';
import { FakeCaps, FakeDepartures, FakeTripOffers } from './ports.js';
import { PresenceService } from './presence.service.js';
import { InMemoryVehicleFacts } from './vehicle-facts.js';
import { ZoneDirectory } from './zones.js';

/** Km per degree of latitude on the haversine sphere (R = 6371 km), so `north(1)` is exactly 1 km away. */
const KM_PER_DEG = (6371 * Math.PI) / 180;

/** A point `km` north (positive) or south of `from` (default: Aziziyah centre). */
export function north(km: number, from: LatLng = AZIZIYAH_CENTRE): LatLng {
  return { lat: from.lat + km / KM_PER_DEG, lng: from.lng };
}

/** Builds the whole dispatch stack on in-memory everything and a fake clock. Shared by the unit tests. */
export function dispatchHarness(start = '2026-10-03T09:00:00Z', config = new ConfigService()) {
  const clock = new FakeClock(start);
  const zones = new ZoneDirectory(config);
  const geo = new InMemoryGeoIndex(() => clock.now());
  const presence = new PresenceService(geo, zones, clock);
  const repo = new InMemoryDispatchRepository();
  const store = new InMemoryDispatchStore(() => clock.now());
  const events = new RecordingEventEmitter();
  const trips = new FakeTripOffers();
  const caps = new FakeCaps();
  const departures = new FakeDepartures();
  const queue = new InMemoryQueue<TimerJob>('dispatch', () => clock.now());
  const uow = new UnitOfWork(new NoDatabaseRunner());
  const facts = new InMemoryVehicleFacts();
  const orchestrator = new OfferOrchestrator(config, presence, zones, repo, store, events, trips, caps, departures, queue, clock, uow, undefined, undefined, facts);
  const service = new DispatchService(config, undefined, undefined, orchestrator, presence, undefined, undefined, facts);

  /** Drivers whose app keeps heartbeating (every 30 s) while the clock advances. */
  const keepAlive = new Set<string>();

  /** Advances the clock one second at a time, running every timer as it falls due. */
  async function advance(seconds: number) {
    for (let i = 0; i < seconds; i += 1) {
      clock.advanceSeconds(1);
      if (clock.now().getTime() % 30_000 === 0) await heartbeatAll([...keepAlive]);
      await queue.drain();
    }
  }

  /** Puts a driver online `km` north of the centre. */
  async function online(
    driverId: string,
    km: number,
    opts: { vehicle?: VehicleClass; tier?: DriverPresence['tier']; vetted?: boolean; edgeOptIn?: boolean; zoneId?: string; at?: LatLng; verticals?: readonly Vertical[] } = {},
  ) {
    return presence.online(driverId, {
      cityId: 'aziziyah',
      at: opts.at ?? north(km),
      vehicle: opts.vehicle ?? 'car',
      tier: opts.tier ?? 'bronze',
      ...(opts.verticals !== undefined ? { verticals: opts.verticals } : {}),
      ...(opts.vetted !== undefined ? { vetted: opts.vetted } : {}),
      ...(opts.edgeOptIn !== undefined ? { edgeOptIn: opts.edgeOptIn } : {}),
      ...(opts.zoneId !== undefined ? { zoneId: opts.zoneId } : {}),
    });
  }

  /** Keeps every listed driver's presence alive (heartbeat in place). */
  async function heartbeatAll(ids: string[]) {
    for (const id of ids) {
      const p = await presence.get(id);
      if (p) await presence.heartbeat(id, p);
    }
  }

  async function offers(tripId: string) {
    return repo.listByTrip(tripId);
  }

  async function openOffer(tripId: string, driverId: string) {
    return (await repo.listByTrip(tripId)).find((o) => o.driverId === driverId && (o.state === 'sent' || o.state === 'seen'));
  }

  const actor = (personId: string) => ({ personId, sessionId: `s-${personId}` });

  return { clock, config, zones, geo, presence, repo, store, events, trips, caps, departures, queue, uow, facts, orchestrator, service, advance, keepAlive, online, heartbeatAll, offers, openOffer, actor };
}
