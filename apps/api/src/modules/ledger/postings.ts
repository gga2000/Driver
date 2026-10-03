import {
  DepartureCancelledPayload,
  OrderCancelledPayload,
  ErrandMoneyPayload,
  LateMeterPayload,
  OrderMoneyPayload,
  RideMoneyPayload,
  SeatMoneyPayload,
  SubscriptionChargePayload,
  kindOf,
  type LedgerEventType,
  type LedgerKind,
  type MoneyRules,
  type TakeRule,
} from '@driver/contracts';
import type { z } from 'zod';
import { Accounts } from './accounts.js';

/**
 * Pure posting groups (plan Step 6). Each function turns one business fact into one balanced
 * group of ledger lines; nothing here reads or writes storage. Every line is a transfer
 * (from → to), so a group always nets to zero per book; on top of that each group declares
 * control totals — accounts that must net to an exact amount inside the group (a cash order's
 * customer nets to zero: what he was charged equals what he paid) — and `recordAll` refuses a
 * group whose controls fail. Sign convention: see `accounts.ts`.
 */

export interface PostingLine {
  type: LedgerEventType;
  amount: number;
  fromAccount: string;
  toAccount: string;
  memo?: string;
}

export interface PostingRefs {
  orderId?: string;
  tripId?: string;
  routeId?: string;
  departureId?: string;
}

export interface PostingGroup {
  /** Stable id derived from the business fact; replays of the same fact are no-ops. */
  id: string;
  kind: LedgerKind;
  occurredAt: Date;
  refs: PostingRefs;
  lines: PostingLine[];
  /** Accounts that must net to exactly `net` within this group. */
  controls: Array<{ account: string; net: number }>;
}

class GroupBuilder {
  private readonly lines: PostingLine[] = [];
  private readonly controls: Array<{ account: string; net: number }> = [];

  constructor(
    private readonly id: string,
    private readonly kind: LedgerKind,
    private readonly occurredAt: Date,
    private readonly refs: PostingRefs,
  ) {}

  /** Adds a line; zero amounts are skipped (a component that did not apply leaves no row). */
  add(type: LedgerEventType, amount: number, fromAccount: string, toAccount: string, memo?: string): this {
    if (amount === 0) return this;
    this.lines.push({ type, amount, fromAccount, toAccount, ...(memo ? { memo } : {}) });
    return this;
  }

  control(account: string, net: number): this {
    this.controls.push({ account, net });
    return this;
  }

  build(): PostingGroup {
    return { id: this.id, kind: this.kind, occurredAt: this.occurredAt, refs: stripUndefined(this.refs), lines: [...this.lines], controls: [...this.controls] };
  }
}

function stripUndefined<T extends object>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
}

// ───────────────────────── arithmetic ─────────────────────────

/** Integer share of an amount at a rate; half rounds up. */
export function pct(amount: number, rate: number): number {
  return Math.round(Math.round(amount * rate * 1e6) / 1e6);
}

/** Platform take on a fare: rate with floor, plus fixed, never more than the fare (no fee > fare). */
export function takeOf(fareIqd: number, rule: TakeRule): number {
  if (fareIqd <= 0) return 0;
  const take = Math.max(rule.minIqd, pct(fareIqd, rule.rate)) + rule.fixedIqd;
  return Math.min(fareIqd, take);
}

/** G-88: customer totals in multiples of 500 (250 only with a 250 component, when enabled); half rounds up. */
export function roundCustomerTotal(totalIqd: number, rules: MoneyRules, has250Component = false): number {
  const step = has250Component && rules.rounding.allowQuarterStepWith250Component ? 250 : rules.rounding.stepIqd;
  return Math.floor(totalIqd / step + 0.5) * step;
}

