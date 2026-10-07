import { describe, expect, it } from 'vitest';
import {
  buildCrashEvent,
  createCrashReporter,
  envelopeEndpoint,
  installCrashHandlers,
  noopCrashReporter,
  parseSentryDsn,
  scrubExtra,
  scrubText,
  type CrashFetch,
} from './crash-report.js';

const DSN = 'https://abc123@o42.ingest.de.sentry.io/4507';
const meta = { app: 'customer', environment: 'production', release: 'iq.driver.customer@0.1.0', os: 'android' };

function recorder() {
  const calls: Array<{ url: string; headers: Record<string, string>; body: string }> = [];
  const fetch: CrashFetch = async (url, init) => {
    calls.push({ url, headers: init.headers, body: init.body });
  };
  return { calls, fetch };
}

describe('parseSentryDsn (the same answers as the API reporter)', () => {
  it('turns a DSN into the envelope endpoint', () => {
    expect(parseSentryDsn(DSN)).toEqual({ envelopeUrl: 'https://o42.ingest.de.sentry.io/api/4507/envelope/', publicKey: 'abc123', dsn: DSN });
  });

  it('keeps a path prefix, a port and a legacy secret out of the key', () => {
    expect(parseSentryDsn('https://k:secret@sentry.example.iq:9000/sub/7')).toMatchObject({
      envelopeUrl: 'https://sentry.example.iq:9000/sub/api/7/envelope/',
      publicKey: 'k',
    });
  });

  it('refuses malformed DSNs', () => {
    for (const bad of ['', 'not a dsn', 'https://sentry.io/1', 'https://k@sentry.io/', 'https://k@sentry.io/abc', 'ftp://k@sentry.io/1']) {
      expect(parseSentryDsn(bad)).toBeNull();
    }
  });
});

describe('scrubbing (personal data never leaves the device)', () => {
  it('removes Iraqi phone numbers in every common shape', () => {
    for (const phone of ['07701112233', '0770 111 2233', '0770-111-2233', '+9647701112233', '+964 770 111 2233', '009647701112233', '9647701112233', '٠٧٧٠١١١٢٢٣٣']) {
      const out = scrubText(`no answer from ${phone} today`);
      expect(out).toBe('no answer from [phone] today');
    }
  });

  it('removes OTP-looking 4–6 digit codes from messages', () => {
    expect(scrubText('رمز التحقق 482913 غلط')).toBe('رمز التحقق [code] غلط');
    expect(scrubText('PIN 1234 wrong')).toBe('PIN [code] wrong');
    expect(scrubText('Error: 9876')).toBe('Error: [code]');
    // short numbers and words with digits stay
    expect(scrubText('HTTP 500 at step 3, id abc12345')).toBe('HTTP 500 at step 3, id abc12345');
  });

  it('keeps line:column numbers in a stack but not a code in its first line', () => {
    const stack = 'Error: code 4821 rejected\n    at submit (index.bundle:1:23456)\n    at http://x/app.js:10234:17';
    const out = scrubText(stack, 'stack');
    expect(out).toContain('code [redacted] rejected'.replace('[redacted]', '[code]'));
    expect(out).toContain('index.bundle:1:23456');
    expect(out).toContain('app.js:10234:17');
  });

  it('removes tokens, Authorization values, query secrets and emails', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.c2lnbmF0dXJlLXZhbHVl';
    expect(scrubText(`Authorization: Bearer ${jwt}`)).not.toContain('eyJ');
    expect(scrubText('authorization=Bearer abcdef123456')).not.toContain('abcdef123456');
    expect(scrubText('GET /trpc?accessToken=s3cr3t-value&x=1')).toBe('GET /trpc?accessToken=[redacted]&x=1');
    expect(scrubText('{"refresh_token":"r-123-xyz","otp":"5521"}')).toBe('{"refresh_token":"[redacted]","otp":"[redacted]"}');
    expect(scrubText('mail ali@example.com now')).toBe('mail [email] now');
  });

  it('extra keeps only short primitives under safe keys', () => {
    expect(
      scrubExtra({ screen: 'checkout 0770 111 2233', attempt: 2, online: true, user: { name: 'علي' }, name: 'علي', phone: '07701112233', requestBody: '{}', authToken: 'x', childName: 'زينب' }),
    ).toEqual({ screen: 'checkout [phone]', attempt: 2, online: true });
  });
});

