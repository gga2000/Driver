import { describe, expect, it } from 'vitest';
import { DriverError } from '@driver/contracts';
import { appRouter } from '@driver/contracts/router';
import { NoDatabaseRunner, UnitOfWork } from '../../shared/db/unit-of-work.js';
import { InMemoryQueue } from '../../shared/queue.js';
import { ConfigService } from '../config/index.js';
import { TripsRpc } from '../trips/index.js';
import { tripsHarness } from '../trips/test-harness.js';
import { InMemoryDispatchRepository } from './dispatch.repository.js';
import { DispatchService } from './dispatch.service.js';
import { InMemoryDispatchStore } from './dispatch.store.js';
import { RecordingEventEmitter } from './events.adapter.js';
import { InMemoryGeoIndex } from './geo-index.js';
import { DispatchOfferCheck } from './offer-check.js';
import { OfferOrchestrator, type TimerJob } from './offer.orchestrator.js';
import { FakeCaps, FakeDepartures } from './ports.js';
import { PresenceService } from './presence.service.js';
import { north } from './test-harness.js';
import { TripsServiceTripOffers } from './trips.adapter.js';
import { ZoneDirectory } from './zones.js';

const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return 'ok';
  } catch (err) {
    return err instanceof DriverError ? err.code : String(err);
  }
};

/** Real trips + real dispatch over in-memory stores, wired the way `DispatchModule` wires them. */
function wired() {
  const t = tripsHarness();
  const config = new ConfigService();
  const zones = new ZoneDirectory(config);
  const presence = new PresenceService(new InMemoryGeoIndex(() => t.clock.now()), zones, t.clock);
  const repo = new InMemoryDispatchRepository();
  const caps = new FakeCaps();
  const orchestrator = new OfferOrchestrator(
    config,
    presence,
    zones,
    repo,
    new InMemoryDispatchStore(() => t.clock.now()),
    new RecordingEventEmitter(),
    new TripsServiceTripOffers(t.trips),
    caps,
    new FakeDepartures(),
    new InMemoryQueue<TimerJob>('dispatch', () => t.clock.now()),
    t.clock,
    new UnitOfWork(new NoDatabaseRunner()),
  );
  t.trips.bindOfferCheck(new DispatchOfferCheck(repo, caps, () => t.clock.now()));
  const dispatch = new DispatchService(config, undefined, undefined, orchestrator, presence);
  const actor = (personId: string) => ({ personId, sessionId: `s-${personId}` });
  async function rideOffered() {
    for (const [id, km] of [['a1', 0.2], ['a2', 0.4]] as const) await presence.online(id, { cityId: 'aziziyah', at: north(km), vehicle: 'car', tier: 'bronze' });
    const trip = await t.foodTrip('ord_r', { vertical: 'taxi' });
    await dispatch.request({ tripId: trip.id, cityId: 'aziziyah', vertical: 'taxi', zoneId: 'centre', pickup: north(0) });
    const offers = await repo.listByTrip(trip.id);
    return { trip, offerOf: (d: string) => offers.find((o) => o.driverId === d)! };
  }
  return { ...t, repo, caps, dispatch, actor, presence, rideOffered };
}

describe('accept only via an open DispatchOffer (M2 review follow-up)', () => {
  it('trips.accept / decline refuse a driver with no open offer: offer_not_found, offer_not_yours', async () => {
    const h = wired();
    // A trip on offer that dispatch never offered to anyone.
    const bare = await h.foodTrip('ord_bare');
    await h.trips.offer(bare.id);
    expect(await code(h.trips.accept(bare.id, 'x1', { vehicleClass: 'car' }))).toBe('offer_not_found');
    expect(await code(h.trips.decline(bare.id, 'x1'))).toBe('offer_not_found');

    // Dispatch offered a1 and a2; x1 has no offer of his own.
    const { trip } = await h.rideOffered();
    expect(await code(h.trips.accept(trip.id, 'x1', { vehicleClass: 'car' }))).toBe('offer_not_yours');
    expect(await code(h.trips.decline(trip.id, 'x1'))).toBe('offer_not_yours');
    expect((await h.trips.get(trip.id)).courierId).toBeNull();
  });

  it('over-cap drivers can never accept, even holding the offer', async () => {
    const h = wired();
    const { trip, offerOf } = await h.rideOffered();
    h.caps.over.add('a1');
    expect(await code(h.trips.accept(trip.id, 'a1', { vehicleClass: 'car' }))).toBe('over_cap');
    expect(await code(h.dispatch.respond(h.actor('a1'), { offerId: offerOf('a1').id, accept: true }))).toBe('over_cap');
    expect((await h.trips.get(trip.id)).state).toBe('offered');
  });

  it('dispatch.respond is the path: an accepted offer assigns the trip; a decline is recorded on trips', async () => {
    const h = wired();
    const { trip, offerOf } = await h.rideOffered();
    await h.dispatch.respond(h.actor('a2'), { offerId: offerOf('a2').id, accept: false });
    expect(h.events.last('trip.declined')!.payload).toMatchObject({ driverId: 'a2', othersPending: true });
    const res = await h.dispatch.respond(h.actor('a1'), { offerId: offerOf('a1').id, accept: true });
    expect(res).toMatchObject({ outcome: 'assigned', tripId: trip.id });
    expect((await h.trips.get(trip.id))).toMatchObject({ courierId: 'a1', state: 'en_route_to_pickup' });
    // Once the offer is consumed, a2 (declined) cannot slip in through trips.
    expect(await code(h.trips.accept(trip.id, 'a2', { vehicleClass: 'car' }))).toBe('offer_not_yours');
  });

  it('the public API has no trips.accept / trips.decline: drivers answer offers through dispatch.respond', () => {
    const procedures = Object.keys(appRouter._def.procedures);
    expect(procedures).toContain('dispatch.respond');
    expect(procedures).not.toContain('trips.accept');
    expect(procedures).not.toContain('trips.decline');
    expect('accept' in TripsRpc.prototype).toBe(false);
    expect('decline' in TripsRpc.prototype).toBe(false);
  });
});
