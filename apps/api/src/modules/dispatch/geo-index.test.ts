import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Redis } from 'ioredis';
import { FakeClock } from '../../shared/clock.js';
import { InMemoryGeoIndex, PRESENCE_TTL_SEC, RedisGeoIndex, driverKey, geoKey, type DriverPresence, type GeoIndex } from './geo-index.js';
import { north } from './test-harness.js';

const presence = (driverId: string, km: number, extra: Partial<DriverPresence> = {}): DriverPresence => ({
  driverId,
  cityId: 'aziziyah',
  ...north(km),
  vehicle: 'car',
  tier: 'bronze',
  vetted: false,
  edgeOptIn: false,
  zoneId: 'centre',
  zoneSince: 0,
  lastSeenAt: 0,
  ...extra,
});

/** One contract, two implementations: what Redis does, the in-memory twin must do. */
function contract(
  name: string,
  make: () => Promise<{ index: GeoIndex; expire: (driverId: string) => Promise<void> }>,
  prefix: string,
  cleanup: () => Promise<void> = async () => {},
) {
  describe(`GeoIndex contract — ${name}`, () => {
    afterAll(cleanup);

    it('GEOSEARCH by radius returns live drivers nearest first with distances', async () => {
      const { index } = await make();
      await index.put(presence(`${prefix}far`, 2.5));
      await index.put(presence(`${prefix}near`, 0.4));
      await index.put(presence(`${prefix}mid`, 1.2));
      const within = await index.search('aziziyah', north(0), 1.5);
      expect(within.map((d) => d.presence.driverId)).toEqual([`${prefix}near`, `${prefix}mid`]);
      expect(within[0]!.distanceKm).toBeCloseTo(0.4, 2);
      expect(within[1]!.distanceKm).toBeCloseTo(1.2, 2);
      expect((await index.search('aziziyah', north(0), 3)).map((d) => d.presence.driverId)).toEqual([`${prefix}near`, `${prefix}mid`, `${prefix}far`]);
      expect(await index.search('aziziyah', north(0), 3, 1)).toHaveLength(1);
    });

    it('round-trips the driver hash', async () => {
      const { index } = await make();
      const p = presence(`${prefix}h`, 1, { vehicle: 'tuktuk', tier: 'gold', vetted: true, edgeOptIn: true, zoneId: 'fidaa', zoneSince: 123, lastSeenAt: 456 });
      await index.put(p);
      const got = await index.get(`${prefix}h`);
      expect(got).toMatchObject({ ...p, lat: expect.closeTo(p.lat, 5), lng: expect.closeTo(p.lng, 5) });
    });

    it('round-trips what he may be offered, and a re-registration without it clears it (review #20)', async () => {
      const { index } = await make();
      await index.put(presence(`${prefix}v`, 1, { verticals: ['food', 'grocery', 'errand', 'parcel', 'tuktuk'] }));
      expect((await index.get(`${prefix}v`))?.verticals).toEqual(['food', 'grocery', 'errand', 'parcel', 'tuktuk']);
      await index.put(presence(`${prefix}v`, 1, { verticals: [] }));
      expect((await index.get(`${prefix}v`))?.verticals).toEqual([]);
      await index.put(presence(`${prefix}v`, 1));
      expect((await index.get(`${prefix}v`))?.verticals).toBeUndefined();
    });

    it('drops a driver whose hash expired (missed heartbeats) from searches', async () => {
      const { index, expire } = await make();
      await index.put(presence(`${prefix}gone`, 0.2));
      await index.put(presence(`${prefix}live`, 0.3));
      await expire(`${prefix}gone`);
      expect((await index.search('aziziyah', north(0), 1)).map((d) => d.presence.driverId)).toEqual([`${prefix}live`]);
      expect(await index.get(`${prefix}gone`)).toBeNull();
    });

    it('remove() and moving city take the driver out of the old city', async () => {
      const { index } = await make();
      await index.put(presence(`${prefix}mover`, 0.1));
      await index.put(presence(`${prefix}mover`, 0.1, { cityId: 'kut' }));
      expect(await index.search('aziziyah', north(0), 1)).toEqual([]);
      expect(await index.search('kut', north(0), 1)).toHaveLength(1);
      await index.remove('kut', `${prefix}mover`);
      expect(await index.search('kut', north(0), 1)).toEqual([]);
    });

    it('list() returns every live driver of the city by id, skipping expired hashes (Console map)', async () => {
      const { index, expire } = await make();
      await index.put(presence(`${prefix}ls-b`, 30));
      await index.put(presence(`${prefix}ls-a`, 0.1));
      await index.put(presence(`${prefix}ls-x`, 0.1));
      await expire(`${prefix}ls-x`);
      await index.put(presence(`${prefix}ls-k`, 0.1, { cityId: 'kut' }));
      const mine = (await index.list('aziziyah')).map((p) => p.driverId).filter((id) => id.startsWith(`${prefix}ls-`));
      expect(mine).toEqual([`${prefix}ls-a`, `${prefix}ls-b`]);
      expect((await index.list('kut')).map((p) => p.driverId)).toContain(`${prefix}ls-k`);
    });
  });
}

