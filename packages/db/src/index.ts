import { PrismaPg } from '@prisma/adapter-pg';
import { pgPoolConfig, type DbConnectionOptions } from './connection.js';
import { PrismaClient, Prisma } from './generated/prisma/client.js';

export { dbOptionsFromEnv, pgPoolConfig, type DbConnectionOptions } from './connection.js';

export { PrismaClient, Prisma } from './generated/prisma/client.js';
export * from './generated/prisma/enums.js';

/** A client inside an interactive transaction: everything except $transaction/$connect/$disconnect. */
export type Tx = Prisma.TransactionClient;

/**
 * Builds a PrismaClient for the given connection string (`opts`: TLS CA and pool size for a hosted
 * database, `dbOptionsFromEnv()`; docs/deploy/supabase.md). The API is the only caller; apps never
 * import this package.
 */
export function createPrisma(connectionString: string, opts: DbConnectionOptions = {}): PrismaClient {
  const adapter = new PrismaPg(pgPoolConfig(connectionString, opts));
  return new PrismaClient({ adapter });
}
