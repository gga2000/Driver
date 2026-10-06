import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { baghdadDayOfMonth, baghdadHour, baghdadMonth, baghdadMonthRange, shiftMonth, type MonthKey } from '@driver/contracts';
import { CLOCK, type Clock } from '../../shared/clock.js';
import type { NewEvent, Aggregate } from '../events/index.js';

/** The month-start card goes out on the 1st from this Baghdad hour (never at night). */
export const MONTH_CARD_HOUR = 10;
/** How often the job looks (it acts once a month; the idempotency key makes every look after the first a no-op). */
export const MONTH_CARD_EVERY_MS = 3_600_000;
export const MONTH_READY_EVENT = 'insights.month_ready';

/** What the job needs: who had a month worth showing, and the outbox. */
export interface MonthCardSources {
  /** People who placed an order that was delivered or completed in `[from, to)`. */
  activePeople(from: Date, to: Date): Promise<string[]>;
  emit(event: NewEvent, aggregate: Aggregate): Promise<unknown>;
}
export const MONTH_CARD_SOURCES = Symbol('MONTH_CARD_SOURCES');

/**
 * The once-a-month «شهرك» push (joy w6): on the 1st from 10:00 Baghdad, one `insights.month_ready`
 * per person who had last month's activity, keyed `insights.month_ready:<person>:<YYYY-MM>` so every
 * instance and every hourly look sends it once. Notify sends it as `month_ready` (category marketing:
 * only with marketing on, held on quiet days and in quiet hours, inside the weekly cap).
 */
@Injectable()
export class MonthCardJob implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MonthCardJob.name);
  private timer: NodeJS.Timeout | undefined;
  private running = false;

  constructor(
    @Inject(MONTH_CARD_SOURCES) private readonly src: MonthCardSources,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => void this.safeTick(), MONTH_CARD_EVERY_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Emits last month's card for everyone due; returns how many it asked for (0 off the 1st). */
  async tick(): Promise<number> {
    const now = this.clock.now();
    if (baghdadDayOfMonth(now) !== 1 || baghdadHour(now) < MONTH_CARD_HOUR) return 0;
    const month: MonthKey = shiftMonth(baghdadMonth(now), -1);
    const { from, to } = baghdadMonthRange(month);
    const people = [...new Set(await this.src.activePeople(from, to))].sort();
    for (const personId of people) {
      await this.src.emit(
        { type: MONTH_READY_EVENT, actorId: 'system', occurredAt: now, payload: { personId, month }, idempotencyKey: `${MONTH_READY_EVENT}:${personId}:${month}` },
        { name: 'person', id: personId },
      );
    }
    return people.length;
  }

  private async safeTick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const n = await this.tick();
      if (n > 0) this.logger.log(`month card: ${n} people`);
    } catch (err) {
      this.logger.error(`month card failed: ${(err as Error).message}`, (err as Error).stack);
    } finally {
      this.running = false;
    }
  }
}
