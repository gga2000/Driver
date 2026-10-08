import { createHmac, generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { FetchLike, HttpRequest } from '../../shared/messaging/http.js';
import { HttpSmsProvider, httpSmsConfigFromEnv, smsPortFromEnv, TwilioSmsProvider, DevSmsProvider, formatNumber } from '../../shared/messaging/sms.js';
import { DevPushProvider, ExpoPushProvider, FcmPushProvider, pushPortsFromEnv, UnconfiguredPushProvider, type PushMessage } from './providers/push.js';
import { cloudTemplateBody, DevWhatsAppProvider, parseStatusWebhook, verifyWebhookSignature, WhatsAppCloudProvider, whatsAppPortFromEnv } from './providers/whatsapp.js';

/** Records requests; answers from a script (one response per call, the last one repeats). */
function fakeFetch(...responses: Array<{ status: number; body: unknown } | ((url: string, init: HttpRequest) => { status: number; body: unknown })>) {
  const calls: Array<{ url: string; init: HttpRequest; json: unknown }> = [];
  const fetchImpl: FetchLike = async (url, init) => {
    let json: unknown = null;
    try {
      json = init.body ? JSON.parse(init.body) : null;
    } catch {
      json = null;
    }
    calls.push({ url, init, json });
    const r = responses[Math.min(calls.length - 1, responses.length - 1)]!;
    const res = typeof r === 'function' ? r(url, init) : r;
    return { status: res.status, text: async () => (typeof res.body === 'string' ? res.body : JSON.stringify(res.body)) };
  };
  return { fetchImpl, calls };
}

const msg = (token: string, extra: Partial<PushMessage> = {}): PushMessage => ({ token, title: 'طلب جديد!', body: '#A1 · 3 صنف', data: { orderId: 'o1' }, channelId: 'offers', sound: 'offer.wav', priority: 'high', ...extra });

describe('Expo push', () => {
  it('posts batches of 100 with the access token and maps tickets in order', async () => {
    const f = fakeFetch((_url, init) => {
      const batch = JSON.parse(init.body!) as Array<{ to: string }>;
      return { status: 200, body: { data: batch.map((m, i) => (m.to === 'ExponentPushToken[dead]' ? { status: 'error', message: 'not registered', details: { error: 'DeviceNotRegistered' } } : { status: 'ok', id: `tk-${i}` })) } };
    });
    const expo = new ExpoPushProvider({ accessToken: 'secret', baseUrl: 'https://exp.host' }, f.fetchImpl);
    const tokens = Array.from({ length: 150 }, (_, i) => (i === 120 ? 'ExponentPushToken[dead]' : `ExponentPushToken[${i}]`));
    const tickets = await expo.send(tokens.map((t) => msg(t, { ttlSec: 120 })));
    expect(f.calls).toHaveLength(2);
    expect(f.calls[0]!.url).toBe('https://exp.host/--/api/v2/push/send');
    expect(f.calls[0]!.init.headers).toMatchObject({ authorization: 'Bearer secret', 'content-type': 'application/json', accept: 'application/json' });
    expect((f.calls[0]!.json as unknown[]).length).toBe(100);
    expect((f.calls[1]!.json as unknown[]).length).toBe(50);
    expect((f.calls[0]!.json as unknown[])[0]).toEqual({ to: 'ExponentPushToken[0]', title: 'طلب جديد!', body: '#A1 · 3 صنف', data: { orderId: 'o1' }, channelId: 'offers', sound: 'offer.wav', priority: 'high', ttl: 120 });
    expect(tickets).toHaveLength(150);
    expect(tickets[120]).toEqual({ token: 'ExponentPushToken[dead]', ok: false, id: null, error: 'DeviceNotRegistered', invalidToken: true });
    expect(tickets[0]).toEqual({ token: 'ExponentPushToken[0]', ok: true, id: 'tk-0' });
  });

  it('polls receipts by id and flags dead tokens; leaves pending ids out', async () => {
    const f = fakeFetch({ status: 200, body: { data: { a: { status: 'ok' }, b: { status: 'error', message: 'gone', details: { error: 'DeviceNotRegistered' } } } } });
    const expo = new ExpoPushProvider({ baseUrl: 'https://exp.host' }, f.fetchImpl);
    const receipts = await expo.receipts(['a', 'b', 'c']);
    expect(f.calls[0]!.url).toBe('https://exp.host/--/api/v2/push/getReceipts');
    expect(f.calls[0]!.json).toEqual({ ids: ['a', 'b', 'c'] });
    expect(f.calls[0]!.init.headers['authorization']).toBeUndefined();
    expect(receipts).toEqual([
      { id: 'a', ok: true },
      { id: 'b', ok: false, error: 'DeviceNotRegistered', invalidToken: true },
    ]);
  });

  it('a 429 / 5xx is a retryable error, a 4xx is not', async () => {
    const busy = new ExpoPushProvider({ baseUrl: 'https://exp.host' }, fakeFetch({ status: 429, body: { errors: [{ code: 'TOO_MANY_REQUESTS', message: 'slow' }] } }).fetchImpl);
    await expect(busy.send([msg('ExponentPushToken[x]')])).rejects.toMatchObject({ permanent: false, code: 'TOO_MANY_REQUESTS' });
    const bad = new ExpoPushProvider({ baseUrl: 'https://exp.host' }, fakeFetch({ status: 401, body: { errors: [{ code: 'UNAUTHORIZED', message: 'token' }] } }).fetchImpl);
    await expect(bad.send([msg('ExponentPushToken[x]')])).rejects.toMatchObject({ permanent: true });
    const down = new ExpoPushProvider({ baseUrl: 'https://exp.host' }, async () => {
      throw new Error('ECONNRESET');
    });
    await expect(down.send([msg('ExponentPushToken[x]')])).rejects.toMatchObject({ permanent: false, code: 'network' });
  });
});

describe('data-only push (the الرجعة lock-screen card, d-8 follow-up)', () => {
  it('Expo: no title, body or sound — only data, high priority and content-available', async () => {
    const f = fakeFetch({ status: 200, body: { data: [{ status: 'ok', id: 'tk-1' }] } });
    await new ExpoPushProvider({ baseUrl: 'https://exp.host' }, f.fetchImpl).send([msg('ExponentPushToken[1]', { silent: true, data: { kind: 'rajaa_pass_update' } })]);
    expect((f.calls[0]!.json as unknown[])[0]).toEqual({ to: 'ExponentPushToken[1]', data: { kind: 'rajaa_pass_update' }, priority: 'high', _contentAvailable: true });
  });

  it('FCM: a data message, no notification block', async () => {
    const f = fakeFetch({ status: 200, body: { name: 'projects/p/messages/1' } });
    await new FcmPushProvider({ projectId: 'p', accessToken: 'at', baseUrl: 'https://fcm.googleapis.com', tokenUrl: 'https://oauth2.googleapis.com/token' }, f.fetchImpl).send([msg('fcm-1', { silent: true, data: { kind: 'rajaa_pass_update' } })]);
    const m = (f.calls[0]!.json as { message: Record<string, unknown> }).message;
    expect(m['notification']).toBeUndefined();
    expect(m).toMatchObject({ token: 'fcm-1', data: { kind: 'rajaa_pass_update' }, android: { priority: 'HIGH' }, apns: { payload: { aps: { 'content-available': 1 } } } });
    expect((m['android'] as Record<string, unknown>)['notification']).toBeUndefined();
  });
});

describe('FCM HTTP v1', () => {
  it('exchanges a service-account JWT once and sends one v1 message per token', async () => {
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    const f = fakeFetch((url) => (url.includes('oauth2') ? { status: 200, body: { access_token: 'ya29.x', expires_in: 3600 } } : url.endsWith('dead') ? { status: 404, body: {} } : { status: 200, body: { name: 'projects/p/messages/1' } }));
    const fcm = new FcmPushProvider({ projectId: 'driver-iq', serviceAccount: { client_email: 'push@driver-iq.iam.gserviceaccount.com', private_key: pem }, baseUrl: 'https://fcm.googleapis.com', tokenUrl: 'https://oauth2.googleapis.com/token' }, f.fetchImpl, () => 1_790_000_000_000);
    const tickets = await fcm.send([msg('fcm-a'), msg('fcm-b', { sound: null, priority: 'normal' })]);
    expect(f.calls.map((c) => c.url)).toEqual(['https://oauth2.googleapis.com/token', 'https://fcm.googleapis.com/v1/projects/driver-iq/messages:send', 'https://fcm.googleapis.com/v1/projects/driver-iq/messages:send']);
    expect(f.calls[0]!.init.body).toContain('grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer');
    expect(f.calls[1]!.init.headers['authorization']).toBe('Bearer ya29.x');
    expect(f.calls[1]!.json).toEqual({
      message: {
        token: 'fcm-a',
        notification: { title: 'طلب جديد!', body: '#A1 · 3 صنف' },
        data: { orderId: 'o1' },
        android: { priority: 'HIGH', notification: { channel_id: 'offers', sound: 'offer.wav' } },
        apns: { headers: { 'apns-priority': '10' }, payload: { aps: { sound: 'offer.wav' } } },
      },
    });
    expect(tickets.map((t) => t.ok)).toEqual([true, true]);
    expect(fcm.hasReceipts).toBe(false);
    await fcm.send([msg('fcm-c')]);
    expect(f.calls.filter((c) => c.url.includes('oauth2'))).toHaveLength(1);
  });

  it('marks UNREGISTERED tokens invalid', async () => {
    const f = fakeFetch({ status: 404, body: { error: { status: 'NOT_FOUND', message: 'Requested entity was not found.', details: [{ errorCode: 'UNREGISTERED' }] } } });
    const fcm = new FcmPushProvider({ projectId: 'p', accessToken: 'static', baseUrl: 'https://fcm.googleapis.com', tokenUrl: 'x' }, f.fetchImpl);
    expect(await fcm.send([msg('fcm-x')])).toEqual([{ token: 'fcm-x', ok: false, id: null, error: 'UNREGISTERED', invalidToken: true }]);
  });
});

describe('WhatsApp Cloud API', () => {
  it('sends a template message with Arabic body parameters', async () => {
    const f = fakeFetch({ status: 200, body: { messaging_product: 'whatsapp', contacts: [{ wa_id: '9647701110001' }], messages: [{ id: 'wamid.HBg' }] } });
    const wa = new WhatsAppCloudProvider({ token: 'EAAG', phoneNumberId: '1234567890', apiVersion: 'v21.0', baseUrl: 'https://graph.facebook.com', statusCallbacks: true }, f.fetchImpl);
    const res = await wa.send({ to: '+9647701110001', template: 'khat_child_arrived', language: 'ar', params: ['زينب', 'مدرسة الرافدين', '7:40'] });
    expect(res).toEqual({ provider: 'meta', messageId: 'wamid.HBg' });
    expect(f.calls[0]!.url).toBe('https://graph.facebook.com/v21.0/1234567890/messages');
    expect(f.calls[0]!.init.headers).toMatchObject({ authorization: 'Bearer EAAG', 'content-type': 'application/json' });
    expect(f.calls[0]!.json).toEqual({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: '9647701110001',
      type: 'template',
      template: {
        name: 'khat_child_arrived',
        language: { code: 'ar' },
        components: [{ type: 'body', parameters: [{ type: 'text', text: 'زينب' }, { type: 'text', text: 'مدرسة الرافدين' }, { type: 'text', text: '7:40' }] }],
      },
    });
    expect(cloudTemplateBody({ to: '+964', template: 't', language: 'en', params: [] })).toMatchObject({ template: { components: [] } });
  });

  it('maps Meta errors: not on WhatsApp is permanent, rate limits retry', async () => {
    const notOnWa = new WhatsAppCloudProvider({ token: 't', phoneNumberId: 'p', apiVersion: 'v21.0', baseUrl: 'https://g', statusCallbacks: false }, fakeFetch({ status: 400, body: { error: { code: 131026, message: 'Message undeliverable' } } }).fetchImpl);
    await expect(notOnWa.send({ to: '+9647', template: 'x', language: 'ar', params: [] })).rejects.toMatchObject({ permanent: true, invalidRecipient: true, code: 'wa_131026' });
    const limited = new WhatsAppCloudProvider({ token: 't', phoneNumberId: 'p', apiVersion: 'v21.0', baseUrl: 'https://g', statusCallbacks: false }, fakeFetch({ status: 400, body: { error: { code: 131056, message: 'pair rate limit' } } }).fetchImpl);
    await expect(limited.send({ to: '+9647', template: 'x', language: 'ar', params: [] })).rejects.toMatchObject({ permanent: false, code: 'wa_131056' });
    const noTemplate = new WhatsAppCloudProvider({ token: 't', phoneNumberId: 'p', apiVersion: 'v21.0', baseUrl: 'https://g', statusCallbacks: false }, fakeFetch({ status: 404, body: { error: { code: 132001, message: 'Template name does not exist in the translation' } } }).fetchImpl);
    await expect(noTemplate.send({ to: '+9647', template: 'x', language: 'ar', params: [] })).rejects.toMatchObject({ permanent: true, invalidRecipient: false });
    const unset = new WhatsAppCloudProvider({ token: '', phoneNumberId: '', apiVersion: 'v21.0', baseUrl: 'https://g', statusCallbacks: false });
    await expect(unset.send({ to: '+9647', template: 'x', language: 'ar', params: [] })).rejects.toMatchObject({ code: 'not_configured', permanent: true });
  });

  it('verifies webhook signatures and reads statuses', () => {
    const body = JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [{ id: 'WABA', changes: [{ field: 'messages', value: { statuses: [{ id: 'wamid.1', status: 'delivered', timestamp: '1790000000', recipient_id: '9647701110001' }, { id: 'wamid.2', status: 'failed', timestamp: '1790000001', errors: [{ code: 131026, title: 'Message undeliverable' }] }] } }] }],
    });
    const sig = `sha256=${createHmac('sha256', 'app-secret').update(body).digest('hex')}`;
    expect(verifyWebhookSignature(body, sig, 'app-secret')).toBe(true);
    expect(verifyWebhookSignature(body, sig, 'other')).toBe(false);
    expect(verifyWebhookSignature(body, undefined, 'app-secret')).toBe(false);
    expect(parseStatusWebhook(JSON.parse(body))).toEqual([
      { messageId: 'wamid.1', status: 'delivered', at: new Date(1_790_000_000_000), error: null },
      { messageId: 'wamid.2', status: 'failed', at: new Date(1_790_000_001_000), error: 'wa_131026: Message undeliverable' },
    ]);
  });
});

