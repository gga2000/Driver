import { Inject, Module, type OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../shared/db/prisma.service.js';
import { DriverAccountModule } from '../driver-account/index.js';
import { EventsModule } from '../events/index.js';
import { ErasureRegistry, IdentityModule } from '../identity/index.js';
import { LedgerModule } from '../ledger/index.js';
import { OrgsModule } from '../orgs/index.js';
import { PlacesErasure, PlacesModule } from '../places/index.js';
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
export class OpsModule implements OnModuleInit {
  constructor(
    @Inject(OPS_REPOSITORY) private readonly repo: OpsRepository,
    private readonly places: PlacesErasure,
    private readonly erasure: ErasureRegistry,
  ) {}

  onModuleInit(): void {
    // W7 account deletion: his landmark photos never approved go; approved ones stay up for everyone,
    // so places keeps those uploads when it removes the rest of his.
    const release = (personId: string) => this.repo.releaseContributor(personId);
    this.places.bindKeeper(release);
    this.erasure.register({ owner: 'ops', tables: ['public.landmark_photos'], erase: async (personId) => void (await release(personId)) });
  }
}
