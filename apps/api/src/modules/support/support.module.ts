import { Module } from '@nestjs/common';
import { PrismaService } from '../../shared/db/prisma.service.js';
import { CatalogModule } from '../catalog/index.js';
import { ChatModule, ChatService } from '../chat/index.js';
import { ControlsModule } from '../controls/index.js';
import { EventsModule } from '../events/index.js';
import { IdentityModule } from '../identity/index.js';
import { LedgerModule } from '../ledger/index.js';
import { OrdersModule } from '../orders/index.js';
import { OrgsModule } from '../orgs/index.js';
import { TripsModule } from '../trips/index.js';
import { InMemorySupportRepository, PrismaSupportRepository, SUPPORT_REPOSITORY, type SupportRepository } from './support.repository.js';
import { SUPPORT_CHAT, SupportService } from './support.service.js';

/**
 * Support desk. Owns `support_tickets` and `support_ticket_entries` (Prisma with DATABASE_URL, in
 * memory otherwise — tickets used to live only in memory). Reads orders, trips, catalog names and
 * ledger lines through their public services; refunds post through the ledger's
 * `SupportCreditService`; the audit log and staff names come from the controls module. The order's
 * support chat («كلّم الدعم») is read and answered through the chat module's `ChatService`.
 */
@Module({
  imports: [CatalogModule, ChatModule, ControlsModule, EventsModule, IdentityModule, LedgerModule, OrdersModule, OrgsModule, TripsModule],
  providers: [
    {
      provide: SUPPORT_REPOSITORY,
      useFactory: (prisma: PrismaService): SupportRepository => (prisma.configured ? new PrismaSupportRepository(prisma) : new InMemorySupportRepository()),
      inject: [PrismaService],
    },
    // «كلّم الدعم»: the desk reads and answers the order's support chat through the chat module.
    { provide: SUPPORT_CHAT, useExisting: ChatService },
    SupportService,
  ],
  exports: [SupportService],
})
export class SupportModule {}
