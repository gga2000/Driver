import { Inject, Injectable, Logger, Optional, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { PROCESS_ROLE, runsJobs, type ProcessRole } from '../../shared/process-role.js';
import { ParcelsService } from './parcels.service.js';

/** How often lapsed parcels (door never set in time) are closed. */
export const PARCELS_SWEEP_MS = 60_000;

/**
 * Closes parcels whose receiver never marked the door in time (no fee: no courier order exists).
 * Reads the database each tick and every close is a conditional update, so any number of job machines may run it.
 */
@Injectable()
export class ParcelsJob implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ParcelsJob.name);
  private timer: NodeJS.Timeout | undefined;
  private running = false;

  constructor(
    private readonly parcels: ParcelsService,
    @Optional() @Inject(PROCESS_ROLE) private readonly role: ProcessRole = 'all',
  ) {}

  onModuleInit(): void {
    if (!runsJobs(this.role)) return;
    this.timer = setInterval(() => void this.tick(), PARCELS_SWEEP_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async tick(): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    try {
      const n = await this.parcels.sweep();
      if (n > 0) this.logger.log(`parcels: ${n} closed with no door`);
      return n;
    } catch (err) {
      this.logger.error(`parcels sweep failed: ${(err as Error).message}`, (err as Error).stack);
      return 0;
    } finally {
      this.running = false;
    }
  }
}
