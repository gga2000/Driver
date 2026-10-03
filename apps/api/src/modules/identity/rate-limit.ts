import { createHash } from 'node:crypto';
import { DriverError } from '@driver/contracts';
import type { Redis } from 'ioredis';
import type { Clock } from '../../shared/clock.js';

/**
 * Fixed-window request counters (M2 review follow-up: OTP request rate limits). `hit` counts one
 * request against `key` and says whether it is within `limit` for the current window, and if not,
 * how many seconds until the window ends.
 */
export interface RateLimiter {
  hit(key: string, limit: number, windowSec: number): Promise<{ allowed: boolean; retryAfterSec: number }>;
}

export const OTP_RATE_LIMITER = Symbol('OTP_RATE_LIMITER');
export const OTP_RATE_LIMITS = Symbol('OTP_RATE_LIMITS');

/** Per-hour OTP request caps (config; defaults 10 per IP, 5 per device). */
export interface OtpRateLimits {
  perIpPerHour: number;
  perDevicePerHour: number;
}

export const DEFAULT_OTP_RATE_LIMITS: OtpRateLimits = { perIpPerHour: 10, perDevicePerHour: 5 };

/** `OTP_RATE_LIMIT_PER_IP_HOUR` / `OTP_RATE_LIMIT_PER_DEVICE_HOUR`; a malformed value stops the boot. */
export function otpRateLimitsFromEnv(env: Record<string, string | undefined> = process.env): OtpRateLimits {
  const read = (name: string, fallback: number) => {
    const raw = env[name];
    if (raw === undefined || raw === '') return fallback;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 1) throw new Error(`${name} must be a positive integer, got "${raw}"`);
    return n;
  };
  return {
    perIpPerHour: read('OTP_RATE_LIMIT_PER_IP_HOUR', DEFAULT_OTP_RATE_LIMITS.perIpPerHour),
    perDevicePerHour: read('OTP_RATE_LIMIT_PER_DEVICE_HOUR', DEFAULT_OTP_RATE_LIMITS.perDevicePerHour),
  };
}

/** In-process counters on the injected clock (tests, simulator, a dev API without Redis). */
export class InMemoryRateLimiter implements RateLimiter {
  private readonly windows = new Map<string, { count: number; resetAt: number }>();

  constructor(private readonly clock: Clock) {}

  async hit(key: string, limit: number, windowSec: number): Promise<{ allowed: boolean; retryAfterSec: number }> {
    const now = this.clock.now().getTime();
    let w = this.windows.get(key);
    if (!w || now >= w.resetAt) {
      w = { count: 0, resetAt: now + windowSec * 1000 };
      this.windows.set(key, w);
    }
    w.count += 1;
    return { allowed: w.count <= limit, retryAfterSec: Math.max(1, Math.ceil((w.resetAt - now) / 1000)) };
  }
}

/** Shared across API pods: SET key 0 PX window NX, INCR, PTTL — atomically in one MULTI. */
export class RedisRateLimiter implements RateLimiter {
  constructor(private readonly redis: Redis) {}

  async hit(key: string, limit: number, windowSec: number): Promise<{ allowed: boolean; retryAfterSec: number }> {
    const res = await this.redis.multi().set(key, '0', 'PX', windowSec * 1000, 'NX').incr(key).pttl(key).exec();
    const count = Number(res?.[1]?.[1] ?? 0);
    const pttl = Number(res?.[2]?.[1] ?? windowSec * 1000);
    return { allowed: count <= limit, retryAfterSec: Math.max(1, Math.ceil((pttl > 0 ? pttl : windowSec * 1000) / 1000)) };
  }
}

/** Where an OTP request came from: the transport's client IP and the app's device fingerprint. */
export interface OtpRequestOrigin {
  ip?: string | null | undefined;
  deviceFingerprint?: string | null | undefined;
}

const HOUR_SEC = 3600;

/**
 * The OTP request guard: one counter per IP and one per device, each per hour. Requests without an
 * IP (internal callers: the simulator, tests) or without a device skip that counter. Keys hold a
 * hash, never the raw IP or fingerprint.
 */
export class OtpRequestGuard {
  constructor(
    private readonly limiter: RateLimiter,
    private readonly limits: OtpRateLimits = DEFAULT_OTP_RATE_LIMITS,
  ) {}

  async check(origin: OtpRequestOrigin): Promise<void> {
    if (origin.ip) await this.one(`ip:${digest(origin.ip)}`, this.limits.perIpPerHour);
    if (origin.deviceFingerprint) await this.one(`device:${digest(origin.deviceFingerprint)}`, this.limits.perDevicePerHour);
  }

  private async one(key: string, limit: number): Promise<void> {
    const r = await this.limiter.hit(`otp:rate:${key}`, limit, HOUR_SEC);
    if (!r.allowed) throw new DriverError('rate_limited', { retryAfterSec: r.retryAfterSec });
  }
}

function digest(v: string): string {
  return createHash('sha256').update(v).digest('hex').slice(0, 32);
}
