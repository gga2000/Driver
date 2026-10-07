import { describe, expect, it } from 'vitest';
import { DriverError } from '@driver/contracts';
import { FakeClock } from '../../shared/clock.js';
import { EventOtpAlerts, OTP_ALERT_EVENT, RecordingEventEmitter } from './events.adapter.js';
import { carrierOf, numberBlock } from './phone.js';
import { DEFAULT_OTP_GUARD, otpGuardConfigFromEnv } from './rate-limit.js';
import { harness } from './test-harness.js';

const DEVICE = { fingerprint: 'device-guard-1', platform: 'android' as const };

async function code(p: Promise<unknown>): Promise<string | null> {
  return p.then(
    () => null,
    (e: unknown) => (e instanceof DriverError ? e.code : String(e)),
  );
}

/** The one OTP guard (audit SEC-04, SEC-05, SEC-17; decision D-5). */
describe('OTP guard', () => {
  it('300 sign-ins from one carrier IP in 10 minutes are all served, and ops get one alert', async () => {
    const h = harness();
    for (let i = 0; i < 300; i += 1) {
      await h.service.requestOtp({ phone: `0770${String(1_000_000 + i)}`, purpose: 'login' }, { ip: '37.236.0.1' });
      if (i % 30 === 29) h.clock.advanceSeconds(60);
    }
    expect(h.sms.sent).toHaveLength(300);
    expect(h.otpAlerts.raised.filter((a) => a.rule === 'ip')).toHaveLength(0);

    // The alert threshold is 1,000 an hour; a lower one shows the alert path: counted, never refused.
    const low = harness(undefined, { otpGuard: { perIpPerHour: 100 } });
    for (let i = 0; i < 300; i += 1) await low.service.requestOtp({ phone: `0780${String(1_000_000 + i)}`, purpose: 'login' }, { ip: '37.236.0.1' });
    expect(low.sms.sent).toHaveLength(300);
    expect(low.otpAlerts.raised.filter((a) => a.rule === 'ip')).toEqual([{ rule: 'ip', mode: 'alert', count: 101, limit: 100, windowSec: 3600, carrier: 'zain' }]);
  });

  it('per number: the 6th code in an hour is refused whatever the IP or device; 10 a day', async () => {
    const h = harness();
    const phone = '07701234567';
    for (let i = 0; i < 5; i += 1) {
      await h.service.requestOtp({ phone, purpose: 'login', device: { ...DEVICE, fingerprint: `fp-${i}` } }, { ip: `10.0.0.${i}` });
      h.clock.advanceSeconds(31);
    }
    expect(await code(h.service.requestOtp({ phone, purpose: 'login' }, { ip: '10.9.9.9' }))).toBe('rate_limited');
    expect(h.sms.sentTo('+9647701234567')).toHaveLength(5);
    h.clock.advanceSeconds(3600);
    for (let i = 0; i < 5; i += 1) {
      await h.service.requestOtp({ phone, purpose: 'login' });
      h.clock.advanceSeconds(31);
    }
    h.clock.advanceSeconds(3600);
    expect(await code(h.service.requestOtp({ phone, purpose: 'login' }))).toBe('rate_limited');
  });

  it('per device: 5 an hour across numbers, with retryAfterSec', async () => {
    const h = harness();
    for (let i = 0; i < 5; i += 1) await h.service.requestOtp({ phone: `0771300000${i}`, purpose: 'login', device: DEVICE });
    h.clock.advanceSeconds(20 * 60);
    const err = await h.service.requestOtp({ phone: '07713000009', purpose: 'login', device: DEVICE }).catch((e: unknown) => e);
    expect((err as DriverError).envelope).toMatchObject({ code: 'rate_limited', retryHint: 'later', retryAfterSec: 2400 });
    await expect(h.service.requestOtp({ phone: '07713000009', purpose: 'login', device: { ...DEVICE, fingerprint: 'other' } })).resolves.toBeTruthy();
  });

  it('per signed-in sender: guardian and phone-change codes count against the account (5 an hour)', async () => {
    const h = harness();
    const { actor } = await h.login('07700000001');
    await h.service.changePhoneStart(actor, { newPhone: '07700000002' }); // 2 codes
    for (let i = 3; i <= 5; i += 1) await h.service.linkGuardian(actor, { wardPhone: `0770000000${i}` });
    expect(await code(h.service.linkGuardian(actor, { wardPhone: '07700000006' }))).toBe('rate_limited');
    expect(h.sms.sentTo('+9647700000006')).toHaveLength(0);
  });

  it('the SMS budget alerts at 50 % and 80 %; at 100 % the spiking block is throttled and everyone else signs in on WhatsApp', async () => {
    const h = harness(undefined, { otpGuard: { smsDailyBudget: 10, blockSpikePerHour: 4 } });
    // A pumping script walks one 7-digit block: 0770 555 x.
    for (let i = 0; i < 6; i += 1) await h.service.requestOtp({ phone: `0770555000${i}`, purpose: 'login' });
    for (let i = 0; i < 4; i += 1) await h.service.requestOtp({ phone: `0781${i}000000`, purpose: 'login' });
    expect(h.sms.sent).toHaveLength(10);
    const budget = h.otpAlerts.raised.filter((a) => a.rule === 'sms_budget').map((a) => ('level' in a ? a.level : null));
    expect(budget).toEqual([50, 80]);
    expect(h.otpAlerts.raised.filter((a) => a.rule === 'block_spike')).toMatchObject([{ block: '0770555', carrier: 'asiacell', throttled: false }]);

    // Budget spent: the block behind the spike waits…
    const err = await h.service.requestOtp({ phone: '07705550099', purpose: 'login' }).catch((e: unknown) => e);
    expect((err as DriverError).code).toBe('rate_limited');
    expect(h.otpAlerts.raised.filter((a) => a.rule === 'sms_budget').at(-1)).toMatchObject({ level: 100, count: 10, limit: 10 });
    expect(h.otpAlerts.raised.at(-1)).toMatchObject({ rule: 'block_spike', block: '0770555', throttled: true });

    // …a normal number gets its code on WhatsApp, and it signs in.
    const res = await h.service.requestOtp({ phone: '07812345678', purpose: 'login' });
    expect(res.channel).toBe('whatsapp');
    expect(h.sms.sentTo('+9647812345678')).toHaveLength(0);
    const sent = h.whatsapp!.sent.at(-1)!;
    expect(sent.to).toBe('+9647812345678');
    await expect(h.service.verifyOtp({ phone: '07812345678', code: sent.params[0]! })).resolves.toMatchObject({ isNew: true });

    // Someone without WhatsApp asks for SMS by name, and gets it (never locked out).
    h.clock.advanceSeconds(31);
    const bySms = await h.service.requestOtp({ phone: '07812345679', purpose: 'login', channel: 'sms' });
    expect(bySms.channel).toBe('sms');
    expect(h.sms.sentTo('+9647812345679')).toHaveLength(1);
  });

  it('OTP_BUDGET_MODE=alert: the spent budget alerts but changes nothing', async () => {
    const h = harness(undefined, { otpGuard: { smsDailyBudget: 2, blockSpikePerHour: 1, modes: { ...DEFAULT_OTP_GUARD.modes, budget: 'alert' } } });
    for (let i = 0; i < 4; i += 1) {
      const r = await h.service.requestOtp({ phone: `0770555000${i}`, purpose: 'login' });
      expect(r.channel).toBe('sms');
    }
    expect(h.otpAlerts.raised.filter((a) => a.rule === 'sms_budget').map((a) => ('level' in a ? a.level : null))).toEqual([50, 80, 100]);
  });

  it('a rule in alert mode counts and alerts once; in enforce mode the IP rule refuses', async () => {
    const soft = harness(undefined, { otpGuard: { perDevicePerHour: 2, modes: { ...DEFAULT_OTP_GUARD.modes, device: 'alert' } } });
    for (let i = 0; i < 5; i += 1) await soft.service.requestOtp({ phone: `0771300000${i}`, purpose: 'login', device: DEVICE });
    expect(soft.otpAlerts.raised.filter((a) => a.rule === 'device')).toHaveLength(1);

    const hard = harness(undefined, { otpGuard: { perIpPerHour: 2, modes: { ...DEFAULT_OTP_GUARD.modes, ip: 'enforce' } } });
    await hard.service.requestOtp({ phone: '07713000001', purpose: 'login' }, { ip: '10.1.1.1' });
    await hard.service.requestOtp({ phone: '07713000002', purpose: 'login' }, { ip: '10.1.1.1' });
    expect(await code(hard.service.requestOtp({ phone: '07713000003', purpose: 'login' }, { ip: '10.1.1.1' }))).toBe('rate_limited');
  });

  it('settings come from the environment; the IP rule stays alert-only unless named', () => {
    expect(otpGuardConfigFromEnv({})).toEqual(DEFAULT_OTP_GUARD);
    const c = otpGuardConfigFromEnv({ OTP_GUARD_MODE: 'alert', OTP_SMS_DAILY_BUDGET: '9000', OTP_RATE_LIMIT_PER_NUMBER_HOUR: '3' });
    expect(c.modes).toEqual({ number: 'alert', device: 'alert', actor: 'alert', ip: 'alert', budget: 'throttle' });
    expect(c.smsDailyBudget).toBe(9000);
    expect(c.perNumberPerHour).toBe(3);
    expect(otpGuardConfigFromEnv({ OTP_GUARD_MODE: 'enforce' }).modes.ip).toBe('alert');
    expect(otpGuardConfigFromEnv({ OTP_GUARD_MODE_IP: 'enforce' }).modes.ip).toBe('enforce');
    expect(() => otpGuardConfigFromEnv({ OTP_RATE_LIMIT_PER_IP_HOUR: 'lots' })).toThrow();
    expect(() => otpGuardConfigFromEnv({ OTP_BUDGET_MODE: 'block' })).toThrow();
  });

  it('alerts are written as security.otp_alert events with no number or IP in them', async () => {
    const events = new RecordingEventEmitter();
    await new EventOtpAlerts(events, new FakeClock('2026-12-07T08:00:00Z')).raise({ rule: 'sms_budget', level: 80, count: 3600, limit: 4500, mode: 'throttle' });
    expect(events.last(OTP_ALERT_EVENT)).toMatchObject({ actorId: 'system', aggregate: { name: 'security', id: 'otp' }, payload: { rule: 'sms_budget', level: 80 } });
  });

  it('number blocks and carriers', () => {
    expect(numberBlock('+9647701234567')).toBe('0770123');
    expect(carrierOf('+9647701234567')).toBe('asiacell');
    expect(carrierOf('+9647801234567')).toBe('zain');
    expect(carrierOf('+9647901234567')).toBe('zain');
    expect(carrierOf('+9647501234567')).toBe('korek');
    expect(carrierOf('+9647601234567')).toBe('other');
  });
});

