import { describe, expect, it } from 'vitest';
import { FakeClock } from '../../shared/clock.js';
import { NoDatabaseRunner, UnitOfWork } from '../../shared/db/unit-of-work.js';
import { InMemoryQueue } from '../../shared/queue.js';
import { ConfigService } from '../config/index.js';
import { DispatchService } from '../dispatch/index.js';
import { EventsService } from '../events/index.js';
import { LedgerService } from '../ledger/index.js';
import { InMemoryLedgerRepository } from '../ledger/repository.js';
import { PricingService } from '../pricing/index.js';
import { InMemoryTripsRepository, TripEventsAdapter, TripsService, type TripTimerJob } from '../trips/index.js';
import { SimulatorService, rng } from './simulator.service.js';

function build() {
  const config = new ConfigService();
  const events = new EventsService();
  const clock = new FakeClock();
  const trips = new TripsService(
    new InMemoryTripsRepository(),
    new TripEventsAdapter(events),
    new UnitOfWork(new NoDatabaseRunner()),
    clock,
    new InMemoryQueue<TripTimerJob>('trips.timers', () => clock.now()),
  );
  return {
    events,
    sim: new SimulatorService(new PricingService(config), new DispatchService(config), trips, new LedgerService(new InMemoryLedgerRepository())),
  };
}

/** One taxi trip's event trail on the Step 4 machine: offer → accept → two stops → completed. */
const TRIP_TRAIL = [
  'trip.created',
  'trip.offered',
  'trip.accepted',
  'trip.en_route',
  'stop.arrived',
  'trip.progressed', // arrived_pickup
  'stop.completed',
  'trip.progressed', // in_transit
  'stop.arrived',
  'trip.progressed', // arrived_dropoff
  'stop.completed',
  'trip.completed',
];

describe('SimulatorService', () => {
  it('runs quote → dispatch → complete → ledger for fake Aziziyah trips and the book balances', async () => {
    const { sim, events } = build();
    const r = await sim.run({ cityId: 'aziziyah', trips: 25, drivers: 6, seed: 42 });
    expect(r.trips).toBe(25);
    expect(r.completed).toBe(25);
    expect(r.noDrivers).toBe(0);
    expect(r.totalFaresIqd % 250).toBe(0);
    expect(r.ledgerBalanced).toBe(true);
    // every completed trip emitted the full state sequence as events
    expect(events.forTrip('trip_1').map((e) => e.type)).toEqual(TRIP_TRAIL);
    expect(events.pendingOutbox()).toBeGreaterThan(0);
    expect(events.drain()).toBe(25 * TRIP_TRAIL.length);
    expect(events.pendingOutbox()).toBe(0);
  });

  it('cancels trips when no drivers are online', async () => {
    const { sim } = build();
    const r = await sim.run({ cityId: 'aziziyah', trips: 3, drivers: 0, seed: 7 });
    expect(r.completed).toBe(0);
    expect(r.noDrivers).toBe(3);
    expect(r.ledgerBalanced).toBe(true);
  });

  it('is deterministic for a seed', async () => {
    const a = await build().sim.run({ cityId: 'aziziyah', trips: 10, drivers: 3, seed: 99 });
    const b = await build().sim.run({ cityId: 'aziziyah', trips: 10, drivers: 3, seed: 99 });
    expect(a).toEqual(b);
    const r = rng(5);
    expect([r(), r()]).toEqual([rng(5)(), (() => { const q = rng(5); q(); return q(); })()]);
  });
});
