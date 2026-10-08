import { Inject, Injectable, Module, Optional, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Redis } from 'ioredis';
import { CLOCK, type Clock } from '../../shared/clock.js';
import { PrismaService } from '../../shared/db/prisma.service.js';
import { BullMqQueueFactory, InMemoryQueue, type Queue } from '../../shared/queue.js';
import { TIMER_STORE, TimerSweeper, type TimerStore } from '../../shared/timers/index.js';
import { ConfigModule } from '../config/index.js';
import { ControlsModule, ControlsService } from '../controls/index.js';
import { EventsModule, EventsService } from '../events/index.js';
import { CAPS_PORT as LEDGER_CAPS_PORT, LedgerModule } from '../ledger/index.js';
import { RoutesDeparturesPort, RoutesModule } from '../routes/index.js';
import { TripsModule, TripsService } from '../trips/index.js';
import { DISPATCH_REPOSITORY, InMemoryDispatchRepository, PrismaDispatchRepository, type DispatchRepository } from './dispatch.repository.js';
import { DISPATCH_POLICIES, DispatchService, defaultPolicies } from './dispatch.service.js';
import { DISPATCH_STORE, InMemoryDispatchStore, RedisDispatchStore } from './dispatch.store.js';
import { DISPATCH_EVENTS, EventsServiceAdapter } from './events.adapter.js';
import { DispatchSubscribers } from './events.subscribers.js';
import { GEO_INDEX, InMemoryGeoIndex, RedisGeoIndex } from './geo-index.js';
import { DISPATCH_QUEUE, DISPATCH_QUEUE_NAME, OfferOrchestrator, type TimerJob } from './offer.orchestrator.js';
import { RoutingModule } from '../routing/index.js';
import { NEARBY_SECRET, NearbyService, nearbySecret } from './nearby.service.js';
import { ZoneDemandService } from './zone-demand.service.js';
import { DispatchOfferCheck } from './offer-check.js';
import { CAPS, DEPARTURES, DISPATCH_HOLDS, TRIP_OFFERS, type CapsPort, type TripOffersPort } from './ports.js';
import { PresenceService } from './presence.service.js';
import { DriverRanker } from './ranker.js';
import { TripsServiceTripOffers } from './trips.adapter.js';
import { ClimateChecks, InMemoryShiftCheckStore, PrismaShiftCheckStore, SHIFT_CHECK_STORE } from './climate-checks.js';
import { InMemoryVehicleFacts, PrismaVehicleFacts, VEHICLE_FACTS } from './vehicle-facts.js';
import { ZoneDirectory } from './zones.js';

export const DISPATCH_REDIS = Symbol('DISPATCH_REDIS');

/**
 * Owns dispatch's Redis connection (geo index, locks, runtime state), hands the far-ahead timers to the
 * durable timer table, and, when there is no Redis, ticks the in-memory timer queue once a second so dev
 * boxes still see waves advance.
 */
@Injectable()
export class DispatchRuntime implements OnModuleDestroy {
  private readonly timer: NodeJS.Timeout | undefined;

  constructor(
    @Inject(DISPATCH_REDIS) private readonly redis: Redis | null,
    @Inject(DISPATCH_QUEUE) queue: Queue<TimerJob>,
    orchestrator: OfferOrchestrator,
    @Inject(TIMER_STORE) timers: TimerStore,
    @Optional() sweeper: TimerSweeper | null,
  ) {
    // NTF-05: booked rides' and departures' far-ahead timers survive a lost Redis job.
    orchestrator.bindDurableTimers(timers, sweeper ?? null);
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
 * Ports: TRIP_OFFERS → `TripsService` (create the courier trip, offer / accept / decline / timeout);
 * and the other way, `DispatchOfferCheck` is bound into `TripsService` so trips accepts or declines
 * only for a driver holding an open `DispatchOffer` (`dispatch.respond` is the only public path);
 * CAPS → the ledger's caps by role and tier (`isOverCap`, `canOffer` with the job's cash);
 * DEPARTURES → the routes module's `RoutesDeparturesPort` (real fill, walk-ups counted after the
 * driver's selfie). The routes module owns the T−30 low-fill rule; this port's cancel re-applies it.
 * Subscribers (`DispatchSubscribers`): `dispatch:auto-assign` on order acceptance, and
 * `dispatch:trip-events` for accept/decline from trips, completion, cancellation and pickup.
 */
@Module({
  imports: [ConfigModule, EventsModule, TripsModule, LedgerModule, RoutesModule, ControlsModule, RoutingModule],
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
    { provide: TRIP_OFFERS, useFactory: (trips: TripsService) => new TripsServiceTripOffers(trips), inject: [TripsService] },
    // Ride idea x1: «المكيّفة شغالة اليوم؟» — a driver's answer for the shift (`driver_shift_checks`).
    {
      provide: SHIFT_CHECK_STORE,
      useFactory: (prisma: PrismaService) => (prisma.configured ? new PrismaShiftCheckStore(prisma) : new InMemoryShiftCheckStore()),
      inject: [PrismaService],
    },
    ClimateChecks,
    // Ride step 3: the car riders are told about (model, colour, confirmed features) and trip counts;
    // x1: less what the driver said is not working this shift.
    {
      provide: VEHICLE_FACTS,
      useFactory: (prisma: PrismaService, trips: TripsService, checks: ClimateChecks) =>
        prisma.configured
          ? new PrismaVehicleFacts(prisma, (ids) => checks.offNow(ids))
          : new InMemoryVehicleFacts(async (driverId) => (await trips.completedForDriver(driverId, new Date(0))).filter((t) => t.state === 'completed').length, (ids) => checks.offNow(ids)),
      inject: [PrismaService, TripsService, ClimateChecks],
    },
    { provide: CAPS, useExisting: LEDGER_CAPS_PORT },
    { provide: DEPARTURES, useExisting: RoutesDeparturesPort },
    // Launch kill switches with "hold dispatch" turn new jobs in their scope suggest-only.
    { provide: DISPATCH_HOLDS, useExisting: ControlsService },
    PresenceService,
    { provide: NEARBY_SECRET, useFactory: nearbySecret },
    NearbyService,
    ZoneDemandService,
    OfferOrchestrator,
    DispatchRuntime,
    DispatchService,
  ],
  exports: [DispatchService, VEHICLE_FACTS, ClimateChecks],
})
export class DispatchModule implements OnModuleInit, OnModuleDestroy {
  private unsubscribe: Array<() => void> = [];

  constructor(
    private readonly events: EventsService,
    private readonly orchestrator: OfferOrchestrator,
    private readonly zones: ZoneDirectory,
    @Inject(TRIP_OFFERS) private readonly trips: TripOffersPort,
    private readonly tripsService: TripsService,
    @Inject(DISPATCH_REPOSITORY) private readonly offers: DispatchRepository,
    @Inject(CAPS) private readonly caps: CapsPort,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  onModuleInit(): void {
    // M2 review follow-up: trips lets a driver accept/decline only with an open DispatchOffer.
    this.tripsService.bindOfferCheck(new DispatchOfferCheck(this.offers, this.caps, () => this.clock.now()));
    this.unsubscribe = new DispatchSubscribers(this.orchestrator, this.trips, this.zones).register(this.events);
  }

  onModuleDestroy(): void {
    for (const off of this.unsubscribe) off();
  }
}
