import { DriverError } from '@driver/contracts';
import type { Clock } from '../../shared/clock.js';
import type { WindowCounter } from '../../shared/window-counter.js';

/**
 * The chat limits on the shared window counter (Redis behind several API instances; review
 * 2026-10-04 #22): a refused hit is not counted, so waiting out the window always works.
 */
export class SharedSlidingWindowLimiter {
  constructor(
    private readonly counter: WindowCounter,
    private readonly name: string,
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  /** Records one hit for `key`, or throws `rate_limited` (with `retryAfterSec`) when over the limit. */
  async hit(key: string): Promise<void> {
    const r = await this.counter.hit(`chat:${this.name}:${key}`, this.windowMs, this.limit);
    if (!r.allowed) throw new DriverError('rate_limited', { retryAfterSec: r.retryAfterSec });
  }
}

/**
 * Sliding-window limiter per key, in process memory. Chat sends and call requests are cheap to
 * abuse (spam, ringing someone repeatedly); this caps them per person. One API instance today; when
 * the API scales out this moves to Redis like identity's OTP limiter (same `rate_limited` contract).
 */
export class SlidingWindowLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly clock: Clock,
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  /** Records one hit for `key`, or throws `rate_limited` (with `retryAfterSec`) when over the limit. */
  hit(key: string): void {
    const now = this.clock.now().getTime();
    const from = now - this.windowMs;
    const list = (this.hits.get(key) ?? []).filter((t) => t > from);
    if (list.length >= this.limit) {
      const retryAfterSec = Math.max(1, Math.ceil((list[0]! + this.windowMs - now) / 1000));
      this.hits.set(key, list);
      throw new DriverError('rate_limited', { retryAfterSec });
    }
    list.push(now);
    this.hits.set(key, list);
    if (this.hits.size > 10_000) this.sweep(from);
  }

  private sweep(from: number): void {
    for (const [k, v] of this.hits) if (!v.some((t) => t > from)) this.hits.delete(k);
  }
}
