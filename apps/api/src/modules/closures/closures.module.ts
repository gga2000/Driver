import { Module } from '@nestjs/common';
import { PrismaService } from '../../shared/db/prisma.service.js';
import { ControlsModule } from '../controls/index.js';
import { EventsModule } from '../events/index.js';
import { RoutingModule } from '../routing/index.js';
import { CLOSURES_REPOSITORY, InMemoryClosuresRepository, PrismaClosuresRepository, type ClosuresRepository } from './closures.repository.js';
import { ClosuresService } from './closures.service.js';

/**
 * N20 «شارع مسدود»: owns `street_closures` (Prisma with DATABASE_URL, in memory otherwise) and keeps
 * routing's closure book current, so every route in the API goes around today's closed streets.
 */
@Module({
  imports: [ControlsModule, EventsModule, RoutingModule],
  providers: [
    {
      provide: CLOSURES_REPOSITORY,
      useFactory: (prisma: PrismaService): ClosuresRepository => (prisma.configured ? new PrismaClosuresRepository(prisma) : new InMemoryClosuresRepository()),
      inject: [PrismaService],
    },
    ClosuresService,
  ],
  exports: [ClosuresService],
})
export class ClosuresModule {}