/** Splits `total` across weights so the parts sum exactly to `total` (largest remainder). */
export function allocate(total: number, weights: readonly number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (total === 0 || weights.length === 0) return weights.map(() => 0);
  if (sum <= 0) return weights.map((_, i) => (i === 0 ? total : 0));
  const raw = weights.map((w) => (total * w) / sum);
  const parts = raw.map(Math.floor);
  let left = total - parts.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => ({ i, frac: r - Math.floor(r) })).sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const { i } of order) {
    if (left <= 0) break;
    parts[i] = (parts[i] ?? 0) + 1;
    left -= 1;
  }
  return parts;
}

// ───────────────────────── shared pieces ─────────────────────────

interface PayerSide {
  customerId: string;
  householdId?: string | undefined;
  payment: 'cash' | 'wallet';
  cashCollectedIqd?: number | undefined;
  has250Component: boolean;
}

function payerAccount(p: { customerId: string; householdId?: string | undefined }): string {
  return p.householdId ? Accounts.household(p.householdId) : Accounts.customer(p.customerId);
}

/**
 * Rounds the customer total, posts the residue to `rounding`, then the payment: cash collected by
 * `collector` (a courier's `cash:` or a merchant's cash account), or nothing for wallet orders.
 * Short cash stays on the payer as wallet debt; extra cash becomes a rounding credit.
 */
function settleCustomer(b: GroupBuilder, payer: string, p: PayerSide, chargedIqd: number, collector: string, rules: MoneyRules): number {
  if (chargedIqd < 0) throw new RangeError(`customer total is negative (${chargedIqd})`);
  const total = roundCustomerTotal(chargedIqd, rules, p.has250Component);
  const residue = total - chargedIqd;
  if (residue > 0) b.add('rounding_residue', residue, payer, Accounts.rounding);
  if (residue < 0) b.add('rounding_residue', -residue, Accounts.rounding, payer);
  if (p.payment === 'wallet') {
    b.control(payer, -total);
    return total;
  }
  const collected = p.cashCollectedIqd ?? total;
  b.add('cash_collected', Math.min(collected, total), collector, payer);
  if (collected > total) b.add('cash_rounding_credit', collected - total, collector, payer, 'change_as_credit');
  b.control(payer, collected - total);
  return total;
}

/** Points value redeemed against the service fee first, then delivery (decisions §2). */
export function redemption(pointsRedeemed: number, serviceFeeIqd: number, deliveryFeeIqd: number, rules: MoneyRules) {
  const value = pointsRedeemed * rules.points.pointValueIqd;
  const maxPoints = Math.floor((serviceFeeIqd + deliveryFeeIqd) / rules.points.pointValueIqd);
  const points = Math.min(pointsRedeemed, maxPoints);
  const usable = Math.min(value, points * rules.points.pointValueIqd);
  const againstService = Math.min(usable, serviceFeeIqd);
  const againstDelivery = usable - againstService;
  return { points, againstService, againstDelivery, valueIqd: usable };
}

// ───────────────────────── order closed (food / grocery catalog) ─────────────────────────

export interface OrderPostings {
  money: PostingGroup;
  /** Points book side of a redemption, posted with the money group. */
  redeem: PostingGroup | null;
  /**
   * Platform revenue the order earned — service fee + commission (decisions §2 points base), net of
   * what the platform itself funded (its promos and redeemed points), so points never earn on points.
   */
  revenueIqd: number;
  totalIqd: number;
}

/**
 * Worked example (money §2): items 15,000 at 15 %, service fee 500, delivery 1,000 →
 * platform 2,750, courier 1,000, merchant 12,750; the customer pays 16,500.
 */
