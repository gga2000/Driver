import 'reflect-metadata';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Actor, LatLng } from '@driver/contracts';
import { AppModule } from './app.module.js';
import { CatalogService } from './modules/catalog/index.js';
import { AuditLogService } from './modules/controls/index.js';
import { DispatchService } from './modules/dispatch/index.js';
import { DISPATCH_REPOSITORY, type DispatchRepository } from './modules/dispatch/dispatch.repository.js';
import { DISPATCH_QUEUE, type TimerJob } from './modules/dispatch/offer.orchestrator.js';
import { EventsService } from './modules/events/index.js';
import { IdentityService } from './modules/identity/index.js';
import { Accounts, LedgerService } from './modules/ledger/index.js';
import { ORDERS_QUEUE, OrdersService, type OrderTimerJob } from './modules/orders/index.js';
import { OrgsService } from './modules/orgs/index.js';
import { TrackingService } from './modules/tracking/index.js';
import { TripsRpc, TripsService } from './modules/trips/index.js';
import { CLOCK, FakeClock } from './shared/clock.js';
import type { InMemoryQueue } from './shared/queue.js';

/**
 * Getting a job back on the road when its driver or kitchen drops out (the real orders, trips,
 * dispatch and ledger in memory, on a fake clock): a ride its driver dropped before pickup is searched
 * again, never after; a far "وصلت" is not an arrival for the fee; a courier released by a silent
 * kitchen is replaced; a red job keeps being offered; the desk can take a job off a stalled courier.
 */
const KITCHEN: LatLng = { lat: 32.9105, lng: 45.0665 };
const HOME: LatLng = { lat: 32.9185, lng: 45.0712 };
const NEAR: LatLng = { lat: 32.9125, lng: 45.0665 };
const FAR: LatLng = { lat: 32.98, lng: 45.0665 }; // ~7.7 km north of the pickup
const MIN = 60_000;
const RIDE_VERTICALS = ['taxi', 'tuktuk'] as const;

