import { Inject, Module, Optional, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { CLOCK, type Clock } from '../../shared/clock.js';
import { PrismaService } from '../../shared/db/prisma.service.js';
import { UnitOfWork } from '../../shared/db/unit-of-work.js';
import { PROCESS_ROLE, runsJobs, type ProcessRole } from '../../shared/process-role.js';
import { BullMqQueueFactory } from '../../shared/queue.js';
import { WorkerSelfCheck } from '../../shared/worker-self-check.js';
import { CONTRADICTION_SUBSCRIBER, ContradictionDetector } from './contradiction.detector.js';
import { EVENTS_REPOSITORY, PrismaEventsRepository, type EventsRepository } from './events.repository.js';
import { EventsService } from './events.service.js';
import { InMemoryEventsRepository } from './memory.repository.js';
import { OUTBOX_QUEUE, OutboxPublisher, type OutboxTick } from './outbox.publisher.js';
import { SubscriberRegistry } from './subscriber.registry.js';

/**
 * Wiring: Prisma repository when DATABASE_URL is set, in-memory twin otherwise; the outbox
 * publisher runs a BullMQ worker on `outbox` when REDIS_URL is set and drains after each commit
 * otherwise. The contradiction detector is the module's own named subscriber.
 */
@Module({
  providers: [
    {
      provide: EVENTS_REPOSITORY,
      useFactory: (prisma: PrismaService): EventsRepository => (prisma.configured ? new PrismaEventsRepository(prisma) : new InMemoryEventsRepository()),
      inject: [PrismaService],
    },
    SubscriberRegistry,
    {
      provide: OutboxPublisher,
      useFactory: (repo: EventsRepository, registry: SubscriberRegistry, uow: UnitOfWork, clock: Clock, queues: BullMqQueueFactory) =>
        new OutboxPublisher(repo, registry, uow, clock, queues.configured ? queues.queue<OutboxTick>(OUTBOX_QUEUE) : null),
      inject: [EVENTS_REPOSITORY, SubscriberRegistry, UnitOfWork, CLOCK, BullMqQueueFactory],
    },
    EventsService,
  ],
  exports: [EventsService],
})
export class EventsModule implements OnModuleInit, OnModuleDestroy {
  constructor(
    private readonly events: EventsService,
    private readonly publisher: OutboxPublisher,
    @Inject(EVENTS_REPOSITORY) private readonly repo: EventsRepository,
    @Inject(CLOCK) private readonly clock: Clock,
    @Optional() @Inject(PROCESS_ROLE) private readonly role: ProcessRole = 'all',
    @Optional() private readonly selfCheck?: WorkerSelfCheck,
  ) {}

  onModuleInit(): void {
    const detector = new ContradictionDetector(this.repo, this.events, this.clock);
    this.events.subscribe(CONTRADICTION_SUBSCRIBER, '*', async (e, ctx) => {
      await detector.check(e, ctx.tx);
    });
    // DRIVER_ROLE=web: commits only poke the queue; job machines also drain from Postgres every 500 ms.
    this.publisher.start({ interval: runsJobs(this.role) });
    this.selfCheck?.watch({ name: 'outbox', oldestOverdueMs: () => this.publisher.oldestOverdueMs(), lastProgressAt: () => this.publisher.lastProgressAt });
  }

  onModuleDestroy(): void {
    this.publisher.stop();
  }
}
