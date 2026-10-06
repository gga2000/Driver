import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { isProviderError } from '../../shared/messaging/http.js';
import { DriverError, isDriverError, OTP_LENGTH, OTP_MAX_ATTEMPTS, OTP_RESEND_SEC, OTP_TTL_SEC, type OtpPurpose } from '@driver/contracts';
import type { Clock } from '../../shared/clock.js';
import type { Tx } from '../../shared/db/unit-of-work.js';
import type { IdentityRepository, OtpRecord } from './identity.repository.js';
import type { SmsProvider } from './sms/provider.js';
import { DevWhatsAppProvider, type WhatsAppPort } from '../../shared/messaging/whatsapp.js';
import type { OtpChannel } from '@driver/contracts';

/** The approved WhatsApp authentication template for login codes (Meta: one `{{1}}` = the code). */
export const OTP_WHATSAPP_TEMPLATE = 'otp_login';

const LOCK_MINUTES = 15;

const BODY_BY_PURPOSE: Record<OtpPurpose, (code: string) => string> = {
  login: (c) => `رمز دخول درايفر: ${c}`,
  guardian_consent: (c) => `رمز موافقة ولي الأمر في درايفر: ${c}`,
  phone_change: (c) => `رمز تغيير الرقم في درايفر: ${c}`,
};

/**
 * One challenge chain per (phone hash, purpose): 6 digits, 5 attempts, 3-minute expiry,
 * 30-second resend. Codes are stored as peppered HMACs; the clear code only ever reaches the SMS
 * provider. After 5 wrong tries the challenge locks for 15 minutes; a resend carries the misses over.
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
    private readonly whatsapp?: WhatsAppPort,
  ) {}

  async request(phoneE164: string, phoneHash: string, purpose: OtpPurpose, tx?: Tx, channel: OtpChannel = 'sms'): Promise<{ expiresAt: Date; resendAfterSec: number; channel: OtpChannel }> {
    if (channel === 'whatsapp' && (!this.whatsapp || purpose !== 'login')) throw new DriverError('otp_channel_unavailable');
    const now = this.clock.now();
    const latest = await this.repo.latestOtp(phoneHash, purpose, tx);
    if (latest) {
      if (latest.lockedAt && now.getTime() < latest.lockedAt.getTime() + LOCK_MINUTES * 60_000) {
        throw new DriverError('otp_locked', { retryAfterSec: secondsUntil(now, latest.lockedAt, LOCK_MINUTES * 60), params: { minutes: LOCK_MINUTES } });
      }
      const sinceLast = (now.getTime() - latest.createdAt.getTime()) / 1000;
      if (!latest.verifiedAt && sinceLast < OTP_RESEND_SEC) {
        throw new DriverError('otp_resend_too_soon', { retryAfterSec: Math.ceil(OTP_RESEND_SEC - sinceLast) });
      }
    }
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
    if (this.whatsapp instanceof DevWhatsAppProvider) {
      if (channel === 'whatsapp') this.devChannel.set(phoneE164, 'whatsapp');
      else this.devChannel.delete(phoneE164);
    }
    return { expiresAt, resendAfterSec: OTP_RESEND_SEC, channel };
  }

  /**
   * Consumes the latest challenge on success (inside `tx`); a miss is counted and, on the 5th, the
   * challenge locked — both committed independently of `tx`, which the thrown error rolls back.
   */
  async verify(phoneHash: string, purpose: OtpPurpose, code: string, tx?: Tx): Promise<OtpRecord> {
    const now = this.clock.now();
    const latest = await this.repo.latestOtp(phoneHash, purpose, tx);
    if (!latest || latest.verifiedAt) throw new DriverError('otp_not_found');
    if (latest.lockedAt) {
      throw new DriverError('otp_locked', { retryAfterSec: secondsUntil(now, latest.lockedAt, LOCK_MINUTES * 60), params: { minutes: LOCK_MINUTES } });
    }
    if (now.getTime() >= latest.expiresAt.getTime()) throw new DriverError('otp_expired');
    const expected = Buffer.from(latest.codeHash, 'hex');
    const given = Buffer.from(this.hash(code, phoneHash), 'hex');
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
      // The miss is recorded OUTSIDE `tx`: the caller's transaction is about to roll back (we throw),
      // and a rolled-back counter would make the 5-try lockout unreachable (review C1).
      const counted = await this.repo.recordOtpFailure(latest.id, { now, maxAttempts: OTP_MAX_ATTEMPTS });
      if (counted.lockedAt) throw new DriverError('otp_locked', { retryAfterSec: secondsUntil(now, counted.lockedAt, LOCK_MINUTES * 60), params: { minutes: LOCK_MINUTES } });
      throw new DriverError('otp_invalid');
    }
    return this.repo.updateOtp(latest.id, { verifiedAt: now, attempts: latest.attempts + 1 }, tx);
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
