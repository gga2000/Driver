import { Logger } from '@nestjs/common';
import { DriverError, REQUEST_LIMITS, type RequestCall, type RequestLimitsPort } from '@driver/contracts';
import type { WindowCounter } from '../shared/window-counter.js';

export type RequestLimitMode = 'enforce' | 'alert';

/** Calls never counted against an address: sign-in has its own guard (W5 OTP guard), health is the load balancer's. */
const UNCOUNTED_FOR_GUESTS = /^(identity|health)\./;

/** `REQUEST_LIMIT_IP_MODE=enforce|alert` (default alert, decision D-5). */
export function ipModeFromEnv(env: Record<string, string | undefined> = process.env): RequestLimitMode {
  return env['REQUEST_LIMIT_IP_MODE'] === 'enforce' ? 'enforce' : 'alert';
}

/**
 * SCALE-20: every API call is counted per signed-in person, or per address for a guest, in the shared
 * window counter (Redis across machines). Over a limit the call answers `rate_limited` with the
 * seconds until the minute ends; an alert-only rule logs once per minute and lets the call through.
 * If the counter itself fails (Redis down) the call goes through: a limit must never take the API
 * down with it.
 */
export class RequestLimits implements RequestLimitsPort {
  private readonly logger = new Logger(RequestLimits.name);
  private lastFailureLog = 0;

  constructor(
    private readonly counter: WindowCounter,
    private readonly ipMode: RequestLimitMode,
  ) {}

  async check(call: RequestCall): Promise<void> {
    const L = REQUEST_LIMITS;
    const quote = call.path === 'pricing.quote';
    if (call.personId) {
      await this.count(`rl:p:${call.personId}`, L.perPerson, 'enforce', `person ${call.personId}`);
      if (quote) await this.count(`rl:quote:p:${call.personId}`, L.quotePerPerson, 'enforce', `person ${call.personId} on pricing.quote`);
      return;
    }
    if (!call.ip || UNCOUNTED_FOR_GUESTS.test(call.path)) return;
    if (quote) await this.count(`rl:quote:ip:${call.ip}`, L.quotePerGuestIp, 'enforce', `address ${call.ip} on pricing.quote`);
    await this.count(`rl:ip:${call.ip}`, L.perGuestIp, this.ipMode, `address ${call.ip}`);
  }

  private async count(key: string, limit: number, mode: RequestLimitMode, who: string): Promise<void> {
    let tally: { count: number; retryAfterSec: number };
    try {
      tally = await this.counter.tally(key, REQUEST_LIMITS.windowMs);
    } catch (err) {
      const now = Date.now();
      if (now - this.lastFailureLog > 60_000) {
        this.lastFailureLog = now;
        this.logger.error(`request limits not counted (calls let through): ${(err as Error).message}`);
      }
      return;
    }
    if (tally.count <= limit) return;
    if (tally.count === limit + 1) this.logger.warn(`request limit reached: ${who}, ${limit} calls a minute (${mode})`);
    if (mode === 'enforce') throw new DriverError('rate_limited', { retryAfterSec: tally.retryAfterSec });
  }
}
