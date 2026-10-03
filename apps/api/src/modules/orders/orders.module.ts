import { Inject, Logger, Module, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { CLOCK, type Clock } from '../../shared/clock.js';
import { PrismaService } from '../../shared/db/prisma.service.js';
import { BullMqQueueFactory, InMemoryQueue, type Queue } from '../../shared/queue.js';
import { EventsModule, EventsService } from '../events/index.js';
import { IdentityModule, IdentityService } from '../identity/index.js';
import { OrgsModule, OrgsService } from '../orgs/index.js';
import { PricingModule, PricingService } from '../pricing/index.js';
import { TripsModule, TripsService } from '../trips/index.js';
import { EventsServiceAdapter, ORDER_EVENTS } from './events.adapter.js';
import { MERCHANT_DIRECTORY, OrgsMerchantDirectory } from './merchants.port.js';
import { InMemoryOrdersRepository, ORDERS_REPOSITORY, PrismaOrdersRepository, type OrdersRepository } from './orders.repository.js';
import { ORDERS_ROLE_CHECKER, OrdersRpc } from './orders.rpc.js';
import { ORDERS_PRICING, ORDERS_QUEUE, ORDERS_TRIPS, OrdersService, type OrderTimerJob } from './orders.service.js';
import { PARTICIPANT_RESOLVER, type ParticipantResolver } from './participants.js';

function timersQueue<T>(name: string, factory: BullMqQueueFactory, clock: Clock): Queue<T> {
  return factory.configured ? factory.queue<T>(name) : new InMemoryQueue<T>(name, () => clock.now());
}

/**
 * Wiring: Prisma repository when DATABASE_URL is set, in-memory twin otherwise; timers on the
 * `orders.timers` queue; merchants read through `OrgsService`; participant phones resolved by
 * identity (hash only); trip events consumed from the events module.
 */
@Module({
  imports: [EventsModule, TripsModule, PricingModule, OrgsModule, IdentityModule],
  providers: [
    {
      provide: ORDERS_REPOSITORY,
      useFactory: (prisma: PrismaService): OrdersRepository => (prisma.configured ? new PrismaOrdersRepository(prisma) : new InMemoryOrdersRepository()),
      inject: [PrismaService],
    },
    { provide: ORDER_EVENTS, useFactory: (events: EventsService) => new EventsServiceAdapter(events), inject: [EventsService] },
    { provide: ORDERS_QUEUE, useFactory: (f: BullMqQueueFactory, clock: Clock) => timersQueue<OrderTimerJob>('orders.timers', f, clock), inject: [BullMqQueueFactory, CLOCK] },
    { provide: ORDERS_TRIPS, useExisting: TripsService },
    { provide: ORDERS_PRICING, useExisting: PricingService },
    { provide: MERCHANT_DIRECTORY, useFactory: (orgs: OrgsService) => new OrgsMerchantDirectory(orgs), inject: [OrgsService] },
    {
      provide: PARTICIPANT_RESOLVER,
      useFactory: (identity: IdentityService): ParticipantResolver => ({ resolvePhone: (phone) => identity.phoneRef(phone) }),
      inject: [IdentityService],
    },
    { provide: ORDERS_ROLE_CHECKER, useExisting: IdentityService },
    OrdersService,
    OrdersRpc,
  ],
  exports: [OrdersService, OrdersRpc],
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
    this.unsubscribe = this.events.subscribeToTrips((e) => this.orders.onTripEvent(e).catch((err: unknown) => this.logger.error(`trip event ${e.type}: ${(err as Error).message}`)));
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
