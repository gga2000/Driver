import { afterAll, describe, expect, it } from 'vitest';
import { Redis } from 'ioredis';
import { DriverError } from '@driver/contracts';
import { FakeClock } from '../../shared/clock.js';
import { RedisWindowCounter } from '../../shared/window-counter.js';
import { DEFAULT_OTP_GUARD, OtpGuard, RecordingOtpAlerts, type OtpSendRequest } from './rate-limit.js';

/** Runs against a real Redis when REDIS_URL is set (CI service / `pnpm db:up`). */
const redisUrl = process.env['REDIS_URL'];

describe.skipIf(!redisUrl)('the OTP guard on Redis (integration)', () => {
  const conns: Redis[] = [];
  const clock = new FakeClock();
  const connect = () => {
    const r = new Redis(redisUrl!);
    conns.push(r);
    return new RedisWindowCounter(r, clock);
  };
  afterAll(() => {
    for (const c of conns) c.disconnect();
  });
  const run = `${Date.now()}${Math.floor(Math.random() * 1000)}`.slice(-7);
  const send = (n: number, origin: OtpSendRequest['origin'] = {}): OtpSendRequest => {
    const e164 = `+9647${run.slice(0, 2)}${String(n).padStart(7, '0')}`;
    return { phoneE164: e164, phoneHash: `hash-${run}-${e164}`, purpose: 'login', channel: undefined, whatsappAvailable: true, knownNumber: async () => false, origin };
  };

  it('two API pods share one per-number counter: the 6th code to a number in the hour is refused with retryAfterSec', async () => {
    const alerts = new RecordingOtpAlerts();
    const pods = [new OtpGuard(connect(), alerts), new OtpGuard(connect(), alerts)];
    for (let i = 0; i < 5; i += 1) await pods[i % 2]!.admit(send(1));
    const err = await pods[0]!.admit(send(1)).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DriverError);
    expect((err as DriverError).code).toBe('rate_limited');
    expect((err as DriverError).envelope.retryAfterSec).toBeGreaterThan(3500);
  });

  it('the IP rule only alerts, once, however many pods see the crowd', async () => {
    const alerts = new RecordingOtpAlerts();
    const config = { ...DEFAULT_OTP_GUARD, perIpPerHour: 3 };
    const pods = [new OtpGuard(connect(), alerts, config), new OtpGuard(connect(), alerts, config)];
    const ip = `198.51.100.${run}`;
    for (let i = 0; i < 8; i += 1) await pods[i % 2]!.admit(send(100 + i, { ip }));
    expect(alerts.raised.filter((a) => a.rule === 'ip')).toHaveLength(1);
  });
});
