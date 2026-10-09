import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ConsoleLogger, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { HOUSEHOLD_RULES, type Trip } from '@driver/contracts';
import { AZIZIYAH_RESTAURANTS } from '@driver/contracts/seeds';
import { AppModule } from './app.module.js';
import { DISPATCH_QUEUE } from './modules/dispatch/index.js';
import { EventsService } from './modules/events/index.js';
import { IdentityService } from './modules/identity/index.js';
import { KHAT_QUEUE, KhatService } from './modules/khat/index.js';
import { NightlyJob } from './modules/ledger/index.js';
import { ORDERS_QUEUE, OrdersService } from './modules/orders/index.js';
import { HouseholdsRpc, OrgsService } from './modules/orgs/index.js';
import { TRIPS_QUEUE, TripsService } from './modules/trips/index.js';
import { CLOCK, FakeClock } from './shared/clock.js';
import { PrismaService } from './shared/db/prisma.service.js';
import { PRISMA_LOG_CONTEXT } from './shared/db/prisma-error-log.js';
import { InMemoryQueue } from './shared/queue.js';

/**
 * CRIT3-05: the timed paths the real-database sweep could not run, walked on Postgres (migrated +
 * seeded) through the whole app on a fake clock. Redis stays off, so the timer queues are the
 * in-memory ones; the test advances the clock and runs every job that fell due, then the outbox. Each
 * path checks its end state in the database, and the last test fails on any Prisma query that failed
 * along the way or any outbox delivery that needed a retry (the bug class behind 4 of the audit's P0s:
 * a foreign key or an aborted transaction that only Postgres raises, inside a timer or a subscriber).
 *
 * The other timed paths are covered elsewhere on Postgres: the request-board driver no-show money in
 * routes.integration.test.ts, the scheduled ride and the day's timers in `pnpm sim --db postgres`.
 * Points have no expiry job (pending points older than 90 days are hidden when the wallet is read).
 */
const url = process.env['DATABASE_URL'];
const MIN = 60_000;
const KITCHEN = { lat: 32.9105, lng: 45.0665 };
const STREET_30 = { lat: 32.9098, lng: 45.0628 };
const HOME = { lat: 32.9185, lng: 45.0712 };
const SCHOOL = { lat: 32.915, lng: 45.06 };

/** Errors and warnings as usual, plus every failed Prisma query (`prisma-error-log.ts`). */
class WatchingLogger extends ConsoleLogger {
  readonly prismaFailures: string[] = [];

  constructor() {
    super();
    this.setLogLevels(['error', 'warn']);
  }

  override warn(message: unknown, ...rest: unknown[]): void {
    if (rest.at(-1) === PRISMA_LOG_CONTEXT) this.prismaFailures.push(String(message));
    super.warn(message, ...(rest as [string]));
  }
}

