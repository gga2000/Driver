import { Module } from '@nestjs/common';
import { PrismaService } from '../../shared/db/prisma.service.js';
import { EventsModule } from '../events/index.js';
import { InMemoryPromotionsRepository, PrismaPromotionsRepository, PROMOTIONS_REPOSITORY, type PromotionsRepository } from './promotions.repository.js';
import { PromotionsService } from './promotions.service.js';

/** Promotions (domain §11): merchant self-serve deals in `promotions` (funder = merchant). */
@Module({
  imports: [EventsModule],
  providers: [
    {
      provide: PROMOTIONS_REPOSITORY,
      useFactory: (prisma: PrismaService): PromotionsRepository => (prisma.configured ? new PrismaPromotionsRepository(prisma) : new InMemoryPromotionsRepository()),
      inject: [PrismaService],
    },
    PromotionsService,
  ],
  exports: [PromotionsService],
})
export class PromotionsModule {}
