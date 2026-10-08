import { Inject, Module, type OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../shared/db/prisma.service.js';
import { EventsModule } from '../events/index.js';
import { ErasureRegistry, IdentityModule, IdentityService } from '../identity/index.js';
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
export class OrgsModule implements OnModuleInit {
  constructor(
    @Inject(ORGS_REPOSITORY) private readonly repo: OrgsRepository,
    private readonly orgs: OrgsService,
    private readonly erasure: ErasureRegistry,
  ) {}

  onModuleInit(): void {
    // W7 account deletion: a payer who still has people in the household hands it over first (they
    // would lose the wallet that pays for them); everyone else simply leaves it. Restaurants, fleets
    // and grocers are work roles, which identity already blocks.
    this.erasure.register({
      owner: 'orgs',
      tables: ['public.org_members', 'public.orgs'],
      blockers: async (personId) => {
        const led = (await this.orgs.householdsOf(personId)).filter((h) => h.members.some((m) => m.personId === personId && m.role === 'payer') && h.members.length > 1);
        return led.length > 0 ? [{ kind: 'household', count: led.length }] : [];
      },
      erase: (personId) => this.repo.leaveHouseholds(personId),
    });
  }
}
