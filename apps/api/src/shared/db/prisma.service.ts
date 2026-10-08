import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { createDbProbe, createPrisma, dbOptionsFromEnv, type DbProbe, type PrismaClient } from '@driver/db';
import { workKind } from '../request-context.js';
import { PRISMA_LOG_CONTEXT, prismaErrorLogger } from './prisma-error-log.js';

export type DbStatus = 'ok' | 'unavailable';

/** Who is waiting on a query: a phone (an HTTP request) or nobody (jobs, sweeps, outbox deliveries). */
export type DbLane = 'request' | 'background';

/** Statement time limits per lane, in ms; 0 = the server's own limit. */
export type DbTimeouts = Record<DbLane, number>;

/** A request query that runs longer than this is cancelled, so one slow query can't hold a connection a crowd is queuing for. */
export const DEFAULT_REQUEST_STATEMENT_TIMEOUT_MS = 5_000;
/** Jobs (nightly close, purges, sweeps) get longer, still well under Supabase's global 2 minutes. */
export const DEFAULT_BACKGROUND_STATEMENT_TIMEOUT_MS = 120_000;

/** `DATABASE_STATEMENT_TIMEOUT_MS` (requests) and `DATABASE_JOB_STATEMENT_TIMEOUT_MS` (background); `0` turns a limit off. */
export function dbTimeoutsFromEnv(env: Record<string, string | undefined> = process.env): DbTimeouts {
  const read = (name: string, fallback: number) => {
    const raw = env[name]?.trim();
    if (!raw) return fallback;
    const ms = Number(raw);
    if (!Number.isInteger(ms) || ms < 0) throw new Error(`${name} must be a whole number of milliseconds, 0 for no limit (got "${raw}")`);
    return ms;
  };
  return {
    request: read('DATABASE_STATEMENT_TIMEOUT_MS', DEFAULT_REQUEST_STATEMENT_TIMEOUT_MS),
    background: read('DATABASE_JOB_STATEMENT_TIMEOUT_MS', DEFAULT_BACKGROUND_STATEMENT_TIMEOUT_MS),
  };
}

async function readTimeoutMs(client: PrismaClient): Promise<number> {
  const rows = await client.$queryRawUnsafe<Array<{ ms: number }>>(
    `SELECT (EXTRACT(EPOCH FROM current_setting('statement_timeout')::interval) * 1000)::int AS ms`,
  );
  return Number(rows[0]?.ms ?? 0);
}

/**
 * Wraps `createPrisma(DATABASE_URL)` (plus `DATABASE_CA_CERT` / `DATABASE_POOL_MAX` for a hosted
 * database, docs/deploy/supabase.md). Clients are created lazily and only when a `DATABASE_URL` is
 * configured, so the API boots (and tests run) with no database at all.
 *
 * Two lanes, one database role: queries made while serving an HTTP request use a pool whose
 * statements stop after 5 s; everything else (queued jobs, interval sweeps, outbox deliveries) uses
 * a pool allowed 2 minutes (`dbTimeoutsFromEnv`). `UnitOfWork` also sets the lane's limit at the start
 * of each transaction, because Supabase's transaction pooler may drop connection-level settings; the
 * first query of each lane logs the limit the server actually applies (docs/deploy/hosting.md).
 *
 * Modules never import `@driver/db` directly for a client; they receive this service
 * (or a `Tx` from the unit of work) and talk to their own tables only.
 */
@Injectable()
export class PrismaService implements OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  private readonly queryLog = new Logger(PRISMA_LOG_CONTEXT);

  private readonly clients = new Map<DbLane, PrismaClient>();

  private probe: DbProbe | undefined;

  readonly timeouts: DbTimeouts;

  constructor(
    private readonly databaseUrl: string | undefined = process.env['DATABASE_URL'],
    timeouts: DbTimeouts = dbTimeoutsFromEnv(),
  ) {
    this.timeouts = timeouts;
  }

  /** True when a DATABASE_URL was configured; says nothing about reachability. */
  get configured(): boolean {
    return Boolean(this.databaseUrl);
  }

  /** The lane of the code running now (see the class comment). */
  lane(): DbLane {
    return workKind();
  }

  /** The client for the current lane. Throws when no DATABASE_URL is configured. */
  get prisma(): PrismaClient {
    return this.client(this.lane());
  }

  /** The client of one lane, opened on first use. */
  client(lane: DbLane): PrismaClient {
    if (!this.databaseUrl) throw new Error('DATABASE_URL is not configured');
    let client = this.clients.get(lane);
    if (!client) {
      // Every failed query is logged once (with the request id inside a request), then rethrown as is.
      // Background transactions may stay open as long as their statements may run; requests keep Prisma's 5 s.
      const ms = this.timeouts[lane];
      const opts = { ...dbOptionsFromEnv(), statementTimeoutMs: ms, ...(lane === 'background' && ms > 5_000 ? { transactionTimeoutMs: ms } : {}) };
      client = createPrisma(this.databaseUrl, opts).$extends({
        query: { $allOperations: prismaErrorLogger((msg) => this.queryLog.warn(msg)) },
      }) as unknown as PrismaClient;
      this.clients.set(lane, client);
      void this.reportTimeout(lane, client);
    }
    return client;
  }

  /**
   * Cheap liveness probe used by `health.live`, `health.ready` and `health.ping`; never throws. It
   * runs on its own connection (`createDbProbe`), so a full request pool never makes a busy machine
   * look dead.
   */
  async status(): Promise<DbStatus> {
    if (!this.databaseUrl) return 'unavailable';
    this.probe ??= createDbProbe(this.databaseUrl, dbOptionsFromEnv());
    const res = await this.probe.check();
    if (res.ok) return 'ok';
    this.logger.warn(`database unavailable: ${res.reason}`);
    return 'unavailable';
  }

  /** The `statement_timeout` the server applies to a lane's queries outside a transaction, in ms (0 = none). */
  effectiveTimeoutMs(lane: DbLane): Promise<number> {
    return readTimeoutMs(this.client(lane));
  }

  /**
   * Logs once per lane what the server really applies. A mismatch means the pooler dropped the
   * connection-level setting: transactions still get their limit (UnitOfWork), single queries get
   * the database role's default (docs/deploy/hosting.md "Database time limits").
   */
  private async reportTimeout(lane: DbLane, client: PrismaClient): Promise<void> {
    try {
      const got = await readTimeoutMs(client);
      const want = this.timeouts[lane];
      if (want === 0 || got === want) this.logger.log(`database ${lane} lane: statement_timeout ${got} ms`);
      else this.logger.warn(`database ${lane} lane: statement_timeout is ${got} ms, wanted ${want} ms (connection setting dropped; transactions still set theirs)`);
    } catch (err) {
      this.logger.warn(`database ${lane} lane: could not read statement_timeout: ${(err as Error).message}`);
    }
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all([...[...this.clients.values()].map((c) => c.$disconnect()), this.probe?.close()]);
  }
}
