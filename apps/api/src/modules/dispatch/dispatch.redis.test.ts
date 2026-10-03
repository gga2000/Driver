import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Redis } from 'ioredis';
import { FakeClock } from '../../shared/clock.js';
import { NoDatabaseRunner, UnitOfWork } from '../../shared/db/unit-of-work.js';
import { InMemoryQueue } from '../../shared/queue.js';
import { ConfigService } from '../config/index.js';
import { InMemoryDispatchRepository } from './dispatch.repository.js';
import { RedisDispatchStore, lockKey } from './dispatch.store.js';
import { RecordingEventEmitter } from './events.adapter.js';
import { RedisGeoIndex, geoKey } from './geo-index.js';
import { OfferOrchestrator, type TimerJob } from './offer.orchestrator.js';
import { FakeCaps, FakeDepartures, FakeTripOffers } from './ports.js';
import { PresenceService } from './presence.service.js';
import { north } from './test-harness.js';
import { ZoneDirectory } from './zones.js';

/** Runs against a real Redis when REDIS_URL is set (CI service / `pnpm db:up`). */
const redisUrl = process.env['REDIS_URL'];

describe.skipIf(!redisUrl)('dispatch on Redis (integration)', () => {
  const conns: Redis[] = [];
  const run = `it${Date.now()}`;
  const connect = () => {
    const r = new Redis(redisUrl!);
    conns.push(r);
    return r;
  };

  beforeAll(async () => {
    await connect().del(geoKey('aziziyah'), 'dispatch:policy:aziziyah');
  });

  afterAll(async () => {
    await conns[0]?.del(geoKey('aziziyah'), 'dispatch:policy:aziziyah');
    for (const c of conns) c.disconnect();
  });

  it('SET NX lock: one winner across two connections (two API pods)', async () => {
    const a = new RedisDispatchStore(connect());
    const b = new RedisDispatchStore(connect());
    const key = lockKey(`${run}-lock`);
    const [x, y] = await Promise.all([a.tryLock(key, 'd1', 5000), b.tryLock(key, 'd2', 5000)]);
    expect([x, y].filter(Boolean)).toHaveLength(1);
    await a.unlock(key);
    expect(await b.tryLock(key, 'd2', 5000)).toBe(true);
    await b.unlock(key);
  });

  it('runtime policy override persists in Redis for every instance', async () => {
    const a = new RedisDispatchStore(connect());
    await a.setPolicyOverride('aziziyah', 'taxi', { suggestOnly: true, setBy: 'disp', setAt: 1 });
    expect(await new RedisDispatchStore(connect()).getPolicyOverride('aziziyah', 'taxi')).toEqual({ suggestOnly: true, setBy: 'disp', setAt: 1 });
    await a.setPolicyOverride('aziziyah', 'taxi', null);
    expect(await a.getPolicyOverride('aziziyah', 'taxi')).toBeNull();
  });

  it('end to end: wave 1 from the Redis geo index, two pods race to accept, one wins', async () => {
    const clock = new FakeClock();
    const config = new ConfigService();
    const zones = new ZoneDirectory(config);
    const repo = new InMemoryDispatchRepository();
    const trips = new FakeTripOffers();
    const pod = () => {
      const redis = connect();
      const presence = new PresenceService(new RedisGeoIndex(redis), zones, clock);
      const orch = new OfferOrchestrator(
        config,
        presence,
        zones,
        repo,
        new RedisDispatchStore(redis),
        new RecordingEventEmitter(),
        trips,
        new FakeCaps(),
        new FakeDepartures(),
        new InMemoryQueue<TimerJob>('dispatch', () => clock.now()),
        clock,
        new UnitOfWork(new NoDatabaseRunner()),
      );
      return { presence, orch };
    };
    const p1 = pod();
    const p2 = pod();
    for (const [id, km] of [['a', 0.2], ['b', 0.6], ['c', 1.1], ['far', 2.5]] as const) {
      await p1.presence.online(`${run}-${id}`, { cityId: 'aziziyah', at: north(km), vehicle: 'car', tier: 'bronze' });
    }
    const tripId = `${run}-trip`;
    await p1.orch.request({ tripId, cityId: 'aziziyah', vertical: 'taxi', zoneId: 'centre', pickup: north(0) });
    expect(trips.offeredTo(tripId)).toEqual([`${run}-a`, `${run}-b`, `${run}-c`]);
    const offers = await repo.listByTrip(tripId);
    const results = await Promise.allSettled([p1.orch.respond(`${run}-a`, offers[0]!.id, true), p2.orch.respond(`${run}-b`, offers[1]!.id, true)]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(trips.assigns).toHaveLength(1);
    expect((await p2.orch.getRequest(tripId))?.status).toBe('assigned');
    await p1.orch.cancel(tripId);
  });
});
