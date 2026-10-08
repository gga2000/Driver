import { Inject, Injectable, Logger, Optional, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { PROCESS_ROLE, runsJobs, type ProcessRole } from '../../shared/process-role.js';
import { IdentityService } from './identity.service.js';

/** How often deleted accounts whose erasure hasn't finished are tried again. */
export const ERASURE_EVERY_MS = 10 * 60_000;

/**
 * W7: every ten minutes, deleted people some module still has to erase (a step failed, or an order of
 * his was still on its way) get every step run again; `people.erased_at` is set once all succeed. The
 * steps are idempotent, so a second machine or a restart only repeats work already done.
 */
@Injectable()
export class AccountErasureJob implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AccountErasureJob.name);
  private timer: NodeJS.Timeout | undefined;
  private running = false;

  constructor(
    private readonly identity: IdentityService,
    @Optional() @Inject(PROCESS_ROLE) private readonly role: ProcessRole = 'all',
  ) {}

  onModuleInit(): void {
    // Background work: on DRIVER_ROLE=web machines the worker runs it.
    if (!runsJobs(this.role)) return;
    this.timer = setInterval(() => void this.safeTick(), ERASURE_EVERY_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** One pass; returns how many deleted people finished erasing. */
  tick(): Promise<number> {
    return this.identity.deletion.resume();
  }

  private async safeTick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const n = await this.tick();
      if (n > 0) this.logger.log(`account erasure: ${n} finished`);
    } catch (err) {
      this.logger.error(`account erasure failed: ${(err as Error).message}`, (err as Error).stack);
    } finally {
      this.running = false;
    }
  }
}
