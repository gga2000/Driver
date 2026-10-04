import { describe, expect, it } from 'vitest';
import { errorReporterFromEnv, noopReporter, parseSentryDsn, type ErrorReporter } from './error-reporter.js';
import { AppLogger, logFormatFromEnv, logLevelsFromEnv } from './logging.js';

const NOW = new Date('2026-10-04T09:00:00Z');

function capture() {
  const lines: Array<Record<string, unknown>> = [];
  const errors: Array<{ error: unknown; logger?: string }> = [];
  const reporter: ErrorReporter = { enabled: true, capture: (error, ctx) => void errors.push({ error, logger: ctx?.logger }), flush: async () => undefined };
  const logger = new AppLogger('json', reporter, ['error', 'warn', 'log'], (l) => void lines.push(JSON.parse(l)), () => NOW);
  return { lines, errors, logger };
}

describe('AppLogger (json)', () => {
  it('writes one JSON object per entry with level, context and message', () => {
    const { lines, logger } = capture();
    logger.log('listening', 'Bootstrap');
    logger.warn('redis unavailable', 'BullMqQueueFactory');
    logger.debug('hidden at the default level', 'X');
    expect(lines).toEqual([
      { time: NOW.toISOString(), level: 'info', context: 'Bootstrap', msg: 'listening', service: 'driver-api' },
      { time: NOW.toISOString(), level: 'warn', context: 'BullMqQueueFactory', msg: 'redis unavailable', service: 'driver-api' },
    ]);
  });

  it('errors keep their stack and go to the error reporter', () => {
    const { lines, errors, logger } = capture();
    const stack = 'Error: boom\n    at handler (/app/dist/x.js:1:1)';
    logger.error('outbox drain failed: boom', stack, 'OutboxPublisher');
    expect(lines[0]).toMatchObject({ level: 'error', context: 'OutboxPublisher', msg: 'outbox drain failed: boom', stack });
    expect(errors).toHaveLength(1);
    expect((errors[0]!.error as Error).message).toBe('outbox drain failed: boom');
    expect((errors[0]!.error as Error).stack).toBe(stack);
    expect(errors[0]!.logger).toBe('OutboxPublisher');
  });

  it('format and levels from env: json in production, pretty elsewhere, LOG_FORMAT wins', () => {
    expect(logFormatFromEnv({ NODE_ENV: 'production' })).toBe('json');
    expect(logFormatFromEnv({})).toBe('pretty');
    expect(logFormatFromEnv({ NODE_ENV: 'production', LOG_FORMAT: 'pretty' })).toBe('pretty');
    expect(logLevelsFromEnv({ LOG_LEVEL: 'debug' })).toContain('debug');
    expect(logLevelsFromEnv({})).toEqual(['error', 'warn', 'log']);
  });
});

describe('error reporter (SENTRY_DSN)', () => {
  it('is a no-op without a DSN or with a malformed one', () => {
    expect(errorReporterFromEnv({})).toBe(noopReporter);
    expect(errorReporterFromEnv({ SENTRY_DSN: 'not a dsn' })).toBe(noopReporter);
  });

  it('parses the DSN into the envelope endpoint', () => {
    expect(parseSentryDsn('https://abc123@o42.ingest.de.sentry.io/4507')).toEqual({
      envelopeUrl: 'https://o42.ingest.de.sentry.io/api/4507/envelope/',
      publicKey: 'abc123',
      dsn: 'https://abc123@o42.ingest.de.sentry.io/4507',
    });
  });

  it('posts an envelope per error, rate-limited, and flushes on demand', async () => {
    const calls: Array<{ url: string; headers: Record<string, string>; body: string }> = [];
    const r = errorReporterFromEnv({ SENTRY_DSN: 'https://abc123@o42.ingest.de.sentry.io/4507', NODE_ENV: 'production' }, '0.1.0', async (url, init) => {
      calls.push({ url, headers: init.headers, body: init.body });
    });
    expect(r.enabled).toBe(true);
    for (let i = 0; i < 40; i++) r.capture(new Error(`boom ${i}`), { logger: 'Test' });
    await r.flush();
    expect(calls).toHaveLength(30); // 30 a minute, the rest dropped
    expect(calls[0]!.url).toBe('https://o42.ingest.de.sentry.io/api/4507/envelope/');
    expect(calls[0]!.headers['x-sentry-auth']).toContain('sentry_key=abc123');
    const [header, item, event] = calls[0]!.body.split('\n').map((l) => JSON.parse(l));
    expect(item).toEqual({ type: 'event' });
    expect(event).toMatchObject({ event_id: header.event_id, environment: 'production', release: '0.1.0', logger: 'Test', exception: { values: [{ type: 'Error', value: 'boom 0' }] } });
  });

  it('a failing endpoint never throws into the app', async () => {
    const r = errorReporterFromEnv({ SENTRY_DSN: 'https://k@sentry.example/1' }, '0.1.0', async () => {
      throw new Error('network down');
    });
    expect(() => r.capture(new Error('x'))).not.toThrow();
    await expect(r.flush()).resolves.toBeUndefined();
  });
});
