import type { Tx } from '@driver/db';
import type { LatLng, VehicleClass, Vertical } from '@driver/contracts';
import { FakeClock } from '../../shared/clock.js';
import { UnitOfWork, type TransactionRunner } from '../../shared/db/unit-of-work.js';
import { InMemoryQueue } from '../../shared/queue.js';
import { RecordingTripEvents } from './events.adapter.js';
import { offsetNorth } from './geofence.js';
import { ScriptedOfferCheck } from './offer-check.port.js';
import { InMemoryTripsRepository, type NewStop } from './trips.repository.js';
import { TripsService, type TripTimerJob } from './trips.service.js';

/** Restaurant and two homes in Aziziyah, roughly 1 km apart. */
export const PINS = {
  kitchen: { lat: 32.9105, lng: 45.0665 },
  home: { lat: 32.9185, lng: 45.0712 },
  home2: { lat: 32.9032, lng: 45.0598 },
  school: { lat: 32.915, lng: 45.06 },
} satisfies Record<string, LatLng>;

/** Fake transaction runner: one fake Tx per run; records commits and rollbacks. */
export function fakeRunner() {
  const log: string[] = [];
  let n = 0;
  const runner: TransactionRunner = {
    async $transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
      n += 1;
      try {
        const out = await fn({ txId: n } as unknown as Tx);
        log.push(`commit ${n}`);
        return out;
      } catch (err) {
        log.push(`rollback ${n}`);
        throw err;
      }
    },
  };
  return { runner, log };
}

/** TripsService on in-memory everything with a fake clock and an in-memory timer queue. */
export function tripsHarness(start = '2026-10-03T09:00:00Z') {
  const clock = new FakeClock(start);
  const repo = new InMemoryTripsRepository();
  const events = new RecordingTripEvents();
  const { runner, log } = fakeRunner();
  const uow = new UnitOfWork(runner);
  const queue = new InMemoryQueue<TripTimerJob>('trips.timers', () => clock.now());
  const trips = new TripsService(repo, events, uow, clock, queue);
  trips.onModuleInit();
  // Stands in for dispatch's open-offer check (dispatch is not in this harness): everything passes
  // unless a test scripts a verdict.
  const offerCheck = new ScriptedOfferCheck();
  trips.bindOfferCheck(offerCheck);

  /** Advances the clock and runs every timer now due. */
  async function advance(ms: number): Promise<number> {
    clock.advance(ms);
    return queue.drain();
  }

  function deliveryStops(orderId: string, from: LatLng = PINS.kitchen, to: LatLng = PINS.home): NewStop[] {
    return [
      { orderId, type: 'pickup', zoneKey: 'centre', target: from },
      { orderId, type: 'dropoff', zoneKey: 'zakur', target: to },
    ];
  }

  async function foodTrip(orderId = 'ord_1', opts: { minVehicleClass?: VehicleClass | null; vertical?: Vertical } = {}) {
    return trips.createForOrders({ cityId: 'aziziyah', vertical: opts.vertical ?? 'food', orders: [{ orderId, minVehicleClass: opts.minVehicleClass ?? null }], stops: deliveryStops(orderId) });
  }

  /** Created → offered → accepted (driver `d1` on a bike unless told otherwise). */
  async function acceptedTrip(orderId = 'ord_1', driverId = 'd1', opts: { vehicleClass?: VehicleClass; vertical?: Vertical } = {}) {
    const t = await foodTrip(orderId, { vertical: opts.vertical ?? 'food' });
    await trips.offer(t.id, { driverIds: [driverId] });
    return trips.accept(t.id, driverId, { vehicleClass: opts.vehicleClass ?? 'bike' });
  }

  return { clock, repo, events, uow, log, queue, trips, offerCheck, advance, deliveryStops, foodTrip, acceptedTrip, near: offsetNorth };
}
