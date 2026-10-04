import { describe, expect, it } from 'vitest';
import { noopReporter } from './shared/error-reporter.js';
import { createShutdown, shutdownOptionsFromEnv, type ShutdownTarget } from './shutdown.js';

const silent = { log: () => undefined, warn: () => undefined, error: () => undefined };

function harness(opts: { openConnections?: boolean; drain?: () => Promise<number>; closeMs?: number } = {}) {
  const steps: string[] = [];
  let closeCb: (() => void) | undefined;
  const target: ShutdownTarget = {
    getHttpServer: () => ({
      close: ((cb?: () => void) => {
        steps.push('server.close');
        closeCb = cb;
        if (!opts.openConnections) cb?.();
      }) as never,
      closeIdleConnections: () => void steps.push('closeIdle'),
      closeAllConnections: () => {
        steps.push('closeAll');
        closeCb?.();
      },
    }),
    drainOutbox: async () => {
      steps.push('drainOutbox');
      return (opts.drain ?? (async () => 3))();
    },
    close: async () => {
      steps.push('app.close');
      if (opts.closeMs) await new Promise((r) => setTimeout(r, opts.closeMs));
    },
  };
  const exits: number[] = [];
  return { steps, exits, target, exit: (code: number) => void exits.push(code) };
}

describe('graceful shutdown', () => {
  it('stops accepting, drains the outbox, closes the app, exits 0 — in that order', async () => {
    const h = harness();
    await createShutdown(h.target, { logger: silent, reporter: noopReporter, timeoutMs: 1000, connectionGraceMs: 100, exit: h.exit })('SIGTERM');
    expect(h.steps).toEqual(['server.close', 'closeIdle', 'drainOutbox', 'app.close']);
    expect(h.exits).toEqual([0]);
  });

  it('cuts connections still open after the grace period (SSE streams)', async () => {
    const h = harness({ openConnections: true });
    await createShutdown(h.target, { logger: silent, reporter: noopReporter, timeoutMs: 1000, connectionGraceMs: 20, exit: h.exit })('SIGTERM');
    expect(h.steps).toEqual(['server.close', 'closeIdle', 'closeAll', 'drainOutbox', 'app.close']);
    expect(h.exits).toEqual([0]);
  });

  it('a failing outbox drain does not stop the shutdown (rows stay pending)', async () => {
    const h = harness({ drain: async () => Promise.reject(new Error('db gone')) });
    await createShutdown(h.target, { logger: silent, reporter: noopReporter, timeoutMs: 1000, connectionGraceMs: 20, exit: h.exit })('SIGTERM');
    expect(h.steps).toContain('app.close');
    expect(h.exits).toEqual([0]);
  });

  it('exits 1 when it takes longer than the timeout, and at once on a second signal', async () => {
    const h = harness({ closeMs: 200 });
    const shutdown = createShutdown(h.target, { logger: silent, reporter: noopReporter, timeoutMs: 50, connectionGraceMs: 10, exit: h.exit });
    const first = shutdown('SIGTERM');
    await shutdown('SIGINT');
    expect(h.exits).toEqual([1]);
    await new Promise((r) => setTimeout(r, 80));
    expect(h.exits).toEqual([1, 1]); // the hard timeout fired
    await first;
  });

  it('timeouts from env stay under the host kill timeout', () => {
    expect(shutdownOptionsFromEnv({})).toEqual({ timeoutMs: 25_000, connectionGraceMs: 10_000 });
    expect(shutdownOptionsFromEnv({ SHUTDOWN_TIMEOUT_MS: '8000' })).toEqual({ timeoutMs: 8000, connectionGraceMs: 4000 });
  });
});