export function postOrderClosed(input: OrderMoneyPayload, rules: MoneyRules): OrderPostings {
  const o = OrderMoneyPayload.parse(input);
  if (!o.courierId && (o.deliveryFeeIqd > 0 || o.tipIqd > 0)) throw new RangeError('delivery fee or tip without a courier');
  const refs: PostingRefs = { orderId: o.orderId, tripId: o.tripId };
  const b = new GroupBuilder(`order:${o.orderId}:money`, 'money', o.occurredAt, refs);
  const payer = payerAccount(o);
  const merchant = Accounts.merchantCash(o.merchantId);

  const commission = pct(o.itemsSubtotalIqd, rules.commission[o.commissionTier]);
  const serviceFee = o.serviceFeeIqd ?? rules.serviceFeeIqd;
  const courierDelivery = o.courierId
    ? Math.min(o.deliveryFeeIqd, o.courierDeliveryIqd ?? (o.batchedSecond ? pct(o.deliveryFeeIqd, rules.batchedSecondCourierShare) : o.deliveryFeeIqd))
    : 0;
  const red = redemption(o.pointsRedeemed, serviceFee, o.deliveryFeeIqd, rules);
  const promo = o.platformPromo?.amountIqd ?? 0;

  b.add('merchant_payable', o.itemsSubtotalIqd, payer, merchant, 'items');
  b.add('commission_accrued', commission, merchant, Accounts.platform, `commission:${o.commissionTier}`);
  b.add('service_fee', serviceFee, payer, Accounts.platform);
  b.add('service_fee', o.smallOrderFeeIqd, payer, Accounts.platform, 'small_order');
  if (o.courierId) {
    b.add('delivery_fee', courierDelivery, payer, Accounts.driver(o.courierId));
    b.add('delivery_fee', o.deliveryFeeIqd - courierDelivery, payer, Accounts.platform, o.batchedSecond ? 'batched_margin' : 'delivery_margin');
    b.add('tip', o.tipIqd, payer, Accounts.driver(o.courierId));
  }
  if (o.platformPromo) b.add('promo_funded', promo, Accounts.promo(o.platformPromo.promotionId), payer, `promo:${o.platformPromo.promotionId}`);
  b.add('promo_funded', red.againstService, Accounts.platform, payer, 'points:service_fee');
  b.add('promo_funded', red.againstDelivery, Accounts.platform, payer, 'points:delivery_fee');

  const charged = o.itemsSubtotalIqd + serviceFee + o.smallOrderFeeIqd + o.deliveryFeeIqd + o.tipIqd - promo - red.valueIqd;
  const collector = o.courierId ? Accounts.cash(o.courierId) : merchant;
  const total = settleCustomer(b, payer, o, charged, collector, rules);

  return {
    money: b.build(),
    redeem: red.points > 0 ? redeemGroup(`order:${o.orderId}:redeem`, o.customerId, red.points, o.occurredAt, refs) : null,
    revenueIqd: Math.max(0, commission + serviceFee + o.smallOrderFeeIqd - promo - red.valueIqd),
    totalIqd: total,
  };
}

function redeemGroup(id: string, personId: string, points: number, at: Date, refs: PostingRefs): PostingGroup {
  return new GroupBuilder(id, 'points', at, refs).add('points_redeemed', points, Accounts.points(personId), Accounts.pointsPool).control(Accounts.points(personId), -points).build();
}

// ───────────────────────── errand / shop-for-me ─────────────────────────

/** Actual cost (shopper paid from float), fee and tip as separate lines (domain §4). */
export function postErrand(input: ErrandMoneyPayload, rules: MoneyRules): OrderPostings {
  const e = ErrandMoneyPayload.parse(input);
  const refs: PostingRefs = { orderId: e.orderId, tripId: e.tripId };
  const b = new GroupBuilder(`order:${e.orderId}:money`, 'money', e.occurredAt, refs);
  const payer = payerAccount(e);
  const shopper = Accounts.driver(e.shopperId);
  const serviceFee = e.serviceFeeIqd ?? rules.serviceFeeIqd;
  const red = redemption(e.pointsRedeemed, serviceFee, e.errandFeeIqd, rules);

  b.add('errand_cost_actual', e.actualCostIqd, payer, shopper, 'receipt');
  b.add('errand_fee', e.errandFeeIqd, payer, shopper);
  b.add('service_fee', serviceFee, payer, Accounts.platform);
  b.add('tip', e.tipIqd, payer, shopper);
  b.add('promo_funded', red.againstService, Accounts.platform, payer, 'points:service_fee');
  b.add('promo_funded', red.againstDelivery, Accounts.platform, payer, 'points:delivery_fee');
  const charged = e.actualCostIqd + e.errandFeeIqd + serviceFee + e.tipIqd - red.valueIqd;
  const total = settleCustomer(b, payer, e, charged, Accounts.cash(e.shopperId), rules);
  return {
    money: b.build(),
    redeem: red.points > 0 ? redeemGroup(`order:${e.orderId}:redeem`, e.customerId, red.points, e.occurredAt, refs) : null,
    revenueIqd: Math.max(0, serviceFee - red.valueIqd),
    totalIqd: total,
  };
}

