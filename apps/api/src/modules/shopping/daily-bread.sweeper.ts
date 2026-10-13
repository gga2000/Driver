import {
  Inject,
  Injectable,
  Logger,
  Optional,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { PROCESS_ROLE, runsJobs, type ProcessRole } from '../../shared/process-role.js';
import { ShoppingService } from './shopping.service.js';

/** How often the «صمون كل يوم» sweep runs (ms); 0 turns it off. Default one minute. */
export function dailyBreadSweepMs(env: Record<string, string | undefined> = process.env): number {
  const raw = env['DAILY_BREAD_SWEEP_MS'];
  const n = raw === undefined || raw === '' ? NaN : Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : 60_000;
}

/**
 * Places the standing bread orders that fall due (`ShoppingService.placeDueBread`) on a timer, where
 * jobs run. An overlapping run is skipped; a failed one is logged and the next tries again (each
 * order claims its day before it is placed, so nothing is placed twice).
 */
@Injectable()
export class DailyBreadSweeper implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DailyBreadSweeper.name);
  private timer: NodeJS.Timeout | undefined;
  private running = false;

  constructor(
    private readonly shopping: ShoppingService,
    @Optional() @Inject(PROCESS_ROLE) private readonly role: ProcessRole = 'all',
  ) {}

  onModuleInit(): void {
    if (!runsJobs(this.role)) return;
    const every = dailyBreadSweepMs();
    if (every <= 0) return;
    this.timer = setInterval(() => void this.tick(), every);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.shopping.placeDueBread();
    } catch (err) {
      this.logger.error(`daily bread sweep: ${(err as Error).message}`);
    } finally {
      this.running = false;
    }
  }
}
