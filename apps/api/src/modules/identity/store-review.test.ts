import { describe, expect, it } from 'vitest';
import { DriverError } from '@driver/contracts';
import { STORE_REVIEW_SIGNIN_EVENT, storeReviewFromEnv, type StoreReviewConfig } from './store-review.js';
import { harness } from './test-harness.js';

// Test values only; the real number and code live in the host's secrets.
const REVIEW: StoreReviewConfig = { phoneE164: '+9647809990001', code: '418257', dailySignIns: 10 };
const PHONE = '0780 999 0001';

async function code(p: Promise<unknown>): Promise<string | null> {
  return p.then(
    () => null,
    (e: unknown) => (e instanceof DriverError ? e.code : String(e)),
  );
}

/** BENCH-04 / decision D-4: the store reviewers' sign-in. */
describe('store-reviewer sign-in', () => {
  it('signs in with the fixed code; nothing is texted; every use is alerted', async () => {
    const h = harness(undefined, { storeReview: REVIEW });
    const sent = await h.service.requestOtp({ phone: PHONE, purpose: 'login' });
    expect(sent.channel).toBe('sms');
    expect(h.sms.sent).toHaveLength(0);
    expect(h.whatsapp!.sent).toHaveLength(0);
    const res = await h.service.verifyOtp({ phone: PHONE, code: REVIEW.code });
    expect(res.isNew).toBe(true);
    expect(await h.service.storeReviewerId()).toBe(res.personId);
    expect(h.events.last(STORE_REVIEW_SIGNIN_EVENT)).toMatchObject({ aggregate: { name: 'security', id: 'store_review' }, payload: { personId: res.personId, signInsToday: 1, limit: 10 } });
    expect(JSON.stringify(h.events.last(STORE_REVIEW_SIGNIN_EVENT))).not.toContain('999');
  });

  it('a wrong code counts like anyone else\'s and locks after 5', async () => {
    const h = harness(undefined, { storeReview: REVIEW });
    await h.service.requestOtp({ phone: PHONE, purpose: 'login' });
    for (let i = 0; i < 4; i += 1) expect(await code(h.service.verifyOtp({ phone: PHONE, code: '000001' }))).toBe('otp_invalid');
    expect(await code(h.service.verifyOtp({ phone: PHONE, code: '000001' }))).toBe('otp_locked');
    expect(await code(h.service.verifyOtp({ phone: PHONE, code: REVIEW.code }))).toBe('otp_locked');
  });

  it('at most 10 sign-ins a rolling day', async () => {
    const h = harness(undefined, { storeReview: REVIEW });
    for (let i = 0; i < 10; i += 1) {
      await h.service.requestOtp({ phone: PHONE, purpose: 'login' });
      await h.service.verifyOtp({ phone: PHONE, code: REVIEW.code });
      h.clock.advanceMinutes(30);
    }
    await h.service.requestOtp({ phone: PHONE, purpose: 'login' });
    expect(await code(h.service.verifyOtp({ phone: PHONE, code: REVIEW.code }))).toBe('rate_limited');
    h.clock.advanceMinutes(24 * 60 - 4 * 60);
    await h.service.requestOtp({ phone: PHONE, purpose: 'login' });
    await expect(h.service.verifyOtp({ phone: PHONE, code: REVIEW.code })).resolves.toBeTruthy();
  });

  it('off without the secrets: the number is an ordinary number and the fixed code means nothing', async () => {
    const h = harness();
    await h.service.requestOtp({ phone: PHONE, purpose: 'login' });
    expect(h.sms.sent).toHaveLength(1);
    const real = h.sms.lastCodeFor(REVIEW.phoneE164)!;
    if (real !== REVIEW.code) expect(await code(h.service.verifyOtp({ phone: PHONE, code: REVIEW.code }))).toBe('otp_invalid');
    expect(await h.service.storeReviewerId()).toBeNull();
  });

  it('no other code is ever sent to the reviewer number (guardian link, phone change)', async () => {
    const h = harness(undefined, { storeReview: REVIEW });
    const { actor } = await h.login('07700000001');
    expect(await code(h.service.linkGuardian(actor, { wardPhone: PHONE }))).toBe('otp_channel_unavailable');
    expect(await code(h.service.changePhoneStart(actor, { newPhone: PHONE }))).toBe('otp_channel_unavailable');
    expect(h.sms.sentTo(REVIEW.phoneE164)).toHaveLength(0);
  });

  it('settings: both or neither, 6 digits, not an obvious code', () => {
    expect(storeReviewFromEnv({})).toBeNull();
    expect(storeReviewFromEnv({ STORE_REVIEW_PHONE: PHONE, STORE_REVIEW_CODE: REVIEW.code })).toEqual(REVIEW);
    expect(() => storeReviewFromEnv({ STORE_REVIEW_PHONE: PHONE })).toThrow();
    expect(() => storeReviewFromEnv({ STORE_REVIEW_CODE: REVIEW.code })).toThrow();
    expect(() => storeReviewFromEnv({ STORE_REVIEW_PHONE: PHONE, STORE_REVIEW_CODE: '12345' })).toThrow();
    expect(() => storeReviewFromEnv({ STORE_REVIEW_PHONE: PHONE, STORE_REVIEW_CODE: '123456' })).toThrow();
    expect(() => storeReviewFromEnv({ STORE_REVIEW_PHONE: PHONE, STORE_REVIEW_CODE: '777777' })).toThrow();
    expect(() => storeReviewFromEnv({ STORE_REVIEW_PHONE: '+441234567890', STORE_REVIEW_CODE: REVIEW.code })).toThrow();
  });
});
