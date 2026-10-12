import { Module } from '@nestjs/common';
import { PrismaService } from '../../shared/db/prisma.service.js';
import {
  InMemoryShopItemsRepository,
  PrismaShopItemsRepository,
  SHOP_ITEMS_REPOSITORY,
  type ShopItemsRepository,
} from './shop-items.repository.js';
import { ShopItemsService } from './shop-items.service.js';

@Module({
  providers: [
    {
      provide: SHOP_ITEMS_REPOSITORY,
      useFactory: (prisma: PrismaService): ShopItemsRepository =>
        prisma.configured
          ? new PrismaShopItemsRepository(prisma)
          : new InMemoryShopItemsRepository(),
      inject: [PrismaService],
    },
    ShopItemsService,
  ],
  exports: [ShopItemsService],
})
export class ShopItemsModule {}