describe('InMemoryGeoIndex TTL', () => {
  it('keeps a driver for 90 s after the last put and no longer', async () => {
    const clock = new FakeClock();
    const index = new InMemoryGeoIndex(() => clock.now());
    await index.put(presence('d1', 0.1));
    clock.advanceSeconds(PRESENCE_TTL_SEC - 1);
    expect(await index.search('aziziyah', north(0), 1)).toHaveLength(1);
    clock.advanceSeconds(1);
    expect(await index.search('aziziyah', north(0), 1)).toHaveLength(0);
  });
});

contract(
  'in-memory',
  async () => {
    const clock = new FakeClock();
    const index = new InMemoryGeoIndex(() => clock.now());
    return {
      index,
      expire: async (id) => {
        // Expire one driver only: re-put everyone else after jumping past the TTL.
        const others = [];
        for (const r of await index.search('aziziyah', north(0), 50)) if (r.presence.driverId !== id) others.push(r.presence);
        clock.advanceSeconds(PRESENCE_TTL_SEC);
        for (const p of others) await index.put(p);
      },
    };
  },
  'm-',
);

/** Runs against a real Redis when REDIS_URL is set (CI service / `pnpm db:up`). */
const redisUrl = process.env['REDIS_URL'];
describe.skipIf(!redisUrl)('RedisGeoIndex (integration)', () => {
  let redis: Redis;
  const prefix = `t${Date.now()}-`;

  beforeAll(async () => {
    redis = new Redis(redisUrl!);
    await redis.del(geoKey('aziziyah'), geoKey('kut'));
  });

  afterAll(async () => {
    await redis.del(geoKey('aziziyah'), geoKey('kut'));
    redis.disconnect();
  });

  it('sets a 90-s TTL on driver:{id} and GEOADDs into drivers:{cityId}', async () => {
    const index = new RedisGeoIndex(redis);
    await index.put(presence(`${prefix}ttl`, 0.1));
    const ttl = await redis.ttl(driverKey(`${prefix}ttl`));
    expect(ttl).toBeGreaterThan(85);
    expect(ttl).toBeLessThanOrEqual(90);
    expect(await redis.geopos(geoKey('aziziyah'), `${prefix}ttl`)).toHaveLength(1);
    await index.remove('aziziyah', `${prefix}ttl`);
  });

  it('lazily removes stale geo members whose hash expired', async () => {
    const index = new RedisGeoIndex(redis);
    await index.put(presence(`${prefix}stale`, 0.1), 1);
    await new Promise((r) => setTimeout(r, 1100));
    expect(await index.search('aziziyah', north(0), 1)).toEqual([]);
    expect(await redis.zscore(geoKey('aziziyah'), `${prefix}stale`)).toBeNull();
  });
});

if (redisUrl) {
  const conns: Redis[] = [];
  contract(
    'redis',
    async () => {
      const redis = new Redis(redisUrl);
      conns.push(redis);
      await redis.del(geoKey('aziziyah'), geoKey('kut'));
      return { index: new RedisGeoIndex(redis), expire: async (id) => void (await redis.del(driverKey(id))) };
    },
    `r${Date.now()}-`,
    async () => {
      for (const r of conns) r.disconnect();
    },
  );
}
