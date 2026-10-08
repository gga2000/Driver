import { Inject, Module, type OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../shared/db/prisma.service.js';
import { CATALOG_REPOSITORY, InMemoryCatalogRepository, PrismaCatalogRepository, type CatalogRepository } from './catalog.repository.js';
import { CatalogService } from './catalog.service.js';
import { FoodMediaController } from './food-media.controller.js';
import { ErasureRegistry, IdentityModule } from '../identity/index.js';

/**
 * Wiring: Prisma repository when DATABASE_URL is set (menus from `pnpm db:seed`), in-memory twin
 * otherwise. `CatalogRpc` (the customer read, `catalog.*`) is provided by the orders module: it
 * needs the merchant directory and the fee engine orders charges with, and orders already imports
 * catalog.
 */
@Module({
  controllers: [FoodMediaController],
  imports: [IdentityModule],
  providers: [
    {
      provide: CATALOG_REPOSITORY,
      useFactory: (prisma: PrismaService): CatalogRepository => (prisma.configured ? new PrismaCatalogRepository(prisma) : new InMemoryCatalogRepository()),
      inject: [PrismaService],
    },
    CatalogService,
  ],
  exports: [CatalogService],
})
export class CatalogModule implements OnModuleInit {
  constructor(
    @Inject(CATALOG_REPOSITORY) private readonly repo: CatalogRepository,
    private readonly erasure: ErasureRegistry,
  ) {}

  onModuleInit(): void {
    // W7 account deletion: the dishes he follows go.
    this.erasure.register({ owner: 'catalog', tables: ['public.dish_follows'], erase: (personId) => this.repo.eraseFollower(personId) });
  }
}
