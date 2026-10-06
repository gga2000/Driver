import { Module } from '@nestjs/common';
import { PrismaService } from '../../shared/db/prisma.service.js';
import { DriverAccountModule } from '../driver-account/index.js';
import { EventsModule } from '../events/index.js';
import { IdentityModule } from '../identity/index.js';
import { LedgerModule } from '../ledger/index.js';
import { OrgsModule } from '../orgs/index.js';
import { PlacesModule } from '../places/index.js';
import { ControlsModule } from '../controls/index.js';
import { MerchantModule } from '../merchant/index.js';
import { InMemoryOpsRepository, OPS_REPOSITORY, PrismaOpsRepository, type OpsRepository } from './ops.repository.js';
import { OpsService } from './ops.service.js';
import { OpsPickupSpotsService } from './pickup-spots.service.js';

/**
 * Field ops mode: landmark photos, courier cash receipts (ledger), merchant onboarding, tasks; and
 * stores' pickup spots set from the Console (over the merchant module, audited in controls).
 */
@Module({
  imports: [DriverAccountModule, EventsModule, IdentityModule, LedgerModule, OrgsModule, PlacesModule, MerchantModule, ControlsModule],
  providers: [
    {
      provide: OPS_REPOSITORY,
      useFactory: (prisma: PrismaService): OpsRepository => (prisma.configured ? new PrismaOpsRepository(prisma) : new InMemoryOpsRepository()),
      inject: [PrismaService],
    },
    OpsService,
    OpsPickupSpotsService,
  ],
  exports: [OpsService, OpsPickupSpotsService],
})
export class OpsModule {}
