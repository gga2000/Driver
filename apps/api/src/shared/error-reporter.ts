import { randomBytes } from 'node:crypto';
import { hostname } from 'node:os';

/**
 * Where unexpected errors go besides the log. With `SENTRY_DSN` unset (the default) it is a no-op;
 * with it set, errors are posted to Sentry's envelope endpoint over plain `fetch` — no SDK, so no
 * dependency and nothing runs unless configured (docs/deploy/hosting.md, "Logs and errors").
 */
export interface ErrorReporter {
  readonly enabled: boolean;
  capture(error: unknown, context?: { logger?: string; extra?: Record<string, unknown> }): void;
  /** Waits (at most `timeoutMs`) for reports still in flight; called on shutdown. */
  flush(timeoutMs?: number): Promise<void>;
}

export const noopReporter: ErrorReporter = { enabled: false, capture: () => undefined, flush: async () => undefined };

interface ParsedDsn {
  envelopeUrl: string;
  publicKey: string;
  dsn: string;
}

/** `https://<key>@<host>[/<path>]/<projectId>` → the project's envelope endpoint. Null when malformed. */
export function parseSentryDsn(dsn: string): ParsedDsn | null {
  try {
    const u = new URL(dsn);
    const parts = u.pathname.split('/').filter(Boolean);
    const projectId = parts.pop();
    if (!u.username || !projectId || !/^\d+$/.test(projectId)) return null;
    const prefix = parts.length ? `/${parts.join('/')}` : '';
    return { envelopeUrl: `${u.protocol}//${u.host}${prefix}/api/${projectId}/envelope/`, publicKey: u.username, dsn };
  } catch {
    return null;
  }
}

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<unknown>;

export interface SentryReporterOptions {
  environment: string;
  release: string;
  /** At most this many reports per minute; the rest are dropped (a crash loop must not flood). */
  perMinute?: number;
  fetch?: FetchLike;
  now?: () => Date;
}

export class SentryReporter implements ErrorReporter {
  readonly enabled = true;
  private readonly inFlight = new Set<Promise<unknown>>();
  private windowStart = 0;
  private sentInWindow = 0;

  constructor(
    private readonly dsn: ParsedDsn,
    private readonly opts: SentryReporterOptions,
  ) {}

  capture(error: unknown, context: { logger?: string; extra?: Record<string, unknown> } = {}): void {
    const now = (this.opts.now ?? (() => new Date()))();
    if (now.getTime() - this.windowStart >= 60_000) {
      this.windowStart = now.getTime();
      this.sentInWindow = 0;
    }
    if (this.sentInWindow >= (this.opts.perMinute ?? 30)) return;
    this.sentInWindow += 1;

    const err = error instanceof Error ? error : new Error(typeof error === 'string' ? error : JSON.stringify(error));
    const eventId = randomBytes(16).toString('hex');
    const event = {
      event_id: eventId,
      timestamp: now.getTime() / 1000,
      platform: 'node',
      level: 'error',
      logger: context.logger ?? 'driver-api',
      server_name: hostname(),
      environment: this.opts.environment,
      release: this.opts.release,
      exception: { values: [{ type: err.name || 'Error', value: err.message }] },
      extra: { ...(err.stack ? { stack: err.stack } : {}), ...context.extra },
    };
    const body = [
      JSON.stringify({ event_id: eventId, sent_at: now.toISOString(), dsn: this.dsn.dsn }),
      JSON.stringify({ type: 'event' }),
      JSON.stringify(event),
    ].join('\n');
    const send = (this.opts.fetch ?? (fetch as unknown as FetchLike))(this.dsn.envelopeUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-sentry-envelope',
        'x-sentry-auth': `Sentry sentry_version=7, sentry_key=${this.dsn.publicKey}, sentry_client=driver-api/${this.opts.release}`,
      },
      body,
    }).catch(() => undefined); // reporting must never throw into the app
    this.inFlight.add(send);
    void send.finally(() => this.inFlight.delete(send));
  }

  async flush(timeoutMs = 2000): Promise<void> {
    if (this.inFlight.size === 0) return;
    let timer: NodeJS.Timeout | undefined;
    await Promise.race([
      Promise.allSettled([...this.inFlight]),
      new Promise((resolve) => {
        timer = setTimeout(resolve, timeoutMs);
        timer.unref();
      }),
    ]);
    if (timer) clearTimeout(timer);
  }
}

/** `SENTRY_DSN` (+ `SENTRY_ENVIRONMENT`, default NODE_ENV) → a reporter; no DSN or a bad one → no-op. */
export function errorReporterFromEnv(env: Record<string, string | undefined> = process.env, release = '0.0.0', fetchImpl?: FetchLike): ErrorReporter {
  const raw = env['SENTRY_DSN']?.trim();
  if (!raw) return noopReporter;
  const dsn = parseSentryDsn(raw);
  if (!dsn) return noopReporter;
  return new SentryReporter(dsn, {
    environment: env['SENTRY_ENVIRONMENT'] || env['NODE_ENV'] || 'development',
    release: env['APP_RELEASE'] || release,
    ...(fetchImpl ? { fetch: fetchImpl } : {}),
  });
}
