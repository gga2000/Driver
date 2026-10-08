import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { isProviderError } from '../../shared/messaging/http.js';
import { DriverError, isDriverError, OTP_LENGTH, OTP_MAX_ATTEMPTS, OTP_RESEND_SEC, OTP_TTL_SEC, type OtpPurpose } from '@driver/contracts';
import type { Clock } from '../../shared/clock.js';
import type { Tx } from '../../shared/db/unit-of-work.js';
import type { IdentityRepository, OtpRecord } from './identity.repository.js';
import type { SmsProvider } from './sms/provider.js';
import { DevWhatsAppProvider, type WhatsAppPort } from '../../shared/messaging/whatsapp.js';
import type { OtpChannel } from '@driver/contracts';
import type { OtpGuard, OtpRequestOrigin } from './rate-limit.js';

/** The approved WhatsApp authentication template for login codes (Meta: one `{{1}}` = the code). */
export const OTP_WHATSAPP_TEMPLATE = 'otp_login';

const LOCK_MINUTES = 15;

const BODY_BY_PURPOSE: Record<OtpPurpose, (code: string) => string> = {
  login: (c) => `رمز دخول درايفر: ${c}`,
  guardian_consent: (c) => `رمز موافقة ولي الأمر في درايفر: ${c}`,
  phone_change: (c) => `رمز تغيير الرقم في درايفر: ${c}`,
  account_delete: (c) => `رمز حذف حسابك في درايفر: ${c}. إذا ما طلبت تحذفه لا تعطيه لأحد`,
};

/**
 * One challenge chain per (phone hash, purpose): 6 digits, 5 attempts, 3-minute expiry,
 * 30-second resend. Codes are stored as peppered HMACs; the clear code only ever reaches the SMS
 * provider. After 5 wrong tries the challenge locks for 15 minutes; a resend carries the misses over.
 * Every send passes the one OTP guard (`rate-limit.ts`), whoever asked for it.
 */
export class OtpService {
  /** Dev only: the channel each phone's latest code went out on, so `devLastOtp` reads the right outbox. */
  private readonly devChannel = new Map<string, OtpChannel>();

  constructor(
    private readonly repo: IdentityRepository,
    private readonly sms: SmsProvider,
    private readonly clock: Clock,
    private readonly pepper: string,
    /** WhatsApp for "دزلي على واتساب"; without it a WhatsApp request is refused (`otp_channel_unavailable`). */
    private readonly guard: OtpGuard,
    private readonly whatsapp?: WhatsAppPort,
  ) {}

  /**
   * `asked`: the channel the person chose; absent = the guard's choice (SMS, or WhatsApp while the
   * day's SMS budget is spent). `origin`: who and where from, for the guard's limits.
   */
  async request(
    phoneE164: string,
    phoneHash: string,
    purpose: OtpPurpose,
    tx?: Tx,
    asked?: OtpChannel,
    origin: OtpRequestOrigin = {},
  ): Promise<{ expiresAt: Date; resendAfterSec: number; channel: OtpChannel }> {
    const whatsappAvailable = !!this.whatsapp && purpose === 'login';
    if (asked === 'whatsapp' && !whatsappAvailable) throw new DriverError('otp_channel_unavailable');
    const now = this.clock.now();
    const latest = await this.repo.latestOtp(phoneHash, purpose, tx);
    if (latest) {
      if (latest.lockedAt && now.getTime() < latest.lockedAt.getTime() + LOCK_MINUTES * 60_000) {
        throw this.locked(now, latest.lockedAt);
      }
      const sinceLast = (now.getTime() - latest.createdAt.getTime()) / 1000;
      if (!latest.verifiedAt && sinceLast < OTP_RESEND_SEC) {
        throw new DriverError('otp_resend_too_soon', { retryAfterSec: Math.ceil(OTP_RESEND_SEC - sinceLast) });
      }
    }
    const knownNumber = async () => (await this.repo.findPersonByPhoneHash(phoneHash, tx)) !== null;
    const send = { phoneE164, phoneHash, purpose, channel: asked, whatsappAvailable, knownNumber, origin };
    const channel = await this.guard.admit(send);
    // One chain: a resend inherits the misses of the unused code it replaces (until a lock-out's time
    // has passed), so asking for a fresh code every 30 seconds never resets the 5-try lock-out.
    const carried = latest && !latest.verifiedAt && !latest.lockedAt && now.getTime() - latest.createdAt.getTime() < LOCK_MINUTES * 60_000 ? latest.attempts : 0;
    const code = randomInt(0, 10 ** OTP_LENGTH).toString().padStart(OTP_LENGTH, '0');
    const expiresAt = new Date(now.getTime() + OTP_TTL_SEC * 1000);
    await this.repo.createOtp({ phoneHash, codeHash: this.hash(code, phoneHash), purpose, expiresAt, now, attempts: carried }, tx);
    try {
      if (channel === 'whatsapp') {
        await this.whatsapp!.send({ to: phoneE164, template: OTP_WHATSAPP_TEMPLATE, language: 'ar', params: [code], preview: BODY_BY_PURPOSE[purpose](code) });
      } else {
        await this.sms.send({ to: phoneE164, body: BODY_BY_PURPOSE[purpose](code), code });
      }
    } catch (err) {
      // A gateway that is not configured is an ops problem; anything else the person may retry.
      if (isDriverError(err)) throw err;
      throw new DriverError(isProviderError(err) && err.code === 'not_configured' ? 'sms_not_configured' : 'sms_send_failed', { cause: err as Error });
    }
    await this.guard.sent(send, channel);
    if (this.whatsapp instanceof DevWhatsAppProvider) {
      if (channel === 'whatsapp') this.devChannel.set(phoneE164, 'whatsapp');
      else this.devChannel.delete(phoneE164);
    }
    return { expiresAt, resendAfterSec: OTP_RESEND_SEC, channel };
  }

