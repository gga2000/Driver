import { describe, expect, it } from 'vitest';
import { locales, voiceProblems } from '@driver/i18n';
import { DriverError, ERROR_TABLE, ErrorEnvelope, errorEnvelope, errorMessageKey } from './errors.js';

describe('error-code table', () => {
  it('every code yields an envelope with Arabic text and a retry hint', () => {
    for (const code of Object.keys(ERROR_TABLE) as Array<keyof typeof ERROR_TABLE>) {
      const env = errorEnvelope(code);
      expect(ErrorEnvelope.parse(env)).toEqual(env);
      expect(env.message_ar.length).toBeGreaterThan(3);
      expect(env.message_ar).not.toMatch(/\{\w+\}/);
    }
  });

  it('every code reads its words from packages/i18n (S-08), in both languages, with no inline copy', () => {
    for (const code of Object.keys(ERROR_TABLE) as Array<keyof typeof ERROR_TABLE>) {
      const key = errorMessageKey(code);
      expect(key, `${code}: add "error.${code}" to packages/i18n/src/locales/ar-IQ.json and en.json`).not.toBeNull();
      expect((locales.en as Record<string, string>)[key!], `${code}: English missing`).toBeTruthy();
      const def = ERROR_TABLE[code] as { message_ar?: string; message_en?: string };
      expect(def.message_ar, `${code}: move message_ar into the locale files`).toBeUndefined();
      expect(def.message_en, `${code}: move message_en into the locale files`).toBeUndefined();
    }
  });

  it('error copy follows the voice glossary', () => {
    const table: Record<string, string> = {};
    for (const code of Object.keys(ERROR_TABLE) as Array<keyof typeof ERROR_TABLE>) table[`error:${code}`] = errorEnvelope(code).message_ar;
    expect(voiceProblems(table)).toEqual([]);
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
