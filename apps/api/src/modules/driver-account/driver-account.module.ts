import { Module } from '@nestjs/common';
import { PrismaService } from '../../shared/db/prisma.service.js';
import { ConfigModule } from '../config/index.js';
import { EventsModule } from '../events/index.js';
import { IdentityModule } from '../identity/index.js';
import { LedgerModule } from '../ledger/index.js';
import { OrdersModule } from '../orders/index.js';
import { PlacesModule } from '../places/index.js';
import { SupportModule } from '../support/index.js';
import { TripsModule } from '../trips/index.js';
import { DRIVER_ACCOUNT_REPOSITORY, InMemoryDriverAccountRepository, PrismaDriverAccountRepository, type DriverAccountRepository } from './driver-account.repository.js';
import { DriverAccountService } from './driver-account.service.js';
import { HANDOVER_SECRET, handoverSecretFromEnv } from './handover-code.js';

/**
 * A driving person's own account (Partner wave 2): earnings from the ledger, scorecard, documents,
 * daily check-in, the online gate and the cash hand-over code. Owns `driver_documents` and
 * `driver_check_ins` (Prisma with DATABASE_URL, in-memory otherwise); photo refs go to the vault.
 */
@Module({
  imports: [ConfigModule, EventsModule, IdentityModule, LedgerModule, OrdersModule, PlacesModule, SupportModule, TripsModule],
  providers: [
    {
      provide: DRIVER_ACCOUNT_REPOSITORY,
      useFactory: (prisma: PrismaService): DriverAccountRepository => (prisma.configured ? new PrismaDriverAccountRepository(prisma) : new InMemoryDriverAccountRepository()),
      inject: [PrismaService],
    },
    { provide: HANDOVER_SECRET, useFactory: handoverSecretFromEnv },
    DriverAccountService,
  ],
  exports: [DriverAccountService],
})
export class DriverAccountModule {}
