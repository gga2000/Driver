import { describe, expect, it } from 'vitest';
import { isDriverError } from '@driver/contracts';
import { OTP_WHATSAPP_TEMPLATE } from './otp.service.js';
import { harness } from './test-harness.js';

/** "ما وصلك؟ دزلي على واتساب" (customer C-18): the login code over WhatsApp when the SMS never came. */
describe('identity.requestOtp over WhatsApp', () => {
  const PHONE = '07701234567';
  const E164 = '+9647701234567';

  it('sends the login code with the approved template after the 30 s cool-down, and it signs in', async () => {
    const h = harness();
    const first = await h.service.requestOtp({ phone: PHONE, purpose: 'login' });
    expect(first.channel).toBe('sms');
    expect(h.sms.sentTo(E164)).toHaveLength(1);

    // Same cool-down as an SMS resend.
    const early = await h.service.requestOtp({ phone: PHONE, purpose: 'login', channel: 'whatsapp' }).catch((e: unknown) => e);
    expect(isDriverError(early) && early.code).toBe('otp_resend_too_soon');

    h.clock.advanceSeconds(31);
    const wa = await h.service.requestOtp({ phone: PHONE, purpose: 'login', channel: 'whatsapp' });
    expect(wa.channel).toBe('whatsapp');
    expect(h.sms.sentTo(E164)).toHaveLength(1);
    const sent = h.whatsapp!.sent.at(-1)!;
    expect(sent).toMatchObject({ to: E164, template: OTP_WHATSAPP_TEMPLATE, language: 'ar' });
    expect(sent.params[0]).toMatch(/^\d{6}$/);

    // The WhatsApp code is the live one (it replaced the SMS challenge); dev tools read it back.
    expect((await h.service.devLastOtp(PHONE)).code).toBe(sent.params[0]);
    const smsCode = h.sms.lastCodeFor(E164)!;
    if (smsCode !== sent.params[0]) {
      const stale = await h.service.verifyOtp({ phone: PHONE, code: smsCode }).catch((e: unknown) => e);
      expect(isDriverError(stale)).toBe(true);
    }
    const res = await h.service.verifyOtp({ phone: PHONE, code: sent.params[0]! });
    expect(res.isNew).toBe(true);
  });

  it('an SMS after a WhatsApp code makes the SMS the one dev tools show', async () => {
    const h = harness();
    await h.service.requestOtp({ phone: PHONE, purpose: 'login', channel: 'whatsapp' });
    h.clock.advanceSeconds(31);
    await h.service.requestOtp({ phone: PHONE, purpose: 'login' });
    expect((await h.service.devLastOtp(PHONE)).code).toBe(h.sms.lastCodeFor(E164));
  });

  it('is refused plainly without a WhatsApp port, and for purposes other than login', async () => {
    const off = harness(undefined, { noWhatsApp: true });
    const err = await off.service.requestOtp({ phone: PHONE, purpose: 'login', channel: 'whatsapp' }).catch((e: unknown) => e);
    expect(isDriverError(err) && err.code).toBe('otp_channel_unavailable');
    expect(off.sms.sentTo(E164)).toHaveLength(0);

    const h = harness();
    const consent = await h.service.requestOtp({ phone: PHONE, purpose: 'guardian_consent', channel: 'whatsapp' }).catch((e: unknown) => e);
    expect(isDriverError(consent) && consent.code).toBe('otp_channel_unavailable');
  });
});
