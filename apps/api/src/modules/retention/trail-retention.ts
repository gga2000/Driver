import { Inject, Injectable, Logger, Optional, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { TRAIL_RETENTION_DAYS } from '@driver/contracts';
import { CLOCK, type Clock } from '../../shared/clock.js';
import { PROCESS_ROLE, runsJobs, type ProcessRole } from '../../shared/process-role.js';
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
 * Runs hourly in every instance that runs jobs (DRIVER_ROLE all or worker). Each run (speed audit z1/z2):
 *   1. makes sure the next days' trail partitions exist (they are daily: one per day);
 *   2. drops every partition whose whole day (or, for the old monthly ones, month) has expired and
 *      that holds no kept trail: no row-by-row delete, no bloat;
 *   3. deletes what is left past retention row by row (a partition a kept trail holds, the default
 *      partition, the expired part of an old monthly one). Idempotent: overlapping runs share the work.
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
    @Optional() @Inject(PROCESS_ROLE) private readonly role: ProcessRole = 'all',
  ) {}

  onModuleInit(): void {
    // Purges are background work: on DRIVER_ROLE=web machines the worker runs them.
    if (!runsJobs(this.role)) return;
    this.timer = setInterval(() => void this.safeTick(), TRAIL_PURGE_EVERY_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Deletes every trail point past retention; returns how many rows went one by one (dropped days aside). */
  async tick(): Promise<number> {
    const now = this.clock.now();
    await this.trips.ensureTrailPartitions(now).catch((err: unknown) => this.logger.error(`trail partitions: ${(err as Error).message}`));
    const cutoff = new Date(now.getTime() - TRAIL_RETENTION_DAYS * DAY_MS);
    const keep = (await Promise.all(CITIES.map((c) => this.support.openIncidentTripIds(c)))).flat();
    // A partition that can't be dropped now (lock wait ran out) is retried next run; the row purge
    // below still clears its expired points meanwhile.
    const drop = await this.trips.dropExpiredTrailPartitions(cutoff, keep).catch((err: unknown) => {
      this.logger.error(`trail partitions: ${(err as Error).message}`);
      return { dropped: [], failed: [] };
    });
    if (drop.dropped.length) this.logger.log(`trail retention: dropped ${drop.dropped.join(', ')}`);
    for (const f of drop.failed) this.logger.warn(`trail retention: ${f.name} not dropped, retrying next run: ${f.error}`);
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
