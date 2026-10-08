import { randomUUID } from 'node:crypto';
import type { Redis } from 'ioredis';
import type { Clock } from './clock.js';

/**
 * Sliding-window hit counters shared by every API instance (backend review 2026-10-04 #22): chat
 * send / call limits and the hand-over code attempt counter. Redis (a sorted set per key, scored by
 * the hit time) when REDIS_URL is set; an in-process twin on the injected clock otherwise (tests, the
 * simulator, a single dev API). Keys are namespaced by the caller.
 */
export interface WindowCounter {
  /** Hits recorded for `key` within the last `windowMs`. */
  count(key: string, windowMs: number): Promise<number>;
  /**
   * Records one hit for `key` unless `limit` hits are already inside the window. `retryAfterSec`:
   * until the oldest hit leaves the window (when refused).
   */
  hit(key: string, windowMs: number, limit: number): Promise<{ allowed: boolean; count: number; retryAfterSec: number }>;
  /**
   * Counts this call in `key`'s current fixed window (windows start at multiples of `windowMs`) and
   * returns the window's count so far, this call included, and the seconds until it ends. One small
   * counter per key instead of one entry per hit, so it suits limits on every request (SCALE-20).
   */
  tally(key: string, windowMs: number): Promise<{ count: number; retryAfterSec: number }>;
}

/** The fixed window `now` falls in: its index and the seconds until it ends. */
function fixedWindow(now: number, windowMs: number): { index: number; retryAfterSec: number } {
  const index = Math.floor(now / windowMs);
  return { index, retryAfterSec: Math.max(1, Math.ceil(((index + 1) * windowMs - now) / 1000)) };
}

export const WINDOW_COUNTER = Symbol('WINDOW_COUNTER');

export class InMemoryWindowCounter implements WindowCounter {
  private readonly hits = new Map<string, number[]>();

  constructor(private readonly clock: Clock) {}

  private live(key: string, windowMs: number, now: number): number[] {
    const list = (this.hits.get(key) ?? []).filter((t) => t > now - windowMs);
    this.hits.set(key, list);
    return list;
  }

  async count(key: string, windowMs: number): Promise<number> {
    return this.live(key, windowMs, this.clock.now().getTime()).length;
  }

  async hit(key: string, windowMs: number, limit: number): Promise<{ allowed: boolean; count: number; retryAfterSec: number }> {
    const now = this.clock.now().getTime();
    const list = this.live(key, windowMs, now);
    if (list.length >= limit) return { allowed: false, count: list.length, retryAfterSec: Math.max(1, Math.ceil((list[0]! + windowMs - now) / 1000)) };
    list.push(now);
    if (this.hits.size > 10_000) this.sweep(now - windowMs);
    return { allowed: true, count: list.length, retryAfterSec: 0 };
  }

  private readonly tallies = new Map<string, number>();

  async tally(key: string, windowMs: number): Promise<{ count: number; retryAfterSec: number }> {
    const { index, retryAfterSec } = fixedWindow(this.clock.now().getTime(), windowMs);
    const k = `${key}:${index}`;
    const count = (this.tallies.get(k) ?? 0) + 1;
    this.tallies.set(k, count);
    if (this.tallies.size > 10_000) for (const old of this.tallies.keys()) if (!old.endsWith(`:${index}`)) this.tallies.delete(old);
    return { count, retryAfterSec };
  }

  private sweep(from: number): void {
    for (const [k, v] of this.hits) if (!v.some((t) => t > from)) this.hits.delete(k);
  }
}

/**
 * Redis twin: `ZREMRANGEBYSCORE` (drop hits older than the window), `ZADD` this hit, `ZCARD`, the
 * oldest score and `PEXPIRE`, in one MULTI. Over the limit, the hit just added is removed again, so a
 * refused attempt never extends the lock-out and two racing hits can never both pass the last slot.
 */
export class RedisWindowCounter implements WindowCounter {
  constructor(
    private readonly redis: Redis,
    private readonly clock: Clock,
  ) {}

  async count(key: string, windowMs: number): Promise<number> {
    const now = this.clock.now().getTime();
    const res = await this.redis.multi().zremrangebyscore(key, 0, now - windowMs).zcard(key).exec();
    return Number(res?.[1]?.[1] ?? 0);
  }

  async hit(key: string, windowMs: number, limit: number): Promise<{ allowed: boolean; count: number; retryAfterSec: number }> {
    const now = this.clock.now().getTime();
    const member = `${now}:${randomUUID()}`;
    const res = await this.redis
      .multi()
      .zremrangebyscore(key, 0, now - windowMs)
      .zadd(key, now, member)
      .zcard(key)
      .zrange(key, '0', '0', 'WITHSCORES')
      .pexpire(key, windowMs)
      .exec();
    const count = Number(res?.[2]?.[1] ?? 0);
    if (count <= limit) return { allowed: true, count, retryAfterSec: 0 };
    await this.redis.zrem(key, member);
    const oldest = Number((res?.[3]?.[1] as string[] | undefined)?.[1] ?? now);
    return { allowed: false, count: count - 1, retryAfterSec: Math.max(1, Math.ceil((oldest + windowMs - now) / 1000)) };
  }

  /** `INCR` on the window's own key and `PEXPIRE` to two windows, in one MULTI. */
  async tally(key: string, windowMs: number): Promise<{ count: number; retryAfterSec: number }> {
    const { index, retryAfterSec } = fixedWindow(this.clock.now().getTime(), windowMs);
    const k = `${key}:${index}`;
    const res = await this.redis.multi().incr(k).pexpire(k, windowMs * 2).exec();
    return { count: Number(res?.[0]?.[1] ?? 0), retryAfterSec };
  }

  onModuleDestroy(): void {
    this.redis.disconnect();
  }
}
