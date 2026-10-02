import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, Prisma } from './generated/prisma/client.js';

export { PrismaClient, Prisma } from './generated/prisma/client.js';
export * from './generated/prisma/enums.js';

/** A client inside an interactive transaction: everything except $transaction/$connect/$disconnect. */
export type Tx = Prisma.TransactionClient;

/**
 * Builds a PrismaClient for the given connection string.
 * The API is the only caller; apps never import this package.
 */
export function createPrisma(connectionString: string): PrismaClient {
  const adapter = new PrismaPg({ connectionString });
  return new PrismaClient({ adapter });
}
