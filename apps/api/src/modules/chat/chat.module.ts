import { Module, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../shared/db/prisma.service.js';
import { EventsModule, EventsService } from '../events/index.js';
import { IdentityModule, IdentityService } from '../identity/index.js';
import { NotifyModule, NotifyService } from '../notify/index.js';
import { OrdersModule, OrdersService } from '../orders/index.js';
import { OrgsModule, OrgsService } from '../orgs/index.js';
import { PlacesModule } from '../places/index.js';
import { TripsModule, TripsService } from '../trips/index.js';
import { CALL_BRIDGE, DevCallBridge, isDevEnvironment, ProxyCallBridge } from './call-bridge.js';
import { registerChatNotifications } from './chat.notify.js';
import { CHAT_REPOSITORY, InMemoryChatRepository, PrismaChatRepository } from './chat.repository.js';
import { CHAT_IDENTITY, CHAT_ORDERS, CHAT_STORES, CHAT_TRIPS, ChatService, type ChatStoresPort } from './chat.service.js';

/**
 * In-order chat and masked calls. Owns `chat_threads`, `chat_messages`, `chat_reads` (Prisma when
 * DATABASE_URL is set, in memory otherwise). Reads orders, trips, identity (roles, first names,
 * logged) and orgs (store names) through their public services; photos are `places` uploads.
 *
 * Call bridge: `DevCallBridge` (the other party's own number, logged vault read) only when NODE_ENV
 * is development or test and CALL_BRIDGE is not `proxy`; otherwise `ProxyCallBridge` with
 * CALL_PROXY_NUMBER (unset → `call_unavailable`).
 *
 * Realtime: clients poll `chat.thread` every 3 s (`CHAT_POLL_MS`) until the push/subscription channel
 * (Supabase Realtime or Ably, platform core §infrastructure) ships; the push notification already
 * goes out through the outbox.
 */
@Module({
  imports: [EventsModule, IdentityModule, NotifyModule, OrdersModule, OrgsModule, PlacesModule, TripsModule],
  providers: [
    {
      provide: CHAT_REPOSITORY,
      useFactory: (prisma: PrismaService) => (prisma.configured ? new PrismaChatRepository(prisma) : new InMemoryChatRepository()),
      inject: [PrismaService],
    },
    { provide: CHAT_ORDERS, useExisting: OrdersService },
    { provide: CHAT_TRIPS, useExisting: TripsService },
    { provide: CHAT_IDENTITY, useExisting: IdentityService },
    {
      provide: CHAT_STORES,
      useFactory: (orgs: OrgsService): ChatStoresPort => ({
        storeName: async (orgId) => {
          try {
            return (await Promise.resolve(orgs.get(orgId))).name;
          } catch {
            return null;
          }
        },
      }),
      inject: [OrgsService],
    },
    {
      provide: CALL_BRIDGE,
      useFactory: (identity: IdentityService) =>
        isDevEnvironment(process.env['NODE_ENV']) && process.env['CALL_BRIDGE'] !== 'proxy' ? new DevCallBridge(identity) : new ProxyCallBridge(process.env['CALL_PROXY_NUMBER']),
      inject: [IdentityService],
    },
    ChatService,
  ],
  exports: [ChatService],
})
export class ChatModule implements OnModuleInit, OnModuleDestroy {
  private unsubscribe: (() => void) | null = null;

  constructor(
    private readonly events: EventsService,
    private readonly notify: NotifyService,
  ) {}

  onModuleInit(): void {
    this.unsubscribe = registerChatNotifications(this.events, this.notify);
  }

  onModuleDestroy(): void {
    this.unsubscribe?.();
  }
}
