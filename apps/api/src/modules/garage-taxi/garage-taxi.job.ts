import { Inject, Injectable, Logger, Optional, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { GARAGE_TAXI_RULES } from '@driver/contracts';
import { GarageTaxiService } from './garage-taxi.service.js';
import { PROCESS_ROLE, runsJobs, type ProcessRole } from '../../shared/process-role.js';

/**
 * Taxi ideas x3 / x4: once a minute, every taxi on its way to a الرجعة car (is it making the car's
 * time?) and every taxi armed to wait at the Aziziyah garage (is the car ten minutes out?). Each
 * outcome is keyed (event idempotency keys, the ride's retry key), so a restart or a second API
 * instance never books or tells twice.
 */
@Injectable()
export class GarageTaxiJob implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(GarageTaxiJob.name);
  private timer: NodeJS.Timeout | undefined;
  private running = false;

  constructor(
    private readonly taxis: GarageTaxiService,
    @Optional() @Inject(PROCESS_ROLE) private readonly role: ProcessRole = 'all',
  ) {}

  onModuleInit(): void {
    // Background work: on DRIVER_ROLE=web machines the worker runs it, so it ticks once, not per machine.
    if (!runsJobs(this.role)) return;
    this.timer = setInterval(() => void this.safeTick(), GARAGE_TAXI_RULES.tickMs);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  tick(): ReturnType<GarageTaxiService['tick']> {
    return this.taxis.tick();
  }

  private async safeTick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const r = await this.tick();
      if (r.placed + r.dropped + r.failed + r.told > 0) this.logger.log(`garage taxis: ${r.placed} booked, ${r.dropped} dropped, ${r.failed} refused, ${r.told} late notices`);
    } catch (err) {
      this.logger.error(`garage taxis failed: ${(err as Error).message}`, (err as Error).stack);
    } finally {
      this.running = false;
    }
  }
}
