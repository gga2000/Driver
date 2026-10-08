import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { OrdersStaffService } from './orders.staff.js';

/** How often the W3 watchdog looks (free-cancel offers on platform failure, dispute deadlines, the stuck list's enter/leave events). */
export const ORDERS_STAFF_SWEEP_MS = 5 * 60_000;

/**
 * The W3 watchdog: every 5 minutes, `OrdersStaffService.sweep()`. It reads the database each time
 * (no in-memory timers to lose on a restart), and every effect is once per order (checked against the
 * order's event log), so a second pod or a restart never repeats one. With every money switch off it
 * only records `order.stuck` / `order.unstuck` (`watchStuck`).
 */
@Injectable()
export class OrdersStaffJob implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OrdersStaffJob.name);
  private timer: NodeJS.Timeout | undefined;
  private running = false;

  constructor(private readonly staff: OrdersStaffService) {}

  onModuleInit(): void {
    this.timer = setInterval(() => void this.safeTick(), ORDERS_STAFF_SWEEP_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async tick(): Promise<number> {
    return (await this.staff.sweep()) + (await this.staff.watchStuck());
  }

  private async safeTick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const n = await this.tick();
      if (n > 0) this.logger.log(`staff watchdog: ${n} actions`);
    } catch (err) {
      this.logger.error(`staff watchdog failed: ${(err as Error).message}`, (err as Error).stack);
    } finally {
      this.running = false;
    }
  }
}
