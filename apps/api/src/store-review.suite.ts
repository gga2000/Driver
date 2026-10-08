import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AZIZIYAH_RESTAURANTS } from '@driver/contracts/seeds';
import { DriverError } from '@driver/contracts';
import { appRouter, t } from '@driver/contracts/router';
import { AppModule } from './app.module.js';
import { CatalogRpc, CatalogService, seedStorefronts } from './modules/catalog/index.js';
import { EventsService } from './modules/events/index.js';
import { IdentityService, STORE_REVIEW } from './modules/identity/index.js';
import { LedgerService } from './modules/ledger/index.js';
import { ORDERS_QUEUE, OrdersService } from './modules/orders/index.js';
import { OrgsService } from './modules/orgs/index.js';
import { STORE_REVIEW_QUEUE, StoreReviewModule } from './modules/store-review/index.js';
import { TripsService } from './modules/trips/index.js';
import { CLOCK, FakeClock } from './shared/clock.js';
import { InMemoryQueue } from './shared/queue.js';
import { PrismaService } from './shared/db/prisma.service.js';
import { TEST_CREW_ID } from './shared/test-scope.js';
import { TrpcService } from './trpc/trpc.module.js';

const REVIEWER_CODE = '480917';
const HOME = { zoneKey: 'zakur', pin: { lat: 32.887, lng: 45.0765 } };

const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return 'ok';
  } catch (err) {
    return err instanceof DriverError ? err.code : String(err);
  }
};

/**
 * BENCH-04 end to end, through the app's own wiring: the store reviewer signs in with the fixed code,
 * sees and orders only the hidden test kitchen, and the order walks to the door by the test crew,
 * while no customer sees the kitchen, nothing is dispatched to a real courier, and no ledger account
 * moves by a single dinar.
 */
