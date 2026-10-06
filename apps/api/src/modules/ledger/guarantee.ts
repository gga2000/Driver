import { Inject, Injectable } from '@nestjs/common';
import { peakWindows, shiftGuarantee, type GuaranteeStats, type GuaranteeWindowView, type MoneyRules, type PeakWindow, type StatementLine } from '@driver/contracts';
import { CLOCK, type Clock } from '../../shared/clock.js';
import { nextLocalSunday, startOfLocalWeek } from '../../shared/local-time.js';
import { Accounts, idOf } from './accounts.js';
import { CapsService } from './caps.js';
import { LedgerService } from './ledger.service.js';
import { guaranteeGroupId, postShiftGuarantee } from './postings.js';
import { MONEY_RULES } from './tokens.js';

/**
 * G-91 launch shift guarantee, server side (money §2, edge-case review #91). For each peak shift of the city (`MoneyRules.guarantee.peaks`) the driver's offers,
 * cancels after accept, completed jobs and the earnings of those jobs are counted from the real
 * record — his own trip events and his ledger lines — and `shiftGuarantee` decides the top-up. The
 * Sunday run of the nightly close posts each top-up once (`settleWeek`); the Partner app reads the
 * same numbers live (`windows`). docs/api/shift-guarantee.md.
 *
 * Switched off by Ali on 2026-10-06 (`MoneyRules.guarantee.enabled: false`, an open decision): off,
 * `covers` is false for everyone and `settle` posts nothing, so no top-up is paid and nothing is shown.
 */

const DAY_MS = 86_400_000;
/** A job completed in a shift may have been accepted before it started: look this far back for the accept. */
const ACCEPT_LOOKBACK_MS = 12 * 3_600_000;
/** The Sunday run settles the week that just ended and re-checks the one before (a missed Sunday pays late, never twice). */
export const GUARANTEE_SETTLE_LOOKBACK_DAYS = 14;
/** Moving money already earned, not earnings (same set as the driver's earnings screen). */
const SETTLEMENT_TYPES: ReadonlySet<string> = new Set(['driver_payout', 'driver_settlement', 'debt_settled']);

/** What a driver did, as the guarantee counts it: offer outcomes, cancels after accept, completed trips. */
export interface ShiftActivity {
  offers: Array<{ at: Date; accepted: boolean }>;
  cancelsAfterAccept: Array<{ at: Date; tripId: string }>;
  completed: Array<{ at: Date; tripId: string }>;
}

/** Where the activity comes from (production: the events log, `EventsShiftActivity`). */
export interface ShiftActivitySource {
  activity(driverId: string, range: { from: Date; to: Date }): Promise<ShiftActivity>;
}

export const SHIFT_ACTIVITY = Symbol('SHIFT_ACTIVITY');

/** The slice of a stored event the activity reader needs (structural: `StoredEvent` from `modules/events`). */
export interface ActivityEvent {
  type: string;
  occurredAt: Date;
  payload: Record<string, unknown>;
  tripId?: string | undefined;
  aggregate: string;
  aggregateId: string;
  quarantined: boolean;
}

/** The events log as the activity reader needs it (structural: `EventsService`). */
export interface ActivityEvents {
  forActor(actorId: string): Promise<readonly ActivityEvent[]>;
  forTrip(tripId: string): Promise<readonly ActivityEvent[]>;
}

function tripOf(e: ActivityEvent): string | null {
  return e.tripId ?? (e.aggregate === 'trip' ? e.aggregateId : null);
}

/**
 * Activity from the append-only events log. The driver is the actor of his own offer answers
 * (`trip.accepted` / `trip.declined` / `trip.timed_out`, dispatch records an expired offer under his
 * id) and of his cancels (`trip.cancelled` with `by: 'driver'`). A trip counts as his completed job
 * when its `trip.completed` falls in the range and he holds its last accept (a customer's "وصلت"
 * completes his ride too). Late offline replays (quarantined) never count.
 */
export class EventsShiftActivity implements ShiftActivitySource {
  constructor(private readonly events: ActivityEvents) {}

