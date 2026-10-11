import { Module } from '@nestjs/common';
import { PrismaService } from '../../shared/db/prisma.service.js';
import { CatalogModule } from '../catalog/index.js';
import { ConfigModule } from '../config/index.js';
import { EventsModule } from '../events/index.js';
import { IdentityModule } from '../identity/index.js';
import { OrgsModule } from '../orgs/index.js';
import { FOOD_CARTS_REPOSITORY, InMemoryFoodCartsRepository, PrismaFoodCartsRepository, type FoodCartsRepository } from './food-carts.repository.js';
import { FoodCartsService } from './food-carts.service.js';

/** Food carts «عربانات»: the list, follows, walk-over tickets and the Merchant app's cart mode. */
@Module({
  imports: [CatalogModule, ConfigModule, EventsModule, IdentityModule, OrgsModule],
  providers: [
    {
      provide: FOOD_CARTS_REPOSITORY,
      useFactory: (prisma: PrismaService): FoodCartsRepository => (prisma.configured ? new PrismaFoodCartsRepository(prisma) : new InMemoryFoodCartsRepository()),
      inject: [PrismaService],
    },
    FoodCartsService,
  ],
  exports: [FoodCartsService, FOOD_CARTS_REPOSITORY],
})
export class FoodCartsModule {}
