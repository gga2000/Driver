import { describe, expect, it } from 'vitest';
import { AZIZIYAH_MONEY_RULES, AZIZIYAH_ZONES, ETA_LEARNING_RULES, type Actor, type LatLng } from '@driver/contracts';
import type { FakeClock } from '../../shared/clock.js';
import { hourBucketOf, InMemoryEtaCorrectionsRepository, LearnedEtaCorrection, lookupChain, zoneLocator } from '../eta/index.js';
import { Accounts } from '../ledger/index.js';
import { ledgerHarness } from '../ledger/test-harness.js';
import { KITCHEN, ordersHarness } from '../orders/test-harness.js';
import { ZoneResolver } from '../places/index.js';
import { EtaService, StraightLineRouter } from '../routing/index.js';
import { ledgerLateCredit } from './late-promise.js';
import { TrackingService } from './tracking.service.js';
import { InMemoryCourierVehicles } from './vehicles.js';

/**
 * The honest-delay promise on the learned ETA (Ali, 2026-10-07: "yes learned data"): the kitchen →
 * door ride is the one ETA's learned minutes (factor clamped 0.7–1.6; router minutes when nothing is
 * learned), locked into the order at placement, and the late credit fires against that locked promise.
 */

const MIN = 60_000;
const AFTER = AZIZIYAH_MONEY_RULES.latePromise.afterMin;
const as = (personId: string): Actor => ({ personId, sessionId: `s-${personId}` });
/** A door in قطنية, about 2 km from the harness kitchen: a ride long enough for each clamp to show in whole minutes. */
const DOOR: LatLng = (() => {
  const z = AZIZIYAH_ZONES.find((x) => x.id === 'qutniya');
  if (!z) throw new Error('no seed zone qutniya');
  return { lat: z.lat, lng: z.lng };
})();
const zones = zoneLocator(new ZoneResolver(), () => ['aziziyah']);
const router = new StraightLineRouter();

let legsTaught = 0;

/** `n` finished kitchen → door legs at `ratio` × the router's minutes, at `at`'s traffic bucket (all four cells of the chain). */
async function teach(repo: InMemoryEtaCorrectionsRepository, ratio: number, at: Date, n: number = ETA_LEARNING_RULES.minSamples, from: LatLng = KITCHEN, to: LatLng = DOOR): Promise<void> {
  const origin = zones.locate(from);
  const toZone = origin ? zones.zoneIn(origin.cityId, to) : null;
  if (!origin || !toZone) throw new Error('harness pins must lie inside the seed zones');
  const leg = { cityId: origin.cityId, fromZone: origin.zoneId, toZone, hourBucket: hourBucketOf(at), vehicleClass: 'bike' as const, basis: 'estimated' as const };
  for (let i = 0; i < n; i++) {
    await repo.learn({ ...leg, stopId: `s${(legsTaught += 1)}`, tripId: `t${i}`, predictedMin: 5, actualMin: 5 * ratio, startedAt: at, arrivedAt: at }, lookupChain(leg), ETA_LEARNING_RULES.alpha);
  }
}

function setup() {
  const repo = new InMemoryEtaCorrectionsRepository();
  let correction: LearnedEtaCorrection | undefined;
  const h = ordersHarness('2026-10-03T09:00:00Z', {
    etaCorrection: (clock: FakeClock) => {
      correction = new LearnedEtaCorrection(repo, zones, clock);
      return correction;
    },
  });
  const learned = correction!;
  const l = ledgerHarness({ start: '2026-10-03T09:00:00Z' });
  const tracking = new TrackingService(
    h.orders,
    h.trips,
    { courierCard: async () => ({ firstName: 'حيدر', lastVerifiedAt: null }) },
    { merchant: (orgId) => (orgId === 'rest_1' ? { name: 'مطعم التجربة', pin: KITCHEN } : null), itemNames: async () => new Map() },
    { earnedOn: async () => 0 },
    new InMemoryCourierVehicles(),
    h.clock,
    // The same one ETA the customer's live screen reads (same learned corrections).
    h.eta,
    ledgerLateCredit(l.ledger),
  );
  /** Learning lands in the store; the correction's per-city cache is dropped as the learner does. */
  const learn = async (ratio: number, at: Date = h.clock.now()) => {
    await teach(repo, ratio, at);
    learned.forget('aziziyah');
  };
  const wallet = async (personId: string) => (await l.ledger.balance(Accounts.customer(personId))).amount;
  /** The router's own whole and exact kitchen → door minutes (factor 1). */
  const routerRide = () => new EtaService(router).baseMinutes(KITCHEN, DOOR, 'bike');
  return { h, tracking, learn, wallet, routerRide };
}

