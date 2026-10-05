import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { HANDOVER_PHOTO_RETENTION_DAYS } from '@driver/contracts';
import { CLOCK, type Clock } from '../../shared/clock.js';
import { TripsService } from '../trips/index.js';

/** How often the purge runs (with the trails). */
export const HANDOVER_PHOTO_PURGE_EVERY_MS = 3_600_000;
/** Photos per round: each is a storage delete plus a row update. */
export const HANDOVER_PHOTO_PURGE_BATCH = 200;
const DAY_MS = 86_400_000;

/**
 * Decision D6 for delivery photos (maps program f11): a courier's handover photo is evidence for a
 * dispute and nothing more, so it goes 30 days after the delivery; the stop keeps `photoPurgedAt`.
 * Hourly in every API instance; a photo already gone is simply not found again.
 */
@Injectable()
export class HandoverPhotoRetention implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(HandoverPhotoRetention.name);
  private timer: NodeJS.Timeout | undefined;
  private running = false;

  constructor(
    private readonly trips: TripsService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => void this.safeTick(), HANDOVER_PHOTO_PURGE_EVERY_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Deletes every delivery photo past retention; returns how many went. */
  async tick(): Promise<number> {
    const cutoff = new Date(this.clock.now().getTime() - HANDOVER_PHOTO_RETENTION_DAYS * DAY_MS);
    let total = 0;
    for (;;) {
      const n = await this.trips.purgeHandoverPhotos(cutoff, HANDOVER_PHOTO_PURGE_BATCH);
      total += n;
      if (n < HANDOVER_PHOTO_PURGE_BATCH) return total;
    }
  }

  private async safeTick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const n = await this.tick();
      if (n > 0) this.logger.log(`handover photo retention: deleted ${n} photos older than ${HANDOVER_PHOTO_RETENTION_DAYS} days`);
    } catch (err) {
      this.logger.error(`handover photo retention failed: ${(err as Error).message}`, (err as Error).stack);
    } finally {
      this.running = false;
    }
  }
}