describe('SMS providers', () => {
  it('generic HTTP gateway: JSON POST with auth header, sender id and number format', async () => {
    const f = fakeFetch({ status: 200, body: { data: { id: 'msg-77' }, status: 'queued' } });
    const sms = new HttpSmsProvider(
      httpSmsConfigFromEnv({
        SMS_HTTP_URL: 'https://sms.example.iq/api/send',
        SMS_HTTP_AUTH_HEADER: 'X-API-Key: k-123',
        SMS_SENDER_ID: 'Driver',
        SMS_HTTP_NUMBER_FORMAT: 'digits',
        SMS_HTTP_BODY: '{"recipient":"{to}","message":"{text}","from":"{sender}"}',
        SMS_HTTP_ID_PATH: 'data.id',
        SMS_HTTP_SUCCESS_REGEX: 'queued|sent',
      }),
      f.fetchImpl,
    );
    expect(await sms.send({ to: '+9647701234567', body: 'رمز دخول درايفر: 123456 "x"' })).toEqual({ provider: 'http', messageId: 'msg-77' });
    expect(f.calls[0]!.init).toMatchObject({ method: 'POST', headers: { 'X-API-Key': 'k-123', 'content-type': 'application/json' } });
    expect(f.calls[0]!.json).toEqual({ recipient: '9647701234567', message: 'رمز دخول درايفر: 123456 "x"', from: 'Driver' });
  });

  it('generic HTTP gateway: GET with URL-encoded params; failures by status and pattern', async () => {
    const f = fakeFetch({ status: 200, body: 'OK:1' }, { status: 200, body: 'ERR:balance' }, { status: 503, body: 'down' }, { status: 400, body: 'bad number' });
    const sms = new HttpSmsProvider(httpSmsConfigFromEnv({ SMS_HTTP_URL: 'https://gw.example.iq/send?u=driver&to={to}&msg={text}&sid={sender}', SMS_HTTP_METHOD: 'GET', SMS_SENDER_ID: 'Driver', SMS_HTTP_NUMBER_FORMAT: 'local', SMS_HTTP_SUCCESS_REGEX: '^OK' }), f.fetchImpl);
    await sms.send({ to: '+9647701234567', body: 'هلا علي' });
    expect(f.calls[0]!.url).toBe(`https://gw.example.iq/send?u=driver&to=07701234567&msg=${encodeURIComponent('هلا علي')}&sid=Driver`);
    expect(f.calls[0]!.init.body).toBeUndefined();
    await expect(sms.send({ to: '+9647701234567', body: 'x' })).rejects.toMatchObject({ code: 'rejected', permanent: false });
    await expect(sms.send({ to: '+9647701234567', body: 'x' })).rejects.toMatchObject({ code: 'http_503', permanent: false });
    await expect(sms.send({ to: '+9647701234567', body: 'x' })).rejects.toMatchObject({ code: 'http_400', permanent: true });
  });

  it('keeps the old SMS_PROVIDER=gateway / SMS_GATEWAY_* names working', () => {
    const cfg = httpSmsConfigFromEnv({ SMS_GATEWAY_URL: 'https://old.example/send', SMS_GATEWAY_KEY: 'k' });
    expect(cfg).toMatchObject({ url: 'https://old.example/send', authHeader: 'Authorization: Bearer k', method: 'POST', numberFormat: 'e164' });
    expect(smsPortFromEnv({ SMS_PROVIDER: 'gateway', SMS_GATEWAY_URL: 'https://old.example/send' })).toBeInstanceOf(HttpSmsProvider);
    expect(smsPortFromEnv({ SMS_PROVIDER: 'fake' }, { log: false })).toBeInstanceOf(DevSmsProvider);
    expect(smsPortFromEnv({}, { log: false })).toBeInstanceOf(DevSmsProvider);
    expect(smsPortFromEnv({ SMS_PROVIDER: 'twilio' })).toBeInstanceOf(TwilioSmsProvider);
    expect(formatNumber('+9647701234567', 'e164')).toBe('+9647701234567');
  });

  it('Twilio-compatible: form-encoded POST with Basic auth; invalid numbers are permanent', async () => {
    const f = fakeFetch({ status: 201, body: { sid: 'SM123', status: 'queued' } }, { status: 400, body: { code: 21211, message: "The 'To' number is not a valid phone number." } });
    const sms = new TwilioSmsProvider({ accountSid: 'AC1', authToken: 'tok', from: 'Driver', baseUrl: 'https://api.twilio.com' }, f.fetchImpl);
    expect(await sms.send({ to: '+9647701234567', body: 'رمز: 1' })).toEqual({ provider: 'twilio', messageId: 'SM123' });
    expect(f.calls[0]!.url).toBe('https://api.twilio.com/2010-04-01/Accounts/AC1/Messages.json');
    expect(f.calls[0]!.init.headers).toMatchObject({ authorization: `Basic ${Buffer.from('AC1:tok').toString('base64')}`, 'content-type': 'application/x-www-form-urlencoded' });
    expect(Object.fromEntries(new URLSearchParams(f.calls[0]!.init.body!))).toEqual({ To: '+9647701234567', Body: 'رمز: 1', From: 'Driver' });
    await expect(sms.send({ to: '+9640', body: 'x' })).rejects.toMatchObject({ code: 'twilio_21211', permanent: true, invalidRecipient: true });
  });
});