describe('dispatch recovery', () => {
  let app: INestApplication;
  let clock: FakeClock;
  beforeEach(async () => {
    clock = new FakeClock('2026-10-03T09:00:00Z');
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(CLOCK).useValue(clock).compile();
    app = moduleRef.createNestApplication({ logger: ['error'] });
    await app.init();
  });
  afterEach(async () => {
    await app.close();
    vi.useRealTimers();
  });

  const s = () => ({
    identity: app.get(IdentityService),
    orgs: app.get(OrgsService),
    orders: app.get(OrdersService),
    trips: app.get(TripsService),
    tripsRpc: app.get(TripsRpc),
    dispatch: app.get(DispatchService),
    ledger: app.get(LedgerService),
    events: app.get(EventsService),
    audit: app.get(AuditLogService),
    dq: app.get<InMemoryQueue<TimerJob>>(DISPATCH_QUEUE, { strict: false }),
    oq: app.get<InMemoryQueue<OrderTimerJob>>(ORDERS_QUEUE, { strict: false }),
    offers: app.get<DispatchRepository>(DISPATCH_REPOSITORY, { strict: false }),
  });
  let n = 0;
  async function person(kind?: string) {
    const { identity } = s();
    const phone = `0771234${String(1000 + n++).padStart(4, '0')}`;
    await identity.requestOtp({ phone, purpose: 'login' });
    const { code } = await identity.devLastOtp(phone);
    const id = (await identity.verifyOtp({ phone, code: code! })).personId;
    if (kind) await identity.grantRole({ personId: 'system:test' }, { personId: id, kind: kind as never });
    return id;
  }
  const bal = async (acc: string) => (await s().ledger.balance(acc)).amount;
  const code = async (p: Promise<unknown>) => {
    try {
      await p;
      return 'ok';
    } catch (e) {
      return (e as { code?: string }).code ?? String(e);
    }
  };
  async function tick(ms: number, step = 20_000) {
    const { dq, oq } = s();
    for (let t = 0; t < ms; t += step) {
      clock.advance(step);
      await dq.drain();
      await oq.drain();
    }
  }
  const driverOnline = (id: string, at: LatLng = NEAR) => s().dispatch.presence.online(id, { cityId: 'aziziyah', at, vehicle: 'car', tier: 'bronze', verticals: [...RIDE_VERTICALS] });

  async function rideMatched(opts: { driverAt?: LatLng } = {}) {
    const { orders, trips, dispatch, dq, offers } = s();
    const driver = await person('driver');
    const cust = await person();
    await driverOnline(driver, opts.driverAt);
    const o = await orders.place(cust, { cityId: 'aziziyah', type: 'ride', rideVertical: 'taxi', paymentMethod: 'cash', pickup: { zoneKey: 'centre', pin: KITCHEN }, dropoff: { zoneKey: 'street_30', pin: HOME } } as never);
    const t = await trips.activeForOrder(o.id);
    await dq.drain();
    const [offer] = await offers.listByTrip(t!.id);
    await dispatch.respond({ personId: driver, sessionId: 's' }, { offerId: offer!.id, accept: true });
    const trip = await trips.get(t!.id);
    return { driver, cust, o, trip, pickup: trip.stops.find((x) => x.type === 'pickup')!, drop: trip.stops.find((x) => x.type === 'dropoff')! };
  }

  async function kitchen() {
    const rest = await s().orgs.create({ type: 'restaurant', name: 'مطعم', cityId: 'aziziyah', ownerId: 'owner-1' });
    await s().orgs.setMerchantSettings(rest.id, { commissionTier: 'featured', location: { zoneKey: 'centre', pin: KITCHEN } });
    const item = await app.get(CatalogService).addItem({ orgId: rest.id, nameAr: 'كباب', priceIqd: 5000 });
    return { rest, item };
  }
  async function food(rest: { id: string }, item: { id: string }) {
    const cust = await person();
    return s().orders.place(cust, { cityId: 'aziziyah', type: 'food', merchantOrgId: rest.id, lines: [{ catalogItemId: item.id, qty: 2 }], deliveryFeeIqd: 1000, serviceFeeIqd: 500, paymentMethod: 'cash', dropoff: { zoneKey: 'nakra', pin: HOME } } as never);
  }
  /** A food order a courier accepted; `beat` keeps the kitchen's tablet alive while he is found. */
  async function foodAssigned(opts: { beat: boolean }) {
    const { orders, trips, dispatch, dq, offers, orgs } = s();
    const { rest, item } = await kitchen();
    const c1 = await person('courier');
    await dispatch.presence.online(c1, { cityId: 'aziziyah', at: NEAR, vehicle: 'bike', tier: 'bronze' });
    const o = await food(rest, item);
    await orgs.heartbeat(rest.id);
    await orders.merchantAccept('m', { orderId: o.id, prepMinutes: 10 });
    const t = await trips.activeForOrder(o.id);
    for (let i = 0; i < 60; i++) {
      clock.advance(20_000);
      if (opts.beat) await orgs.heartbeat(rest.id);
      await dispatch.presence.online(c1, { cityId: 'aziziyah', at: NEAR, vehicle: 'bike', tier: 'bronze' });
      await dq.drain();
      const off = (await offers.listByTrip(t!.id)).find((x) => x.state === 'sent');
      if (off) {
        await dispatch.respond({ personId: c1, sessionId: 's' }, { offerId: off.id, accept: true });
        break;
      }
    }
    expect((await trips.get(t!.id)).courierId).toBe(c1);
    return { rest, o, c1, tripId: t!.id };
  }

  it('a ride its driver drops at the pickup gets a new trip and a new search, never offered to him again', async () => {
    const { orders, trips, offers, dispatch } = s();
    const r = await rideMatched();
    const d2 = await person('driver');
    await driverOnline(d2);
    await trips.arrive(r.trip.id, r.pickup.id, r.driver, { pin: KITCHEN });
    await trips.cancel(r.trip.id, 'driver', r.driver, 'rider_no_show');
    await tick(2_000, 1_000);
    const live = await trips.activeForOrder(r.o.id);
    expect(live).not.toBeNull();
    expect(live!.id).not.toBe(r.trip.id);
    const sent = await offers.listByTrip(live!.id);
    expect(sent.map((o) => o.driverId)).toContain(d2);
    expect(sent.map((o) => o.driverId)).not.toContain(r.driver);
    // The new driver takes it: the rider has a driver again.
    const mine = sent.find((o) => o.driverId === d2)!;
    await dispatch.respond({ personId: d2, sessionId: 's' }, { offerId: mine.id, accept: true });
    await tick(20_000);
    expect((await orders.get(r.o.id)).state).toBe('matched');
    // The driver's after-arrival credit to the rider is unchanged by the new search.
    expect(await bal(Accounts.customer(r.cust))).toBe(500);
  });

  it("a ride's driver can't cancel once the rider is in the car, and the finished ride is never searched again", async () => {
    const { orders, trips } = s();
    const r = await rideMatched();
    await trips.arrive(r.trip.id, r.pickup.id, r.driver, { pin: KITCHEN });
    await trips.completeStop(r.trip.id, r.pickup.id, r.driver);
    await trips.arrive(r.trip.id, r.drop.id, r.driver, { pin: HOME });
    expect(await code(trips.cancel(r.trip.id, 'driver', r.driver, 'x'))).toBe('trip_picked_up');
    await tick(60_000);
    expect((await orders.get(r.o.id)).state).toBe('matched');
    expect((await trips.get(r.trip.id)).state).toBe('arrived_dropoff');
    expect(await bal(Accounts.customer(r.cust))).toBe(0);
    expect(await bal(Accounts.driver(r.driver))).toBe(0);
  });

  it('a "وصلت" tapped 7.7 km from the rider is not an arrival: his cancel pays the en-route fee, and the tracking says the driver only claims it', async () => {
    const { orders, trips } = s();
    const r = await rideMatched({ driverAt: FAR });
    const a = await trips.arrive(r.trip.id, r.pickup.id, r.driver, { pin: FAR });
    expect(a.stops.find((x) => x.id === r.pickup.id)!.arrivedOutsideGeofence).toBe(true);
    clock.advance(61_000);
    expect(await orders.cancellationPreview(r.o.id)).toMatchObject({ amountIqd: 500, reason_ar: 'السايق تحرك عليك' });
    const tracked = await app.get(TrackingService).track({ personId: r.cust } as Actor, { orderId: r.o.id });
    expect(tracked.trip!.stops.find((x) => x.type === 'pickup')).toMatchObject({ arrivedOutsideGeofence: true });
    await orders.cancel(r.cust, { orderId: r.o.id });
    await tick(40_000);
    expect(await bal(Accounts.customer(r.cust))).toBe(-500);
    expect(await bal(Accounts.driver(r.driver))).toBe(500);
  });

  it('an arrival at the pickup still counts: the rider who cancels then pays the after-arrival fee', async () => {
    const { orders, trips } = s();
    const r = await rideMatched();
    await trips.arrive(r.trip.id, r.pickup.id, r.driver, { pin: KITCHEN });
    clock.advance(61_000);
    expect(await orders.cancellationPreview(r.o.id)).toMatchObject({ amountIqd: 1000, reason_ar: 'السايق وصل يمك' });
  });

  it('a courier released by a silent kitchen is replaced: once the food is ready a courier is offered it', async () => {
    const { orders, trips, dispatch, orgs, events } = s();
    const { rest, o, c1, tripId } = await foodAssigned({ beat: false });
    await tick(22 * MIN);
    const types = (await events.forOrder(o.id)).map((e) => e.type);
    expect(types).toContain('order.courier_released');
    expect(types).toContain('order.courier_unassigned');
    expect((await trips.get(tripId)).state).toBe('platform_cancelled');
    await orgs.heartbeat(rest.id);
    await orders.markReady('m', { orderId: o.id });
    // His phone was idle through the wait: back online, the red job reaches him on its next retry.
    for (let i = 0; i < 18; i++) {
      await dispatch.presence.online(c1, { cityId: 'aziziyah', at: NEAR, vehicle: 'bike', tier: 'bronze' });
      await tick(20_000);
    }
    const live = await trips.activeForOrder(o.id);
    expect(live).not.toBeNull();
    expect(live!.id).not.toBe(tripId);
    expect((await s().offers.listByTrip(live!.id)).length).toBeGreaterThan(0);
  });

  it('a red job nobody took keeps being offered: a courier who comes online later gets it, and the card stays red until he takes it', async () => {
    const { orders, trips, dispatch, offers, orgs } = s();
    const { rest, item } = await kitchen();
    const o = await food(rest, item);
    await orgs.heartbeat(rest.id);
    await orders.merchantAccept('m', { orderId: o.id, prepMinutes: 5 });
    const t = await trips.activeForOrder(o.id);
    for (let i = 0; i < 30; i++) {
      clock.advance(20_000);
      await orgs.heartbeat(rest.id);
      await s().dq.drain();
    }
    expect((await dispatch.getRequest(t!.id))?.status).toBe('needs_dispatcher');
    const c1 = await person('courier');
    let offer = null;
    for (let i = 0; i < 30 && !offer; i++) {
      clock.advance(20_000);
      await orgs.heartbeat(rest.id);
      await dispatch.presence.online(c1, { cityId: 'aziziyah', at: KITCHEN, vehicle: 'bike', tier: 'bronze' });
      await s().dq.drain();
      offer = (await offers.listByTrip(t!.id)).find((x) => x.driverId === c1 && x.state === 'sent') ?? null;
    }
    expect(offer).not.toBeNull();
    expect((await dispatch.getRequest(t!.id))).toMatchObject({ status: 'needs_dispatcher', red: true });
    await dispatch.respond({ personId: c1, sessionId: 's' }, { offerId: offer!.id, accept: true });
    expect((await dispatch.getRequest(t!.id))).toMatchObject({ status: 'assigned', red: false });
    expect((await trips.get(t!.id)).courierId).toBe(c1);
  });

  it("the desk takes a job off a stalled courier before pickup (reason + audit row) and it is offered again; after pickup it can't", async () => {
    const { trips, tripsRpc, audit, offers, dispatch } = s();
    const ops = await person('dispatcher');
    const { o, c1, tripId } = await foodAssigned({ beat: true });
    const desk = { personId: ops } as Actor;
    expect(await code(tripsRpc.cancel(desk, { tripId, reason: '  ' }))).not.toBe('ok');
    const c2 = await person('courier');
    await dispatch.presence.online(c2, { cityId: 'aziziyah', at: NEAR, vehicle: 'bike', tier: 'bronze' });
    await tripsRpc.cancel(desk, { tripId, reason: 'الدليفري واگف من ربع ساعة وما يرد' });
    expect((await trips.get(tripId)).state).toBe('platform_cancelled');
    const rows = await audit.list({ subjectKind: 'trip', subjectId: tripId, limit: 5 });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ action: 'trip.ops_take_off', actorId: ops, detail: { courierId: c1, orderIds: [o.id] } });
    expect(rows[0]!.summary_ar).toContain('الدليفري واگف من ربع ساعة وما يرد');
    await tick(40_000);
    const live = await trips.activeForOrder(o.id);
    expect(live).not.toBeNull();
    expect(live!.id).not.toBe(tripId);
    expect(live!.courierId).toBeNull();
    expect(await dispatch.getRequest(live!.id)).not.toBeNull();
    void offers;

    // Picked up: the food stays with its courier.
    const second = await foodAssigned({ beat: true });
    const st = await trips.get(second.tripId);
    const pk = st.stops.find((x) => x.type === 'pickup')!;
    await trips.arrive(second.tripId, pk.id, second.c1, { pin: KITCHEN });
    await trips.completeStop(second.tripId, pk.id, second.c1, { handover: { pickupCode: '0000' } } as never);
    expect(await code(tripsRpc.cancel(desk, { tripId: second.tripId, reason: 'x' }))).toBe('trip_picked_up');
    expect((await trips.get(second.tripId)).state).not.toBe('platform_cancelled');
  });
});
