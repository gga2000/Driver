import { afterAll, describe, expect, it } from 'vitest';
import { Redis } from 'ioredis';
import type { LiveBusEvent } from '@driver/contracts';
import { RedisLiveBus } from './live.bus.js';

/** Runs against a real Redis when REDIS_URL is set (CI service / `pnpm db:up`). */
const redisUrl = process.env['REDIS_URL'];

describe.skipIf(!redisUrl)('live bus on Redis pub/sub (two API instances)', () => {
  const buses: RedisLiveBus[] = [];
  const instance = () => {
    const bus = new RedisLiveBus(new Redis(redisUrl!), new Redis(redisUrl!));
    buses.push(bus);
    return bus;
  };
  afterAll(async () => {
    await Promise.all(buses.map((b) => b.close()));
  });

  it('an event published on one instance reaches the streams of another (dates revive); unsubscribed channels go quiet', async () => {
    const a = instance();
    const b = instance();
    const channel = `order:test_${Date.now()}`;
    const got: LiveBusEvent[] = [];
    const sub = b.subscribe(channel, (e) => got.push(e));
    await sub.ready;
    const at = new Date('2026-10-04T09:00:00Z');
    await a.publish(channel, {
      type: 'position',
      orderId: 'o1',
      tripId: 't1',
      pin: { lat: 32.9, lng: 45.07 },
      bearing: 90,
      speedKmh: 20,
      at,
    });
    await a.publish(`${channel}_other`, { type: 'invalidate', keys: ['orders.track'], cause: 'x' });
    for (let i = 0; i < 50 && got.length === 0; i++) await new Promise((r) => setTimeout(r, 20));
    expect(got).toEqual([
      {
        type: 'position',
        orderId: 'o1',
        tripId: 't1',
        pin: { lat: 32.9, lng: 45.07 },
        bearing: 90,
        speedKmh: 20,
        at,
      },
    ]);
    expect(b.channels()).toEqual([channel]);

    sub.unsubscribe();
    expect(b.channels()).toEqual([]);
    await a.publish(channel, { type: 'invalidate', keys: ['orders.track'], cause: 'late' });
    await new Promise((r) => setTimeout(r, 100));
    expect(got).toHaveLength(1);
  });
});
