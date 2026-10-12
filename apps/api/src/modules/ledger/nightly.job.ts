import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { nightlyMessage, type LedgerEvent, type MoneyRules, type NightlyReport } from '@driver/contracts';
import { CLOCK, type Clock } from '../../shared/clock.js';
import { jobKey, type Queue } from '../../shared/queue.js';
import { idOf } from './accounts.js';
import { CapsService } from './caps.js';
import { ShiftGuaranteeService, type GuaranteePayout } from './guarantee.js';
import type { LedgerEventBus } from './events.adapter.js';
import type { LedgerIncidentPort } from './incidents.js';
import { LedgerService } from './ledger.service.js';
import { LEDGER_EVENTS, LEDGER_INCIDENTS, MONEY_RULES } from './tokens.js';

export const NIGHTLY_QUEUE = 'ledger-nightly';
/** The money-group check looks at what closed in the 24 h ending this long before the run (retries have settled). */
export const MONEY_GROUP_SETTLE_MS = 30 * 60_000;
const DAY_MS = 24 * 3_600_000;

/**
 * A module whose closed jobs each settle in one money posting group: orders (`order:<id>:money`, a
 * ride's `trip:<trip>:money`) and intercity seats (`seat:<seat>:money`). The ledger owns the naming;
 * a source only says what closed.
 */
export interface MoneyClosureSource {
  /** Orders that closed in `[from, to)` (ids), and seats whose money settled then (seat money ids). */
  closedBetween(from: Date, to: Date): Promise<Array<{ kind: 'order' | 'seat'; id: string }>>;
}

/** The order's money groups among its ledger rows: its own, or its ride trip's. */
function orderMoneyGroups(rows: readonly LedgerEvent[], orderId: string): string[] {
  const groups = new Set<string>();
  for (const e of rows) {
    const g = e.postingGroupId;
    if (e.kind !== 'money' || !g) continue;
    if (g === `order:${orderId}:money` || (g.startsWith('trip:') && g.endsWith(':money'))) groups.add(g);
  }
  return [...groups];
}

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
 * Sunday runs first post the G-91 shift-guarantee top-ups of the week that ended (paid with the
 * weekly scorecard, never nightly), then mark every positive driver balance as payout due (G-86
 * weekly payouts), so the top-ups go out with that payout.
 */
@Injectable()
export class NightlyJob {
  private readonly logger = new Logger(NightlyJob.name);
  private readonly closures: MoneyClosureSource[] = [];

  constructor(
    private readonly ledger: LedgerService,
    private readonly caps: CapsService,
    @Inject(LEDGER_INCIDENTS) private readonly incidents: LedgerIncidentPort,
    @Inject(LEDGER_EVENTS) private readonly bus: LedgerEventBus,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(MONEY_RULES) private readonly rules: MoneyRules,
    /** G-91 top-ups on the Sunday run; absent in harnesses that do not exercise them. */
    @Optional() private readonly guarantee?: ShiftGuaranteeService,
  ) {}

