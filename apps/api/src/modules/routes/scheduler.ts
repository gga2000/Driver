import { Inject, Injectable, Logger, Optional, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { AgreementsService } from './agreements.service.js';
import { DemandService } from './demand.service.js';
import { DeparturesService } from './departures.service.js';
import { RequestBoardService } from './request-board.service.js';
import { RoutesWriter } from './writer.js';
import { PROCESS_ROLE, runsJobs, type ProcessRole } from '../../shared/process-role.js';

export interface RoutesTickResult {
  expiredHolds: number;
  boarding: number;
  lowFill: number;
  closed: number;
  demandExpired: number;
  demandEscalated: number;
  requestsExpired: number;
  agreementsExpired: number;
}

/**
 * The routes module's clock-driven rules, run every 15 s in one write: holds lapse, T−30 boarding
 * or low-fill cancel (this module owns low fill), arrived runs close, demand posts expire or
 * escalate, request-board posts expire,
 * agreed-price asks and prices lapse. Every step is idempotent, so a missed tick only delays.
 * Tests and the simulator call `tick()` on their own clock.
 */
@Injectable()
export class RoutesScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RoutesScheduler.name);
  private timer: NodeJS.Timeout | undefined;
  private running = false;

  constructor(
    private readonly writer: RoutesWriter,
    private readonly departures: DeparturesService,
    private readonly demand: DemandService,
    private readonly requests: RequestBoardService,
    private readonly agreements: AgreementsService,
    @Optional() @Inject(PROCESS_ROLE) private readonly role: ProcessRole = 'all',
  ) {}

  onModuleInit(): void {
    // Background work: on DRIVER_ROLE=web machines the worker runs it, so it ticks once, not per machine.
    if (!runsJobs(this.role)) return;
    this.timer = setInterval(() => void this.safeTick(), 15_000);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  tick(): Promise<RoutesTickResult> {
    return this.writer.run(async (tx) => {
      const d = await this.departures.tick(tx);
      const m = await this.demand.tick(tx);
      const r = await this.requests.tick(tx);
      const a = await this.agreements.tick(tx);
      return {
        expiredHolds: d.expired,
        boarding: d.boarding,
        lowFill: d.lowFill,
        closed: d.closed,
        demandExpired: m.expired,
        demandEscalated: m.escalated,
        requestsExpired: r,
        agreementsExpired: a,
      };
    });
  }

  private async safeTick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.tick();
    } catch (err) {
      this.logger.error(`routes tick failed: ${(err as Error).message}`, (err as Error).stack);
    } finally {
      this.running = false;
    }
  }
}
