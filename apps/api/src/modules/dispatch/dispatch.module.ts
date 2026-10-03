import { Inject, Injectable, Module, type OnModuleDestroy } from '@nestjs/common';
import { Redis } from 'ioredis';
import { CLOCK, type Clock } from '../../shared/clock.js';
import { PrismaService } from '../../shared/db/prisma.service.js';
import { BullMqQueueFactory, InMemoryQueue, type Queue } from '../../shared/queue.js';
import { ConfigModule } from '../config/index.js';
import { EventsModule, EventsService } from '../events/index.js';
import { DISPATCH_REPOSITORY, InMemoryDispatchRepository, PrismaDispatchRepository } from './dispatch.repository.js';
import { DISPATCH_POLICIES, DispatchService, defaultPolicies } from './dispatch.service.js';
import { DISPATCH_STORE, InMemoryDispatchStore, RedisDispatchStore } from './dispatch.store.js';
import { DISPATCH_EVENTS, EventsServiceAdapter } from './events.adapter.js';
import { GEO_INDEX, InMemoryGeoIndex, RedisGeoIndex } from './geo-index.js';
import { DISPATCH_QUEUE, DISPATCH_QUEUE_NAME, OfferOrchestrator, type TimerJob } from './offer.orchestrator.js';
import { CAPS, DEPARTURES, TRIP_OFFERS, UnwiredCaps, UnwiredDepartures, UnwiredTripOffers } from './ports.js';
import { PresenceService } from './presence.service.js';
import { DriverRanker } from './ranker.js';
import { ZoneDirectory } from './zones.js';

export const DISPATCH_REDIS = Symbol('DISPATCH_REDIS');

/**
 * Owns dispatch's Redis connection (geo index, locks, runtime state) and, when there is no Redis,
 * ticks the in-memory timer queue once a second so dev boxes still see waves advance.
 */
@Injectable()
export class DispatchRuntime implements OnModuleDestroy {
  private readonly timer: NodeJS.Timeout | undefined;

  constructor(
    @Inject(DISPATCH_REDIS) private readonly redis: Redis | null,
    @Inject(DISPATCH_QUEUE) queue: Queue<TimerJob>,
  ) {
    if (queue instanceof InMemoryQueue) {
      this.timer = setInterval(() => void queue.drain().catch(() => undefined), 1000);
      this.timer.unref();
    }
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.redis?.disconnect();
  }
}

/**
 * Wiring: Redis-backed geo index, state store and BullMQ timers when REDIS_URL is set, in-memory
 * twins otherwise; Prisma `DispatchOffer` repository when DATABASE_URL is set.
 *
 * TODO(M2 Step 4 merge): bind TRIP_OFFERS to the rebuilt TripsService (offer/assign) and subscribe
 *   `order.merchant_accepted` → `DispatchService.request` (auto-assign), trip pickup/completion →
 *   `markPickedUp` / `jobFinished`, customer cancel → `cancel`.
 * TODO(M2 Step 6 merge): bind CAPS to the ledger's caps-by-role `isOverCap(driverId)`.
 * TODO(routes): bind DEPARTURES to the routes module (seats incl. walk-ups, cancelled_low_fill).
 */
@Module({
  imports: [ConfigModule, EventsModule],
  providers: [
    ZoneDirectory,
    DriverRanker,
    { provide: DISPATCH_POLICIES, useFactory: defaultPolicies },
    {
      provide: DISPATCH_REDIS,
      useFactory: () => {
        const url = process.env['REDIS_URL'];
        return url ? new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 3 }) : null;
      },
    },
    {
      provide: GEO_INDEX,
      useFactory: (redis: Redis | null, clock: Clock) => (redis ? new RedisGeoIndex(redis) : new InMemoryGeoIndex(() => clock.now())),
      inject: [DISPATCH_REDIS, CLOCK],
    },
    {
      provide: DISPATCH_STORE,
      useFactory: (redis: Redis | null, clock: Clock) => (redis ? new RedisDispatchStore(redis) : new InMemoryDispatchStore(() => clock.now())),
      inject: [DISPATCH_REDIS, CLOCK],
    },
    {
      provide: DISPATCH_REPOSITORY,
      useFactory: (prisma: PrismaService) => (prisma.configured ? new PrismaDispatchRepository(prisma) : new InMemoryDispatchRepository()),
      inject: [PrismaService],
    },
    {
      provide: DISPATCH_QUEUE,
      useFactory: (queues: BullMqQueueFactory, clock: Clock) =>
        queues.configured ? queues.queue<TimerJob>(DISPATCH_QUEUE_NAME) : new InMemoryQueue<TimerJob>(DISPATCH_QUEUE_NAME, () => clock.now()),
      inject: [BullMqQueueFactory, CLOCK],
    },
    { provide: DISPATCH_EVENTS, useFactory: (events: EventsService) => new EventsServiceAdapter(events), inject: [EventsService] },
    // TODO(M2 Step 4/6 merge): real ports — see the class comment.
    { provide: TRIP_OFFERS, useClass: UnwiredTripOffers },
    { provide: CAPS, useClass: UnwiredCaps },
    { provide: DEPARTURES, useClass: UnwiredDepartures },
    PresenceService,
    OfferOrchestrator,
    DispatchRuntime,
    DispatchService,
  ],
  exports: [DispatchService],
})
export class DispatchModule {}
