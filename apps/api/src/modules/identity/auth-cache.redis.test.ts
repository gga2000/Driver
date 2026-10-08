import { afterAll, describe, expect, it } from 'vitest';
import { Redis } from 'ioredis';
import { RedisDropBus, type AuthDrop } from './auth-cache.js';

/** Runs against a real Redis when REDIS_URL is set (CI service / `pnpm db:up`). */
const redisUrl = process.env['REDIS_URL'];

describe.skipIf(!redisUrl)('auth cache drops on Redis pub/sub (two API machines)', () => {
  const buses: RedisDropBus[] = [];
  const machine = () => {
    const bus = new RedisDropBus(new Redis(redisUrl!), new Redis(redisUrl!));
    buses.push(bus);
    return bus;
  };
  afterAll(async () => {
    await Promise.all(buses.map((b) => b.close()));
  });

  it("a drop from one machine reaches the other, and never comes back to its sender", async () => {
    const a = machine();
    const b = machine();
    const atA: AuthDrop[] = [];
    const atB: AuthDrop[] = [];
    a.listen((d) => atA.push(d), () => {});
    b.listen((d) => atB.push(d), () => {});
    // Let both subscriptions settle before publishing.
    for (let i = 0; i < 50; i++) {
      await a.publish({ session: `probe_${i}` });
      await new Promise((r) => setTimeout(r, 20));
      if (atB.length > 0) break;
    }
    atB.length = 0;
    await a.publish({ session: 'sess_1' });
    await a.publish({ person: 'person_1' });
    for (let i = 0; i < 50 && atB.length < 2; i++) await new Promise((r) => setTimeout(r, 20));
    expect(atB).toEqual([{ session: 'sess_1' }, { person: 'person_1' }]);
    expect(atA).toEqual([]);
  });
});