describe('provider selection by env', () => {
  it('defaults to dev providers that log', () => {
    const push = pushPortsFromEnv({}, { log: false });
    expect(push.expo).toBeInstanceOf(DevPushProvider);
    expect(push.fcm).toBeInstanceOf(DevPushProvider);
    expect(whatsAppPortFromEnv({}, { log: false })).toBeInstanceOf(DevWhatsAppProvider);
  });

  it('switches to Expo, FCM and Meta when their credentials are set', () => {
    const push = pushPortsFromEnv({ EXPO_ACCESS_TOKEN: 'x', FCM_PROJECT_ID: 'p', FCM_ACCESS_TOKEN: 'ya29' });
    expect(push.expo).toBeInstanceOf(ExpoPushProvider);
    expect(push.fcm).toBeInstanceOf(FcmPushProvider);
    expect(pushPortsFromEnv({ PUSH_PROVIDER: 'expo' }).expo).toBeInstanceOf(ExpoPushProvider);
    const wa = whatsAppPortFromEnv({ WHATSAPP_TOKEN: 't', WHATSAPP_PHONE_NUMBER_ID: '1', WHATSAPP_APP_SECRET: 's' });
    expect(wa).toBeInstanceOf(WhatsAppCloudProvider);
    expect(wa.statusCallbacks).toBe(true);
    expect(whatsAppPortFromEnv({ WHATSAPP_TOKEN: 't', WHATSAPP_PHONE_NUMBER_ID: '1' }).statusCallbacks).toBe(false);
  });

  it('OPS-02: a live host refuses to boot on the dev push; staging may keep it', () => {
    const live = { NODE_ENV: 'production' };
    expect(() => pushPortsFromEnv(live, { log: false })).toThrow(/PUSH_PROVIDER must be expo/);
    expect(() => pushPortsFromEnv({ ...live, PUSH_PROVIDER: 'dev' }, { log: false })).toThrow(/refusing to boot/);
    expect(() => pushPortsFromEnv({ ...live, DEPLOY_ENVIRONMENT: 'production', PUSH_PROVIDER: 'dev' }, { log: false })).toThrow(/refusing to boot/);
    expect(pushPortsFromEnv({ ...live, DEPLOY_ENVIRONMENT: 'staging' }, { log: false }).expo).toBeInstanceOf(DevPushProvider);
    expect(pushPortsFromEnv({ ...live, PUSH_PROVIDER: 'expo' }).expo).toBeInstanceOf(ExpoPushProvider);
  });

  it('OPS-02: on a live host a token with no transport fails instead of pretending it was delivered', async () => {
    const push = pushPortsFromEnv({ NODE_ENV: 'production', PUSH_PROVIDER: 'expo' });
    expect(push.fcm).toBeInstanceOf(UnconfiguredPushProvider);
    const msg: PushMessage = { token: 'fcm-token', title: 't', body: 'b', data: {}, channelId: 'orders', sound: 'default', priority: 'high' };
    expect(await push.fcm.send([msg])).toEqual([{ token: 'fcm-token', ok: false, id: null, error: 'push_not_configured' }]);
  });
});
