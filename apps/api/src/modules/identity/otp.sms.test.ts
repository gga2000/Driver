import { describe, expect, it } from 'vitest';
import { FakeClock } from '../../shared/clock.js';
import type { FetchLike } from '../../shared/messaging/http.js';
import { HttpSmsProvider, httpSmsConfigFromEnv } from '../../shared/messaging/sms.js';
import { InMemoryIdentityRepository } from './memory.repository.js';
import { OtpService } from './otp.service.js';
import { OtpGuard, RecordingOtpAlerts } from './rate-limit.js';
import { InMemoryWindowCounter } from '../../shared/window-counter.js';

const guard = () => new OtpGuard(new InMemoryWindowCounter(new FakeClock()), new RecordingOtpAlerts());

/** OTP codes go out through the shared SmsPort; gateway failures become Arabic error codes. */
describe('OTP over the SMS port', () => {
  const gateway = (status: number) => {
    const sent: Array<{ url: string; body: string }> = [];
    const fetchImpl: FetchLike = async (url, init) => {
      sent.push({ url, body: init.body ?? '' });
      return { status, text: async () => '{"id":"m1"}' };
    };
    const sms = new HttpSmsProvider(httpSmsConfigFromEnv({ SMS_HTTP_URL: 'https://sms.example.iq/send', SMS_SENDER_ID: 'Driver', SMS_HTTP_NUMBER_FORMAT: 'digits' }), fetchImpl);
    return { sms, sent };
  };

  it('sends the code through the configured HTTP gateway', async () => {
    const { sms, sent } = gateway(200);
    const otp = new OtpService(new InMemoryIdentityRepository(), sms, new FakeClock(), 'pepper', guard());
    await otp.request('+9647701234567', 'hash-1', 'login');
    expect(sent).toHaveLength(1);
    const body = JSON.parse(sent[0]!.body) as { to: string; text: string; sender: string };
    expect(body.to).toBe('9647701234567');
    expect(body.sender).toBe('Driver');
    expect(body.text).toMatch(/^رمز دخول درايفر: \d{6}$/);
  });

  it('a failing gateway is sms_send_failed; an unset one is sms_not_configured', async () => {
    const { sms } = gateway(503);
    await expect(new OtpService(new InMemoryIdentityRepository(), sms, new FakeClock(), 'p', guard()).request('+9647701234567', 'h', 'login')).rejects.toMatchObject({ code: 'sms_send_failed' });
    const unset = new HttpSmsProvider(httpSmsConfigFromEnv({}));
    await expect(new OtpService(new InMemoryIdentityRepository(), unset, new FakeClock(), 'p', guard()).request('+9647701234567', 'h', 'login')).rejects.toMatchObject({ code: 'sms_not_configured' });
  });
});
