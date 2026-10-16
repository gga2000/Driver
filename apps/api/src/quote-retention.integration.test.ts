import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PriceRequest } from '@driver/contracts';
import { AppModule } from './app.module.js';
import { CLOCK, FakeClock } from './shared/clock.js';
import { PrismaService } from './shared/db/prisma.service.js';
import { IdentityService } from './modules/identity/index.js';
import { OrdersService } from './modules/orders/index.js';
import { PricingService, QUOTE_PURGE_GRACE_MIN, QUOTE_TTL_MIN } from './modules/pricing/index.js';
import { QuoteRetention } from './modules/retention/index.js';

/**
 * Expired quotes on a real Postgres, through the app's own wiring: the quotes nobody booked go (with
 * their components) an hour after they expire; a quote a ride took stays, and so does its link from the
 * order. Skipped without DATABASE_URL.
 */
const url = process.env['DATABASE_URL'];
const KITCHEN = { lat: 32.9105, lng: 45.0665 };
const STREET_30 = { lat: 32.9098, lng: 45.0628 };

describe.skipIf(!url)('quote retention on Postgres (needs DATABASE_URL)', () => {
  const clock = new FakeClock('2026-10-03T10:00:00Z');
  const run = Date.now().toString(36);
  let app: INestApplication;
  let db: PrismaService['prisma'];
  let customer = '';

  const quote = () =>
    app.get(PricingService).keepQuote(
      PriceRequest.parse({ cityId: 'aziziyah', vertical: 'taxi', stops: [{ zoneId: 'centre', type: 'pickup', pin: KITCHEN }, { zoneId: 'street_30', type: 'dropoff', pin: STREET_30 }], options: { doorPickup: false, streetHandover: false }, at: clock.now() }),
    );

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(CLOCK).useValue(clock).compile();
    app = moduleRef.createNestApplication({ logger: ['error'] });
    await app.init();
    db = app.get(PrismaService).prisma;
    const phone = `0773${String(Date.now() % 10_000_000).padStart(7, '0')}`;
    customer = await app.get(IdentityService).ensurePersonByPhone(phone, 'system:test', 'quote_retention_it', { name: 'زينب' });
  }, 60_000);

  afterAll(async () => {
    if (!app) return;
    for (let i = 0; i < 50 && (await db.outbox.count({ where: { status: 'pending', attempts: 0 } })) > 0; i++) await new Promise((r) => setTimeout(r, 100));
    await app.close();
  });

  it('deletes expired quotes nobody booked, keeps the booked one and the fresh one', async () => {
    const unbooked = await quote();
    const booked = await quote();
    const ride = await app.get(OrdersService).place(customer, {
      cityId: 'aziziyah',
      type: 'ride',
      rideVertical: 'taxi',
      fareIqd: booked.total,
      quoteId: booked.id,
      pickup: { zoneKey: 'centre', pin: KITCHEN },
      dropoff: { zoneKey: 'street_30', pin: STREET_30 },
      clientRequestId: `quote-retention-${run}`,
    });
    expect(await db.quoteComponent.count({ where: { quoteId: unbooked.id } })).toBeGreaterThan(0);

    // Expired, but still inside the grace hour: nothing goes yet.
    clock.advanceMinutes(QUOTE_TTL_MIN + QUOTE_PURGE_GRACE_MIN - 1);
    const retention = app.get(QuoteRetention);
    await retention.tick();
    expect(await db.quote.findUnique({ where: { id: unbooked.id } })).not.toBeNull();

    clock.advanceMinutes(2);
    const fresh = await quote();
    expect(await retention.tick()).toBeGreaterThanOrEqual(1);
    expect(await db.quote.findUnique({ where: { id: unbooked.id } })).toBeNull();
    expect(await db.quoteComponent.count({ where: { quoteId: unbooked.id } })).toBe(0);
    expect(await db.quote.findUnique({ where: { id: booked.id } })).not.toBeNull();
    expect((await db.order.findUnique({ where: { id: ride.id } }))?.quoteId).toBe(booked.id);
    expect(await db.quote.findUnique({ where: { id: fresh.id } })).not.toBeNull();
  }, 60_000);

  it('perf z3: the same caller re-asking for the same trip writes no new rows until an order takes the quote', async () => {
    const who = `p:z3-${run}`;
    const ask = () =>
      app.get(PricingService).keepQuote(
        PriceRequest.parse({ cityId: 'aziziyah', vertical: 'taxi', stops: [{ zoneId: 'centre', type: 'pickup', pin: KITCHEN }, { zoneId: 'street_30', type: 'dropoff', pin: STREET_30 }], options: { doorPickup: false, streetHandover: false }, at: clock.now() }),
        who,
      );
    const first = await ask();
    const before = await db.quote.count();
    clock.advanceMinutes(1);
    expect((await ask()).id).toBe(first.id);
    clock.advanceMinutes(1);
    expect((await ask()).id).toBe(first.id);
    expect(await db.quote.count()).toBe(before);

    const ride = await app.get(OrdersService).place(customer, {
      cityId: 'aziziyah',
      type: 'ride',
      rideVertical: 'taxi',
      fareIqd: first.total,
      quoteId: first.id,
      pickup: { zoneKey: 'centre', pin: KITCHEN },
      dropoff: { zoneKey: 'street_30', pin: STREET_30 },
      clientRequestId: `quote-reuse-${run}`,
    });
    expect((await db.order.findUnique({ where: { id: ride.id } }))?.quoteId).toBe(first.id);
    const next = await ask();
    expect(next.id).not.toBe(first.id);
    expect(await db.quote.findUnique({ where: { id: next.id } })).not.toBeNull();
  }, 60_000);
});