/** SEC-01: the 5-try lock-out holds under parallel guesses. */
describe('OTP attempts', () => {
  it('20 parallel wrong codes: exactly 5 are counted, then the code is locked (the right one too)', async () => {
    const h = harness();
    await h.service.requestOtp({ phone: '07712345678', purpose: 'login' });
    const real = h.sms.lastCodeFor('+9647712345678')!;
    const wrong = (i: number) => String((Number(real) + 1 + i) % 1_000_000).padStart(6, '0');
    const results = await Promise.all(Array.from({ length: 20 }, (_, i) => code(h.service.verifyOtp({ phone: '07712345678', code: wrong(i) }))));
    expect(results.filter((r) => r === 'otp_invalid')).toHaveLength(4);
    expect(results.filter((r) => r === 'otp_locked')).toHaveLength(16);
    expect(h.repo.otps.at(-1)).toMatchObject({ attempts: 5 });
    expect(h.repo.otps.at(-1)!.lockedAt).not.toBeNull();
    expect(await code(h.service.verifyOtp({ phone: '07712345678', code: real }))).toBe('otp_locked');
  });

  it('two parallel right codes sign in once', async () => {
    const h = harness();
    await h.service.requestOtp({ phone: '07712345678', purpose: 'login' });
    const real = h.sms.lastCodeFor('+9647712345678')!;
    const results = await Promise.all([0, 1].map(() => code(h.service.verifyOtp({ phone: '07712345678', code: real }))));
    expect(results.sort()).toEqual([null, 'otp_not_found'].sort());
  });
});
