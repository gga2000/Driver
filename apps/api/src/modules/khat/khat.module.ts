import { Module } from '@nestjs/common';
import { PrismaService } from '../../shared/db/prisma.service.js';
import { DispatchModule } from '../dispatch/index.js';
import { EventsModule } from '../events/index.js';
import { callBridgeFor } from '../../shared/call-bridge.js';
import { IdentityModule, IdentityService } from '../identity/index.js';
import { TripsModule } from '../trips/index.js';
import { InMemoryKhatRepository, KHAT_REPOSITORY, PrismaKhatRepository, type KhatRepository } from './khat.repository.js';
import { KHAT_CALLS, KhatService } from './khat.service.js';

/**
 * خطوط driver side: today's run, per-child taps, absences, substitute offers. Runs are khat Trips
 * (trips module), names come from identity's vault port, offers from dispatch. Owns `khat_absences`.
 */
@Module({
  imports: [TripsModule, DispatchModule, IdentityModule, EventsModule],
  providers: [
    {
      provide: KHAT_REPOSITORY,
      useFactory: (prisma: PrismaService): KhatRepository => (prisma.configured ? new PrismaKhatRepository(prisma) : new InMemoryKhatRepository()),
      inject: [PrismaService],
    },
    // Guardian calls: the same masked-call bridge as in-order chat (dev: the guardian's own number, logged).
    { provide: KHAT_CALLS, useFactory: (identity: IdentityService) => callBridgeFor(identity), inject: [IdentityService] },
    KhatService,
  ],
  exports: [KhatService],
})
export class KhatModule {}
