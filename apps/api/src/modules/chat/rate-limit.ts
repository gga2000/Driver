import { DriverError } from '@driver/contracts';
import type { Clock } from '../../shared/clock.js';

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