  async activity(driverId: string, range: { from: Date; to: Date }): Promise<ShiftActivity> {
    const inRange = (at: Date) => at.getTime() >= range.from.getTime() && at.getTime() < range.to.getTime();
    const out: ShiftActivity = { offers: [], cancelsAfterAccept: [], completed: [] };
    const accepted = new Set<string>();
    for (const e of await this.events.forActor(driverId)) {
      if (e.quarantined) continue;
      const tripId = tripOf(e);
      if (e.type === 'trip.accepted') {
        if (inRange(e.occurredAt)) out.offers.push({ at: e.occurredAt, accepted: true });
        if (tripId && e.occurredAt.getTime() < range.to.getTime() && e.occurredAt.getTime() >= range.from.getTime() - ACCEPT_LOOKBACK_MS) accepted.add(tripId);
      } else if (e.type === 'trip.declined' || e.type === 'trip.timed_out') {
        if (inRange(e.occurredAt)) out.offers.push({ at: e.occurredAt, accepted: false });
      } else if (e.type === 'trip.cancelled' && e.payload['by'] === 'driver' && tripId && inRange(e.occurredAt)) {
        out.cancelsAfterAccept.push({ at: e.occurredAt, tripId });
      }
    }
    for (const tripId of [...accepted].sort()) {
      const evs = (await this.events.forTrip(tripId)).filter((e) => !e.quarantined);
      const lastAccept = evs.filter((e) => e.type === 'trip.accepted').at(-1);
      const done = evs.find((e) => e.type === 'trip.completed');
      if (!done || lastAccept?.payload['driverId'] !== driverId || !inRange(done.occurredAt)) continue;
      out.completed.push({ at: done.occurredAt, tripId });
    }
    return out;
  }
}

/**
 * One shift's numbers, pure. Offers, cancels and completions are counted by when they happened in
 * `[from, to)`. Earnings are his ledger lines for the trips completed in the shift, whenever they
 * posted (a wallet order's money posts at close, after the shift): pay, extras and tips, less the
 * platform's take. Penalties are not added back (the platform does not top up a fine), settlements
 * are not earnings, and an earlier guarantee line never counts toward the next.
 */
export function windowStats(activity: ShiftActivity, lines: readonly StatementLine[], w: { from: Date; to: Date }): GuaranteeStats & { tripIds: string[] } {
  const inW = (at: Date) => at.getTime() >= w.from.getTime() && at.getTime() < w.to.getTime();
  const offers = activity.offers.filter((o) => inW(o.at));
  const tripIds = [...new Set(activity.completed.filter((c) => inW(c.at)).map((c) => c.tripId))].sort();
  const jobs = new Set(tripIds);
  let earningsIqd = 0;
  for (const l of lines) {
    if (!l.tripId || !jobs.has(l.tripId) || SETTLEMENT_TYPES.has(l.type)) continue;
    if (l.type === 'driver_incentive' && (l.memo ?? '').startsWith('guarantee')) continue;
    if (l.amountIqd > 0 || l.type === 'commission_accrued') earningsIqd += l.amountIqd;
  }
  return {
    offers: offers.length,
    accepted: offers.filter((o) => o.accepted).length,
    cancelsAfterAccept: activity.cancelsAfterAccept.filter((c) => inW(c.at)).length,
    completedJobs: tripIds.length,
    earningsIqd,
    tripIds,
  };
}

export interface GuaranteePayout {
  driverId: string;
  windowId: string;
  amountIqd: number;
}

@Injectable()
export class ShiftGuaranteeService {
  constructor(
    private readonly ledger: LedgerService,
    private readonly caps: CapsService,
    @Inject(SHIFT_ACTIVITY) private readonly source: ShiftActivitySource,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(MONEY_RULES) private readonly rules: MoneyRules,
  ) {}

  private get offsetMin(): number {
    return this.rules.nightly.utcOffsetMin;
  }

  /** The guarantee is on in the city and his cap role is one it covers (couriers at launch). */
  async covers(driverId: string): Promise<boolean> {
    const g = this.rules.guarantee;
    if (!g.enabled) return false;
    return g.roles.includes((await this.caps.status(driverId)).role);
  }