describe('the envelope', () => {
  it('has the header, the item and an event with no user, request or person id', () => {
    const err = new TypeError('cannot read seat for 0770 111 2233');
    const event = buildCrashEvent(err, { logger: 'boundary', extra: { route: '/rajaa' } }, meta, 'a'.repeat(32), new Date('2026-10-07T10:00:00Z'));
    expect(event).toMatchObject({
      event_id: 'a'.repeat(32),
      timestamp: Date.parse('2026-10-07T10:00:00Z') / 1000,
      platform: 'javascript',
      level: 'fatal',
      logger: 'boundary',
      environment: 'production',
      release: 'iq.driver.customer@0.1.0',
      tags: { app: 'customer', os: 'android', handled: 'no' },
      exception: { values: [{ type: 'TypeError', value: 'cannot read seat for [phone]', mechanism: { type: 'boundary', handled: false } }] },
      extra: { route: '/rajaa' },
    });
    expect(event).not.toHaveProperty('user');
    expect(event).not.toHaveProperty('request');
    expect(event).not.toHaveProperty('breadcrumbs');
    expect(String(event.extra['stack'])).not.toContain('0770');
  });

  it('never serializes a thrown object', () => {
    const event = buildCrashEvent({ user: { phone: '07701112233' } }, {}, meta, 'b'.repeat(32), new Date());
    expect(JSON.stringify(event)).not.toContain('0770');
    expect(event.exception.values[0]!.value).toBe('Non-Error object thrown');
  });

  it('is posted as text/plain with the key in the query string', async () => {
    const { calls, fetch } = recorder();
    const r = createCrashReporter({ ...meta, dsn: DSN, fetch, now: () => new Date('2026-10-07T10:00:00Z'), randomId: () => 'c'.repeat(32) });
    expect(r.enabled).toBe(true);
    r.capture(new Error('boom'));
    await r.flush();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(envelopeEndpoint(parseSentryDsn(DSN)!, 'driver-customer/iq.driver.customer@0.1.0'));
    expect(calls[0]!.url).toContain('sentry_key=abc123');
    expect(calls[0]!.headers).toEqual({ 'content-type': 'text/plain;charset=UTF-8' });
    const [header, item, event] = calls[0]!.body.split('\n').map((l) => JSON.parse(l));
    expect(header).toEqual({ event_id: 'c'.repeat(32), sent_at: '2026-10-07T10:00:00.000Z', dsn: DSN });
    expect(item).toEqual({ type: 'event' });
    expect(event).toMatchObject({ event_id: 'c'.repeat(32), exception: { values: [{ type: 'Error', value: 'boom' }] } });
  });
});

describe('the reporter', () => {
  it('is a no-op without a DSN or with a malformed one', () => {
    expect(createCrashReporter({ ...meta, dsn: undefined })).toBe(noopCrashReporter);
    expect(createCrashReporter({ ...meta, dsn: '  ' })).toBe(noopCrashReporter);
    expect(createCrashReporter({ ...meta, dsn: 'not a dsn' })).toBe(noopCrashReporter);
    const target = { ErrorUtils: { getGlobalHandler: () => undefined, setGlobalHandler: () => { throw new Error('should not install'); } } };
    expect(() => installCrashHandlers(noopCrashReporter, { target })).not.toThrow();
  });

  it('sends at most N a minute, then again after the minute', async () => {
    const { calls, fetch } = recorder();
    let t = Date.parse('2026-10-07T10:00:00Z');
    const r = createCrashReporter({ ...meta, dsn: DSN, fetch, now: () => new Date(t), perMinute: 10 });
    for (let i = 0; i < 25; i++) r.capture(new Error(`loop ${i}`));
    await r.flush();
    expect(calls).toHaveLength(10);
    t += 60_000;
    r.capture(new Error('later'));
    await r.flush();
    expect(calls).toHaveLength(11);
  });

  it('reports the same error object once', async () => {
    const { calls, fetch } = recorder();
    const r = createCrashReporter({ ...meta, dsn: DSN, fetch });
    const e = new Error('twice');
    r.capture(e, { logger: 'boundary' });
    r.capture(e, { logger: 'global' });
    await r.flush();
    expect(calls).toHaveLength(1);
  });

  it('a failing endpoint never throws into the app', async () => {
    const r = createCrashReporter({ ...meta, dsn: DSN, fetch: async () => { throw new Error('offline'); } });
    expect(() => r.capture(new Error('x'))).not.toThrow();
    await expect(r.flush()).resolves.toBeUndefined();
  });
});

describe('installCrashHandlers', () => {
  it('chains to the previous ErrorUtils handler and can be undone', async () => {
    const { calls, fetch } = recorder();
    const r = createCrashReporter({ ...meta, dsn: DSN, fetch });
    const seen: unknown[] = [];
    const previous = (e: unknown) => seen.push(e);
    let handler: (e: unknown, fatal?: boolean) => void = previous;
    const target = { ErrorUtils: { getGlobalHandler: () => handler, setGlobalHandler: (h: typeof handler) => (handler = h) } };
    const undo = installCrashHandlers(r, { target });
    const err = new Error('render');
    handler(err, true);
    await r.flush();
    expect(calls).toHaveLength(1);
    expect(seen).toEqual([err]);
    undo();
    expect(handler).toBe(previous);
  });

  it('listens to window error and unhandledrejection, and Hermes rejections when asked', async () => {
    const { calls, fetch } = recorder();
    const r = createCrashReporter({ ...meta, dsn: DSN, fetch });
    const listeners = new Map<string, (e: unknown) => void>();
    let tracker: { onUnhandled: (id: number, reason: unknown) => void } | undefined;
    const target = {
      addEventListener: (type: string, l: (e: unknown) => void) => listeners.set(type, l),
      removeEventListener: (type: string) => listeners.delete(type),
      HermesInternal: { enablePromiseRejectionTracker: (o: { onUnhandled: (id: number, reason: unknown) => void }) => (tracker = o) },
    };
    const undo = installCrashHandlers(r, { target, hermesRejections: true });
    listeners.get('error')!({ error: new Error('a') });
    listeners.get('unhandledrejection')!({ reason: new Error('b') });
    tracker!.onUnhandled(1, new Error('c'));
    await r.flush();
    expect(calls.map((c) => JSON.parse(c.body.split('\n')[2]!).exception.values[0].value)).toEqual(['a', 'b', 'c']);
    undo();
    expect(listeners.size).toBe(0);
  });
});
