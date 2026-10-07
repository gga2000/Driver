import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { RideHabitsService } from './ride-habits.service.js';

/** How often the job looks: within each habit's push window (10 → 3 minutes before) it looks at least once. */
export const SAME_RIDE_EVERY_MS = 5 * 60_000;

/**
 * Step 4 (o4): «نفس مشوار البارحة؟» — every 5 minutes on working days, riders whose usual ride is ten
 * minutes away get one `same_ride.due` (once a day: the event is keyed per person and date, so a
 * restart or a second pod never sends it twice). Notify sends it with its own switch.
 */
@Injectable()
export class SameRideJob implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SameRideJob.name);
  private timer: NodeJS.Timeout | undefined;
  private running = false;

  constructor(private readonly habits: RideHabitsService) {}

  onModuleInit(): void {
    this.timer = setInterval(() => void this.safeTick(), SAME_RIDE_EVERY_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Emits every «نفس مشوار البارحة؟» now due; returns how many. */
  tick(): Promise<number> {
    return this.habits.sameRideDue();
  }

  private async safeTick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const n = await this.tick();
      if (n > 0) this.logger.log(`same ride: ${n} offers`);
    } catch (err) {
      this.logger.error(`same ride failed: ${(err as Error).message}`, (err as Error).stack);
    } finally {
      this.running = false;
    }
  }
}
