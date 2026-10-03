import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  ErrandMoneyPayload,
  OrderMoneyPayload,
  RideMoneyPayload,
  SeatMoneyPayload,
  SubscriptionChargePayload,
  type CancellationPayload,
  type DepartureCancelledPayload,
  type LateMeterPayload,
  type MoneyRules,
} from '@driver/contracts';
import { UnitOfWork, type Tx } from '../../shared/db/unit-of-work.js';
import { Accounts, idOf } from './accounts.js';
import { LedgerService, type RecordAllResult } from './ledger.service.js';
import { MerchantCashService } from './merchant-cash.service.js';
import {
  orderPointRecipients,
  pointsForRevenue,
  pointsForRideTake,
  postCancellation,
  postDepartureCancelled,
  postErrand,
  postLateMeter,
  postOrderClosed,
  postPoints,
  postReferral,
  postRideCompleted,
  postSeat,
  postSubscription,
  type PostingGroup,
} from './postings.js';
import { MONEY_RULES } from './tokens.js';

/**
 * Turns domain-event payloads into posting groups and records them, with the history-dependent
 * parts the pure functions cannot do: referral unlock (needs the referee's past cash orders and the
 * referrer's monthly count) and the merchant exposure-cap trigger (needs the live balance).
 * Every method is idempotent per business fact.
 */
@Injectable()
export class PostingService {
  constructor(
    private readonly ledger: LedgerService,
    private readonly merchantCash: MerchantCashService,
    @Inject(MONEY_RULES) private readonly rules: MoneyRules,
    @Optional() @Inject(UnitOfWork) private readonly uow?: UnitOfWork,
  ) {}

  private run<T>(fn: (tx: Tx | undefined) => Promise<T>): Promise<T> {
    return this.uow ? this.uow.run((tx) => fn(tx)) : fn(undefined);
  }

  private async record(groups: ReadonlyArray<PostingGroup | null>): Promise<RecordAllResult> {
    const list = groups.filter((g): g is PostingGroup => g !== null);
    if (list.length === 0) return { recorded: [], skipped: [], events: [] };
    const result = await this.run((tx) => this.ledger.recordAll(list, tx));
    await this.afterMerchantCredit(list);
    return result;
  }

  /** Merchants credited by these groups may have crossed their exposure cap. */
  private async afterMerchantCredit(groups: readonly PostingGroup[]): Promise<void> {
    const merchants = new Set<string>();
    for (const g of groups) for (const l of g.lines) {
      const m = idOf(l.toAccount, 'merchant_cash');
      if (m) merchants.add(m);
    }
    for (const m of merchants) await this.merchantCash.checkExposure(m);
  }

  /** Cash collected at the door: the money group posts now (merchant payable is instant, decisions §3). */
  async orderMoney(input: OrderMoneyPayload): Promise<RecordAllResult> {
    const posted = postOrderClosed(input, this.rules);
    return this.record([posted.money, posted.redeem]);
  }

  /** Order closed: money (if cash collection did not already post it), points on revenue, referral unlock. */
  async orderClosed(input: OrderMoneyPayload): Promise<RecordAllResult> {
    const o = OrderMoneyPayload.parse(input);
    const posted = postOrderClosed(o, this.rules);
    const points = postPoints({
      groupId: `order:${o.orderId}:points`,
      occurredAt: o.occurredAt,
      refs: { orderId: o.orderId },
      points: pointsForRevenue(posted.revenueIqd, this.rules),
      ordererId: o.customerId,
      recipients: orderPointRecipients(o),
      rules: this.rules,
    });
    const result = await this.record([posted.money, posted.redeem, points]);
    await this.referral(o.customerId, o.referredBy, o.occurredAt);
    return result;
  }

  async errandMoney(input: ErrandMoneyPayload): Promise<RecordAllResult> {
    const posted = postErrand(input, this.rules);
    return this.record([posted.money, posted.redeem]);
  }

