import { afterAll, describe, expect, it } from 'vitest';
import { Redis } from 'ioredis';
import { DriverError } from '@driver/contracts';
import { OtpRequestGuard, RedisRateLimiter } from './rate-limit.js';

/** Runs against a real Redis when REDIS_URL is set (CI service / `pnpm db:up`). */
const redisUrl = process.env['REDIS_URL'];

describe.skipIf(!redisUrl)('OTP rate limits on Redis (integration, M2 follow-up)', () => {
  const conns: Redis[] = [];
  const connect = () => {
    const r = new Redis(redisUrl!);
    conns.push(r);
    return r;
  };
  afterAll(() => {
    for (const c of conns) c.disconnect();
  });

  it('two API pods share one per-IP counter; the 11th request in the hour is refused with retryAfterSec', async () => {
    const ip = `198.51.100.${Date.now() % 250}-${Math.random()}`;
    const pods = [new OtpRequestGuard(new RedisRateLimiter(connect())), new OtpRequestGuard(new RedisRateLimiter(connect()))];
    for (let i = 0; i < 10; i += 1) await pods[i % 2]!.check({ ip });
    const err = await pods[0]!.check({ ip }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DriverError);
    expect((err as DriverError).code).toBe('rate_limited');
    expect((err as DriverError).envelope.retryAfterSec).toBeGreaterThan(3500);
  });

  it('per device: 5 per hour', async () => {
    const guard = new OtpRequestGuard(new RedisRateLimiter(connect()));
    const deviceFingerprint = `fp-${Date.now()}-${Math.random()}`;
    for (let i = 0; i < 5; i += 1) await guard.check({ deviceFingerprint });
    await expect(guard.check({ deviceFingerprint })).rejects.toMatchObject({ code: 'rate_limited' });
  });
});
