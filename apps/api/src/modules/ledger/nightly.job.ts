import { Inject, Injectable } from '@nestjs/common';
import { nightlyMessage, type MoneyRules, type NightlyReport } from '@driver/contracts';
import { CLOCK, type Clock } from '../../shared/clock.js';
import { jobKey, type Queue } from '../../shared/queue.js';
import { idOf } from './accounts.js';
import { CapsService } from './caps.js';
import type { LedgerEventBus } from './events.adapter.js';
import type { LedgerIncidentPort } from './incidents.js';
import { LedgerService } from './ledger.service.js';
import { LEDGER_EVENTS, LEDGER_INCIDENTS, MONEY_RULES } from './tokens.js';

export const NIGHTLY_QUEUE = 'ledger-nightly';

/** Next 02:00 in the city's zone (Asia/Baghdad is UTC+3 all year), strictly after `now`. */
export function nextNightlyRunAt(now: Date, rules: MoneyRules): Date {
  const offsetMs = rules.nightly.utcOffsetMin * 60_000;
  const local = new Date(now.getTime() + offsetMs);
  const candidate = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), rules.nightly.hour) - offsetMs;
  return new Date(candidate > now.getTime() ? candidate : candidate + 24 * 3_600_000);
}

/** Local calendar day of an instant, `YYYY-MM-DD`; the nightly job's idempotency key. */
export function localDay(at: Date, rules: MoneyRules): string {
  return new Date(at.getTime() + rules.nightly.utcOffsetMin * 60_000).toISOString().slice(0, 10);
}

/**
 * Nightly close (money §4, plan Step 6): money Σ=0 and points Σ=0 checked separately, per-driver
 * owed/cap/payout report for the morning WhatsApp, and an incident when anything fails.
 * Sunday runs mark every positive driver balance as payout due (G-86 weekly payouts).
 */
@Injectable()
export class NightlyJob {
  constructor(
    private readonly ledger: LedgerService,
    private readonly caps: CapsService,
    @Inject(LEDGER_INCIDENTS) private readonly incidents: LedgerIncidentPort,
    @Inject(LEDGER_EVENTS) private readonly bus: LedgerEventBus,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(MONEY_RULES) private readonly rules: MoneyRules,
  ) {}

  async run(opts: { requestedBy?: string } = {}): Promise<NightlyReport> {
    const runAt = this.clock.now();
    const weekly = new Date(runAt.getTime() + this.rules.nightly.utcOffsetMin * 60_000).getUTCDay() === 0;
    const inv = await this.ledger.checkInvariant();

    const driverIds = new Set<string>();
    for (const account of await this.ledger.accounts()) {
      const id = idOf(account, 'driver') ?? idOf(account, 'cash');
      if (id) driverIds.add(id);
    }
    const drivers = [];
    for (const driverId of [...driverIds].sort()) {
      const s = await this.caps.status(driverId, { weekly });
      drivers.push({ driverId, owedIqd: s.owedIqd, capIqd: s.capIqd, capRemainingIqd: s.capRemainingIqd, overCap: s.overCap, payoutDueIqd: s.payoutDueIqd });
    }

    let incidentId: string | null = null;
    if (!inv.ok) {
      incidentId = await this.incidents.open({
        kind: 'ledger_imbalance',
        summary: `nightly ${localDay(runAt, this.rules)}: money ${inv.money.net}, points ${inv.points.net}, kind violations ${inv.kindViolations}`,
        evidence: { money: inv.money, points: inv.points, kindViolations: inv.kindViolations, runAt: runAt.toISOString() },
      });
    }
    const report: NightlyReport = {
      runAt,
      ok: inv.ok,
      money: inv.money,
      points: inv.points,
      kindViolations: inv.kindViolations,
      drivers,
      incidentId,
      message_ar: nightlyMessage(inv.ok, inv.money.net, inv.points.net),
    };
    await this.bus.emit(
      undefined,
      {
        actorId: opts.requestedBy ?? 'system:ledger',
        type: 'ledger.nightly_closed',
        occurredAt: runAt,
        payload: { ok: report.ok, money: report.money, points: report.points, kindViolations: report.kindViolations, drivers: report.drivers, incidentId },
      },
      { name: 'ledger', id: localDay(runAt, this.rules) },
    );
    return report;
  }

  /** Puts the next 02:00 run on the queue; each run re-schedules the following one. */
  async schedule(queue: Queue<{ day: string }>): Promise<Date> {
    const at = nextNightlyRunAt(this.clock.now(), this.rules);
    const day = localDay(at, this.rules);
    await queue.add('nightly', { day }, { delayMs: at.getTime() - this.clock.now().getTime(), jobId: jobKey(NIGHTLY_QUEUE, day) });
    return at;
  }

  /** Binds the queue processor: run, then schedule tomorrow. */
  attach(queue: Queue<{ day: string }>): void {
    queue.process(async () => {
      await this.run();
      await this.schedule(queue);
    });
  }
}
