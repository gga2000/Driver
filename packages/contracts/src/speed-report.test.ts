import { describe, expect, it } from 'vitest';
import type { CrashFetch } from './crash-report.js';
import {
  buildSpeedEvent,
  createScreenSpeed,
  createSpeedReporter,
  noopSpeedReporter,
  parseSampleRate,
  processStartMs,
  routeName,
  type SpeedSample,
} from './speed-report.js';

const DSN = 'https://abc123@o42.ingest.de.sentry.io/4507';
const meta = { app: 'customer', environment: 'production', release: 'iq.driver.customer@0.1.0', os: 'android' };

function recorder() {
  const calls: Array<{ url: string; body: string }> = [];
  const fetch: CrashFetch = async (url, init) => {
    calls.push({ url, body: init.body });
  };
  return { calls, fetch };
}

const flush = () => new Promise((r) => setTimeout(r, 0));
const sample: SpeedSample = { name: 'restaurant/[id]', op: 'ui.load', source: 'route', startMs: 1_000_000, endMs: 1_000_420 };

describe('routeName', () => {
  it('keeps route patterns and never a concrete id', () => {
    expect(routeName(['(tabs)', 'orders'])).toBe('(tabs)/orders');
    expect(routeName(['restaurant', '[id]'])).toBe('restaurant/[id]');
    expect(routeName(['order', 'ord_8812734'])).toBe('order/[x]');
    expect(routeName(['places', '07701234567'])).toBe('places/[x]');
    expect(routeName(['مطعم'])).toBe('[x]');
    expect(routeName([])).toBe('index');
  });
});

describe('parseSampleRate', () => {
  it('reads 0–1 and falls back to 1 in 10', () => {
    expect(parseSampleRate('0.25')).toBe(0.25);
    expect(parseSampleRate(1)).toBe(1);
    expect(parseSampleRate('0')).toBe(0);
    for (const bad of [undefined, '', 'lots', '2', -1]) expect(parseSampleRate(bad)).toBe(0.1);
  });
});

describe('createSpeedReporter', () => {
  it('is a no-op without a DSN, with a malformed one, or when this session is not sampled', () => {
    const { fetch } = recorder();
    expect(createSpeedReporter({ ...meta, dsn: undefined, fetch })).toBe(noopSpeedReporter);
    expect(createSpeedReporter({ ...meta, dsn: 'nope', fetch })).toBe(noopSpeedReporter);
    expect(createSpeedReporter({ ...meta, dsn: DSN, fetch, sampleRate: 0.1, random: () => 0.5 })).toBe(noopSpeedReporter);
    expect(createSpeedReporter({ ...meta, dsn: DSN, fetch, sampleRate: 0, random: () => 0 })).toBe(noopSpeedReporter);
  });

  it('sends a Sentry transaction envelope with the measurement and no personal data', async () => {
    const { calls, fetch } = recorder();
    const r = createSpeedReporter({ ...meta, dsn: DSN, fetch, sampleRate: 1, random: () => 0, randomHex: (n) => 'a'.repeat(n * 2), now: () => new Date(1_000_500) });
    r.send({ ...sample, measurements: { screen_open: { value: 420, unit: 'millisecond' } } });
    await flush();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('https://o42.ingest.de.sentry.io/api/4507/envelope/?sentry_version=7&sentry_key=abc123&sentry_client=driver-customer%2Fiq.driver.customer%400.1.0');
    const [header, item, body] = calls[0]!.body.split('\n').map((l) => JSON.parse(l));
    expect(header).toMatchObject({ dsn: DSN, sent_at: new Date(1_000_500).toISOString() });
    expect(item).toEqual({ type: 'transaction' });
    expect(body).toMatchObject({
      type: 'transaction',
      transaction: 'restaurant/[id]',
      start_timestamp: 1000,
      timestamp: 1000.42,
      tags: { app: 'customer', os: 'android' },
      contexts: { trace: { op: 'ui.load', status: 'ok', trace_id: 'a'.repeat(32), span_id: 'a'.repeat(16) } },
      measurements: { screen_open: { value: 420, unit: 'millisecond' } },
    });
    expect(Object.keys(body)).not.toContain('user');
  });

  it('drops impossible spans and caps reports a minute', async () => {
    const { calls, fetch } = recorder();
    let t = 0;
    const r = createSpeedReporter({ ...meta, dsn: DSN, fetch, sampleRate: 1, random: () => 0, perMinute: 2, now: () => new Date(t) });
    r.send({ ...sample, endMs: sample.startMs - 1 });
    r.send({ ...sample, endMs: sample.startMs + 10 * 60_000 });
    r.send(sample);
    r.send(sample);
    r.send(sample);
    await flush();
    expect(calls).toHaveLength(2);
    t = 61_000;
    r.send(sample);
    await flush();
    expect(calls).toHaveLength(3);
  });

  it('never throws when the network fails', async () => {
    const r = createSpeedReporter({ ...meta, dsn: DSN, sampleRate: 1, random: () => 0, fetch: () => Promise.reject(new Error('offline')) });
    expect(() => r.send(sample)).not.toThrow();
    await flush();
  });
});

