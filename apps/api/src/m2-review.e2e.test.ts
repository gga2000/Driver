import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { isDriverError, type LatLng } from '@driver/contracts';
import { AppModule } from './app.module.js';
import { CatalogService } from './modules/catalog/index.js';
import { DispatchService } from './modules/dispatch/index.js';
import { DISPATCH_REPOSITORY, type DispatchRepository } from './modules/dispatch/dispatch.repository.js';
import { DISPATCH_QUEUE, type TimerJob } from './modules/dispatch/offer.orchestrator.js';
import { IdentityService } from './modules/identity/index.js';
import { Accounts, LedgerService } from './modules/ledger/index.js';
import { ORDERS_QUEUE, OrdersRpc, OrdersService, type OrderTimerJob } from './modules/orders/index.js';
import { OrgsService } from './modules/orgs/index.js';
import { TripsRpc, TripsService } from './modules/trips/index.js';
import { CLOCK, FakeClock } from './shared/clock.js';
import type { InMemoryQueue } from './shared/queue.js';

const KITCHEN: LatLng = { lat: 32.9105, lng: 45.0665 };
const HOME: LatLng = { lat: 32.9185, lng: 45.0712 };
const COURIER_AT: LatLng = { lat: 32.9195, lng: 45.0665 };

const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return 'ok';
  } catch (err) {
    return isDriverError(err) ? err.code : String(err);
  }
};

/**
 * Milestone 2 review regressions on the app's own wiring (AppModule, in-memory, fake clock):
 * C2 client prices never reach the ledger, H a reused client idempotency key never swallows another
 * delivery's events, H a busy courier cannot take a second job around dispatch.
 */
