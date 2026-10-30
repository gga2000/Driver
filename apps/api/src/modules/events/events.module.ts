import { Inject, Logger, Module, Optional, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
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

/** How often a job machine checks the money alarm, and how often it repeats it while it lasts. */
export const MONEY_ALARM_CHECK_MS = 60_000;
export const MONEY_ALARM_REPEAT_MS = 10 * 60_000;

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
  private readonly logger = new Logger('MoneyAlarm');

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
    if (runsJobs(this.role)) {
      this.alarmTimer = setInterval(() => void this.checkMoneyAlarm(), MONEY_ALARM_CHECK_MS);
      this.alarmTimer.unref();
    }
  }

  onModuleDestroy(): void {
    this.publisher.stop();
    if (this.alarmTimer) clearInterval(this.alarmTimer);
  }

  private alarmTimer: NodeJS.Timeout | undefined;
  private alarmLoggedAt = 0;

  /**
   * The money alarm (job machines, every minute): a ledger posting failed for good, or a row pending
   * longer than 2 min, is logged as an error — so it reaches Sentry — when it starts and every
   * 10 min while it lasts. The Console shows the same alarm on its strip (`system.moneyAlarm`).
   */
  async checkMoneyAlarm(now = Date.now()): Promise<boolean> {
    try {
      const a = await this.events.moneyAlarm();
      if (!a.alarm) {
        if (this.alarmLoggedAt) this.logger.log('money alarm cleared: no ledger posting is stuck in the outbox');
        this.alarmLoggedAt = 0;
        return false;
      }
      if (now - this.alarmLoggedAt >= MONEY_ALARM_REPEAT_MS) {
        this.alarmLoggedAt = now;
        this.logger.error(`money alarm: ${a.ledgerFailed} failed ledger posting(s) in the outbox, oldest pending row ${a.oldestPendingSec} s old — requeue from the Console System page once the cause is fixed`);
      }
      return true;
    } catch (err) {
      this.logger.warn(`money alarm: cannot tell (${(err as Error).message})`);
      return false;
    }
  }
}