describe('buildSpeedEvent', () => {
  it('adds sample tags after the app tags', () => {
    const e = buildSpeedEvent({ ...sample, tags: { first_screen: '(tabs)' } }, meta, { eventId: 'e', traceId: 't', spanId: 's' });
    expect(e.tags).toEqual({ app: 'customer', os: 'android', first_screen: '(tabs)' });
    expect(e.spans).toEqual([]);
  });
});

describe('processStartMs', () => {
  it('prefers React Native’s native start mark', () => {
    expect(processStartMs({ performance: { now: () => 900, timeOrigin: 10_000, rnStartupTiming: { startTime: 50 } } })).toBe(10_050);
  });
  it('uses the time origin on the web and gives up elsewhere', () => {
    expect(processStartMs({ document: {}, performance: { now: () => 900, timeOrigin: 10_000 } })).toBe(10_000);
    expect(processStartMs({ performance: { now: () => 900, timeOrigin: 10_000 } })).toBeNull();
    expect(processStartMs({})).toBeNull();
    const throwing = { performance: { now: () => 1, timeOrigin: 5, get rnStartupTiming(): never { throw new Error('no module'); } } };
    expect(processStartMs(throwing)).toBeNull();
  });
});

describe('createScreenSpeed', () => {
  function harness() {
    const frames: Array<() => void> = [];
    const sent: SpeedSample[] = [];
    const reporter = { enabled: true, send: (s: SpeedSample) => sent.push(s) };
    const target = {
      requestAnimationFrame: (cb: () => void) => frames.push(cb),
      performance: { now: () => 0, timeOrigin: Date.now() - 1500, rnStartupTiming: { startTime: 100 }, memory: { usedJSHeapSize: 31.4 * 1048576 } },
    };
    const paint = () => {
      for (let i = 0; i < 2; i++) frames.splice(0).forEach((f) => f());
    };
    return { sent, speed: createScreenSpeed(reporter, target), paint };
  }

  it('reports the app start once, on the first screen, with the JS heap', () => {
    const { sent, speed, paint } = harness();
    speed.onRoute(['(tabs)']);
    paint();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ name: 'app start', op: 'app.start.cold', tags: { first_screen: '(tabs)' }, measurements: { js_heap: { value: 31.4, unit: 'megabyte' } } });
    const ms = sent[0]!.measurements!.app_start_cold!.value;
    expect(ms).toBeGreaterThanOrEqual(1400);
    expect(ms).toBeLessThan(2000);
  });

  it('times a screen from the navigation, skips repeats and screens left before they drew', () => {
    const { sent, speed, paint } = harness();
    speed.onRoute(['(tabs)']);
    paint();
    speed.onNavigate();
    speed.onRoute(['restaurant', '[id]']);
    speed.onRoute(['restaurant', '[id]']);
    paint();
    expect(sent.map((s) => s.name)).toEqual(['app start', 'restaurant/[id]']);
    expect(sent[1]).toMatchObject({ op: 'ui.load', source: 'route' });
    speed.onRoute(['cart']);
    speed.onRoute(['checkout']);
    paint();
    expect(sent.map((s) => s.name)).toEqual(['app start', 'restaurant/[id]', 'checkout']);
  });

  it('does nothing when the reporter is off', () => {
    const speed = createScreenSpeed(noopSpeedReporter, {});
    expect(() => {
      speed.onNavigate();
      speed.onRoute(['x']);
    }).not.toThrow();
  });
});
