import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { LatLng } from '@driver/contracts';
import { AppModule } from './app.module.js';
import { CatalogService } from './modules/catalog/index.js';
import { DispatchService } from './modules/dispatch/index.js';
import { DISPATCH_REPOSITORY, type DispatchRepository } from './modules/dispatch/dispatch.repository.js';
import { DISPATCH_QUEUE, type TimerJob } from './modules/dispatch/offer.orchestrator.js';
import { EventsService } from './modules/events/index.js';
import { IdentityService } from './modules/identity/index.js';
import { Accounts, CapsService, LedgerFacade, LedgerService } from './modules/ledger/index.js';
import { ORDERS_QUEUE, OrdersService, type OrderTimerJob } from './modules/orders/index.js';
import { OrgsService } from './modules/orgs/index.js';
import { TripsService } from './modules/trips/index.js';
import { CLOCK, FakeClock } from './shared/clock.js';
import type { InMemoryQueue } from './shared/queue.js';

const KITCHEN: LatLng = { lat: 32.9105, lng: 45.0665 };
const HOME: LatLng = { lat: 32.9185, lng: 45.0712 };
/** ~1 km north of the kitchen. */
const COURIER_AT: LatLng = { lat: 32.9195, lng: 45.0665 };
const MIN = 60_000;

/**
 * Milestone 2 end to end, on the app's own wiring (AppModule, no DATABASE_URL / REDIS_URL: in-memory
 * repositories, synchronous outbox drain) with a fake clock: a customer's cash food order goes
 * merchant → dispatch → courier → stops → cash → closed, and the ledger ends balanced on the money
 * spec's worked example (15,000 at 15 %: platform 2,750, courier 1,000, merchant 12,750).
 */
