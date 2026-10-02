import { Module } from '@nestjs/common';
import { LedgerService } from './ledger.service.js';
import { InMemoryLedgerRepository } from './repository.js';
import { LEDGER_REPOSITORY } from './tokens.js';

/**
 * Until a DATABASE_URL is wired in (Milestone 2), the API runs on the in-memory repository.
 * Swapping to Prisma is a provider change here, nothing else in the module moves.
 */
@Module({
  providers: [{ provide: LEDGER_REPOSITORY, useClass: InMemoryLedgerRepository }, LedgerService],
  exports: [LedgerService],
})
export class LedgerModule {}