// ───────────────────────── rides, parcels ─────────────────────────

export interface RidePostings {
  money: PostingGroup;
  takeIqd: number;
  totalIqd: number;
}

/** Ride/parcel completed: fare to the driver, platform take by class (tuktuk 10 % min 100, car 12 %, parcel 15 %…). */
export function postRideCompleted(input: RideMoneyPayload, rules: MoneyRules): RidePostings {
  const r = RideMoneyPayload.parse(input);
  const b = new GroupBuilder(`trip:${r.tripId}:money`, 'money', r.occurredAt, { tripId: r.tripId, orderId: r.orderId });
  const payer = payerAccount(r);
  const driver = Accounts.driver(r.driverId);
  const take = takeOf(r.fareIqd, rules.take[r.takeClass]);
  const fareType: LedgerEventType = r.takeClass === 'parcel' || r.takeClass === 'parcel_intercity' ? 'parcel_fee' : 'fare';

  b.add(fareType, r.fareIqd, payer, driver, r.takeClass);
  b.add('commission_accrued', take, driver, Accounts.platform, `take:${r.takeClass}`);
  b.add('tip', r.tipIqd, payer, driver);
  b.add('driver_incentive', r.pickupCompensationIqd, Accounts.platform, driver, 'rebroadcast_compensation');
  const total = settleCustomer(b, payer, r, r.fareIqd + r.tipIqd, Accounts.cash(r.driverId), rules);
  return { money: b.build(), takeIqd: take, totalIqd: total };
}

// ───────────────────────── intercity seats ─────────────────────────

/** Seat 10 %, front-seat premium 25 % (money §3); walk-ups carry no commission at launch. */
export function postSeat(input: SeatMoneyPayload, rules: MoneyRules): RidePostings {
  const s = SeatMoneyPayload.parse(input);
  const b = new GroupBuilder(`seat:${s.seatId}:money`, 'money', s.occurredAt, { departureId: s.departureId, routeId: s.routeId });
  const payer = payerAccount(s);
  const driver = Accounts.driver(s.driverId);
  const seatTake = s.walkUp ? 0 : takeOf(s.fareIqd, rules.take.intercity_seat);
  const premiumTake = s.walkUp ? 0 : takeOf(s.frontPremiumIqd, rules.take.front_seat_premium);

  b.add('fare', s.fareIqd, payer, driver, s.walkUp ? 'walk_up' : 'seat');
  b.add('commission_accrued', seatTake, driver, Accounts.platform, 'take:intercity_seat');
  b.add('seat_premium', s.frontPremiumIqd, payer, driver, 'front');
  b.add('commission_accrued', premiumTake, driver, Accounts.platform, 'take:front_seat_premium');
  const total = settleCustomer(b, payer, s, s.fareIqd + s.frontPremiumIqd, Accounts.cash(s.driverId), rules);
  return { money: b.build(), takeIqd: seatTake + premiumTake, totalIqd: total };
}

// ───────────────────────── khat subscriptions ─────────────────────────

