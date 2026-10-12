import { Module } from '@nestjs/common';
import { PrismaService } from '../../shared/db/prisma.service.js';
import { ControlsModule } from '../controls/index.js';
import { EventsModule } from '../events/index.js';
import { PartnerModule, PartnerService } from '../partner/index.js';
import { RoutingModule } from '../routing/index.js';
import { CLOSURES_REPOSITORY, InMemoryClosuresRepository, PrismaClosuresRepository, type ClosuresRepository } from './closures.repository.js';
import { CLOSURES_COURIER_WAY, ClosuresService, type CourierWayPort } from './closures.service.js';

/**
 * N20 «شارع مسدود»: owns `street_closures` (Prisma with DATABASE_URL, in memory otherwise) and keeps
 * routing's closure book current, so every route in the API goes around today's closed streets.
 */
@Module({
  imports: [ControlsModule, EventsModule, RoutingModule, PartnerModule],
  providers: [
    {
      provide: CLOSURES_REPOSITORY,
      useFactory: (prisma: PrismaService): ClosuresRepository => (prisma.configured ? new PrismaClosuresRepository(prisma) : new InMemoryClosuresRepository()),
      inject: [PrismaService],
    },
    // A courier's report is taken from his own job road (partner module), never from a point the app sends.
    { provide: CLOSURES_COURIER_WAY, useFactory: (p: PartnerService): CourierWayPort => ({ jobWay: (id) => p.jobWay(id) }), inject: [PartnerService] },
    ClosuresService,
  ],
  exports: [ClosuresService],
})
export class ClosuresModule {}
