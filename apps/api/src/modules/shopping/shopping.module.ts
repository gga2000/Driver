import { Module } from '@nestjs/common';
import { PrismaService } from '../../shared/db/prisma.service.js';
import { CatalogModule, STOREFRONT_PHOTOS } from '../catalog/index.js';
import { IdentityModule } from '../identity/index.js';
import { OrdersModule } from '../orders/index.js';
import { OrgsModule } from '../orgs/index.js';
import { BLOB_STORE, PlacesModule } from '../places/index.js';
import { ShopItemsModule } from '../shop-items/index.js';
import { DailyBreadSweeper } from './daily-bread.sweeper.js';
import {
  InMemoryShoppingRepository,
  PrismaShoppingRepository,
  SHOPPING_REPOSITORY,
  type ShoppingRepository,
} from './shopping.repository.js';
import { ShoppingService } from './shopping.service.js';

/** The shopping side «السوق»: stalls, bakeries, «صمون كل يوم» and the Merchant app's shop mode. */
@Module({
  imports: [CatalogModule, IdentityModule, OrdersModule, OrgsModule, PlacesModule, ShopItemsModule],
  providers: [
    {
      provide: SHOPPING_REPOSITORY,
      useFactory: (prisma: PrismaService): ShoppingRepository =>
        prisma.configured ? new PrismaShoppingRepository(prisma) : new InMemoryShoppingRepository(),
      inject: [PrismaService],
    },
    // Photos a stall uploaded (`upload:<id>`) leave the API as signed links.
    { provide: STOREFRONT_PHOTOS, useExisting: BLOB_STORE },
    ShoppingService,
    DailyBreadSweeper,
  ],
  exports: [ShoppingService, SHOPPING_REPOSITORY],
})
export class ShoppingModule {}
