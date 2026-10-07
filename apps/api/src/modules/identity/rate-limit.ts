import { createHash } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { DriverError, type OtpChannel, type OtpPurpose } from '@driver/contracts';
import type { WindowCounter } from '../../shared/window-counter.js';
import { carrierOf, numberBlock, type IraqiCarrier } from './phone.js';

/**
 * The one OTP guard (audit pattern `otp_and_auth_abuse`: SEC-04, SEC-05). Every code that leaves the
 * server — sign-in, guardian consent, phone change — passes `admit` before it is made and `sent`
 * after the provider took it:
 *
 * - hard limits per destination number (5/h, 10/day), per device (5/h) and per signed-in sender
 *   (5/h, 20/day) — the real protection;
 * - the per-IP rule is an alert-only signal at launch (1,000/h): carrier NAT puts a whole town
 *   behind a few IPs, so blocking on IP would lock real people out;
 * - a global SMS budget per 24 h (about 3 × the expected day-one installs) alerts at 50 % and 80 %;
 *   at 100 % it never locks the town out: only the 7-digit number block behind the spike is
 *   throttled, and everyone else gets the code on WhatsApp unless they ask for SMS by name.
 *
 * Each rule has a mode (`OTP_GUARD_MODE_<RULE>=enforce|alert`, `OTP_BUDGET_MODE=throttle|alert`): in
 * `alert` it only counts and raises an alert once per window. Counters live in the shared
 * `WindowCounter` (Redis across pods); keys hold a hash, never a raw IP, fingerprint or number.
 */

export type OtpRuleMode = 'enforce' | 'alert';
export type OtpBudgetMode = 'throttle' | 'alert';
export type OtpGuardRule = 'number' | 'device' | 'actor' | 'ip';

export interface OtpGuardConfig {
  perNumberPerHour: number;
  perNumberPerDay: number;
  perDevicePerHour: number;
  perActorPerHour: number;
  perActorPerDay: number;
  /** The alert threshold while the IP rule is in `alert` mode; a hard limit in `enforce`. */
  perIpPerHour: number;
  /** SMS sends per rolling 24 h before the budget throttles (WhatsApp codes are not counted). */
  smsDailyBudget: number;
  /** Codes per hour to one 7-digit block that mark it as the spike, once the budget is spent. */
  blockSpikePerHour: number;
  modes: Record<OtpGuardRule, OtpRuleMode> & { budget: OtpBudgetMode };
}

export const DEFAULT_OTP_GUARD: OtpGuardConfig = {
  perNumberPerHour: 5,
  perNumberPerDay: 10,
  perDevicePerHour: 5,
  perActorPerHour: 5,
  perActorPerDay: 20,
  perIpPerHour: 1000,
  smsDailyBudget: 4500,
  blockSpikePerHour: 30,
  modes: { number: 'enforce', device: 'enforce', actor: 'enforce', ip: 'alert', budget: 'throttle' },
};

/** The guard's settings from the environment; a malformed value stops the boot. */
export function otpGuardConfigFromEnv(env: Record<string, string | undefined> = process.env): OtpGuardConfig {
  const int = (name: string, fallback: number) => {
    const raw = env[name];
    if (raw === undefined || raw === '') return fallback;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 1) throw new Error(`${name} must be a positive integer, got "${raw}"`);
    return n;
  };
  const pick = <T extends string>(name: string, allowed: readonly T[], fallback: T): T => {
    const raw = env[name];
    if (raw === undefined || raw === '') return fallback;
    if (!(allowed as readonly string[]).includes(raw)) throw new Error(`${name} must be one of ${allowed.join('|')}, got "${raw}"`);
    return raw as T;
  };
  const d = DEFAULT_OTP_GUARD;
  const hard = pick<OtpRuleMode>('OTP_GUARD_MODE', ['enforce', 'alert'], 'enforce');
  const mode = (rule: OtpGuardRule, fallback: OtpRuleMode) => pick<OtpRuleMode>(`OTP_GUARD_MODE_${rule.toUpperCase()}`, ['enforce', 'alert'], fallback);
  return {
    perNumberPerHour: int('OTP_RATE_LIMIT_PER_NUMBER_HOUR', d.perNumberPerHour),
    perNumberPerDay: int('OTP_RATE_LIMIT_PER_NUMBER_DAY', d.perNumberPerDay),
    perDevicePerHour: int('OTP_RATE_LIMIT_PER_DEVICE_HOUR', d.perDevicePerHour),
    perActorPerHour: int('OTP_RATE_LIMIT_PER_ACTOR_HOUR', d.perActorPerHour),
    perActorPerDay: int('OTP_RATE_LIMIT_PER_ACTOR_DAY', d.perActorPerDay),
    perIpPerHour: int('OTP_RATE_LIMIT_PER_IP_HOUR', d.perIpPerHour),
    smsDailyBudget: int('OTP_SMS_DAILY_BUDGET', d.smsDailyBudget),
    blockSpikePerHour: int('OTP_BLOCK_SPIKE_PER_HOUR', d.blockSpikePerHour),
    modes: {
      number: mode('number', hard),
      device: mode('device', hard),
      actor: mode('actor', hard),
      // Alert-only at launch whatever OTP_GUARD_MODE says (decision D-5); enforce only by name.
      ip: mode('ip', 'alert'),
      budget: pick<OtpBudgetMode>('OTP_BUDGET_MODE', ['throttle', 'alert'], d.modes.budget),
    },
  };
}

