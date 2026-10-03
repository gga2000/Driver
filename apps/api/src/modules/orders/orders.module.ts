import { Inject, Logger, Module, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { CLOCK, type Clock } from '../../shared/clock.js';
import { PrismaService } from '../../shared/db/prisma.service.js';
import { BullMqQueueFactory, InMemoryQueue, type Queue } from '../../shared/queue.js';
import { EventsModule, EventsService } from '../events/index.js';
import { IdentityModule, IdentityService } from '../identity/index.js';
import { CatalogModule, CatalogRpc, CatalogService, STOREFRONT_MERCHANTS } from '../catalog/index.js';
import { CapsService, LedgerModule } from '../ledger/index.js';
import { OrgsModule, OrgsService } from '../orgs/index.js';
import { PricingModule, PricingService } from '../pricing/index.js';
import { PromotionsModule, PromotionsService } from '../promotions/index.js';
import { TripsModule, TripsService } from '../trips/index.js';
import { ORDERS_CATALOG } from './catalog.port.js';
import { EventsServiceAdapter, ORDER_EVENTS } from './events.adapter.js';
import { MERCHANT_DIRECTORY, OrgsMerchantDirectory, type MerchantDirectory } from './merchants.port.js';
import { InMemoryOrdersRepository, ORDERS_REPOSITORY, PrismaOrdersRepository, type OrdersRepository } from './orders.repository.js';
import { ORDERS_ROLE_CHECKER, OrdersRpc } from './orders.rpc.js';
import { ORDERS_CASH_RISK, ORDERS_PRICING, ORDERS_QUEUE, ORDERS_TRIPS, OrdersService, type OrderTimerJob } from './orders.service.js';
import { PARTICIPANT_RESOLVER, type ParticipantResolver } from './participants.js';
import { MerchantDealsPromotions } from './promotions.adapter.js';
import { ORDERS_PROMOTIONS, type PromotionsPort } from './promotions.port.js';
import { OrdersStorefrontMerchants } from './storefront.port.js';

function timersQueue<T>(name: string, factory: BullMqQueueFactory, clock: Clock): Queue<T> {
  return factory.configured ? factory.queue<T>(name) : new InMemoryQueue<T>(name, () => clock.now());
}

/**
 * Wiring: Prisma repository when DATABASE_URL is set, in-memory twin otherwise; timers on the
 * `orders.timers` queue; merchants read through `OrgsService`; participant phones resolved by
 * identity (hash only); the new-customer cash cap read from the ledger's caps; trip events consumed
 * from the outbox as the `orders:trip-events` subscriber.
 */
@Module({
  imports: [EventsModule, TripsModule, PricingModule, OrgsModule, IdentityModule, LedgerModule, CatalogModule, PromotionsModule],
  providers: [
    {
      provide: ORDERS_REPOSITORY,
      useFactory: (prisma: PrismaService): OrdersRepository => (prisma.configured ? new PrismaOrdersRepository(prisma) : new InMemoryOrdersRepository()),
      inject: [PrismaService],
    },
    { provide: ORDER_EVENTS, useFactory: (events: EventsService) => new EventsServiceAdapter(events), inject: [EventsService] },
    { provide: ORDERS_QUEUE, useFactory: (f: BullMqQueueFactory, clock: Clock) => timersQueue<OrderTimerJob>('orders.timers', f, clock), inject: [BullMqQueueFactory, CLOCK] },
    { provide: ORDERS_TRIPS, useExisting: TripsService },
    // M2 review follow-up: fees come from this quote engine at placement, never from the client.
    { provide: ORDERS_PRICING, useExisting: PricingService },
    // Discounts only from the server: merchant deals from the promotions module (best one, spend reserved
    // atomically in the order's transaction); platform codes resolve nothing yet.
    { provide: ORDERS_PROMOTIONS, useFactory: (promotions: PromotionsService) => new MerchantDealsPromotions(promotions), inject: [PromotionsService] },
    // Decisions §4 new-customer cash cap, enforced at place(): the ledger counts completed cash orders.
    { provide: ORDERS_CASH_RISK, useExisting: CapsService },
    // Review C2: line prices come from the merchant's menu (catalog module), never from the client.
    { provide: ORDERS_CATALOG, useExisting: CatalogService },
    { provide: MERCHANT_DIRECTORY, useFactory: (orgs: OrgsService) => new OrgsMerchantDirectory(orgs), inject: [OrgsService] },
    {
      provide: PARTICIPANT_RESOLVER,
      useFactory: (identity: IdentityService): ParticipantResolver => ({ resolvePhone: (phone) => identity.phoneRef(phone) }),
      inject: [IdentityService],
    },
    { provide: ORDERS_ROLE_CHECKER, useExisting: IdentityService },
    // M3 customer catalog read: cards are open exactly when place() takes orders, fees as place() charges.
    { provide: STOREFRONT_MERCHANTS, useFactory: (dir: MerchantDirectory, deals: PromotionsPort) => new OrdersStorefrontMerchants(dir, deals), inject: [MERCHANT_DIRECTORY, ORDERS_PROMOTIONS] },
    CatalogRpc,
    OrdersService,
    OrdersRpc,
  ],
  exports: [OrdersService, OrdersRpc, CatalogRpc],
})
export class OrdersModule implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OrdersModule.name);

  private poller: NodeJS.Timeout | undefined;

  private unsubscribe: (() => void) | undefined;

  constructor(
    @Inject(ORDERS_QUEUE) private readonly queue: Queue<OrderTimerJob>,
    @Inject(ORDER_EVENTS) private readonly events: EventsServiceAdapter,
    private readonly orders: OrdersService,
  ) {}

  onModuleInit(): void {
    // Named outbox subscriber: a failure is retried with backoff by the publisher (and logged there).
    this.unsubscribe = this.events.subscribeToTrips((e) => this.orders.onTripEvent(e));
    const q = this.queue;
    if (q instanceof InMemoryQueue) {
      this.poller = setInterval(() => {
        q.drain().catch((err: unknown) => this.logger.error(`orders timer failed: ${(err as Error).message}`));
      }, 1000);
      this.poller.unref();
    }
  }

  onModuleDestroy(): void {
    this.unsubscribe?.();
    if (this.poller) clearInterval(this.poller);
  }
}
