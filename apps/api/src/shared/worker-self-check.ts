import { Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { runsJobs, type ProcessRole } from './process-role.js';

/** One kind of background work the self-check watches (BullMQ jobs, the outbox). */
export interface StallProbe {
  readonly name: string;
  /** How late the most overdue item is, in ms (0 when nothing is due). Throws when it cannot tell (Redis or the database away). */
  oldestOverdueMs(): Promise<number>;
  /** When this process last finished an item (epoch ms). */
  lastProgressAt(): number;
}

export interface WorkerSelfCheckOptions {
  /** On for job machines with Redis (InfraModule decides). */
  enabled: boolean;
  intervalMs: number;
  /** Work overdue this long while nothing finished for this long = stuck. */
  stuckMs: number;
  /** `WORKER_HEARTBEAT_URL`: pinged while healthy (Better Stack heartbeat; a missing ping pages). */
  heartbeatUrl?: string;
  heartbeatMs: number;
}

export function workerSelfCheckOptionsFromEnv(env: Record<string, string | undefined> = process.env): Omit<WorkerSelfCheckOptions, 'enabled'> {
  const url = env['WORKER_HEARTBEAT_URL']?.trim();
  return { intervalMs: 30_000, stuckMs: 120_000, heartbeatMs: 60_000, ...(url ? { heartbeatUrl: url } : {}) };
}

/**
 * The worker watches its own progress (docs/deploy/hosting.md "Web and worker machines"). Every 30 s
 * each probe says how late its oldest due item is; work overdue for 2 min while nothing finished for
 * 2 min means this process is stuck: it logs one error and exits, and Fly's restart policy starts it
 * again. A probe that cannot answer (Redis or the database away) is not a stuck worker, and no
 * heartbeat goes out then either, so a long outage still pages through the missing heartbeat.
 */
@Injectable()
export class WorkerSelfCheck implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(WorkerSelfCheck.name);
  private readonly probes: StallProbe[] = [];
  private timer: NodeJS.Timeout | undefined;
  private lastBeat = 0;
  private exiting = false;

  constructor(
    private readonly role: ProcessRole,
    private readonly opts: WorkerSelfCheckOptions,
    private readonly exit: (code: number) => void = (code) => process.exit(code),
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  watch(probe: StallProbe): void {
    this.probes.push(probe);
  }

  onApplicationBootstrap(): void {
    if (!this.opts.enabled || !runsJobs(this.role)) return;
    this.timer = setInterval(() => void this.check(), this.opts.intervalMs);
    this.timer.unref();
    this.logger.log(`worker self-check on: ${this.probes.map((p) => p.name).join(', ')}${this.opts.heartbeatUrl ? ', heartbeat on' : ''}`);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  /** One check. Returns why the process is stuck (and exits it), or null. Never throws. */
  async check(now = Date.now()): Promise<string | null> {
    let answered = true;
    for (const p of this.probes) {
      let late: number;
      try {
        late = await p.oldestOverdueMs();
      } catch (err) {
        answered = false;
        this.logger.warn(`self-check ${p.name}: cannot tell (${(err as Error).message})`);
        continue;
      }
      const idle = now - p.lastProgressAt();
      if (late >= this.opts.stuckMs && idle >= this.opts.stuckMs) {
        const why = `${p.name} stuck: oldest due item ${Math.round(late / 1000)} s late, nothing finished for ${Math.round(idle / 1000)} s`;
        if (!this.exiting) {
          this.exiting = true;
          this.logger.error(`worker self-check: ${why}; exiting so the machine restarts`);
          // A moment for the error report to leave; then the restart policy takes over.
          setTimeout(() => this.exit(1), 2_000);
        }
        return why;
      }
    }
    if (answered && this.opts.heartbeatUrl && now - this.lastBeat >= this.opts.heartbeatMs - 1_000) {
      this.lastBeat = now;
      try {
        await this.fetchFn(this.opts.heartbeatUrl, { signal: AbortSignal.timeout(5_000) });
      } catch (err) {
        this.logger.warn(`worker heartbeat not sent: ${(err as Error).message}`);
      }
    }
    return null;
  }
}
