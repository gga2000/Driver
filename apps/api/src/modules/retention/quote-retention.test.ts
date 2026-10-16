import { afterEach, describe, expect, it, vi } from 'vitest';
import { PriceRequest } from '@driver/contracts';
import { FakeClock } from '../../shared/clock.js';
import { ConfigService } from '../config/index.js';
import { InMemoryQuoteStore, PricingService, QUOTE_PURGE_GRACE_MIN, QUOTE_TTL_MIN } from '../pricing/index.js';
import { QuoteRetention } from './quote-retention.js';

const REQ = (at: Date) =>
  PriceRequest.parse({
    cityId: 'aziziyah',
    vertical: 'taxi',
    stops: [
      { zoneId: 'centre', type: 'pickup', pin: { lat: 32.9105, lng: 45.0665 } },
      { zoneId: 'street_30', type: 'dropoff', pin: { lat: 32.9098, lng: 45.0628 } },
    ],
    options: { doorPickup: false, streetHandover: false },
    at,
  });

describe('QuoteRetention', () => {
  afterEach(() => vi.restoreAllMocks());

  it('deletes kept quotes nobody booked once an hour has passed since they expired', async () => {
    const clock = new FakeClock('2026-10-03T10:00:00Z');
    const store = new InMemoryQuoteStore();
    const pricing = new PricingService(new ConfigService(), store, clock);
    const unbooked = await pricing.keepQuote(REQ(clock.now()));
    const booked = await pricing.keepQuote(REQ(clock.now()));
    expect(await pricing.claimQuote(booked.id, clock.now())).toBe(true);
    const retention = new QuoteRetention(pricing, 'all');

    clock.advanceMinutes(QUOTE_TTL_MIN + QUOTE_PURGE_GRACE_MIN - 1);
    expect(await retention.tick()).toBe(0);
    clock.advanceMinutes(2);
    expect(await retention.tick()).toBe(1);
    expect(store.quotes.has(unbooked.id)).toBe(false);
    expect(store.quotes.has(booked.id)).toBe(true);
  });

  it('runs only where jobs run (DRIVER_ROLE web leaves it to the worker)', () => {
    const pricing = new PricingService(new ConfigService());
    const spy = vi.spyOn(globalThis, 'setInterval');
    new QuoteRetention(pricing, 'web').onModuleInit();
    expect(spy).not.toHaveBeenCalled();
    const worker = new QuoteRetention(pricing, 'worker');
    worker.onModuleInit();
    expect(spy).toHaveBeenCalledTimes(1);
    worker.onModuleDestroy();
  });
});
