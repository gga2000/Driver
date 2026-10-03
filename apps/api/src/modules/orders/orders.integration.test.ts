import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FakeClock } from '../../shared/clock.js';
import { PrismaService } from '../../shared/db/prisma.service.js';
import { UnitOfWork } from '../../shared/db/unit-of-work.js';
import { InMemoryQueue } from '../../shared/queue.js';
import { ConfigService } from '../config/index.js';
import { PricingService } from '../pricing/index.js';
import { RecordingTripEvents, TripsService, type TripTimerJob } from '../trips/index.js';
import { PrismaTripsRepository } from '../trips/trips.repository.js';
import { RecordingOrderEvents } from './events.adapter.js';
import { InMemoryMerchantDirectory } from './merchants.port.js';
import { PrismaOrdersRepository } from './orders.repository.js';
import { OrdersService, type OrderTimerJob } from './orders.service.js';
import { HOME, KITCHEN, fakePhoneHash } from './test-harness.js';

/**
 * Orders + trips on a real Postgres+PostGIS (plan Step 4 integration): the Prisma repositories,
 * the raw-SQL geography columns (stop target pins, arrival pins, trail points), conditional state
 * updates and `trip_orders` history. Needs DATABASE_URL with the migrations deployed and the seed
 * (city `aziziyah`) loaded. Skipped otherwise.
 */
const url = process.env['DATABASE_URL'];

describe.skipIf(!url)('orders × trips on Postgres (needs DATABASE_URL)', () => {
  const prisma = new PrismaService(url);
  const uow = new UnitOfWork(prisma);
  const clock = new FakeClock('2026-10-03T09:00:00Z');
  const tripsRepo = new PrismaTripsRepository(prisma);
  const tripEvents = new RecordingTripEvents();
  const trips = new TripsService(tripsRepo, tripEvents, uow, clock, new InMemoryQueue<TripTimerJob>('trips.timers', () => clock.now()));
  const merchants = new InMemoryMerchantDirectory();
  const events = new RecordingOrderEvents();
  const orders = new OrdersService(
    new PrismaOrdersRepository(prisma),
    events,
    uow,
    clock,
    new InMemoryQueue<OrderTimerJob>('orders.timers', () => clock.now()),
    trips,
    new PricingService(new ConfigService()),
    merchants,
    { resolvePhone: async (phone) => ({ personId: null, phoneHash: fakePhoneHash(phone) }) },
  );
  tripEvents.onEvent((e) => orders.onTripEvent({ type: e.type, tripId: e.tripId!, actorId: e.actorId, occurredAt: e.occurredAt, ...(e.orderId ? { orderId: e.orderId } : {}), payload: e.payload }));
  const ids = { customer: '', courier: '', org: '', order: '', trip: '' };

  beforeAll(async () => {
    const db = prisma.prisma;
    ids.customer = (await db.person.create({ data: {} })).id;
    ids.courier = (await db.person.create({ data: {} })).id;
    ids.org = (await db.org.create({ data: { type: 'restaurant', name: 'مطعم اختبار', cityId: 'aziziyah' } })).id;
    merchants.add(ids.org);
  });

  afterAll(async () => {
    const db = prisma.prisma;
    if (ids.trip) {
      await db.stop.deleteMany({ where: { tripId: ids.trip } });
      await db.tripOrder.deleteMany({ where: { tripId: ids.trip } });
      await db.$executeRaw`DELETE FROM "public"."trail_points" WHERE trip_id = ${ids.trip}`;
      await db.trip.deleteMany({ where: { id: ids.trip } });
    }
    if (ids.order) {
      await db.orderLine.deleteMany({ where: { orderId: ids.order } });
      await db.participant.deleteMany({ where: { orderId: ids.order } });
      await db.order.deleteMany({ where: { id: ids.order } });
    }
    await db.org.deleteMany({ where: { id: ids.org } });
    await db.person.deleteMany({ where: { id: { in: [ids.customer, ids.courier] } } });
    await prisma.onModuleDestroy();
  });

  it('places, accepts, delivers and keeps pins and history in Postgres', async () => {
    const o = await orders.place(ids.customer, {
      cityId: 'aziziyah',
      type: 'food',
      merchantOrgId: ids.org,
      participants: [{ ref: 'sis', role: 'diner', phone: '07709998877' }],
      lines: [{ freeText: 'كباب', qty: 2, unitPriceIqd: 5000, participantRef: 'sis' }],
      deliveryFeeIqd: 1000,
      serviceFeeIqd: 500,
    });
    ids.order = o.id;
    expect(o).toMatchObject({ state: 'placed', totalIqd: 11500, minVehicleClass: 'bike' });
    expect(o.participants[0]!.phoneOnly).toBe(true);
    await orders.merchantAccept('m', { orderId: o.id, prepMinutes: 10 });

    const t = await trips.createForOrders({
      cityId: 'aziziyah',
      vertical: 'food',
      orders: [{ orderId: o.id, minVehicleClass: 'bike' }],
      stops: [
        { orderId: o.id, type: 'pickup', zoneKey: 'centre', target: KITCHEN },
        { orderId: o.id, type: 'dropoff', zoneKey: 'zakur', target: HOME },
      ],
    });
    ids.trip = t.id;
    expect(t.stops[0]!.target!.lat).toBeCloseTo(KITCHEN.lat, 6);
    await trips.offer(t.id);
    await trips.accept(t.id, ids.courier, { vehicleClass: 'bike' });
    const armed = await trips.reportPosition(ids.courier, { tripId: t.id, pin: KITCHEN, at: clock.now() });
    expect(armed.armed.map((a) => a.stopId)).toEqual([t.stops[0]!.id]);
    for (const s of t.stops) {
      await trips.arrive(t.id, s.id, ids.courier, { pin: s.target! });
      await trips.completeStop(t.id, s.id, ids.courier, s.type === 'dropoff' ? { handover: { cashCollectedIqd: 11500 } } : {});
    }
    await tripEvents.deliver();
    const done = await trips.get(t.id);
    expect(done.state).toBe('completed');
    expect(done.stops[1]!.arrivalDistanceM).toBe(0);
    expect((await orders.get(o.id)).state).toBe('delivered');
    expect(await trips.detachedAt(t.id, o.id)).toBeNull();
  });
});