describe('M2 end to end: food order → dispatch → courier → ledger', () => {
  const clock = new FakeClock('2026-10-03T09:00:00Z'); // Saturday 12:00 in Baghdad, outside any pause window
  let app: INestApplication;

  beforeAll(async () => {
    // Module pollers (setInterval) would drain the queues on real time; this test drives them by hand.
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(CLOCK).useValue(clock).compile();
    app = moduleRef.createNestApplication({ logger: ['error', 'warn'] });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    vi.useRealTimers();
  });

  it('places, accepts, auto-assigns, delivers, collects cash, closes — books balanced, no failed outbox rows', async () => {
    const identity = app.get(IdentityService);
    const orgs = app.get(OrgsService);
    const orders = app.get(OrdersService);
    const trips = app.get(TripsService);
    const dispatch = app.get(DispatchService);
    const ledger = app.get(LedgerService);
    const facade = app.get(LedgerFacade);
    const caps = app.get(CapsService);
    const events = app.get(EventsService);
    const dispatchQueue = app.get<InMemoryQueue<TimerJob>>(DISPATCH_QUEUE, { strict: false });
    const ordersQueue = app.get<InMemoryQueue<OrderTimerJob>>(ORDERS_QUEUE, { strict: false });
    const offers = app.get<DispatchRepository>(DISPATCH_REPOSITORY, { strict: false });

    // A courier (identity role), a restaurant at the featured 15 % tier with its pickup point.
    await identity.requestOtp({ phone: '07712340001', purpose: 'login' });
    const { code } = await identity.devLastOtp('07712340001');
    const courierId = (await identity.verifyOtp({ phone: '07712340001', code: code! })).personId;
    await identity.grantRole({ personId: 'system:test' }, { personId: courierId, kind: 'courier' });
    const rest = orgs.create({ type: 'restaurant', name: 'مطعم التجربة', cityId: 'aziziyah', ownerId: 'owner-1' });
    orgs.setMerchantSettings(rest.id, { commissionTier: 'featured', location: { zoneKey: 'centre', pin: KITCHEN } });
    await orgs.settled(); // orgs emits without awaiting; let its outbox drain finish before the order flow
    // Its menu: orders prices lines from here (review C2), the client sends item ids only.
    const catalog = app.get(CatalogService);
    const kebab = await catalog.addItem({ orgId: rest.id, nameAr: 'كباب', priceIqd: 5000 });
    const tikka = await catalog.addItem({ orgId: rest.id, nameAr: 'تكة', priceIqd: 5000 });
    await dispatch.presence.online(courierId, { cityId: 'aziziyah', at: COURIER_AT, vehicle: 'bike', tier: 'bronze' });

    // 1. The customer places a 15,000 cash order (+1,000 delivery, +500 service) to his door.
    const placed = await orders.place('cust-1', {
      cityId: 'aziziyah',
      type: 'food',
      merchantOrgId: rest.id,
      lines: [
        { catalogItemId: kebab.id, qty: 2 },
        { catalogItemId: tikka.id, qty: 1 },
      ],
      deliveryFeeIqd: 1000,
      serviceFeeIqd: 500,
      paymentMethod: 'cash',
      dropoff: { zoneKey: 'street_30', pin: HOME },
    });
    expect(placed).toMatchObject({ state: 'placed', totalIqd: 16500 });

    // 2. The kitchen accepts with 15 min prep → dispatch builds the courier trip and times the courier.
    await orders.merchantAccept('m-staff', { orderId: placed.id, prepMinutes: 15 });
    const trip = await trips.activeForOrder(placed.id);
    expect(trip).toMatchObject({ vertical: 'food', state: 'created' });
    expect(trip!.stops.map((s) => [s.type, s.zoneKey])).toEqual([
      ['pickup', 'centre'],
      ['dropoff', 'street_30'],
    ]);
    const req = await dispatch.getRequest(trip!.id);
    expect(req).toMatchObject({ policy: 'auto_assign', status: 'scheduled', cashIqd: 16500 });
    // readyAt − (ETA + 2 min): the courier is ~1 km out, so the first offer goes out ~9.6 min after acceptance.
    const startAt = req!.nextTimerAt!;
    expect(startAt - clock.now().getTime()).toBeGreaterThan(9 * MIN);
    expect(startAt - clock.now().getTime()).toBeLessThan(11 * MIN);

    // 3. At the start time the courier (still online) gets the offer; the trip is on offer.
    clock.set(startAt);
    await dispatch.presence.online(courierId, { cityId: 'aziziyah', at: COURIER_AT, vehicle: 'bike', tier: 'bronze' });
    await dispatchQueue.drain();
    const [offer] = await offers.listByTrip(trip!.id);
    expect(offer).toMatchObject({ driverId: courierId, policy: 'auto_assign', state: 'sent' });
    expect((await trips.get(trip!.id)).state).toBe('offered');

    // 4. He accepts through dispatch: trips assigns him, dispatch marks the request assigned.
    await dispatch.respond({ personId: courierId, sessionId: 's1' }, { offerId: offer!.id, accept: true });
    expect(await trips.get(trip!.id)).toMatchObject({ state: 'en_route_to_pickup', courierId });
    expect(await dispatch.getRequest(trip!.id)).toMatchObject({ status: 'assigned', assignedDriverId: courierId });

    // 5. Kitchen preparing → ready; the courier picks up and delivers, collecting 16,500 at the door.
    await orders.markPreparing('m-staff', { orderId: placed.id });
    await orders.markReady('m-staff', { orderId: placed.id });
    const [pickup, dropoff] = (await trips.get(trip!.id)).stops;
    await trips.arrive(trip!.id, pickup!.id, courierId, { pin: KITCHEN });
    await trips.completeStop(trip!.id, pickup!.id, courierId);
    expect((await orders.get(placed.id)).state).toBe('picked_up');
    expect((await dispatch.getRequest(trip!.id))?.pickedUp).toBe(true);
    await trips.arrive(trip!.id, dropoff!.id, courierId, { pin: HOME });
    await trips.completeStop(trip!.id, dropoff!.id, courierId, { handover: { cashCollectedIqd: 16500 } });
    expect((await orders.get(placed.id)).state).toBe('delivered');
    expect((await trips.get(trip!.id)).state).toBe('completed');
    // dispatch freed the courier and took the card off the board
    expect((await dispatch.board('aziziyah')).cards.map((c) => c.tripId)).not.toContain(trip!.id);

    // Cash collected: the merchant's live cash account shows the payable, held by this courier.
    const merchant = await facade.merchantBalance(rest.id);
    expect(merchant).toMatchObject({ balanceIqd: 12750, holders: [{ courierId, amountIqd: 12750 }] });
    expect(await caps.status(courierId)).toMatchObject({ role: 'courier', tier: 'bronze', owedIqd: 15500, capIqd: 75000, overCap: false });

    // 6. Two hours later the order closes; points on revenue post, money does not post twice.
    clock.advance(2 * 60 * MIN);
    await ordersQueue.drain();
    expect((await orders.get(placed.id)).state).toBe('closed');

    // Worked example: platform 2,750 (2,250 commission + 500 service), courier 1,000, merchant 12,750.
    expect((await ledger.balance(Accounts.platform)).amount).toBe(2750);
    expect((await ledger.balance(Accounts.driver(courierId))).amount).toBe(1000);
    expect((await ledger.balance(Accounts.merchantCash(rest.id))).amount).toBe(12750);
    expect((await ledger.balance(Accounts.cash(courierId))).amount).toBe(-16500);
    expect((await ledger.balance(Accounts.customer('cust-1'))).amount).toBe(0);
    expect((await ledger.balance(Accounts.points('cust-1'))).amount).toBe(27);
    const books = await ledger.checkInvariant();
    expect(books).toMatchObject({ ok: true, money: { ok: true, net: 0 }, points: { ok: true, net: 0 }, kindViolations: 0 });

    // Every cross-module event reached every subscriber: nothing pending, nothing failed.
    expect(await events.outboxStats()).toMatchObject({ pending: 0, failed: 0 });
    const types = (await events.forOrder(placed.id)).map((e) => e.type);
    expect(types).toEqual(expect.arrayContaining(['order.accepted', 'order.cash_collected', 'merchant.payable_accrued', 'order.closed']));
  });
});
