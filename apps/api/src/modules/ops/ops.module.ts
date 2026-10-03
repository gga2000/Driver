import { Module } from '@nestjs/common';
import { PrismaService } from '../../shared/db/prisma.service.js';
import { DriverAccountModule } from '../driver-account/index.js';
import { EventsModule } from '../events/index.js';
import { IdentityModule } from '../identity/index.js';
import { LedgerModule } from '../ledger/index.js';
import { OrgsModule } from '../orgs/index.js';
import { PlacesModule } from '../places/index.js';
import { InMemoryOpsRepository, OPS_REPOSITORY, PrismaOpsRepository, type OpsRepository } from './ops.repository.js';
import { OpsService } from './ops.service.js';

/** Field ops mode: landmark photos, courier cash receipts (ledger), merchant onboarding, tasks. */
@Module({
  imports: [DriverAccountModule, EventsModule, IdentityModule, LedgerModule, OrgsModule, PlacesModule],
  providers: [
    {
      provide: OPS_REPOSITORY,
      useFactory: (prisma: PrismaService): OpsRepository => (prisma.configured ? new PrismaOpsRepository(prisma) : new InMemoryOpsRepository()),
      inject: [PrismaService],
    },
    OpsService,
  ],
  exports: [OpsService],
})
export class OpsModule {}
