import pg from 'pg';
import { pgPoolConfig, type DbConnectionOptions } from './connection.js';

/** How long one probe may take (connect + `SELECT 1`) before the database counts as unreachable. */
export const DB_PROBE_TIMEOUT_MS = 2_000;

export type DbProbeResult = { ok: true } | { ok: false; reason: string };

export interface DbProbe {
  /** `ok` when the database answered `SELECT 1` within the timeout, else why not. Never throws. */
  check(): Promise<DbProbeResult>;
  close(): Promise<void>;
}

/**
 * A health probe on its own single connection, apart from the query pools. Under load the request
 * pool can be full for seconds; a probe that queued behind it would call a busy but healthy machine
 * dead, and Fly would pull it from rotation exactly when it is needed. A dropped connection is
 * reopened on the next check. Probes that arrive while one is running share its answer, so a herd
 * of checks costs one query.
 */
export function createDbProbe(
  connectionString: string,
  opts: DbConnectionOptions = {},
  timeoutMs = DB_PROBE_TIMEOUT_MS,
): DbProbe {
  const pool = new pg.Pool({
    ...pgPoolConfig(connectionString, {
      ...(opts.caCert ? { caCert: opts.caCert } : {}),
      statementTimeoutMs: timeoutMs,
    }),
    // Named, so it is easy to tell apart in pg_stat_activity.
    application_name: 'driver-health-probe',
    max: 1,
    connectionTimeoutMillis: timeoutMs,
    idleTimeoutMillis: 0,
    allowExitOnIdle: true,
  });
  // A connection that dies while idle emits here; without a listener node would crash the process.
  pool.on('error', () => undefined);
  let running: Promise<DbProbeResult> | undefined;

  const once = async (): Promise<DbProbeResult> => {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<DbProbeResult>((resolve) => {
      timer = setTimeout(
        () => resolve({ ok: false, reason: `no answer within ${timeoutMs} ms` }),
        timeoutMs,
      );
    });
    const query = pool.query('SELECT 1').then(
      (): DbProbeResult => ({ ok: true }),
      (err: unknown): DbProbeResult => ({
        ok: false,
        reason: err instanceof Error ? err.message : String(err),
      }),
    );
    try {
      return await Promise.race([query, timeout]);
    } finally {
      clearTimeout(timer);
    }
  };

  return {
    check() {
      running ??= once().finally(() => {
        running = undefined;
      });
      return running;
    },
    async close() {
      await pool.end().catch(() => undefined);
    },
  };
}
