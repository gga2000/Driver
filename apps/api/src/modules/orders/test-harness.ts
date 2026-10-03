import { createHash } from 'node:crypto';
import type { LatLng, PlaceOrderInput } from '@driver/contracts';
import { FakeClock } from '../../shared/clock.js';
import { NoDatabaseRunner, UnitOfWork } from '../../shared/db/unit-of-work.js';
import { InMemoryQueue } from '../../shared/queue.js';
import { ConfigService } from '../config/index.js';
import { PricingService } from '../pricing/index.js';
import { InMemoryTripsRepository, RecordingTripEvents, TripsService, type TripTimerJob } from '../trips/index.js';
import { RecordingOrderEvents } from './events.adapter.js';
import { InMemoryMerchantDirectory } from './merchants.port.js';
import { InMemoryOrdersRepository } from './orders.repository.js';
import { OrdersService, type OrderTimerJob } from './orders.service.js';
import type { ParticipantResolver } from './participants.js';

/** Stand-in for identity's peppered HMAC: deterministic, and the number cannot be read back from it. */
export function fakePhoneHash(phone: string): string {
  return createHash('sha256').update(`test-pepper:${phone}`).digest('hex');
}

export const KITCHEN: LatLng = { lat: 32.9105, lng: 45.0665 };
export const HOME: LatLng = { lat: 32.9185, lng: 45.0712 };

/**
 * Orders + trips on in-memory everything, one fake clock, two in-memory timer queues, and a fake
 * outbox that forwards trip events to `orders.onTripEvent` when `deliver()` (or `advance`) runs.
 * Start: Saturday 2026-10-03 12:00 Baghdad.
 */
export function ordersHarness(start = '2026-10-03T09:00:00Z') {
  const clock = new FakeClock(start);
  const uow = new UnitOfWork(new NoDatabaseRunner());

  const tripEvents = new RecordingTripEvents();
  const tripsQueue = new InMemoryQueue<TripTimerJob>('trips.timers', () => clock.now());
  const tripsRepo = new InMemoryTripsRepository();
  const trips = new TripsService(tripsRepo, tripEvents, uow, clock, tripsQueue);
  trips.onModuleInit();

  const repo = new InMemoryOrdersRepository();
  const events = new RecordingOrderEvents();
  const queue = new InMemoryQueue<OrderTimerJob>('orders.timers', () => clock.now());
  const merchants = new InMemoryMerchantDirectory();
  merchants.add('rest_1');
  const people = new Map<string, string>(); // phone → personId
  const resolver: ParticipantResolver = { resolvePhone: async (phone) => ({ personId: people.get(phone) ?? null, phoneHash: fakePhoneHash(phone) }) };
  const pricing = new PricingService(new ConfigService());
  const orders = new OrdersService(repo, events, uow, clock, queue, trips, pricing, merchants, resolver);
  orders.onModuleInit();

  tripEvents.onEvent((e) => orders.onTripEvent({ type: e.type, tripId: e.tripId!, actorId: e.actorId, occurredAt: e.occurredAt, ...(e.orderId ? { orderId: e.orderId } : {}), payload: e.payload }));

  /** Publishes pending trip events to orders (the outbox drain). */
  const deliver = () => tripEvents.deliver();

  /** Moves time, runs every due timer on both queues and publishes what they emitted. */
  async function advance(ms: number): Promise<void> {
    clock.advance(ms);
    for (let i = 0; i < 5; i++) {
      const n = (await queue.drain()) + (await tripsQueue.drain()) + (await deliver());
      if (n === 0) break;
    }
  }

  function foodInput(patch: Partial<PlaceOrderInput> = {}): PlaceOrderInput {
    return {
      cityId: 'aziziyah',
      type: 'food',
      merchantOrgId: 'rest_1',
      lines: [
        { catalogItemId: 'kebab', qty: 2, unitPriceIqd: 5000 },
        { catalogItemId: 'tikka', qty: 1, unitPriceIqd: 5000 },
      ],
      deliveryFeeIqd: 1000,
      serviceFeeIqd: 500,
      ...patch,
    };
  }

  /** The courier trip dispatch (Step 5) would create for an order. */
  async function tripFor(orderId: string, opts: { vertical?: 'food' | 'taxi'; driverId?: string; vehicleClass?: 'bike' | 'tuktuk' | 'car' } = {}) {
    const order = await orders.get(orderId);
    const t = await trips.createForOrders({
      cityId: 'aziziyah',
      vertical: opts.vertical ?? 'food',
      orders: [{ orderId, minVehicleClass: order.minVehicleClass }],
      stops: [
        { orderId, type: 'pickup', zoneKey: 'centre', target: KITCHEN },
        { orderId, type: 'dropoff', zoneKey: 'zakur', target: HOME },
      ],
    });
    await trips.offer(t.id);
    const driverId = opts.driverId ?? 'd1';
    await trips.accept(t.id, driverId, { vehicleClass: opts.vehicleClass ?? 'tuktuk' });
    await deliver();
    return trips.get(t.id);
  }

  async function pickup(tripId: string, driverId = 'd1') {
    const t = await trips.get(tripId);
    const s = t.stops.find((x) => x.type === 'pickup')!;
    await trips.arrive(tripId, s.id, driverId, { pin: KITCHEN });
    await trips.completeStop(tripId, s.id, driverId);
    await deliver();
  }

  async function dropoff(tripId: string, opts: { cashCollectedIqd?: number; driverId?: string } = {}) {
    const driverId = opts.driverId ?? 'd1';
    const t = await trips.get(tripId);
    const s = t.stops.find((x) => x.type === 'dropoff')!;
    await trips.arrive(tripId, s.id, driverId, { pin: HOME });
    await trips.completeStop(tripId, s.id, driverId, { handover: { ...(opts.cashCollectedIqd !== undefined ? { cashCollectedIqd: opts.cashCollectedIqd } : {}) } });
    await deliver();
  }

  return { clock, uow, trips, tripsRepo, tripEvents, tripsQueue, repo, events, queue, merchants, people, orders, deliver, advance, foodInput, tripFor, pickup, dropoff };
}
