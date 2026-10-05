import { Module } from '@nestjs/common';
import { PrismaService } from '../../shared/db/prisma.service.js';
import { CatalogModule } from '../catalog/index.js';
import { ConfigModule } from '../config/index.js';
import { EventsModule } from '../events/index.js';
import { IdentityModule } from '../identity/index.js';
import { LedgerModule } from '../ledger/index.js';
import { MerchantModule } from '../merchant/index.js';
import { OrdersModule } from '../orders/index.js';
import { OrgsModule } from '../orgs/index.js';
import { PlacesModule } from '../places/index.js';
import { PromotionsModule } from '../promotions/index.js';
import { InMemoryMerchantAdminRepository, MERCHANT_ADMIN_REPOSITORY, PrismaMerchantAdminRepository, type MerchantAdminRepository } from './merchant-admin.repository.js';
import { MerchantAdminService } from './merchant-admin.service.js';

/**
 * Merchant app wave 2: composes catalog (menu), promotions (deals), ledger + orders (money,
 * insights, disputes) and identity (staff). Owns only `merchant_dispute_responses`.
 */
@Module({
  imports: [CatalogModule, ConfigModule, EventsModule, IdentityModule, LedgerModule, MerchantModule, OrdersModule, OrgsModule, PlacesModule, PromotionsModule],
  providers: [
    {
      provide: MERCHANT_ADMIN_REPOSITORY,
      useFactory: (prisma: PrismaService): MerchantAdminRepository => (prisma.configured ? new PrismaMerchantAdminRepository(prisma) : new InMemoryMerchantAdminRepository()),
      inject: [PrismaService],
    },
    MerchantAdminService,
  ],
  exports: [MerchantAdminService],
})
export class MerchantAdminModule {}