  /** The peak shifts overlapping `[from, to)` that have begun by now, each with his numbers, oldest first. */
  async windows(driverId: string, range: { from: Date; to: Date }): Promise<GuaranteeWindowView[]> {
    const now = this.clock.now();
    const shifts = peakWindows(range, this.rules.guarantee.peaks, this.offsetMin).filter((w) => w.from.getTime() < now.getTime());
    if (shifts.length === 0) return [];
    const until = new Date(Math.min(now.getTime(), Math.max(...shifts.map((w) => w.to.getTime()))));
    const [activity, statement, paid] = await Promise.all([
      this.source.activity(driverId, { from: shifts[0]!.from, to: until }),
      this.ledger.statement(Accounts.driver(driverId)),
      this.paidAmounts(driverId, shifts),
    ]);
    return shifts.map((w) => this.view(w, windowStats(activity, statement.lines, { from: w.from, to: new Date(Math.min(w.to.getTime(), now.getTime())) }), paid.get(w.id) ?? null, now));
  }

  private view(w: PeakWindow, stats: GuaranteeStats, paidIqd: number | null, now: Date): GuaranteeWindowView {
    const g = this.rules.guarantee;
    const check = shiftGuarantee(stats, g);
    return {
      id: w.id,
      peak: w.peak,
      from: w.from,
      to: w.to,
      status: paidIqd !== null ? 'paid' : now.getTime() < w.to.getTime() ? 'live' : 'ended',
      offers: stats.offers,
      accepted: stats.accepted,
      acceptance: check.acceptance,
      cancelsAfterAccept: stats.cancelsAfterAccept,
      completedJobs: stats.completedJobs,
      earningsIqd: stats.earningsIqd,
      meets: check.meets,
      qualified: check.qualified,
      jobsToGo: check.jobsToGo,
      topUpIqd: paidIqd ?? check.topUpIqd,
      paysOn: nextLocalSunday(w.from, this.offsetMin),
      rule: { amountIqd: g.amountIqd, minAcceptance: g.minAcceptance, maxCancelsAfterAccept: g.maxCancelsAfterAccept, minCompletedJobs: g.minCompletedJobs },
    };
  }

  /** What the ledger already paid him per shift (by the shift's posting group). */
  private async paidAmounts(driverId: string, shifts: readonly PeakWindow[]): Promise<Map<string, number>> {
    const byGroup = new Map(shifts.map((w) => [guaranteeGroupId(driverId, w.id), w.id]));
    const out = new Map<string, number>();
    for (const e of await this.ledger.eventsForGroups([...byGroup.keys()])) {
      const id = e.postingGroupId ? byGroup.get(e.postingGroupId) : undefined;
      if (id) out.set(id, (out.get(id) ?? 0) + e.amount);
    }
    return out;
  }

  /**
   * Posts the top-up of every covered driver for every peak shift that started in `[from, to)` and
   * is over by now: platform-funded, one posting group per driver per shift (a re-run posts nothing
   * twice). Returns what this call posted.
   */
  async settle(range: { from: Date; to: Date }): Promise<GuaranteePayout[]> {
    if (!this.rules.guarantee.enabled) return [];
    const now = this.clock.now();
    const over = peakWindows(range, this.rules.guarantee.peaks, this.offsetMin).filter((w) => w.from.getTime() >= range.from.getTime() && w.to.getTime() <= Math.min(range.to.getTime(), now.getTime()));
    if (over.length === 0) return [];
    const drivers = new Set<string>();
    for (const account of await this.ledger.accounts()) {
      const id = idOf(account, 'driver');
      if (id) drivers.add(id);
    }
    const out: GuaranteePayout[] = [];
    for (const driverId of [...drivers].sort()) {
      if (!(await this.covers(driverId))) continue;
      const views = await this.windows(driverId, { from: over[0]!.from, to: over.at(-1)!.to });
      for (const v of views) {
        if (v.status !== 'ended' || !v.qualified || v.topUpIqd <= 0 || !over.some((w) => w.id === v.id)) continue;
        const group = postShiftGuarantee({ driverId, windowId: v.id, amountIqd: v.topUpIqd, occurredAt: now });
        if (!group) continue;
        const res = await this.ledger.recordAll(group);
        if (res.recorded.includes(group.id)) out.push({ driverId, windowId: v.id, amountIqd: v.topUpIqd });
      }
    }
    return out;
  }

  /** The Sunday run: the local week that just ended, and the one before it (late, never twice). */
  settleWeek(runAt: Date): Promise<GuaranteePayout[]> {
    const weekStart = startOfLocalWeek(runAt, this.offsetMin);
    return this.settle({ from: new Date(weekStart.getTime() - GUARANTEE_SETTLE_LOOKBACK_DAYS * DAY_MS), to: weekStart });
  }
}
