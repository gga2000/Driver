import { describe, expect, it } from 'vitest';
import { DriverError, ERROR_TABLE, ErrorEnvelope, errorEnvelope } from './errors.js';

describe('error-code table', () => {
  it('every code yields an envelope with Arabic text and a retry hint', () => {
    for (const code of Object.keys(ERROR_TABLE) as Array<keyof typeof ERROR_TABLE>) {
      const env = errorEnvelope(code);
      expect(ErrorEnvelope.parse(env)).toEqual(env);
      expect(env.message_ar.length).toBeGreaterThan(3);
      expect(env.message_ar).not.toMatch(/\{\w+\}/);
    }
  });

  it('uses the packages/i18n ar-IQ string when an error.* key exists', () => {
    expect(errorEnvelope('otp_invalid').message_ar).toBe('الرمز غلط. تأكد من الرسالة وجرب مرة ثانية');
    expect(errorEnvelope('otp_locked', { params: { minutes: 15 } }).message_ar).toContain('15');
  });

  it('DriverError carries code, envelope and transport status', () => {
    const err = new DriverError('reverification_required');
    expect(err.code).toBe('reverification_required');
    expect(err.status).toBe('FORBIDDEN');
    expect(err.envelope.retryHint).toBe('reverify');
    expect(new DriverError('otp_resend_too_soon', { retryAfterSec: 12 }).envelope.retryAfterSec).toBe(12);
  });
});
