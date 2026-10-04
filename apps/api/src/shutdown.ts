import type { Server } from 'node:http';
import type { LoggerService } from '@nestjs/common';
import type { ErrorReporter } from './shared/error-reporter.js';

/** What graceful shutdown needs from the running app (a Nest app in main.ts, fakes in the test). */
export interface ShutdownTarget {
  getHttpServer(): Pick<Server, 'close'> & Partial<Pick<Server, 'closeIdleConnections' | 'closeAllConnections'>>;
  /** Delivers outbox rows still due (OutboxPublisher.shutdown). */
  drainOutbox(): Promise<number>;
  /** Nest's app.close(): module destroy hooks — BullMQ workers finish their job, Redis and Postgres disconnect. */
  close(): Promise<void>;
}

export interface ShutdownOptions {
  logger: LoggerService;
  reporter: ErrorReporter;
  /** Whole sequence; keep it under the host's kill timeout (fly.toml kill_timeout = 30 s). */
  timeoutMs: number;
  /** How long open requests and streams (SSE) get before their connections are cut. */
  connectionGraceMs: number;
  exit: (code: number) => void;
}

export function shutdownOptionsFromEnv(env: Record<string, string | undefined> = process.env): Pick<ShutdownOptions, 'timeoutMs' | 'connectionGraceMs'> {
  const timeoutMs = Number(env['SHUTDOWN_TIMEOUT_MS']) > 0 ? Number(env['SHUTDOWN_TIMEOUT_MS']) : 25_000;
  return { timeoutMs, connectionGraceMs: Math.min(10_000, Math.floor(timeoutMs / 2)) };
}

/**
 * The deploy-time stop sequence (docs/deploy/runbook.md). On SIGTERM (Fly, Docker, Railway, Render)
 * or SIGINT:
 *   1. stop accepting connections; idle keep-alive sockets close at once;
 *   2. let in-flight requests finish, up to `connectionGraceMs`, then cut what is left — long-lived
 *      streams (SSE) reconnect to the new instance;
 *   3. drain the outbox, so events committed by this instance's last requests are delivered now;
 *   4. app.close(): BullMQ workers finish their current job, then Redis and Postgres disconnect;
 *   5. flush the error reporter and exit 0.
 * Past `timeoutMs` it exits 1 whatever is left: outbox rows stay pending and BullMQ re-queues a
 * stalled job, so nothing is lost, only delayed. A second signal exits at once.
 */
export function createShutdown(target: ShutdownTarget, opts: ShutdownOptions): (signal: string) => Promise<void> {
  let started = false;
  return async (signal: string) => {
    if (started) {
      opts.logger.warn(`${signal} again: exiting now`, 'Shutdown');
      opts.exit(1);
      return;
    }
    started = true;
    const t0 = Date.now();
    opts.logger.log(`${signal}: shutting down (timeout ${opts.timeoutMs} ms)`, 'Shutdown');
    const hard = setTimeout(() => {
      opts.logger.error(`shutdown did not finish in ${opts.timeoutMs} ms: exiting`, 'Shutdown');
      opts.exit(1);
    }, opts.timeoutMs);
    hard.unref?.();
    try {
      const server = target.getHttpServer();
      const closed = new Promise<void>((resolve) => server.close(() => resolve()));
      server.closeIdleConnections?.();
      let grace: NodeJS.Timeout | undefined;
      const graceOver = new Promise<'grace'>((resolve) => {
        grace = setTimeout(() => resolve('grace'), opts.connectionGraceMs);
        grace.unref?.();
      });
      if ((await Promise.race([closed.then(() => 'closed' as const), graceOver])) === 'grace') {
        opts.logger.warn('open connections after the grace period (streams, slow requests): closing them', 'Shutdown');
        server.closeAllConnections?.();
      }
      if (grace) clearTimeout(grace);

      try {
        const n = await target.drainOutbox();
        if (n > 0) opts.logger.log(`outbox: delivered ${n} pending row(s) before exit`, 'Shutdown');
      } catch (err) {
        opts.logger.warn(`outbox drain on shutdown failed, rows stay pending: ${(err as Error).message}`, 'Shutdown');
      }

      await target.close();
      await opts.reporter.flush(2000);
      opts.logger.log(`stopped in ${Date.now() - t0} ms`, 'Shutdown');
      clearTimeout(hard);
      opts.exit(0);
    } catch (err) {
      opts.logger.error(`shutdown failed: ${(err as Error).message}`, (err as Error).stack, 'Shutdown');
      await opts.reporter.flush(1000);
      clearTimeout(hard);
      opts.exit(1);
    }
  };
}
