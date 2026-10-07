import { Inject, Logger, Module, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { CLOCK, type Clock } from '../../shared/clock.js';
import { PrismaService } from '../../shared/db/prisma.service.js';
import { BullMqQueueFactory, InMemoryQueue, type Queue } from '../../shared/queue.js';
import { EventsModule, EventsService } from '../events/index.js';
import { IdentityModule, IdentityService } from '../identity/index.js';
import { BLOB_STORE, PlacesModule, type BlobStore } from '../places/index.js';
import { EventsServiceAdapter, TRIP_EVENTS } from './events.adapter.js';
import { HANDOVER_PHOTOS, type HandoverPhotos } from './handover-photos.js';
import { TRIP_ORDER_LOOKUP } from './trip-order.lookup.js';
import { InMemoryTripsRepository, PrismaTripsRepository, TRIPS_REPOSITORY, type TripsRepository } from './trips.repository.js';
import { TRIPS_CHILD_NAMES, TRIPS_DRIVER_CARDS, TRIPS_ROLE_CHECKER, TripsRpc } from './trips.rpc.js';
import { TRIPS_QUEUE, TripsService, type TripTimerJob } from './trips.service.js';

/** BullMQ when REDIS_URL is set; otherwise an in-process queue the module polls once a second. */
function timersQueue<T>(name: string, factory: BullMqQueueFactory, clock: Clock): Queue<T> {
  return factory.configured ? factory.queue<T>(name) : new InMemoryQueue<T>(name, () => clock.now());
}

/**
 * Wiring: Prisma repository when DATABASE_URL is set, in-memory twin otherwise; timers on the
 * `trips.timers` queue; the repository doubles as the events module's `TripOrderLookup`.
 */
@Module({
  imports: [EventsModule, IdentityModule, PlacesModule],
  providers: [
    {
      // Maps program f11: delivery photos are uploads in the places module's blob store.
      provide: HANDOVER_PHOTOS,
      useFactory: (blobs: BlobStore): HandoverPhotos => ({
        owns: async (id, personId) => {
          const rec = await blobs.get(id);
          return rec !== null && rec.ownerId === personId && rec.state === 'stored';
        },
        readUrl: (id) => blobs.readUrl(id),
        remove: (id) => blobs.remove(id),
      }),
      inject: [BLOB_STORE],
    },
    {
      provide: TRIPS_REPOSITORY,
      useFactory: (prisma: PrismaService): TripsRepository => (prisma.configured ? new PrismaTripsRepository(prisma) : new InMemoryTripsRepository()),
      inject: [PrismaService],
    },
    { provide: TRIP_ORDER_LOOKUP, useExisting: TRIPS_REPOSITORY },
    { provide: TRIP_EVENTS, useFactory: (events: EventsService) => new EventsServiceAdapter(events), inject: [EventsService] },
    { provide: TRIPS_QUEUE, useFactory: (f: BullMqQueueFactory, clock: Clock) => timersQueue<TripTimerJob>('trips.timers', f, clock), inject: [BullMqQueueFactory, CLOCK] },
    { provide: TRIPS_ROLE_CHECKER, useExisting: IdentityService },
    // M2 review follow-up: children's names come only from the identity vault, read (and logged) there.
    { provide: TRIPS_CHILD_NAMES, useExisting: IdentityService },
    // s1: the Console's night-ride code alerts name the driver (masked number), read and logged in identity.
    { provide: TRIPS_DRIVER_CARDS, useExisting: IdentityService },
    TripsService,
    TripsRpc,
  ],
  exports: [TripsService, TripsRpc, TRIP_ORDER_LOOKUP],
})
export class TripsModule implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TripsModule.name);

  private poller: NodeJS.Timeout | undefined;

  constructor(
    @Inject(TRIPS_QUEUE) private readonly queue: Queue<TripTimerJob>,
    @Inject(TRIPS_REPOSITORY) private readonly repo: TripsRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async onModuleInit(): Promise<void> {
    const q = this.queue;
    if (q instanceof InMemoryQueue) {
      this.poller = setInterval(() => {
        q.drain().catch((err: unknown) => this.logger.error(`trips timer failed: ${(err as Error).message}`));
      }, 1000);
      this.poller.unref();
    }
    if (this.repo instanceof PrismaTripsRepository) {
      await this.repo.ensureTrailPartitions(this.clock.now()).catch((err: unknown) => this.logger.warn(`trail partitions: ${(err as Error).message}`));
    }
  }

  onModuleDestroy(): void {
    if (this.poller) clearInterval(this.poller);
  }
}
