import { afterAll, describe, expect, it } from 'vitest';
import { Redis } from 'ioredis';
import { FakeClock } from './clock.js';
import { RedisWindowCounter } from './window-counter.js';

/** Runs against a real Redis when REDIS_URL is set (CI service / `pnpm db:up`). */
const redisUrl = process.env['REDIS_URL'];

describe.skipIf(!redisUrl)('shared window counter on Redis (review 2026-10-04 #22)', () => {
  const conns: Redis[] = [];
  const connect = () => {
    const r = new Redis(redisUrl!);
    conns.push(r);
    return r;
  };
  afterAll(() => {
    for (const c of conns) c.disconnect();
  });

  it('two API instances share one sliding window; refused hits are not counted; the window slides', async () => {
    const clock = new FakeClock('2026-10-04T09:00:00Z');
    const key = `test:wc:${Date.now()}:${Math.random()}`;
    const [a, b] = [new RedisWindowCounter(connect(), clock), new RedisWindowCounter(connect(), clock)];
    for (let i = 0; i < 4; i++) {
      expect((await (i % 2 ? a : b).hit(key, 60_000, 4)).allowed).toBe(true);
      clock.advance(1000);
    }
    const refused = await a.hit(key, 60_000, 4);
    expect(refused).toMatchObject({ allowed: false, count: 4 });
    expect(refused.retryAfterSec).toBeGreaterThan(50);
    expect(await b.count(key, 60_000)).toBe(4);
    clock.advance(57_000); // the first hit leaves the window
    expect((await b.hit(key, 60_000, 4)).allowed).toBe(true);
  });

  it('racing hits never pass the last slot together', async () => {
    const clock = new FakeClock('2026-10-04T09:00:00Z');
    const key = `test:wc:race:${Date.now()}:${Math.random()}`;
    const pods = [new RedisWindowCounter(connect(), clock), new RedisWindowCounter(connect(), clock)];
    const results = await Promise.all(Array.from({ length: 10 }, (_, i) => pods[i % 2]!.hit(key, 60_000, 5)));
    expect(results.filter((r) => r.allowed)).toHaveLength(5);
    expect(await pods[0]!.count(key, 60_000)).toBe(5);
  });
  it('tally: two API instances share one fixed-window count that starts over each window', async () => {
    const clock = new FakeClock('2026-10-04T09:00:10Z');
    const key = `test:wc:tally:${Date.now()}:${Math.random()}`;
    const [a, b] = [new RedisWindowCounter(connect(), clock), new RedisWindowCounter(connect(), clock)];
    const counts = await Promise.all(Array.from({ length: 10 }, (_, i) => (i % 2 ? a : b).tally(key, 60_000)));
    expect(counts.map((c) => c.count).sort((x, y) => x - y)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(counts[0]!.retryAfterSec).toBe(50);
    clock.advance(50_000);
    expect(await a.tally(key, 60_000)).toEqual({ count: 1, retryAfterSec: 60 });
  });
});
