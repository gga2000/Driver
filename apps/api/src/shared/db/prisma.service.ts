import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { createPrisma, dbOptionsFromEnv, type PrismaClient } from '@driver/db';
import { PRISMA_LOG_CONTEXT, prismaErrorLogger } from './prisma-error-log.js';

export type DbStatus = 'ok' | 'unavailable';

/**
 * Wraps `createPrisma(DATABASE_URL)` (plus `DATABASE_CA_CERT` / `DATABASE_POOL_MAX` for a hosted
 * database, docs/deploy/supabase.md). The client is created lazily and only when a
 * `DATABASE_URL` is configured, so the API boots (and tests run) with no database at all.
 *
 * Modules never import `@driver/db` directly for a client; they receive this service
 * (or a `Tx` from the unit of work) and talk to their own tables only.
 */
@Injectable()
export class PrismaService implements OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  private readonly queryLog = new Logger(PRISMA_LOG_CONTEXT);

  private client: PrismaClient | undefined;

  constructor(private readonly databaseUrl: string | undefined = process.env['DATABASE_URL']) {}

  /** True when a DATABASE_URL was configured; says nothing about reachability. */
  get configured(): boolean {
    return Boolean(this.databaseUrl);
  }

  /** The underlying client. Throws when no DATABASE_URL is configured. */
  get prisma(): PrismaClient {
    if (!this.databaseUrl) throw new Error('DATABASE_URL is not configured');
    // Every failed query is logged once (with the request id inside a request), then rethrown as is.
    this.client ??= createPrisma(this.databaseUrl, dbOptionsFromEnv()).$extends({
      query: { $allOperations: prismaErrorLogger((msg) => this.queryLog.warn(msg)) },
    }) as unknown as PrismaClient;
    return this.client;
  }

  /** Cheap liveness probe used by `health.ping`; never throws. */
  async status(): Promise<DbStatus> {
    if (!this.databaseUrl) return 'unavailable';
    try {
      await this.prisma.$queryRawUnsafe('SELECT 1');
      return 'ok';
    } catch (err) {
      this.logger.warn(`database unavailable: ${(err as Error).message}`);
      return 'unavailable';
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.client?.$disconnect();
  }
}