/** Khat seat: 8 % + 1,000 fixed per rider-month; prorated joins post `subscription_proration`. */
export function postSubscription(input: SubscriptionChargePayload, rules: MoneyRules): RidePostings {
  const s = SubscriptionChargePayload.parse(input);
  const b = new GroupBuilder(`subscription:${s.subscriptionId}:${s.cycle}`, 'money', s.occurredAt, { routeId: s.routeId });
  const payer = payerAccount(s);
  const driver = Accounts.driver(s.driverId);
  const take = takeOf(s.amountIqd, rules.take.khat_seat);
  b.add(s.prorated ? 'subscription_proration' : 'subscription_charge', s.amountIqd, payer, driver, s.cycle);
  b.add('commission_accrued', take, driver, Accounts.platform, 'take:khat_seat');
  const total = settleCustomer(b, payer, s, s.amountIqd, Accounts.cash(s.driverId), rules);
  return { money: b.build(), takeIqd: take, totalIqd: total };
}

// ───────────────────────── late meter ─────────────────────────

/** Meter blocks after the grace period, counted up to the cap (domain §2). */
export function lateMeterBlocks(minutesLate: number, rules: MoneyRules): number {
  const m = rules.lateMeter;
  const late = Math.min(minutesLate, m.capMin);
  if (late <= m.graceMin) return 0;
  return Math.ceil((late - m.graceMin) / m.blockMin);
}

/** Late meters pay 100 % to the wronged party; the platform takes nothing (money §3). */
export function postLateMeter(input: LateMeterPayload, rules: MoneyRules): PostingGroup | null {
  const l = LateMeterPayload.parse(input);
  const blocks = lateMeterBlocks(l.minutesLate, rules);
  if (blocks === 0) return null;
  const b = new GroupBuilder(`late:${l.departureId}:${l.late.kind}:${l.late.id}`, 'money', l.occurredAt, { departureId: l.departureId });
  const waiting = l.waitingRiderIds.filter((id) => id !== l.late.id);
  if (l.late.kind === 'rider') {
    const rider = Accounts.customer(l.late.id);
    b.add('late_penalty_driver', blocks * rules.lateMeter.riderLateToDriverPerBlockIqd, rider, Accounts.driver(l.driverId));
    for (const w of waiting) b.add('late_penalty_rider_credit', blocks * rules.lateMeter.riderLateToEachRiderPerBlockIqd, rider, Accounts.customer(w));
  } else {
    for (const w of waiting) b.add('late_penalty_rider_credit', blocks * rules.lateMeter.driverLateToEachRiderPerBlockIqd, Accounts.driver(l.driverId), Accounts.customer(w), 'driver_late');
  }
  const g = b.build();
  return g.lines.length > 0 ? g : null;
}

// ───────────────────────── cancellations ─────────────────────────

/** Cancellation fee, 100 % to the wronged party; unpaid it stays as wallet debt. */
export function postCancellation(input: z.input<typeof OrderCancelledPayload>): PostingGroup | null {
  const c = OrderCancelledPayload.parse(input);
  if (c.feeIqd === 0) return null;
  const payer = payerAccount(c);
  const b = new GroupBuilder(`order:${c.orderId}:cancel`, 'money', c.occurredAt, { orderId: c.orderId, tripId: c.tripId });
  for (const to of c.beneficiaries) b.add('cancellation_fee', to.amountIqd, payer, to.kind === 'merchant' ? Accounts.merchantCash(to.id) : Accounts.driver(to.id), to.kind);
  return b.control(payer, -c.feeIqd).build();
}

/** Driver cancels inside 2 h: his fee is shared by the booked riders as credit; low-fill cancels post nothing. */
export function postDepartureCancelled(input: DepartureCancelledPayload): PostingGroup | null {
  const d = DepartureCancelledPayload.parse(input);
  if (d.cancelledBy !== 'driver' || d.feeIqd === 0 || d.riderIds.length === 0) return null;
  const b = new GroupBuilder(`departure:${d.departureId}:cancel`, 'money', d.occurredAt, { departureId: d.departureId, routeId: d.routeId });
  const shares = allocate(d.feeIqd, d.riderIds.map(() => 1));
  d.riderIds.forEach((r, i) => b.add('departure_cancel_fee', shares[i] ?? 0, Accounts.driver(d.driverId), Accounts.customer(r)));
  return b.control(Accounts.driver(d.driverId), -d.feeIqd).build();
}

