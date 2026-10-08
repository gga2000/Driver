import { Module } from '@nestjs/common';
import { PrismaService } from '../../shared/db/prisma.service.js';
import { ControlsModule } from '../controls/index.js';
import { EventsModule } from '../events/index.js';
import { IdentityModule } from '../identity/index.js';
import {
  INBOX_REPOSITORY,
  InMemoryInboxRepository,
  PrismaInboxRepository,
  type InboxRepository,
} from './inbox.repository.js';
import { INBOX_CONFIG, InboxService, type InboxConfig } from './inbox.service.js';

/**
 * The Today list (Console E1, CON-12). Owns `inbox_items` (Prisma with DATABASE_URL, in memory
 * otherwise). Hears the outbox; audits and staff names through controls; staff checks through
 * identity. Imports no domain module: rows point at orders, trips and incidents by id.
 *
 * Env: INBOX_DEFAULT_CITY (the city for events that carry none; default aziziyah).
 */
@Module({
  imports: [ControlsModule, EventsModule, IdentityModule],
  providers: [
    {
      provide: INBOX_REPOSITORY,
      useFactory: (prisma: PrismaService): InboxRepository =>
        prisma.configured ? new PrismaInboxRepository(prisma) : new InMemoryInboxRepository(),
      inject: [PrismaService],
    },
    {
      provide: INBOX_CONFIG,
      useFactory: (): InboxConfig => ({
        defaultCityId: process.env['INBOX_DEFAULT_CITY'] ?? 'aziziyah',
      }),
    },
    InboxService,
  ],
  exports: [InboxService],
})
export class InboxModule {}
