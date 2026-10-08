import { Logger } from '@nestjs/common';
import { DriverError, REQUEST_LIMITS, type RequestCall, type RequestLimitsPort } from '@driver/contracts';
import type { WindowCounter } from '../shared/window-counter.js';

export type RequestLimitMode = 'enforce' | 'alert';

/** Calls never counted against an address: sign-in has its own guard (W5 OTP guard), health is the load balancer's. */
const UNCOUNTED_FOR_GUESTS = /^(identity|health)\./;

/** How long a staff call keeps its person on the staff ceiling, and how many staff one machine remembers. */
const STAFF_MARK_MS = 10 * 60_000;
const STAFF_MARKS_MAX = 2_000;

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
  /**
   * Staff seen on this machine (person → until when), so their overall per-person ceiling covers their
   * Console limits: a dispatcher with three Console tabs open reads more than an app user ever does.
   * Marked by their first staff call; a stale mark only means the higher ceiling a little longer.
   */
  private readonly staff = new Map<string, number>();

  constructor(
    private readonly counter: WindowCounter,
    private readonly ipMode: RequestLimitMode,
  ) {}

  async check(call: RequestCall): Promise<void> {
    const L = REQUEST_LIMITS;
    const quote = call.path === 'pricing.quote';
    if (call.personId) {
      const ceiling = this.isStaff(call.personId) ? L.staffWritesPerPerson + L.staffReadsPerPerson : L.perPerson;
      await this.count(`rl:p:${call.personId}`, ceiling, 'enforce', `person ${call.personId}`);
      if (quote) await this.count(`rl:quote:p:${call.personId}`, L.quotePerPerson, 'enforce', `person ${call.personId} on pricing.quote`);
      return;
    }
    if (!call.ip || UNCOUNTED_FOR_GUESTS.test(call.path)) return;
    if (quote) await this.count(`rl:quote:ip:${call.ip}`, L.quotePerGuestIp, 'enforce', `address ${call.ip} on pricing.quote`);
    await this.count(`rl:ip:${call.ip}`, L.perGuestIp, this.ipMode, `address ${call.ip}`);
  }

  /**
   * CON-21: a Console-only call, counted per staff person, writes and reads apart. Enforced; the log
   * names the person and the call at the first refusal of a minute and every 50th after it, so a
   * screen stuck in a loop is visible without flooding the log.
   */
  async checkStaff(call: RequestCall & { personId: string }): Promise<void> {
    this.markStaff(call.personId);
    const write = call.type === 'mutation';
    const limit = write ? REQUEST_LIMITS.staffWritesPerPerson : REQUEST_LIMITS.staffReadsPerPerson;
    await this.count(`rl:staff:${write ? 'w' : 'r'}:${call.personId}`, limit, 'enforce', `staff ${call.personId} (${write ? 'writes' : 'reads'}, last call ${call.path})`, 50);
  }

  private isStaff(personId: string): boolean {
    const until = this.staff.get(personId);
    if (until === undefined) return false;
    if (until > Date.now()) return true;
    this.staff.delete(personId);
    return false;
  }

  private markStaff(personId: string): void {
    if (this.staff.size >= STAFF_MARKS_MAX && !this.staff.has(personId)) this.staff.delete(this.staff.keys().next().value!);
    this.staff.set(personId, Date.now() + STAFF_MARK_MS);
  }

  private async count(key: string, limit: number, mode: RequestLimitMode, who: string, logEvery = 0): Promise<void> {
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
    const over = tally.count - limit;
    if (over === 1 || (logEvery > 0 && over % logEvery === 0)) this.logger.warn(`request limit reached: ${who}, ${limit} calls a minute, ${over} over (${mode})`);
    if (mode === 'enforce') throw new DriverError('rate_limited', { retryAfterSec: tally.retryAfterSec });
  }
}