/** What the guard tells ops about. One alert per rule and key per window, never per request. */
export type OtpAlert =
  | { rule: OtpGuardRule; mode: 'alert'; count: number; limit: number; windowSec: number; carrier: IraqiCarrier }
  | { rule: 'sms_budget'; level: 50 | 80 | 100; count: number; limit: number; mode: OtpBudgetMode }
  | { rule: 'block_spike'; block: string; carrier: IraqiCarrier; count: number; limit: number; throttled: boolean };

export interface OtpAlertSink {
  raise(alert: OtpAlert): Promise<void>;
}

/** Where a code request came from: the transport's client IP, the app's device, the signed-in sender. */
export interface OtpRequestOrigin {
  ip?: string | null | undefined;
  deviceFingerprint?: string | null | undefined;
  /** The signed-in person asking us to text someone (guardian link, phone change). */
  actorId?: string | null | undefined;
}

export interface OtpSendRequest {
  phoneE164: string;
  phoneHash: string;
  purpose: OtpPurpose;
  /** What the person asked for; absent = the server's choice (SMS unless the budget is spent). */
  channel: OtpChannel | undefined;
  /** WhatsApp can carry this code (configured, and a sign-in code). */
  whatsappAvailable: boolean;
  origin: OtpRequestOrigin;
}

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const UNCAPPED = Number.MAX_SAFE_INTEGER;
/** How long a throttled block is told to wait before trying again. */
const BLOCK_RETRY_SEC = 15 * 60;
const BUDGET_LEVELS = [50, 80, 100] as const;

export class OtpGuard {
  private readonly log = new Logger('OtpGuard');

  constructor(
    private readonly counter: WindowCounter,
    private readonly alerts: OtpAlertSink,
    private readonly config: OtpGuardConfig = DEFAULT_OTP_GUARD,
  ) {}

  /**
   * Counts this request against every rule that applies and returns the channel the code goes out
   * on. Throws `rate_limited` (with `retryAfterSec`) when an enforced rule is over its limit.
   */
  async admit(req: OtpSendRequest): Promise<OtpChannel> {
    const c = this.config;
    const carrier = carrierOf(req.phoneE164);
    const { ip, deviceFingerprint, actorId } = req.origin;
    if (ip) await this.rule('ip', digest(ip), HOUR_MS, c.perIpPerHour, carrier);
    if (deviceFingerprint) await this.rule('device', digest(deviceFingerprint), HOUR_MS, c.perDevicePerHour, carrier);
    if (actorId) {
      await this.rule('actor', actorId, HOUR_MS, c.perActorPerHour, carrier);
      await this.rule('actor', actorId, DAY_MS, c.perActorPerDay, carrier);
    }
    const number = req.phoneHash.slice(0, 32);
    await this.rule('number', number, HOUR_MS, c.perNumberPerHour, carrier);
    await this.rule('number', number, DAY_MS, c.perNumberPerDay, carrier);
    return this.channelWithinBudget(req, carrier);
  }