describe.skipIf(!url)('timed paths on Postgres, on a fake clock (CRIT3-05, needs DATABASE_URL)', () => {
  const clock = new FakeClock('2026-10-03T10:00:00Z'); // Saturday 13:00 in Baghdad: kitchens open
  const since = new Date();
  const logger = new WatchingLogger();
  const run = Date.now().toString(36);
  const phone = (n: number) => `0773${String((Date.now() + n) % 10_000_000).padStart(7, '0')}`;
  const khalid = AZIZIYAH_RESTAURANTS.find((r) => r.key === 'khalid')!;
  const people = { customer: '', courier: '', owner: '', payer: '', member: '', guardian: '', khatDriver: '' };
  let app: INestApplication;
  let db: PrismaService['prisma'];
  let queues: InMemoryQueue<unknown>[] = [];

  const foodInput = (extra: Record<string, unknown> = {}) => ({
    cityId: 'aziziyah',
    type: 'food' as const,
    merchantOrgId: khalid.orgId,
    lines: [{ catalogItemId: `${khalid.orgId}_pepsi`, qty: 8 }],
    dropoff: { zoneKey: 'street_30', pin: STREET_30 },
    ...extra,
  });

  /** Runs every timer job due on the fake clock and the outbox, until nothing is left to run. */
  async function settle(): Promise<void> {
    const events = app.get(EventsService);
    for (let i = 0; i < 50; i++) {
      let ran = 0;
      for (const q of queues) ran += await q.drain(clock.now());
      await events.drain();
      if (ran === 0) return;
    }
    throw new Error('timer jobs kept scheduling each other');
  }

  async function advance(ms: number): Promise<void> {
    clock.advance(ms);
    await settle();
  }

  const order = (id: string) => db.order.findUniqueOrThrow({ where: { id } });

  const savedRedis = process.env['REDIS_URL'];

  beforeAll(async () => {
    // Timers in memory on the fake clock (BullMQ's delays run on the wall clock).
    delete process.env['REDIS_URL'];
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(CLOCK).useValue(clock).compile();
    app = moduleRef.createNestApplication({ logger });
    await app.init();
    db = app.get(PrismaService).prisma;
    queues = [ORDERS_QUEUE, TRIPS_QUEUE, DISPATCH_QUEUE, KHAT_QUEUE].map((token) => app.get<InMemoryQueue<unknown>>(token, { strict: false }));
    for (const q of queues) if (!(q instanceof InMemoryQueue)) throw new Error('the timer queues must be in memory (REDIS_URL unset)');
    const identity = app.get(IdentityService);
    for (const [i, k] of (Object.keys(people) as Array<keyof typeof people>).entries()) people[k] = await identity.ensurePersonByPhone(phone(i + 1), 'system:test', `timed_paths_${run}`);
  }, 60_000);

  afterAll(async () => {
    if (savedRedis !== undefined) process.env['REDIS_URL'] = savedRedis;
    if (app) await app.close();
  });

  it('a scheduled food order reaches the kitchen before its time, and the kitchen that never answers lets it go after 90 s', async () => {
    const orders = app.get(OrdersService);
    const at = new Date(clock.now().getTime() + 3 * 60 * MIN);
    const o = await orders.place(people.customer, foodInput({ scheduledFor: at }));
    await settle();
    expect((await order(o.id)).merchantOfferedAt).toBeNull();
    // Offered at T − (prep + busy + 10 min): walk the clock a minute at a time until it is.
    let offeredAt: Date | null = null;
    for (let i = 0; i < 180 && !offeredAt; i++) {
      await advance(MIN);
      offeredAt = (await order(o.id)).merchantOfferedAt;
    }
    expect(offeredAt).not.toBeNull();
    expect(offeredAt!.getTime()).toBeLessThanOrEqual(at.getTime() - 10 * MIN);
    const offered = await order(o.id);
    if (offered.state === 'placed') {
      await advance(91_000);
      expect(await order(o.id)).toMatchObject({ state: 'merchant_rejected', cancellationReason: 'merchant_timeout' });
    } else {
      // A kitchen on auto-accept takes it at once.
      expect(offered.state).toBe('merchant_accepted');
    }
  }, 120_000);

  it('a customer unreachable at the door: the desk is called at 3:00, the courier may fail it at 5:00, and the order is disputed', async () => {
    const orders = app.get(OrdersService);
    const trips = app.get(TripsService);
    const o = await orders.place(people.customer, foodInput());
    await settle();
    await orders.merchantAccept(people.owner, { orderId: o.id, prepMinutes: 15 });
    await settle();
    const trip: Trip | null = await trips.activeForOrder(o.id);
    expect(trip).not.toBeNull();
    // The dispatch accept, stood in by the row it writes.
    await db.trip.update({ where: { id: trip!.id }, data: { courierId: people.courier, acceptedAt: clock.now(), state: 'en_route_to_pickup' } });
    const pickup = trip!.stops.find((s) => s.type === 'pickup')!;
    const door = trip!.stops.find((s) => s.type === 'dropoff')!;
    await trips.arrive(trip!.id, pickup.id, people.courier, { pin: KITCHEN });
    await trips.completeStop(trip!.id, pickup.id, people.courier);
    await settle();
    expect((await order(o.id)).state).toBe('picked_up');

    await trips.arrive(trip!.id, door.id, people.courier, { pin: STREET_30 });
    await trips.startUnreachable(trip!.id, door.id, people.courier);
    await settle();
    await advance(3 * MIN - 1_000);
    expect((await db.trip.findUniqueOrThrow({ where: { id: trip!.id } })).unreachableEscalatedAt).toBeNull();
    await advance(1_000);
    expect((await db.trip.findUniqueOrThrow({ where: { id: trip!.id } })).unreachableEscalatedAt).not.toBeNull();
    await advance(2 * MIN);
    await trips.fail(trip!.id, { personId: people.courier, role: 'driver' });
    await settle();
    expect(await db.trip.findUniqueOrThrow({ where: { id: trip!.id } })).toMatchObject({ state: 'failed', cancellationReason: 'unreachable' });
    expect((await order(o.id)).state).toBe('disputed');
  }, 120_000);

  it(`a household order over the budget waits for the payer: nobody answers, it is cancelled free after ${HOUSEHOLD_RULES.approvalWaitMin} min; a yes sends it on`, async () => {
    const orders = app.get(OrdersService);
    const orgs = app.get(OrgsService);
    const home = await orgs.createHousehold({ name: `بيت ${run}`, cityId: 'aziziyah', payerId: people.payer });
    await orgs.addMember(home.id, people.member, { role: 'orderer' });
    await orgs.setMonthlyBudget(home.id, people.member, 1_000);
    const input = foodInput({ householdOrgId: home.id, paymentMethod: 'cash' });

    const silent = await orders.place(people.member, input);
    await settle();
    expect((await order(silent.id)).heldForPayer).toBe(true);
    await advance(HOUSEHOLD_RULES.approvalWaitMin * MIN - 1_000);
    expect((await order(silent.id)).state).toBe('placed');
    await advance(1_000);
    expect(await order(silent.id)).toMatchObject({ state: 'platform_cancelled', cancellationReason: 'payer_no_answer', cancellationFeeIqd: 0 });
    expect(await orgs.approvalForOrder(home.id, silent.id)).toMatchObject({ state: 'withdrawn' });

    const yes = await orders.place(people.member, input);
    await settle();
    const req = await orgs.approvalForOrder(home.id, yes.id);
    expect(req).toMatchObject({ state: 'pending' });
    // The payer's «موافق» in the app (the router's path: the answer, then the held order moves).
    await app.get(HouseholdsRpc).approve({ personId: people.payer, sessionId: `p_${run}` }, { requestId: req!.id });
    await settle();
    const after = await order(yes.id);
    expect(after.heldForPayer).toBe(false);
    expect(after.merchantOfferedAt).not.toBeNull();
    // Its own timer is spent: past the wait it is not cancelled.
    await advance(HOUSEHOLD_RULES.approvalWaitMin * MIN);
    expect((await order(yes.id)).state).not.toBe('platform_cancelled');
  }, 120_000);

  it('a full خطوط run: the child in at home and out at school; an unchecked car raises the sweep alert 5 min after the last drop', async () => {
    const identity = app.get(IdentityService);
    const trips = app.get(TripsService);
    const khat = app.get(KhatService);
    const driver = { personId: people.khatDriver, sessionId: `s_${run}` };
    const { childRef } = await identity.registerChild({ personId: people.guardian, sessionId: `g_${run}` }, { name: 'زينب علي' });
    const w = (min: number) => new Date(clock.now().getTime() + min * MIN);
    const trip = await trips.createForOrders({
      cityId: 'aziziyah',
      vertical: 'khat',
      orders: [],
      stops: [
        { type: 'pickup', zoneKey: 'zakur', target: HOME, childRef, windowStart: w(10), windowEnd: w(15) },
        { type: 'dropoff', zoneKey: 'centre', target: SCHOOL, childRef, windowStart: w(30), windowEnd: w(35) },
      ],
    });
    // The driver's accept of the run's offer, stood in by the row it writes.
    await db.trip.update({ where: { id: trip.id }, data: { courierId: people.khatDriver, acceptedAt: clock.now(), state: 'en_route_to_pickup' } });
    const [p, d] = trip.stops;
    await khat.tapIn(driver, { tripId: trip.id, stopId: p!.id, pin: HOME });
    await advance(20 * MIN);
    await khat.tapOut(driver, { tripId: trip.id, stopId: d!.id, pin: SCHOOL });
    await settle();
    expect((await db.trip.findUniqueOrThrow({ where: { id: trip.id } })).state).toBe('completed');
    await advance(5 * MIN - 1_000);
    expect(await db.khatSweepAlert.findUnique({ where: { tripId: trip.id } })).toBeNull();
    await advance(1_000);
    expect(await db.khatSweepAlert.findUnique({ where: { tripId: trip.id } })).toMatchObject({ tripId: trip.id, driverId: people.khatDriver, confirmedAt: null });
    // A late check clears it.
    await khat.confirmEmptyCar(driver, { tripId: trip.id });
    await settle();
    expect((await db.khatSweepAlert.findUniqueOrThrow({ where: { tripId: trip.id } })).confirmedAt).not.toBeNull();
  }, 120_000);

  it('the nightly ledger close runs on Postgres and records its result', async () => {
    const closed = () => db.event.count({ where: { type: 'ledger.nightly_closed', aggregate: 'ledger' } });
    const before = await closed();
    const report = await app.get(NightlyJob).run({ requestedBy: `timed_paths_${run}` });
    await settle();
    expect(typeof report.ok).toBe('boolean');
    expect(report.kindViolations).toBe(0);
    expect(await closed()).toBe(before + 1);
  }, 60_000);

  it('no Prisma query failed and no outbox delivery needed a retry along the way', async () => {
    await settle();
    expect(logger.prismaFailures).toEqual([]);
    const retried = await db.subscriberDelivery.findMany({ where: { createdAt: { gte: since }, attempts: { gt: 1 } }, select: { subscriber: true, attempts: true, lastError: true } });
    expect(retried).toEqual([]);
  });
});