  async errandClosed(input: ErrandMoneyPayload): Promise<RecordAllResult> {
    const e = ErrandMoneyPayload.parse(input);
    const posted = postErrand(e, this.rules);
    const points = postPoints({
      groupId: `order:${e.orderId}:points`,
      occurredAt: e.occurredAt,
      refs: { orderId: e.orderId },
      points: pointsForRevenue(posted.revenueIqd, this.rules),
      ordererId: e.customerId,
      recipients: [],
      rules: this.rules,
    });
    const result = await this.record([posted.money, posted.redeem, points]);
    await this.referral(e.customerId, e.referredBy, e.occurredAt);
    return result;
  }

  /** Ride/parcel completed (or its cash collected): money plus points on the platform take. */
  async ride(input: RideMoneyPayload): Promise<RecordAllResult> {
    const r = RideMoneyPayload.parse(input);
    const posted = postRideCompleted(r, this.rules);
    const points = postPoints({
      groupId: `trip:${r.tripId}:points`,
      occurredAt: r.occurredAt,
      refs: { tripId: r.tripId },
      points: pointsForRideTake(posted.takeIqd, this.rules),
      ordererId: r.customerId,
      recipients: [],
      rules: this.rules,
    });
    return this.record([posted.money, points]);
  }

  /** Seat completed earns points; a no-show forfeits the seat (the driver still keeps the fare). */
  async seat(input: SeatMoneyPayload, opts: { completed: boolean }): Promise<RecordAllResult> {
    const s = SeatMoneyPayload.parse(input);
    const posted = postSeat(s, this.rules);
    const points = opts.completed
      ? postPoints({
          groupId: `seat:${s.seatId}:points`,
          occurredAt: s.occurredAt,
          refs: { departureId: s.departureId },
          points: pointsForRideTake(posted.takeIqd, this.rules),
          ordererId: s.customerId,
          recipients: [],
          rules: this.rules,
        })
      : null;
    return this.record([posted.money, points]);
  }

  async subscription(input: SubscriptionChargePayload): Promise<RecordAllResult> {
    return this.record([postSubscription(SubscriptionChargePayload.parse(input), this.rules).money]);
  }

  async lateMeter(input: LateMeterPayload): Promise<RecordAllResult> {
    return this.record([postLateMeter(input, this.rules)]);
  }

  async cancellation(input: CancellationPayload): Promise<RecordAllResult> {
    return this.record([postCancellation(input)]);
  }

  async departureCancelled(input: DepartureCancelledPayload): Promise<RecordAllResult> {
    return this.record([postDepartureCancelled(input)]);
  }

  /**
   * Decisions §1: 200 points per side once the referee has N completed cash orders ≥ 10,000; the
   * referrer's side counts against his monthly cap. Idempotent (`referral:<referee>`).
   */
  async referral(refereeId: string, referrerId: string | undefined, at: Date): Promise<RecordAllResult | null> {
    if (!referrerId || referrerId === refereeId) return null;
    const r = this.rules.referral;
    if (await this.ledger.hasGroup(`referral:${refereeId}`)) return null;
    const qualifying = await this.ledger.cashOrders(refereeId, r.minOrderIqd);
    if (qualifying.length < r.unlockOnQualifyingOrder) return null;
    const month = baghdadMonth(at, this.rules.nightly.utcOffsetMin);
    const referrerEvents = await this.ledger.eventsFor(Accounts.points(referrerId));
    const thisMonth = referrerEvents.filter(
      (e) => e.type === 'referral_bonus' && e.toAccount === Accounts.points(referrerId) && e.memo?.startsWith('referrer_of:') && baghdadMonth(e.occurredAt, this.rules.nightly.utcOffsetMin) === month,
    ).length;
    return this.record([postReferral({ refereeId, referrerId, referrerWithinCap: thisMonth < r.monthlyCapPerReferrer, occurredAt: at, rules: this.rules })]);
  }
}

function baghdadMonth(at: Date, offsetMin: number): string {
  return new Date(at.getTime() + offsetMin * 60_000).toISOString().slice(0, 7);
}
