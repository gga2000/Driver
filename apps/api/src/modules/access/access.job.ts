import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { WAVE_RULES } from '@driver/contracts';
import { AccessService } from './access.service.js';

/**
 * Lets waiting customers in as places open (W5): every minute, each zone with someone waiting. The
 * zone lock and the once-per-person message key make overlapping instances harmless.
 */
@Injectable()
export class AccessSweepJob implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AccessSweepJob.name);
  private timer: NodeJS.Timeout | undefined;
  private running = false;

  constructor(private readonly access: AccessService) {}

  onModuleInit(): void {
    this.timer = setInterval(() => void this.safeTick(), WAVE_RULES.sweepEveryMs);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async safeTick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const n = await this.access.sweep();
      if (n > 0) this.logger.log(`waves: let ${n} people in`);
    } catch (err) {
      this.logger.error(`waves sweep failed: ${(err as Error).message}`, (err as Error).stack);
    } finally {
      this.running = false;
    }
  }
}
