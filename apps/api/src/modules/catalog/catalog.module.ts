import { Module } from '@nestjs/common';
import { PrismaService } from '../../shared/db/prisma.service.js';
import { CATALOG_REPOSITORY, InMemoryCatalogRepository, PrismaCatalogRepository, type CatalogRepository } from './catalog.repository.js';
import { CatalogService } from './catalog.service.js';

/** Wiring: Prisma repository when DATABASE_URL is set (menus from `pnpm db:seed`), in-memory twin otherwise. */
@Module({
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
export class CatalogModule {}