  /**
   * Checks a code against the latest challenge, OUTSIDE any transaction: call it before opening the
   * one that uses the code, so a sign-in never holds a pooled connection while it waits for another.
   * Each guess first claims one of the 5 attempts with a single conditional UPDATE (audit SEC-01),
   * committed on its own, so parallel guesses can never all be compared before the lock lands: the
   * 6th claim finds nothing to claim. Returns the matched challenge for `consume`.
   */
  async check(phoneHash: string, purpose: OtpPurpose, code: string): Promise<OtpRecord> {
    const now = this.clock.now();
    const latest = await this.repo.latestOtp(phoneHash, purpose);
    if (!latest || latest.verifiedAt) throw new DriverError('otp_not_found');
    if (latest.lockedAt) throw this.locked(now, latest.lockedAt);
    if (now.getTime() >= latest.expiresAt.getTime()) throw new DriverError('otp_expired');
    const claimed = await this.repo.claimOtpAttempt(latest.id, { maxAttempts: OTP_MAX_ATTEMPTS });
    if (!claimed) {
      // Another guess took the last attempt, locked it or used the code first.
      const row = await this.repo.lockOtp(latest.id, { now, maxAttempts: OTP_MAX_ATTEMPTS });
      if (row?.lockedAt) throw this.locked(now, row.lockedAt);
      throw new DriverError('otp_not_found');
    }
    const expected = Buffer.from(latest.codeHash, 'hex');
    const given = Buffer.from(this.hash(code, phoneHash), 'hex');
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
      if (claimed.attempts >= OTP_MAX_ATTEMPTS) {
        const locked = await this.repo.lockOtp(latest.id, { now, maxAttempts: OTP_MAX_ATTEMPTS });
        throw this.locked(now, locked?.lockedAt ?? now);
      }
      throw new DriverError('otp_invalid');
    }
    return latest;
  }

  /** Uses up a challenge `check` accepted, inside `tx`, only if no other request got there first. */
  async consume(challenge: OtpRecord, tx?: Tx): Promise<OtpRecord> {
    const used = await this.repo.consumeOtp(challenge.id, this.clock.now(), tx);
    if (!used) throw new DriverError('otp_not_found');
    return used;
  }

  private locked(now: Date, lockedAt: Date): DriverError {
    return new DriverError('otp_locked', { retryAfterSec: secondsUntil(now, lockedAt, LOCK_MINUTES * 60), params: { minutes: LOCK_MINUTES } });
  }

  /** Dev only: the code a dev WhatsApp provider delivered last to this phone, when its latest code went that way. */
  devWhatsAppCode(phoneE164: string): string | null {
    if (this.devChannel.get(phoneE164) !== 'whatsapp' || !(this.whatsapp instanceof DevWhatsAppProvider)) return null;
    for (let i = this.whatsapp.sent.length - 1; i >= 0; i -= 1) {
      const m = this.whatsapp.sent[i]!;
      if (m.to === phoneE164 && m.template === OTP_WHATSAPP_TEMPLATE) return m.params[0] ?? null;
    }
    return null;
  }

  private hash(code: string, phoneHash: string): string {
    return createHmac('sha256', this.pepper).update(`${phoneHash}:${code}`).digest('hex');
  }
}

function secondsUntil(now: Date, from: Date, plusSec: number): number {
  return Math.max(0, Math.ceil((from.getTime() + plusSec * 1000 - now.getTime()) / 1000));
}