export function storeReviewSuite(opts: { database: boolean }): void {
  describe(`the store reviewers test kitchen (${opts.database ? 'Postgres' : 'in memory'})`, () => {
    const clock = new FakeClock('2026-10-08T09:00:00Z'); // 12:00 Baghdad, a Thursday
    // One number per run, so runs against a shared database never meet each other's reviewer.
    const n = opts.database ? String(Date.now() % 10_000_000).padStart(7, '0') : '9990001';
    const REVIEWER_PHONE = `0771${n}`;
    let app: INestApplication;
    let kitchenId: string;
    let realKitchen: { orgId: string; itemIds: Map<string, string> };
    let reviewer: string;
    let reviewerToken: string;
    let reviewerIsNew: boolean;
    let customer: string;

    beforeAll(async () => {
      if (!opts.database) vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
      const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
        .overrideProvider(CLOCK)
        .useValue(clock)
        .overrideProvider(STORE_REVIEW)
        .useValue({ phoneE164: `+964771${n}`, code: REVIEWER_CODE, dailySignIns: 10 })
        // The walk's steps and the order timers run when the test says so, also where Redis is configured.
        .overrideProvider(STORE_REVIEW_QUEUE)
        .useValue(new InMemoryQueue('store-review.steps', () => clock.now()))
        .overrideProvider(ORDERS_QUEUE)
        .useValue(new InMemoryQueue('orders.timers', () => clock.now()))
        .compile();
      app = moduleRef.createNestApplication({ logger: ['error', 'warn'] });
      await app.init();
      kitchenId = (await app.get(StoreReviewModule).ensureKitchen())!;
      // A real kitchen next to the test one: the seeded launch menu on Postgres, a fresh one in memory.
      if (opts.database) {
        const front = (await app.get(CatalogService).storefronts('aziziyah')).find(
          (f) => !f.isTest,
        )!;
        realKitchen = {
          orgId: front.orgId,
          itemIds: new Map(
            (await app.get(CatalogService).menu(front.orgId)).map((i) => [i.id, i.id]),
          ),
        };
      } else {
        const seeded = await seedStorefronts(
          app.get(OrgsService),
          app.get(CatalogService),
          AZIZIYAH_RESTAURANTS.slice(0, 1).map((r) => ({ ...r, hours: [] })),
          'sr-owner',
        );
        realKitchen = seeded[0]!;
      }
      const identity = app.get(IdentityService);
      await identity.requestOtp({ phone: REVIEWER_PHONE, purpose: 'login' });
      const signedIn = await identity.verifyOtp({ phone: REVIEWER_PHONE, code: REVIEWER_CODE });
      reviewer = signedIn.personId;
      reviewerToken = signedIn.tokens.accessToken;
      reviewerIsNew = signedIn.isNew;
      customer = await identity.ensurePersonByPhone(`0770${n}`, 'system:e2e', 'e2e');
    });

    afterAll(async () => {
      await app.close();
      vi.useRealTimers();
    });

    const reader = (personId: string) => ({ actor: { personId, sessionId: 'e2e' } });
    const foodAt = (merchantOrgId: string, catalogItemId: string) => ({
      cityId: 'aziziyah',
      type: 'food' as const,
      merchantOrgId,
      lines: [{ catalogItemId, qty: 2 }],
      paymentMethod: 'cash' as const,
      dropoff: HOME,
    });

    it('making the kitchen twice keeps one kitchen and one menu', async () => {
      expect(await app.get(StoreReviewModule).ensureKitchen()).toBe(kitchenId);
      expect((await app.get(CatalogService).menu(kitchenId)).map((i) => i.nameEn)).toEqual([
        'Chicken sandwich',
        'Falafel plate',
        'Laban',
      ]);
      expect((await app.get(OrgsService).merchants('aziziyah')).map((m) => m.id)).not.toContain(
        kitchenId,
      );
    });

    it('the reviewer account is made at boot, so every machine knows it before the first sign-in', () => {
      expect(reviewerIsNew).toBe(false);
    });

    it('the reviewer may make only the food-flow writes; the rest answers «paused» untouched', async () => {
      const ctx = await app.get(TrpcService).context(`Bearer ${reviewerToken}`, '127.0.0.1');
      const call = t.createCallerFactory(appRouter)(ctx);
      const paused = async (p: Promise<unknown>) =>
        p.then(
          () => 'ok',
          (err: { cause?: { code?: string } }) => err.cause?.code ?? String(err),
        );
      expect(await paused(call.wallet.claimPoints())).toBe('service_paused');
      expect(await paused(call.referral.claim({ code: 'ABC123' }))).toBe('service_paused');
      expect(await paused(call.household.create({ name: 'بيت التجربة' }))).toBe('service_paused');
      expect(await paused(call.identity.updateProfile({ name: 'App Review' }))).toBe('ok');
    });

    it('only the reviewer sees the test kitchen, and the reviewer sees nothing else', async () => {
      const rpc = app.get(CatalogRpc);
      const forCustomer = await rpc.restaurants(reader(customer), {
        cityId: 'aziziyah',
        filters: {},
      } as never);
      const forReviewer = await rpc.restaurants(reader(reviewer), {
        cityId: 'aziziyah',
        filters: {},
      } as never);
      const forGuest = await rpc.restaurants({ actor: null }, {
        cityId: 'aziziyah',
        filters: {},
      } as never);
      expect(forCustomer.map((c) => c.id)).toContain(realKitchen.orgId);
      expect(forCustomer.map((c) => c.id)).not.toContain(kitchenId);
      expect(forGuest.map((c) => c.id)).not.toContain(kitchenId);
      expect(forReviewer.map((c) => c.id)).toEqual([kitchenId]);
      expect(await code(rpc.menu(reader(customer), { merchantId: kitchenId } as never))).toBe(
        'org_not_found',
      );
      expect(
        await code(rpc.menu(reader(reviewer), { merchantId: realKitchen.orgId } as never)),
      ).toBe('org_not_found');
      expect(
        (await rpc.menu(reader(reviewer), { merchantId: kitchenId } as never)).categories.flatMap(
          (c) => c.items,
        ),
      ).toHaveLength(3);
    });

    it('orders pair the same way: nobody else orders from it, the reviewer orders nothing else', async () => {
      const orders = app.get(OrdersService);
      const testItem = (await app.get(CatalogService).menu(kitchenId))[0]!.id;
      const realItem = [...realKitchen.itemIds.values()][0]!;
      expect(await code(orders.place(customer, foodAt(kitchenId, testItem)))).toBe('org_not_found');
      expect(await code(orders.place(reviewer, foodAt(realKitchen.orgId, realItem)))).toBe(
        'org_not_found',
      );
      expect(await code(orders.quote(reviewer, foodAt(realKitchen.orgId, realItem)))).toBe(
        'org_not_found',
      );
      expect(
        await code(
          orders.place(reviewer, {
            cityId: 'aziziyah',
            type: 'ride',
            rideVertical: 'tuktuk',
            lines: [],
            paymentMethod: 'cash',
            pickup: HOME,
            dropoff: { zoneKey: 'centre' },
          } as never),
        ),
      ).toBe('service_paused');
    });

    it("the reviewer's order walks to the door by the test crew; no courier is asked and no money moves", async () => {
      const ledger = app.get(LedgerService);
      const events = app.get(EventsService);
      // In memory the whole ledger is this test's, so every balance must stay put; on a shared database
      // no account of the kitchen, the crew or the reviewer may appear.
      const ours = (a: string) => [kitchenId, reviewer, TEST_CREW_ID].some((id) => a.includes(id));
      const snapshot = async () =>
        Object.fromEntries(
          await Promise.all(
            (await ledger.accounts())
              .filter((a) => !opts.database || ours(a))
              .map(async (a) => [a, (await ledger.balance(a)).amount] as const),
          ),
        );
      // In memory the test delivers events itself; on Postgres the app's own outbox worker does, and
      // the test waits for it (a second drain racing the worker is not what production runs).
      const settle = async () => {
        if (!opts.database) return void (await events.drain());
        const db = app.get(PrismaService).prisma;
        for (
          let i = 0;
          i < 200 && (await db.outbox.count({ where: { status: 'pending', attempts: 0 } })) > 0;
          i += 1
        )
          await new Promise((r) => setTimeout(r, 50));
      };
      await settle();
      const before = await snapshot();

      const orders = app.get(OrdersService);
      const items = await app.get(CatalogService).menu(kitchenId);
      const placed = await orders.place(reviewer, foodAt(kitchenId, items[0]!.id));
      expect(placed.id).toMatch(/^test_/);
      expect(placed.state).toBe('merchant_accepted');
      expect((await orders.aggregate(placed.id)).order.isTest).toBe(true);
      // The Console's live list never shows it; the test kitchen's own list does. (In memory only: a
      // shared database holds every earlier run's orders, and reading them all is slow.)
      if (!opts.database) {
        expect((await orders.listActive({ cityId: 'aziziyah' })).map((o) => o.id)).not.toContain(
          placed.id,
        );
        expect((await orders.listActive({ merchantOrgId: kitchenId })).map((o) => o.id)).toContain(
          placed.id,
        );
      }

      const steps = app.get<InMemoryQueue<unknown>>(STORE_REVIEW_QUEUE);
      const walk = async (seconds: number) => {
        clock.advance(seconds * 1000);
        await settle();
        await steps.drain();
        await settle();
      };
      await walk(0);
      await walk(20);
      expect((await orders.get(placed.id)).state).toBe('preparing');
      await walk(25);
      const trip = (await app.get(TripsService).activeForOrder(placed.id))!;
      expect(trip.id).toMatch(/^test_/);
      expect(trip.courierId).toBe(TEST_CREW_ID);
      await walk(75);
      expect((await orders.get(placed.id)).state).toBe('picked_up');
      await walk(180);
      expect((await orders.get(placed.id)).state).toBe('delivered');
      // The order closes on its own timer two hours later, still without touching money.
      clock.advance(2 * 3_600_000 + 1000);
      for (let i = 0; i < 3; i += 1) {
        await app.get<InMemoryQueue<unknown>>(ORDERS_QUEUE).drain();
        await settle();
      }
      expect((await orders.get(placed.id)).state).toBe('closed');

      const types = (await events.forOrder(placed.id)).map((e) => e.type);
      expect(types).toEqual(
        expect.arrayContaining(['order.placed', 'order.cash_collected', 'order.closed']),
      );
      expect(await snapshot()).toEqual(before);
      expect(
        (await events.forTrip(trip.id)).map((e) => e.type).filter((t) => t.startsWith('dispatch.')),
      ).toEqual([]);
    });

    // Made-up order ids: in memory only (Postgres would refuse the links to orders that do not exist).
    it.skipIf(opts.database)(
      'a real courier can never take a test trip, and the crew can never take a real one',
      async () => {
        const trips = app.get(TripsService);
        expect(
          await code(
            trips.createForOrders({
              id: 'trip_real',
              cityId: 'aziziyah',
              vertical: 'food',
              orders: [{ orderId: 'ord_x' }],
              stops: [{ orderId: 'ord_x', type: 'pickup', zoneKey: 'centre' }],
            }),
          ),
        ).toBe('invalid_input');
        expect(
          await code(
            trips.createForOrders({
              cityId: 'aziziyah',
              vertical: 'food',
              orders: [{ orderId: 'test_x' }],
              stops: [{ orderId: 'test_x', type: 'pickup', zoneKey: 'centre' }],
            }),
          ),
        ).toBe('invalid_input');
        const t = await trips.createForOrders({
          id: 'test_trip_probe',
          cityId: 'aziziyah',
          vertical: 'food',
          orders: [{ orderId: 'test_probe' }],
          stops: [{ orderId: 'test_probe', type: 'pickup', zoneKey: 'centre' }],
        });
        await trips.offer(t.id, { driverIds: ['p_real'] });
        expect(await code(trips.accept(t.id, 'p_real', { vehicleClass: 'bike' }))).toBe(
          'offer_not_yours',
        );
        const real = await trips.createForOrders({
          cityId: 'aziziyah',
          vertical: 'food',
          orders: [{ orderId: 'ord_probe' }],
          stops: [{ orderId: 'ord_probe', type: 'pickup', zoneKey: 'centre' }],
        });
        await trips.offer(real.id, { driverIds: [TEST_CREW_ID] });
        expect(await code(trips.accept(real.id, TEST_CREW_ID, { vehicleClass: 'bike' }))).toBe(
          'offer_not_yours',
        );
      },
    );
  });
}
