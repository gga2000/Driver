import { describe, expect, it } from 'vitest';
import { PriceRequest } from '@driver/contracts';
import { FakeClock } from '../../shared/clock.js';
import { ConfigService } from '../config/index.js';
import { InMemoryQuoteStore, QUOTE_REUSE_MIN_LEFT_MIN, QUOTE_TTL_MIN } from './quote-store.js';
import { PricingService } from './pricing.service.js';

const REQ = (at: Date, dropoff = 'street_30') =>
  PriceRequest.parse({
    cityId: 'aziziyah',
    vertical: 'taxi',
    stops: [
      { zoneId: 'centre', type: 'pickup', pin: { lat: 32.9105, lng: 45.0665 } },
      { zoneId: dropoff, type: 'dropoff' },
    ],
    options: { doorPickup: false, streetHandover: false },
    at,
  });

function world(at = '2026-10-03T10:00:00Z') {
  const clock = new FakeClock(at);
  const store = new InMemoryQuoteStore();
  const pricing = new PricingService(new ConfigService(), store, clock);
  return { clock, store, pricing };
}

describe('pricing.quote keeps one quote per caller and trip (perf z3)', () => {
  it('the same caller re-asking each minute for the same trip gets the kept quote back and writes nothing new', async () => {
    const w = world();
    const first = await w.pricing.keepQuote(REQ(w.clock.now()), 'p:c1');
    for (let i = 0; i < 5; i++) {
      w.clock.advanceMinutes(1);
      const again = await w.pricing.keepQuote(REQ(w.clock.now()), 'p:c1');
      expect(again.id).toBe(first.id);
      expect(again.total).toBe(first.total);
    }
    expect(w.store.quotes.size).toBe(1);
  });

  it('another caller, another trip, or no caller at all keeps a new quote', async () => {
    const w = world();
    const mine = await w.pricing.keepQuote(REQ(w.clock.now()), 'p:c1');
    expect((await w.pricing.keepQuote(REQ(w.clock.now()), 'p:c2')).id).not.toBe(mine.id);
    expect((await w.pricing.keepQuote(REQ(w.clock.now()), 'ip:10.0.0.1')).id).not.toBe(mine.id);
    expect((await w.pricing.keepQuote(REQ(w.clock.now(), 'zakur'), 'p:c1')).id).not.toBe(mine.id);
    // In-process callers (simulator, tests) name nobody: always a fresh kept quote, as before.
    const a = await w.pricing.keepQuote(REQ(w.clock.now()));
    const b = await w.pricing.keepQuote(REQ(w.clock.now()));
    expect(a.id).not.toBe(b.id);
    expect(w.store.quotes.size).toBe(6);
  });

  it('a quote an order took is never handed out again: the next ask keeps a new one', async () => {
    const w = world();
    const booked = await w.pricing.keepQuote(REQ(w.clock.now()), 'p:c1');
    expect(await w.pricing.claimQuote(booked.id, w.clock.now())).toBe(true);
    const next = await w.pricing.keepQuote(REQ(w.clock.now()), 'p:c1');
    expect(next.id).not.toBe(booked.id);
    // …and that new one can be booked once.
    expect(await w.pricing.claimQuote(next.id, w.clock.now())).toBe(true);
  });

  it(`once fewer than ${QUOTE_REUSE_MIN_LEFT_MIN} minutes are left to book it, a new quote is kept`, async () => {
    const w = world();
    const first = await w.pricing.keepQuote(REQ(w.clock.now()), 'p:c1');
    w.clock.advanceMinutes(QUOTE_TTL_MIN - QUOTE_REUSE_MIN_LEFT_MIN - 1);
    expect((await w.pricing.keepQuote(REQ(w.clock.now()), 'p:c1')).id).toBe(first.id);
    w.clock.advanceMinutes(1);
    const fresh = await w.pricing.keepQuote(REQ(w.clock.now()), 'p:c1');
    expect(fresh.id).not.toBe(first.id);
    // The new one carries on being reused.
    w.clock.advanceMinutes(1);
    expect((await w.pricing.keepQuote(REQ(w.clock.now()), 'p:c1')).id).toBe(fresh.id);
  });

  it('when the engine prices the trip differently now (a night or peak rule flips), the new price is kept and shown', async () => {
    const w = world();
    // Find an hour where this trip costs something else than at 13:00 Baghdad.
    const base = w.pricing.quote(REQ(w.clock.now())).total;
    const hours = Array.from({ length: 24 }, (_, h) => new Date(Date.UTC(2026, 9, 3, h, 0)));
    const other = hours.find((at) => w.pricing.quote(REQ(at)).total !== base);
    expect(other).toBeDefined();
    const first = await w.pricing.keepQuote(REQ(w.clock.now()), 'p:c1');
    const flipped = await w.pricing.keepQuote(REQ(other!), 'p:c1');
    expect(flipped.id).not.toBe(first.id);
    expect(flipped.total).toBe(w.pricing.quote(REQ(other!)).total);
    expect(flipped.total).not.toBe(first.total);
  });
});
