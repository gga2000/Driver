import { Inject, Injectable, Logger, Optional, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { PROCESS_ROLE, runsJobs, type ProcessRole } from '../../shared/process-role.js';
import { PricingService } from '../pricing/index.js';

/** How often expired quotes are cleared. */
export const QUOTE_PURGE_EVERY_MS = 10 * 60_000;
/** Quotes per DELETE: short locks on a table every choose screen writes to. */
export const QUOTE_PURGE_BATCH = 2_000;

/**
 * LOAD-01 follow-up: `pricing.quote` keeps every quote it hands out (30 minutes to book it), so the
 * quotes nobody booked are deleted an hour after they expire, with their components. A quote an order
 * or trip took stays as long as they do. Runs only where jobs run (DRIVER_ROLE all or worker); several
 * workers split the rows (SKIP LOCKED).
 */
@Injectable()
export class QuoteRetention implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(QuoteRetention.name);
  private timer: NodeJS.Timeout | undefined;
  private running = false;

  constructor(
    private readonly pricing: PricingService,
    @Optional() @Inject(PROCESS_ROLE) private readonly role: ProcessRole = 'all',
  ) {}

  onModuleInit(): void {
    // Purges are background work: on DRIVER_ROLE=web machines the worker runs them.
    if (!runsJobs(this.role)) return;
    this.timer = setInterval(() => void this.safeTick(), QUOTE_PURGE_EVERY_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Deletes every expired, unbooked quote past the grace period; returns how many went. */
  async tick(): Promise<number> {
    let total = 0;
    for (;;) {
      const n = await this.pricing.purgeExpiredQuotes(QUOTE_PURGE_BATCH);
      total += n;
      if (n < QUOTE_PURGE_BATCH) return total;
    }
  }

  private async safeTick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const n = await this.tick();
      if (n > 0) this.logger.log(`quote retention: deleted ${n} expired quotes nobody booked`);
    } catch (err) {
      this.logger.error(`quote retention failed: ${(err as Error).message}`, (err as Error).stack);
    } finally {
      this.running = false;
    }
  }
}