describe('M2 review regressions end to end', () => {
  const clock = new FakeClock('2026-10-03T09:00:00Z');
  let app: INestApplication;

  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(CLOCK).useValue(clock).compile();
    app = moduleRef.createNestApplication({ logger: ['error'] });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    vi.useRealTimers();
  });

  async function person(phone: string, courier = false): Promise<string> {
    const identity = app.get(IdentityService);
    await identity.requestOtp({ phone, purpose: 'login' });
    const personId = (await identity.verifyOtp({ phone, code: (await identity.devLastOtp(phone)).code! })).personId;
    if (courier) await identity.grantRole({ personId: 'system:test' }, { personId, kind: 'courier' });
    return personId;
  }

  async function restaurant(): Promise<{ orgId: string; kebab: string }> {
    const orgs = app.get(OrgsService);
    const rest = await orgs.create({ type: 'restaurant', name: 'مطعم', cityId: 'aziziyah', ownerId: 'owner' });
    await orgs.setMerchantSettings(rest.id, { commissionTier: 'base', location: { zoneKey: 'centre', pin: KITCHEN } });
    await orgs.settled();
    const kebab = await app.get(CatalogService).addItem({ orgId: rest.id, nameAr: 'كباب', priceIqd: 10000 });
    return { orgId: rest.id, kebab: kebab.id };
  }

  /** Places, accepts and gets the courier offered and assigned through dispatch; returns the trip. */
  async function dispatched(customerId: string, orgId: string, itemId: string, courierId: string) {
    const orders = app.get(OrdersService);
    const trips = app.get(TripsService);
    const dispatch = app.get(DispatchService);
    const dq = app.get<InMemoryQueue<TimerJob>>(DISPATCH_QUEUE, { strict: false });
    const offers = app.get<DispatchRepository>(DISPATCH_REPOSITORY, { strict: false });
    const o = await orders.place(customerId, { cityId: 'aziziyah', type: 'food', merchantOrgId: orgId, lines: [{ catalogItemId: itemId, qty: 1 }], deliveryFeeIqd: 1000, serviceFeeIqd: 500, paymentMethod: 'cash', dropoff: { zoneKey: 'nakra', pin: HOME } });
    await orders.merchantAccept('m', { orderId: o.id, prepMinutes: 1 });
    const trip = (await trips.activeForOrder(o.id))!;
    clock.set(Math.max(clock.now().getTime(), (await dispatch.getRequest(trip.id))!.nextTimerAt ?? 0));
    await dispatch.presence.online(courierId, { cityId: 'aziziyah', at: COURIER_AT, vehicle: 'bike', tier: 'bronze' });
    await dq.drain();
    const offer = (await offers.listByTrip(trip.id)).find((x) => x.driverId === courierId)!;
    await dispatch.respond({ personId: courierId, sessionId: 's' }, { offerId: offer.id, accept: true });
    return { order: o, trip: await trips.get(trip.id) };
  }

  it('C2: a lowballed client price is refused; item ids alone are charged at the menu price', async () => {
    const { orgId, kebab } = await restaurant();
    const customer = await person('07712340101');
    const rpc = app.get(OrdersRpc);
    const lowball = rpc.place({ personId: customer, sessionId: 's' }, {
      cityId: 'aziziyah', type: 'food', merchantOrgId: orgId, lines: [{ catalogItemId: kebab, qty: 1, unitPriceIqd: 100, modifiers: [], pointsEligible: true }], participants: [], deliveryFeeIqd: 1000, serviceFeeIqd: 500, discountIqd: 0, tipIqd: 0, paymentMethod: 'cash', dropoff: { zoneKey: 'nakra', pin: HOME },
    });
    expect(await code(lowball)).toBe('price_changed');
    const fair = await rpc.place({ personId: customer, sessionId: 's' }, {
      cityId: 'aziziyah', type: 'food', merchantOrgId: orgId, lines: [{ catalogItemId: kebab, qty: 1, modifiers: [], pointsEligible: true }], participants: [], deliveryFeeIqd: 1000, serviceFeeIqd: 500, discountIqd: 0, tipIqd: 0, paymentMethod: 'cash', dropoff: { zoneKey: 'nakra', pin: HOME },
    });
    expect(fair).toMatchObject({ itemsTotalIqd: 10000, totalIqd: 11500 });
  });

  it('H: reusing client keys across deliveries still closes every order and settles the ledger; a busy courier cannot take a second job around dispatch', async () => {
    const trips = app.get(TripsService);
    const orders = app.get(OrdersService);
    const ledger = app.get(LedgerService);
    const oq = app.get<InMemoryQueue<OrderTimerJob>>(ORDERS_QUEUE, { strict: false });
    const { orgId, kebab } = await restaurant();
    const courier = await person('07712340109', true);
    const other = await person('07712340110', true);

    const results: Array<{ trip: string; order: string; customer: number }> = [];
    for (const n of [1, 2]) {
      const customer = `cust-review-${n}`;
      const { order, trip } = await dispatched(customer, orgId, kebab, courier);
      const [p, d] = trip.stops;
      await trips.arrive(trip.id, p!.id, courier, { pin: KITCHEN, idempotencyKey: 'same-arrive' });
      await trips.completeStop(trip.id, p!.id, courier, { idempotencyKey: 'same-key-pick' });

      if (n === 1) {
        // While he carries this job, a second trip on offer cannot be taken around dispatch: trips has
        // no public accept any more, and internally it wants an open DispatchOffer (M2 follow-up) —
        // which neither the busy courier nor a free one holds for a trip dispatch never offered.
        const second = await trips.createForOrders({ cityId: 'aziziyah', vertical: 'food', orders: [{ orderId: 'free-standing', minVehicleClass: null }], stops: [{ orderId: 'free-standing', type: 'pickup', zoneKey: 'centre', target: KITCHEN }, { orderId: 'free-standing', type: 'dropoff', zoneKey: 'zakur', target: HOME }] });
        await trips.offer(second.id);
        expect('accept' in app.get(TripsRpc)).toBe(false);
        expect(await code(trips.accept(second.id, courier, { vehicleClass: 'bike' }))).toBe('offer_not_found');
        expect(await code(trips.accept(second.id, other, { vehicleClass: 'bike' }))).toBe('offer_not_found');
      }

      await trips.arrive(trip.id, d!.id, courier, { pin: HOME, idempotencyKey: 'same-arrive' });
      await trips.completeStop(trip.id, d!.id, courier, { handover: { cashCollectedIqd: 11500 }, idempotencyKey: 'same-key-drop' });
      clock.advance(3 * 3600_000);
      await oq.drain();
      results.push({ trip: (await trips.get(trip.id)).state, order: (await orders.get(order.id)).state, customer: (await ledger.balance(Accounts.customer(customer))).amount });
    }
    expect(results).toEqual([
      { trip: 'completed', order: 'closed', customer: 0 },
      { trip: 'completed', order: 'closed', customer: 0 },
    ]);
    expect((await ledger.checkInvariant()).ok).toBe(true);
  });
});