// ───────────────────────── merchant cash account ─────────────────────────

/** Courier hands a merchant its cash, confirmed by PIN or tablet tap (decisions §3). */
export function postMerchantPaidByCourier(input: { handoverId: string; courierId: string; merchantId: string; amountIqd: number; occurredAt: Date }): PostingGroup {
  return new GroupBuilder(`handover:${input.handoverId}`, 'money', input.occurredAt, {})
    .add('merchant_paid_by_courier', input.amountIqd, Accounts.merchantCash(input.merchantId), Accounts.cash(input.courierId), input.handoverId)
    .build();
}

export type SettlementChannel = 'zaincash' | 'agent' | 'ops_round' | 'bank';

/**
 * Real money moving between the company and a driver or merchant, keyed by its settlement
 * reference (G-82): a driver hands cash in, the company pays a merchant out, or the company pays a
 * driver it owes (G-86 negative-balance payouts).
 */
export function postSettlement(
  input:
    | { kind: 'driver_settlement'; driverId: string; amountIqd: number; channel: SettlementChannel; reference: string; occurredAt: Date }
    | { kind: 'merchant_payout'; merchantId: string; amountIqd: number; channel: SettlementChannel; reference: string; occurredAt: Date }
    | { kind: 'driver_payout'; driverId: string; amountIqd: number; channel: SettlementChannel; reference: string; occurredAt: Date },
): PostingGroup {
  const b = new GroupBuilder(`settlement:${input.reference}`, 'money', input.occurredAt, {});
  const memo = `${input.channel}:${input.reference}`;
  if (input.kind === 'driver_settlement') b.add('driver_settlement', input.amountIqd, Accounts.bank, Accounts.cash(input.driverId), memo);
  else if (input.kind === 'merchant_payout') b.add('merchant_payout', input.amountIqd, Accounts.merchantCash(input.merchantId), Accounts.bank, memo);
  else b.add('driver_payout', input.amountIqd, Accounts.driver(input.driverId), Accounts.bank, memo);
  return b.build();
}

// ───────────────────────── incentives ─────────────────────────

export interface ShiftStats {
  earningsIqd: number;
  acceptanceRate: number;
  cancelsAfterAccept: number;
  completedJobs: number;
}

/** G-91: guarantee needs ≥ 85 % acceptance, ≤ 1 cancel after accept and ≥ 3 completed jobs. */
export function guaranteeTopUp(shift: ShiftStats, rules: MoneyRules): number {
  const g = rules.guarantee;
  const eligible = shift.acceptanceRate >= g.minAcceptance && shift.cancelsAfterAccept <= g.maxCancelsAfterAccept && shift.completedJobs >= g.minCompletedJobs;
  return eligible ? Math.max(0, g.amountIqd - shift.earningsIqd) : 0;
}

export function postDriverIncentive(input: { key: string; driverId: string; amountIqd: number; reason: string; occurredAt: Date }): PostingGroup | null {
  if (input.amountIqd === 0) return null;
  return new GroupBuilder(`incentive:${input.key}`, 'money', input.occurredAt, {})
    .add('driver_incentive', input.amountIqd, Accounts.platform, Accounts.driver(input.driverId), input.reason)
    .build();
}

// ───────────────────────── points ─────────────────────────

export interface PointsRecipient {
  personId?: string | undefined;
  phoneHash?: string | undefined;
  weight: number;
}

/** Decisions §2: 1 point per 100 IQD of platform revenue, capped per order. */
export function pointsForRevenue(revenueIqd: number, rules: MoneyRules): number {
  return Math.min(rules.points.maxPerOrder, Math.floor(Math.max(0, revenueIqd) / rules.points.revenueIqdPerPoint));
}