/** rest_1's food to the قطنية door (fees as the server quotes them). */
const toDoor = (h: ReturnType<typeof ordersHarness>, patch: Parameters<ReturnType<typeof ordersHarness>['foodInput']>[0] = {}) =>
  h.foodInput({ dropoff: { zoneKey: 'qutniya', pin: DOOR }, deliveryFeeIqd: undefined, serviceFeeIqd: undefined, ...patch });

async function placeAndAccept(h: ReturnType<typeof ordersHarness>) {
  const placed = await h.orders.place('c1', toDoor(h));
  await h.orders.merchantAccept('m-staff', { orderId: placed.id, prepMinutes: 15 });
  return placed.id;
}

const lockedRide = async (h: ReturnType<typeof ordersHarness>, orderId: string) => (await h.orders.aggregate(orderId)).order.promisedRideMin;

describe('honest-delay promise on the learned ETA (Ali, 2026-10-07)', () => {
  it('nothing learned: the promise is the router’s minutes (factor 1), as before', async () => {
    const { h, tracking, routerRide } = setup();
    const id = await placeAndAccept(h);
    const ride = await routerRide();
    expect(await lockedRide(h, id)).toBe(ride.minutes);
    const v = await tracking.track(as('c1'), { orderId: id });
    expect(v.promisedAt!.getTime()).toBe(v.order.promisedReadyAt!.getTime() + ride.minutes * MIN);
  });

  it('fewer than minSamples legs is still nothing learned', async () => {
    const { h, routerRide } = setup();
    const repo = new InMemoryEtaCorrectionsRepository();
    await teach(repo, 1.5, h.clock.now(), ETA_LEARNING_RULES.minSamples - 1);
    const eta = new EtaService(router, new LearnedEtaCorrection(repo, zones, h.clock));
    expect((await eta.minutes(KITCHEN, DOOR, 'bike')).minutes).toBe((await routerRide()).minutes);
  });

  it('slow streets: the learned minutes, clamped at 1.6 however slow they taught', async () => {
    const { h, tracking, learn, routerRide } = setup();
    await learn(3); // raw factor 3: the clamp holds it at maxFactor
    const id = await placeAndAccept(h);
    const exact = (await routerRide()).exactMinutes;
    const ride = Math.max(1, Math.round(exact * ETA_LEARNING_RULES.maxFactor));
    expect(ETA_LEARNING_RULES.maxFactor).toBe(1.6);
    expect(await lockedRide(h, id)).toBe(ride);
    expect(ride).toBeGreaterThan((await routerRide()).minutes);
    expect(ride).toBeLessThan(Math.round(exact * 3)); // unclamped it would be 3×
    const v = await tracking.track(as('c1'), { orderId: id });
    expect(v.promisedAt!.getTime()).toBe(v.order.promisedReadyAt!.getTime() + ride * MIN);
    expect(v.latePromise!.deadlineAt.getTime()).toBe(v.promisedAt!.getTime() + AFTER * MIN);
  });

  it('fast streets: the learned minutes, clamped at 0.7 however fast they taught', async () => {
    const { h, tracking, learn, routerRide } = setup();
    await learn(0.3); // raw factor 0.3: the clamp holds it at minFactor
    const id = await placeAndAccept(h);
    const exact = (await routerRide()).exactMinutes;
    const ride = Math.max(1, Math.round(exact * ETA_LEARNING_RULES.minFactor));
    expect(ETA_LEARNING_RULES.minFactor).toBe(0.7);
    expect(await lockedRide(h, id)).toBe(ride);
    expect(ride).toBeLessThan((await routerRide()).minutes);
    expect(ride).toBeGreaterThan(Math.round(exact * 0.3)); // unclamped it would be 0.3×
    const v = await tracking.track(as('c1'), { orderId: id });
    expect(v.promisedAt!.getTime()).toBe(v.order.promisedReadyAt!.getTime() + ride * MIN);
  });

  it('agrees with the ETA the customer sees: courier at the counter, the live ETA is the promise', async () => {
    const { h, tracking, learn } = setup();
    await learn(1.5);
    const id = await placeAndAccept(h);
    const trip = await h.tripFor(id);
    await h.trips.reportPosition('d1', { tripId: trip.id, pin: KITCHEN, at: h.clock.now() });
    const live = await tracking.courierPosition(as('c1'), { orderId: id });
    const promised = (await tracking.track(as('c1'), { orderId: id })).promisedAt!;
    expect(live!.etaAt!.getTime()).toBe(promised.getTime());
  });

  it('a scheduled order is locked for its slot’s traffic bucket, not the hour it was ordered', async () => {
    const { h, learn, routerRide } = setup();
    // 18:30 Baghdad: the evening peak bucket is slow; noon (now) has learned nothing.
    const slot = new Date('2026-10-03T15:30:00Z');
    expect(hourBucketOf(slot)).not.toBe(hourBucketOf(h.clock.now()));
    await learn(1.5, slot);
    const exact = (await routerRide()).exactMinutes;
    // The bucket-free cells learned too; teach noon at 1.0 so "now" really is the router's minutes.
    await learn(1, h.clock.now());
    const asap = await h.orders.place('c1', toDoor(h));
    const later = await h.orders.place('c1', toDoor(h, { scheduledFor: slot }));
    expect(await lockedRide(h, asap.id)).toBe(Math.max(1, Math.round(exact)));
    expect(await lockedRide(h, later.id)).toBe(Math.max(1, Math.round(exact * 1.5)));
  });
});

