import { describe, expect, it } from 'vitest';
import { DriverError } from '@driver/contracts';
import { isStagingTestNumber, stagingTestFromEnv, type StagingTestConfig } from './staging-test.js';
import { harness } from './test-harness.js';

// Test values only; the real code lives in the staging host's secret.
const TEST: StagingTestConfig = { code: '583014', dailyCodes: 200 };
const PHONE = '0770 000 0142';
const E164 = '+9647700000142';
const SYSTEM = { personId: 'system:test' };

async function code(p: Promise<unknown>): Promise<string | null> {
  return p.then(
    () => null,
    (e: unknown) => (e instanceof DriverError ? e.code : String(e)),
  );
}

/** Staging test numbers 0770 000 01xx (docs/api/staging-test-numbers.md). */
describe('staging test numbers', () => {
  it('the range is exactly 0770 000 0100 to 0199', () => {
    expect(isStagingTestNumber('+9647700000100')).toBe(true);
    expect(isStagingTestNumber('+9647700000199')).toBe(true);
    expect(isStagingTestNumber('+9647700000001')).toBe(false);
    expect(isStagingTestNumber('+9647700000200')).toBe(false);
    expect(isStagingTestNumber('+96477000001420')).toBe(false);
  });

  it('a number in the range signs in with the fixed code; nothing is texted', async () => {
    const h = harness(undefined, { stagingTest: TEST });
    await h.service.requestOtp({ phone: PHONE, purpose: 'login' });
    expect(h.sms.sent).toHaveLength(0);
    expect(h.whatsapp!.sent).toHaveLength(0);
    const res = await h.service.verifyOtp({ phone: PHONE, code: TEST.code });
    expect(res.isNew).toBe(true);
  });

  it('a wrong code counts like anyone else\'s and locks after 5', async () => {
    const h = harness(undefined, { stagingTest: TEST });
    await h.service.requestOtp({ phone: PHONE, purpose: 'login' });
    for (let i = 0; i < 4; i += 1) expect(await code(h.service.verifyOtp({ phone: PHONE, code: '000001' }))).toBe('otp_invalid');
    expect(await code(h.service.verifyOtp({ phone: PHONE, code: '000001' }))).toBe('otp_locked');
    expect(await code(h.service.verifyOtp({ phone: PHONE, code: TEST.code }))).toBe('otp_locked');
  });

  it('the number limits apply, and a cap across the whole range', async () => {
    const h = harness(undefined, { stagingTest: { ...TEST, dailyCodes: 3 } });
    for (let i = 0; i < 3; i += 1) {
      await h.service.requestOtp({ phone: `0770 000 01${10 + i}`, purpose: 'login' });
    }
    expect(await code(h.service.requestOtp({ phone: '0770 000 0199', purpose: 'login' }))).toBe('rate_limited');
    // An ordinary number is not affected by the range's cap.
    await h.service.requestOtp({ phone: '0770 123 4567', purpose: 'login' });
    expect(h.sms.sent).toHaveLength(1);
  });

  it('outside the range, or with the range off, a number gets a real code and the fixed code means nothing', async () => {
    const on = harness(undefined, { stagingTest: TEST });
    await on.service.requestOtp({ phone: '0770 000 0200', purpose: 'login' });
    expect(on.sms.sent).toHaveLength(1);
    const off = harness();
    await off.service.requestOtp({ phone: PHONE, purpose: 'login' });
    expect(off.sms.sent).toHaveLength(1);
    if (off.sms.lastCodeFor(E164) !== TEST.code) expect(await code(off.service.verifyOtp({ phone: PHONE, code: TEST.code }))).toBe('otp_invalid');
  });

  it('never staff: a test number is not made staff, and a test number holding a staff role cannot sign in', async () => {
    const h = harness(undefined, { stagingTest: TEST });
    await h.service.requestOtp({ phone: PHONE, purpose: 'login' });
    const { personId } = await h.service.verifyOtp({ phone: PHONE, code: TEST.code });
    for (const kind of ['admin', 'support', 'dispatcher', 'finance', 'field_ops'] as const) {
      expect(await code(h.service.grantRole(SYSTEM, { personId, kind }))).toBe('forbidden');
    }
    // A partner role is fine (staging tests the partner app too).
    expect(await code(h.service.grantRole(SYSTEM, { personId, kind: 'courier' }))).toBeNull();

    // A role that got there another way (a seed, a direct write) still stops the sign-in.
    await h.repo.upsertRole({ personId, kind: 'admin', orgId: null, grantedBy: null, now: h.clock.now() });
    h.clock.advanceMinutes(1);
    await h.service.requestOtp({ phone: PHONE, purpose: 'login' });
    expect(await code(h.service.verifyOtp({ phone: PHONE, code: TEST.code }))).toBe('forbidden');
  });

  it('staff cannot move their account onto a test number', async () => {
    const h = harness(undefined, { stagingTest: TEST });
    const staff = await h.login('0770 555 0001');
    await h.service.grantRole(SYSTEM, { personId: staff.personId, kind: 'support' });
    expect(await code(h.service.changePhoneStart(staff.actor, { newPhone: PHONE }))).toBe('forbidden');
  });

  it('settings: only on a staging host, 6 digits, not an obvious code', () => {
    expect(stagingTestFromEnv({})).toBeNull();
    expect(stagingTestFromEnv({ DEPLOY_ENVIRONMENT: 'staging' })).toBeNull();
    expect(stagingTestFromEnv({ STAGING_TEST_OTP: TEST.code, DEPLOY_ENVIRONMENT: 'staging' })).toEqual(TEST);
    expect(stagingTestFromEnv({ STAGING_TEST_OTP: TEST.code, DEPLOY_ENVIRONMENT: 'staging', STAGING_TEST_DAILY_CODES: '50' })).toEqual({ ...TEST, dailyCodes: 50 });
    expect(() => stagingTestFromEnv({ STAGING_TEST_OTP: TEST.code })).toThrow(/refusing to boot/);
    expect(() => stagingTestFromEnv({ STAGING_TEST_OTP: TEST.code, DEPLOY_ENVIRONMENT: 'production' })).toThrow(/refusing to boot/);
    expect(() => stagingTestFromEnv({ STAGING_TEST_OTP: '12345', DEPLOY_ENVIRONMENT: 'staging' })).toThrow();
    expect(() => stagingTestFromEnv({ STAGING_TEST_OTP: '123456', DEPLOY_ENVIRONMENT: 'staging' })).toThrow();
    expect(() => stagingTestFromEnv({ STAGING_TEST_OTP: '444444', DEPLOY_ENVIRONMENT: 'staging' })).toThrow();
    expect(() => stagingTestFromEnv({ STAGING_TEST_OTP: TEST.code, DEPLOY_ENVIRONMENT: 'staging', STAGING_TEST_DAILY_CODES: '0' })).toThrow();
  });
});