/** Rides and seats: 1 point per 200 IQD of platform take, same cap. */
export function pointsForRideTake(takeIqd: number, rules: MoneyRules): number {
  return Math.min(rules.points.maxPerOrder, Math.floor(Math.max(0, takeIqd) / rules.points.rideTakeIqdPerPoint));
}

/**
 * Earned points split across tagged participants by their share of the items; phone-only
 * participants get pending points keyed by phone hash; the orderer of a group order earns the
 * organiser bonus (+10 % of the order's points). Points come out of the points pool, never money.
 */
export function postPoints(input: {
  groupId: string;
  occurredAt: Date;
  refs: PostingRefs;
  points: number;
  ordererId: string;
  recipients: readonly PointsRecipient[];
  rules: MoneyRules;
}): PostingGroup | null {
  const { points, rules } = input;
  if (points <= 0) return null;
  const b = new GroupBuilder(input.groupId, 'points', input.occurredAt, input.refs);
  const recipients = input.recipients.length > 0 ? input.recipients : [{ personId: input.ordererId, weight: 1 }];
  const shares = allocate(points, recipients.map((r) => r.weight));
  recipients.forEach((r, i) => {
    const n = shares[i] ?? 0;
    if (r.personId) b.add('points_earned', n, Accounts.pointsPool, Accounts.points(r.personId));
    else if (r.phoneHash) b.add('points_pending', n, Accounts.pointsPool, Accounts.pointsPending(r.phoneHash));
  });
  const othersTagged = recipients.some((r) => r.personId !== input.ordererId);
  if (othersTagged) b.add('organizer_bonus', Math.floor(points * rules.points.organizerBonusRate), Accounts.pointsPool, Accounts.points(input.ordererId));
  const g = b.build();
  return g.lines.length > 0 ? g : null;
}

/** Decisions §1: 200 points per side; the referrer's side is dropped once his monthly cap is reached. */
export function postReferral(input: { refereeId: string; referrerId: string; referrerWithinCap: boolean; occurredAt: Date; rules: MoneyRules }): PostingGroup {
  const n = input.rules.referral.pointsPerSide;
  const b = new GroupBuilder(`referral:${input.refereeId}`, 'points', input.occurredAt, {});
  b.add('referral_bonus', n, Accounts.pointsPool, Accounts.points(input.refereeId), 'referee');
  if (input.referrerWithinCap) b.add('referral_bonus', n, Accounts.pointsPool, Accounts.points(input.referrerId), `referrer_of:${input.refereeId}`);
  return b.build();
}

/** Recipients for an order's points: tagged participants by items, untagged items to the orderer. */
export function orderPointRecipients(order: { customerId: string; itemsSubtotalIqd: number; participants: ReadonlyArray<{ personId?: string | undefined; phoneHash?: string | undefined; itemsIqd: number }> }): PointsRecipient[] {
  const tagged = order.participants.reduce((a, p) => a + p.itemsIqd, 0);
  const recipients: PointsRecipient[] = order.participants.map((p) => ({ personId: p.personId, phoneHash: p.phoneHash, weight: p.itemsIqd }));
  const untagged = Math.max(0, order.itemsSubtotalIqd - tagged);
  if (untagged > 0 || recipients.length === 0) recipients.push({ personId: order.customerId, weight: untagged || 1 });
  return recipients;
}

// ───────────────────────── adjustments ─────────────────────────

/** G-85: a hand-written correction; who may post it is decided by `AdjustmentService`. */
export function postAdjustment(input: { id: string; amountIqd: number; fromAccount: string; toAccount: string; reason: string; incidentId: string; occurredAt: Date }): PostingGroup {
  return new GroupBuilder(`adjustment:${input.id}`, kindOf('adjustment'), input.occurredAt, {})
    .add('adjustment', input.amountIqd, input.fromAccount, input.toAccount, `${input.reason} [incident:${input.incidentId}]`)
    .build();
}