describe('the promise is locked at placement', () => {
  it('learning after placement, or the hour turning, never moves the promise or its deadline', async () => {
    const { h, tracking, learn, routerRide } = setup();
    const placed = await h.orders.place('c1', toDoor(h));
    // The streets turn slow between placing and the kitchen accepting: the ride was already locked.
    await learn(1.5);
    await h.orders.merchantAccept('m-staff', { orderId: placed.id, prepMinutes: 15 });
    const ride = (await routerRide()).minutes;
    const first = await tracking.track(as('c1'), { orderId: placed.id });
    expect(first.promisedAt!.getTime()).toBe(first.order.promisedReadyAt!.getTime() + ride * MIN);
    // Faster still, later in the day (another bucket): same promise, same deadline.
    h.clock.advance(3 * MIN);
    await learn(0.5);
    h.clock.advance(3 * 60 * MIN);
    await learn(0.5);
    const again = await tracking.track(as('c1'), { orderId: placed.id });
    expect(again.promisedAt).toEqual(first.promisedAt);
    expect(again.latePromise!.deadlineAt).toEqual(first.latePromise!.deadlineAt);
  });

  it('the late credit fires against the locked (learned) deadline, not the router’s, and once', async () => {
    const { h, tracking, learn, wallet, routerRide } = setup();
    await learn(3); // locked at the 1.6 clamp: later than the router's promise
    const id = await placeAndAccept(h);
    const trip = await h.tripFor(id);
    await h.pickup(trip.id);
    const v = await tracking.track(as('c1'), { orderId: id });
    const deadline = v.latePromise!.deadlineAt.getTime();
    const routerDeadline = v.order.promisedReadyAt!.getTime() + ((await routerRide()).minutes + AFTER) * MIN;
    expect(deadline).toBeGreaterThan(routerDeadline);
    // Past the router's deadline but inside the locked one: no credit.
    h.clock.set(new Date(routerDeadline + 30_000));
    expect((await tracking.track(as('c1'), { orderId: id })).latePromise!.credit).toBeNull();
    expect(await wallet('c1')).toBe(0);
    // Past the locked deadline: the delivery fee comes back, once.
    h.clock.set(new Date(deadline + MIN));
    const late = await tracking.track(as('c1'), { orderId: id });
    const fee = v.order.deliveryFeeIqd;
    expect(fee).toBeGreaterThan(0);
    expect(late.latePromise!.credit).toMatchObject({ amountIqd: fee });
    await tracking.track(as('c1'), { orderId: id });
    expect(await wallet('c1')).toBe(fee);
  });
});