  /** After the provider accepted the code: the SMS budget and the number block's hourly count. */
  async sent(req: Pick<OtpSendRequest, 'phoneE164'>, channel: OtpChannel): Promise<void> {
    if (channel === 'sms') await this.counter.hit('otp:guard:sms', DAY_MS, UNCAPPED);
    const block = numberBlock(req.phoneE164);
    const r = await this.counter.hit(`otp:guard:block:${block}`, HOUR_MS, UNCAPPED);
    if (r.count >= this.config.blockSpikePerHour) {
      await this.alertOnce(`block:${block}`, HOUR_MS, { rule: 'block_spike', block, carrier: carrierOf(req.phoneE164), count: r.count, limit: this.config.blockSpikePerHour, throttled: false });
    }
  }

  private async rule(rule: OtpGuardRule, id: string, windowMs: number, limit: number, carrier: IraqiCarrier): Promise<void> {
    const enforce = this.config.modes[rule] === 'enforce';
    const key = `otp:guard:${rule}:${windowMs / HOUR_MS}h:${id}`;
    const r = await this.counter.hit(key, windowMs, enforce ? limit : UNCAPPED);
    if (enforce) {
      if (r.allowed) return;
      // Logged by carrier so the closed test shows whether one carrier's people hit a wall (SEC-05).
      this.log.warn(JSON.stringify({ event: 'otp.rate_limited', rule, windowH: windowMs / HOUR_MS, carrier }));
      throw new DriverError('rate_limited', { retryAfterSec: r.retryAfterSec });
    }
    if (r.count > limit) await this.alertOnce(key, windowMs, { rule, mode: 'alert', count: r.count, limit, windowSec: windowMs / 1000, carrier });
  }

  private async channelWithinBudget(req: OtpSendRequest, carrier: IraqiCarrier): Promise<OtpChannel> {
    const c = this.config;
    const wanted: OtpChannel = req.channel ?? 'sms';
    const used = await this.counter.count('otp:guard:sms', DAY_MS);
    for (const level of BUDGET_LEVELS) {
      if (used >= (c.smsDailyBudget * level) / 100) await this.alertOnce(`sms_budget:${level}`, DAY_MS, { rule: 'sms_budget', level, count: used, limit: c.smsDailyBudget, mode: c.modes.budget });
    }
    if (used < c.smsDailyBudget || c.modes.budget === 'alert') return wanted;

    const block = numberBlock(req.phoneE164);
    const blockCount = await this.counter.count(`otp:guard:block:${block}`, HOUR_MS);
    if (blockCount >= c.blockSpikePerHour) {
      await this.alertOnce(`block_throttled:${block}`, HOUR_MS, { rule: 'block_spike', block, carrier, count: blockCount, limit: c.blockSpikePerHour, throttled: true });
      this.log.warn(JSON.stringify({ event: 'otp.rate_limited', rule: 'block_spike', carrier }));
      throw new DriverError('rate_limited', { retryAfterSec: BLOCK_RETRY_SEC });
    }
    // Everyone else: WhatsApp unless they asked for SMS by name ("ابعث برسالة" after a WhatsApp code
    // that never came), so a number without WhatsApp can still sign in.
    return req.channel === undefined && req.whatsappAvailable ? 'whatsapp' : wanted;
  }

  private async alertOnce(key: string, windowMs: number, alert: OtpAlert): Promise<void> {
    const first = await this.counter.hit(`otp:guard:alerted:${key}`, windowMs, 1);
    if (!first.allowed) return;
    this.log.warn(JSON.stringify({ event: 'otp.alert', ...alert }));
    try {
      await this.alerts.raise(alert);
    } catch (err) {
      // An alert that cannot be written must never stop a person signing in.
      this.log.error(`otp alert not recorded: ${(err as Error).message}`);
    }
  }
}

/** Test and dev sink: keeps what was raised. */
export class RecordingOtpAlerts implements OtpAlertSink {
  readonly raised: OtpAlert[] = [];

  async raise(alert: OtpAlert): Promise<void> {
    this.raised.push(alert);
  }
}

function digest(v: string): string {
  return createHash('sha256').update(v).digest('hex').slice(0, 32);
}
