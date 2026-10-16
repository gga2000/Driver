import { Inject, Injectable, Logger, Optional, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { RideHabitsService } from './ride-habits.service.js';
import { PROCESS_ROLE, runsJobs, type ProcessRole } from '../../shared/process-role.js';

/** How often the reminder job looks (each occurrence is asked about once: the event is keyed per trip and date). */
export const REGULAR_TRIP_EVERY_MS = 5 * 60_000;

/**
 * Joy r5: «تأكد رحلتك؟» — every 5 minutes, the regular trips whose ask time (20:00 the evening
 * before, or 08:00 that morning) has come get their `regular_trip.due`, once per trip and day. Notify
 * sends it as `regular_trip_reminder` (its own switch, quiet hours and quiet days respected).
 */
@Injectable()
export class RegularTripJob implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RegularTripJob.name);
  private timer: NodeJS.Timeout | undefined;
  private running = false;

  constructor(
    private readonly habits: RideHabitsService,
    @Optional() @Inject(PROCESS_ROLE) private readonly role: ProcessRole = 'all',
  ) {}

  onModuleInit(): void {
    // Background work: on DRIVER_ROLE=web machines the worker runs it, so it ticks once, not per machine.
    if (!runsJobs(this.role)) return;
    this.timer = setInterval(() => void this.safeTick(), REGULAR_TRIP_EVERY_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Emits every reminder now due; returns how many. */
  tick(): Promise<number> {
    return this.habits.remindDue();
  }

  private async safeTick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const n = await this.tick();
      if (n > 0) this.logger.log(`regular trips: ${n} reminders`);
    } catch (err) {
      this.logger.error(`regular trips failed: ${(err as Error).message}`, (err as Error).stack);
    } finally {
      this.running = false;
    }
  }
}
