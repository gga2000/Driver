import { Module } from '@nestjs/common';
import { PrismaService } from '../../shared/db/prisma.service.js';
import { EventsModule } from '../events/index.js';
import { IdentityModule, IdentityService } from '../identity/index.js';
import { HOUSEHOLD_PEOPLE, HouseholdsRpc } from './households.rpc.js';
import { InMemoryOrgsRepository, ORGS_REPOSITORY, PrismaOrgsRepository, type OrgsRepository } from './orgs.repository.js';
import { OrgsService } from './orgs.service.js';

/**
 * Orgs (restaurants, grocers, fleets, households) and the households transport port.
 * Wiring: Prisma repository when DATABASE_URL is set (`orgs`, `org_members`, `payer_approvals`), in-memory
 * twin otherwise.
 */
@Module({
  imports: [EventsModule, IdentityModule],
  providers: [
    {
      provide: ORGS_REPOSITORY,
      useFactory: (prisma: PrismaService): OrgsRepository => (prisma.configured ? new PrismaOrgsRepository(prisma) : new InMemoryOrgsRepository()),
      inject: [PrismaService],
    },
    OrgsService,
    { provide: HOUSEHOLD_PEOPLE, useExisting: IdentityService },
    HouseholdsRpc,
  ],
  exports: [OrgsService, HouseholdsRpc],
})
export class OrgsModule {}
