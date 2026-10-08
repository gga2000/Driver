import { Inject, Injectable, Logger, Optional, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { CLOCK, type Clock } from '../../shared/clock.js';
import { PROCESS_ROLE, runsJobs, type ProcessRole } from '../../shared/process-role.js';
import { EventsService } from '../events/index.js';
import { NotifyService } from '../notify/index.js';

/** How often delivery records are cleared. */
export const DELIVERY_PURGE_EVERY_MS = 60 * 60_000;
/** Rows per DELETE: short locks on tables every event and message writes to. */
export const DELIVERY_PURGE_BATCH = 5_000;
/** Batches per table per run: a large first run spreads over a few hours instead of one long sweep. */
export const DELIVERY_PURGE_MAX_BATCHES = 100;
/** A published event's per-subscriber records are kept this long (support reads them while a case is fresh). */
export const SUBSCRIBER_DELIVERY_KEEP_DAYS = 7;
/** A sent message's record (the Console's message log) is kept this long. */
export const NOTIFY_DELIVERY_KEEP_DAYS = 60;

const DAY_MS = 86_400_000;

/**
 * Speed audit z1: the two bookkeeping tables that grow with every event and every message.
 * `subscriber_deliveries` (one row per event per subscriber) only guards against running a handler
 * twice while its outbox row can still drain; once the row is published it guards nothing, so its
 * records go after a week. `notify_deliveries` rows that are settled (sent, read, failed, …) go after
 * 60 days; queued and deferred ones stay. The outbox and events tables are not touched here: the
 * outbox payload is the event store's read. Runs only where jobs run (DRIVER_ROLE all or worker).
 */
@Injectable()
export class DeliveryRetention implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DeliveryRetention.name);
  private timer: NodeJS.Timeout | undefined;
  private running = false;

  constructor(
    private readonly events: EventsService,
    private readonly notify: NotifyService,
    @Inject(CLOCK) private readonly clock: Clock,
    @Optional() @Inject(PROCESS_ROLE) private readonly role: ProcessRole = 'all',
  ) {}

  onModuleInit(): void {
    // Purges are background work: on DRIVER_ROLE=web machines the worker runs them.
    if (!runsJobs(this.role)) return;
    this.timer = setInterval(() => void this.safeTick(), DELIVERY_PURGE_EVERY_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** One pass over both tables; returns how many rows went from each. */
  async tick(): Promise<{ subscriber: number; notify: number }> {
    const now = this.clock.now().getTime();
    const subscriber = await drain((limit) => this.events.purgeDeliveries(new Date(now - SUBSCRIBER_DELIVERY_KEEP_DAYS * DAY_MS), limit));
    const notify = await drain((limit) => this.notify.purgeDeliveries(new Date(now - NOTIFY_DELIVERY_KEEP_DAYS * DAY_MS), limit));
    return { subscriber, notify };
  }

  private async safeTick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const n = await this.tick();
      if (n.subscriber + n.notify > 0) this.logger.log(`delivery retention: deleted ${n.subscriber} subscriber records and ${n.notify} message records`);
    } catch (err) {
      this.logger.error(`delivery retention failed: ${(err as Error).message}`, (err as Error).stack);
    } finally {
      this.running = false;
    }
  }
}

async function drain(purge: (limit: number) => Promise<number>): Promise<number> {
  let total = 0;
  for (let i = 0; i < DELIVERY_PURGE_MAX_BATCHES; i++) {
    const n = await purge(DELIVERY_PURGE_BATCH);
    total += n;
    if (n < DELIVERY_PURGE_BATCH) break;
  }
  return total;
}