  async run(opts: { requestedBy?: string } = {}): Promise<NightlyReport> {
    const runAt = this.clock.now();
    const weekly = new Date(runAt.getTime() + this.rules.nightly.utcOffsetMin * 60_000).getUTCDay() === 0;
    const guaranteePaid = weekly ? await this.settleGuarantees(runAt) : [];
    const inv = await this.ledger.checkInvariant();
    await this.reconcileRunningBalances(runAt);
    const groupsIncident = await this.checkMoneyGroups(runAt);

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
    incidentId ??= groupsIncident;
    const report: NightlyReport = {
      runAt,
      ok: inv.ok,
      money: inv.money,
      points: inv.points,
      kindViolations: inv.kindViolations,
      drivers,
      incidentId,
      message_ar: nightlyMessage(inv.ok, inv.money.net, inv.points.net),
      guaranteePaid,
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

  /**
   * The week's guarantee top-ups. A failure must not stop the close (the books are still checked
   * and the payouts still listed): it opens an incident, and the next Sunday run re-checks the week
   * (the posting is once per driver per shift, so nothing is paid twice).
   */
  private async settleGuarantees(runAt: Date): Promise<GuaranteePayout[]> {
    if (!this.guarantee) return [];
    try {
      return await this.guarantee.settleWeek(runAt);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`shift guarantee settlement failed: ${message}`);
      await this.incidents.open({ kind: 'guarantee_settlement_failed', summary: `weekly ${localDay(runAt, this.rules)}: ${message}`, evidence: { runAt: runAt.toISOString() } });
      return [];
    }
  }

  /**
   * Perf item 13: the running driver balances must equal the full ledger sum. Runs before the
   * per-driver report so the report reads repaired values. A mismatch is repaired from the full sum,
   * logged and opened as an incident; a failure of the check itself must not stop the close.
   */
  private async reconcileRunningBalances(runAt: Date): Promise<void> {
    try {
      const drift = await this.ledger.reconcileRunningBalances();
      if (drift.length === 0) return;
      this.logger.error(`running balances repaired from the full ledger sum: ${drift.map((d) => `${d.accountId} ${d.runningIqd}→${d.fullIqd}`).join(', ')}`);
      await this.incidents.open({
        kind: 'ledger_balance_drift',
        summary: `nightly ${localDay(runAt, this.rules)}: ${drift.length} running driver balance(s) differed from the ledger and were repaired`,
        evidence: { drift, runAt: runAt.toISOString() },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`running balance check failed: ${message}`);
      await this.incidents.open({ kind: 'ledger_balance_check_failed', summary: `nightly ${localDay(runAt, this.rules)}: ${message}`, evidence: { runAt: runAt.toISOString() } });
    }
  }

  /** Orders and routes say what closed; the nightly run checks each settled in exactly one money group. */
  watchClosures(source: MoneyClosureSource): void {
    this.closures.push(source);
  }

  /**
   * Every order closed and every seat settled in the 24 h before the run (less the settle margin) has
   * exactly one money posting group. A missing one is money the outbox never posted (requeue it from
   * the Console System page); two are a double posting. Either opens a ledger incident; a failure of
   * the check itself must not stop the close. Returns the incident id, if one was opened.
   */
  private async checkMoneyGroups(runAt: Date): Promise<string | null> {
    if (this.closures.length === 0) return null;
    const to = new Date(runAt.getTime() - MONEY_GROUP_SETTLE_MS);
    const from = new Date(to.getTime() - DAY_MS);
    try {
      const closed = (await Promise.all(this.closures.map((c) => c.closedBetween(from, to)))).flat();
      const problems: string[] = [];
      const seats = closed.filter((c) => c.kind === 'seat').map((c) => `seat:${c.id}:money`);
      const posted = new Set((seats.length > 0 ? await this.ledger.eventsForGroups(seats) : []).map((e) => e.postingGroupId));
      for (const g of seats) if (!posted.has(g)) problems.push(`${g} missing`);
      for (const c of closed) {
        if (c.kind !== 'order') continue;
        const groups = orderMoneyGroups(await this.ledger.eventsForOrder(c.id), c.id);
        if (groups.length !== 1) problems.push(`order ${c.id}: ${groups.length} money groups${groups.length ? ` (${groups.join(', ')})` : ''}`);
      }
      if (problems.length === 0) return null;
      this.logger.error(`money groups: ${problems.length} of ${closed.length} closed orders and seats do not have exactly one: ${problems.slice(0, 10).join('; ')}`);
      return await this.incidents.open({
        kind: 'ledger_money_group_missing',
        summary: `nightly ${localDay(runAt, this.rules)}: ${problems.length} closed order(s) or seat(s) without exactly one money posting group`,
        evidence: { from: from.toISOString(), to: to.toISOString(), checked: closed.length, problems: problems.slice(0, 100), runAt: runAt.toISOString() },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`money group check failed: ${message}`);
      await this.incidents.open({ kind: 'ledger_money_group_check_failed', summary: `nightly ${localDay(runAt, this.rules)}: ${message}`, evidence: { runAt: runAt.toISOString() } });
      return null;
    }
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
