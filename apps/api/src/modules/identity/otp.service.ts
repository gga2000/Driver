import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { DriverError, OTP_LENGTH, OTP_MAX_ATTEMPTS, OTP_RESEND_SEC, OTP_TTL_SEC, type OtpPurpose } from '@driver/contracts';
import type { Clock } from '../../shared/clock.js';
import type { Tx } from '../../shared/db/unit-of-work.js';
import type { IdentityRepository, OtpRecord } from './identity.repository.js';
import type { SmsProvider } from './sms/provider.js';

const LOCK_MINUTES = 15;

const BODY_BY_PURPOSE: Record<OtpPurpose, (code: string) => string> = {
  login: (c) => `رمز دخول درايفر: ${c}`,
  guardian_consent: (c) => `رمز موافقة ولي الأمر في درايفر: ${c}`,
  phone_change: (c) => `رمز تغيير الرقم في درايفر: ${c}`,
};

/**
 * One challenge chain per (phone hash, purpose): 6 digits, 5 attempts, 3-minute expiry,
 * 30-second resend. Codes are stored as peppered HMACs; the clear code only ever reaches the SMS
 * provider. After 5 wrong tries the challenge locks for 15 minutes.
 */
export class OtpService {
  constructor(
    private readonly repo: IdentityRepository,
    private readonly sms: SmsProvider,
    private readonly clock: Clock,
    private readonly pepper: string,
  ) {}

  async request(phoneE164: string, phoneHash: string, purpose: OtpPurpose, tx?: Tx): Promise<{ expiresAt: Date; resendAfterSec: number }> {
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
    const code = randomInt(0, 10 ** OTP_LENGTH).toString().padStart(OTP_LENGTH, '0');
    const expiresAt = new Date(now.getTime() + OTP_TTL_SEC * 1000);
    await this.repo.createOtp({ phoneHash, codeHash: this.hash(code, phoneHash), purpose, expiresAt, now }, tx);
    await this.sms.send({ to: phoneE164, body: BODY_BY_PURPOSE[purpose](code), code });
    return { expiresAt, resendAfterSec: OTP_RESEND_SEC };
  }

  /** Consumes the latest challenge on success; counts attempts and locks on the 5th miss. */
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
      const attempts = latest.attempts + 1;
      const lock = attempts >= OTP_MAX_ATTEMPTS;
      await this.repo.updateOtp(latest.id, { attempts, ...(lock ? { lockedAt: now } : {}) }, tx);
      if (lock) throw new DriverError('otp_locked', { retryAfterSec: LOCK_MINUTES * 60, params: { minutes: LOCK_MINUTES } });
      throw new DriverError('otp_invalid');
    }
    return this.repo.updateOtp(latest.id, { verifiedAt: now, attempts: latest.attempts + 1 }, tx);
  }

  private hash(code: string, phoneHash: string): string {
    return createHmac('sha256', this.pepper).update(`${phoneHash}:${code}`).digest('hex');
  }
}

function secondsUntil(now: Date, from: Date, plusSec: number): number {
  return Math.max(0, Math.ceil((from.getTime() + plusSec * 1000 - now.getTime()) / 1000));
}
