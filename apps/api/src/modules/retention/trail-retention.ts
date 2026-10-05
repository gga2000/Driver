import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { TRAIL_RETENTION_DAYS } from '@driver/contracts';
import { CLOCK, type Clock } from '../../shared/clock.js';
import { SupportService } from '../support/index.js';
import { TripsService } from '../trips/index.js';

/** How often the purge runs; each run deletes everything already due, in batches. */
export const TRAIL_PURGE_EVERY_MS = 3_600_000;
/** Rows per DELETE: small enough to keep locks short on a busy table. */
export const TRAIL_PURGE_BATCH = 5_000;
/** Cities whose open incidents keep trails (one city today). */
const CITIES = ['aziziyah'] as const;
const DAY_MS = 86_400_000;

/**
 * Decision D6 (maps program): raw driver trails are deleted after 30 days; the trip row stays as the
 * summary. A trail tied to an unresolved support incident is kept until the incident is resolved.
 * Runs hourly in every API instance; the DELETE is idempotent, so overlapping runs only share the work.
 */
@Injectable()
export class TrailRetention implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TrailRetention.name);
  private timer: NodeJS.Timeout | undefined;
  private running = false;

  constructor(
    private readonly trips: TripsService,
    private readonly support: SupportService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => void this.safeTick(), TRAIL_PURGE_EVERY_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Deletes every trail point past retention; returns how many went. */
  async tick(): Promise<number> {
    const cutoff = new Date(this.clock.now().getTime() - TRAIL_RETENTION_DAYS * DAY_MS);
    const keep = (await Promise.all(CITIES.map((c) => this.support.openIncidentTripIds(c)))).flat();
    let total = 0;
    for (;;) {
      const n = await this.trips.purgeTrail(cutoff, keep, TRAIL_PURGE_BATCH);
      total += n;
      if (n < TRAIL_PURGE_BATCH) return total;
    }
  }

  private async safeTick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const n = await this.tick();
      if (n > 0) this.logger.log(`trail retention: deleted ${n} points older than ${TRAIL_RETENTION_DAYS} days`);
    } catch (err) {
      this.logger.error(`trail retention failed: ${(err as Error).message}`, (err as Error).stack);
    } finally {
      this.running = false;
    }
  }
}
