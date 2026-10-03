import type { CancellationFee, FeeParty, OrderState, OrderType, TripState } from '@driver/contracts';
import { roundTo } from './engine.js';

/**
 * Cancellation fees (dispatch & pricing spec §4, edge-case review A.12/A.15). Pure: everything it
 * needs about the order or trip is passed in, so orders, trips and the Console preview agree.
 *
 * Rules: round to the city step; no fee exceeds the fare; every fee carries an Arabic label and a
 * one-line reason for the receipt.
 */

/** What an order looks like to the fee rules. */
export interface OrderCancellationSubject {
  kind: 'order';
  type: OrderType;
  state: OrderState;
  itemsTotalIqd: number;
  deliveryFeeIqd: number;
  totalIqd: number;
  /** Scheduled orders cancel free until the merchant has been offered the order. */
  scheduledFor: Date | null;
  merchantOfferedAt: Date | null;
  /** A courier has accepted and is heading to the pickup (food: gets 500 of the fee). */
  courierEnRoute: boolean;
  /** Errands: a courier accepted the job (cancel before purchase = 500). */
  courierAssigned: boolean;
  /** Errands: receipt total once purchased (cancel after purchase pays receipt + fee). */
  receiptTotalIqd: number | null;
}

/** What a ride trip looks like to the fee rules. */
export interface TripCancellationSubject {
  kind: 'trip';
  state: TripState;
  /** Who is cancelling. */
  by: 'customer' | 'driver';
  acceptedAt: Date | null;
  /** First pickup arrival (driver at the rider). */
  arrivedPickupAt: Date | null;
  fareIqd: number;
}

export type CancellationSubject = OrderCancellationSubject | TripCancellationSubject;

export interface CancellationRules {
  roundingStep: number;
  /** Rides: free window after acceptance. */
  rideFreeAfterAcceptSec: number;
  rideAfterAcceptIqd: number;
  rideAfterArrivalIqd: number;
  driverAfterArrivalCreditIqd: number;
  foodAfterAcceptIqd: number;
  courierEnRouteIqd: number;
  errandBeforePurchaseIqd: number;
}

export const DEFAULT_CANCELLATION_RULES: CancellationRules = {
  roundingStep: 250,
  rideFreeAfterAcceptSec: 60,
  rideAfterAcceptIqd: 500,
  rideAfterArrivalIqd: 1000,
  driverAfterArrivalCreditIqd: 500,
  foodAfterAcceptIqd: 500,
  courierEnRouteIqd: 500,
  errandBeforePurchaseIqd: 500,
};

const MERCHANT_TYPES: readonly OrderType[] = ['food', 'grocery_catalog'];

export function cancellationFee(subject: CancellationSubject, at: Date, rules: CancellationRules = DEFAULT_CANCELLATION_RULES): CancellationFee {
  return subject.kind === 'trip' ? tripFee(subject, at, rules) : orderFee(subject, rules);
}

function orderFee(o: OrderCancellationSubject, r: CancellationRules): CancellationFee {
  if (o.type === 'ride') {
    // Ride orders are priced through their trip; without one nothing has happened yet.
    if (o.state === 'placed') return free('قبل ما يقبل السايق', 'Before a driver accepted');
  }
  const terminal: readonly OrderState[] = ['delivered', 'closed', 'completed', 'merchant_rejected', 'customer_cancelled', 'platform_cancelled', 'refunded', 'disputed', 'failed'];
  if (o.state === 'picked_up' || terminal.includes(o.state)) return notAllowed();

  if (MERCHANT_TYPES.includes(o.type)) {
    if (o.scheduledFor && !o.merchantOfferedAt) return free('الطلب المجدول ما وصل للمطعم بعد', 'Scheduled order not yet sent to the merchant');
    if (o.state === 'placed') return free('قبل ما يقبل المطعم', 'Before the merchant accepted');
    const courier = o.courierEnRoute ? r.courierEnRouteIqd : 0;
    if (o.state === 'merchant_accepted') {
      return fee(o.totalIqd, r, 'customer', [
        { to: 'merchant', amountIqd: r.foodAfterAcceptIqd },
        { to: 'courier', amountIqd: courier },
      ], 'إلغاء بعد قبول المطعم', 'Cancelled after the merchant accepted', 'المطعم قبل الطلب وبلش يجهزه');
    }
    // preparing / ready: the food cost goes to the merchant, 500 to a courier already on the way (A.15).
    return fee(o.totalIqd, r, 'customer', [
      { to: 'merchant', amountIqd: o.itemsTotalIqd },
      { to: 'courier', amountIqd: courier },
    ], 'إلغاء بعد التحضير', 'Cancelled while preparing', 'الأكل انطبخ، تدفع كلفته');
  }

  // errands and parcels (no merchant acceptance)
  if (!o.courierAssigned) return free('قبل ما يقبل المندوب', 'Before a courier accepted');
  if (o.receiptTotalIqd !== null && o.receiptTotalIqd > 0) {
    return fee(Number.MAX_SAFE_INTEGER, r, 'customer', [
      { to: 'courier', amountIqd: o.receiptTotalIqd + o.deliveryFeeIqd },
    ], 'إلغاء بعد الشراء', 'Cancelled after purchase', 'المندوب اشترى الغراض، تدفع الوصل والأجرة');
  }
  return fee(o.totalIqd || Number.MAX_SAFE_INTEGER, r, 'customer', [{ to: 'courier', amountIqd: r.errandBeforePurchaseIqd }], 'إلغاء بعد قبول المندوب', 'Cancelled after the courier accepted', 'المندوب تحرك على طلبك');
}

function tripFee(t: TripCancellationSubject, at: Date, r: CancellationRules): CancellationFee {
  const terminal: readonly TripState[] = ['completed', 'driver_cancelled', 'customer_cancelled', 'platform_cancelled', 'failed'];
  if (terminal.includes(t.state)) return notAllowed();
  const accepted = t.acceptedAt !== null && !['created', 'offered', 'declined', 'timed_out'].includes(t.state);
  const arrived = t.arrivedPickupAt !== null || ['arrived_pickup', 'in_transit', 'arrived_dropoff'].includes(t.state);

  if (t.by === 'driver') {
    if (!accepted) return free('قبل القبول', 'Before acceptance');
    if (arrived) {
      return {
        ...fee(t.fareIqd, r, 'driver', [{ to: 'customer', amountIqd: r.driverAfterArrivalCreditIqd }], 'إلغاء السايق بعد الوصول', 'Driver cancelled after arrival', 'السايق لغى بعد ما وصل، رصيد إلك'),
        scoringHit: true,
      };
    }
    return { ...free('إلغاء السايق', 'Driver cancelled'), scoringHit: true };
  }

  // customer
  if (t.state === 'in_transit' || t.state === 'arrived_dropoff') return notAllowed();
  if (!accepted) return free('قبل ما يقبل السايق', 'Before a driver accepted');
  if (arrived) {
    return fee(t.fareIqd, r, 'customer', [{ to: 'driver', amountIqd: r.rideAfterArrivalIqd }], 'إلغاء بعد وصول السايق', 'Cancelled after the driver arrived', 'السايق وصل يمك');
  }
  const sinceAcceptSec = t.acceptedAt ? (at.getTime() - t.acceptedAt.getTime()) / 1000 : 0;
  if (sinceAcceptSec <= r.rideFreeAfterAcceptSec) return free('خلال أول دقيقة من القبول', 'Within a minute of acceptance');
  return fee(t.fareIqd, r, 'customer', [{ to: 'driver', amountIqd: r.rideAfterAcceptIqd }], 'إلغاء بعد قبول السايق', 'Cancelled after the driver accepted', 'السايق تحرك عليك');
}

// ───────────────────────── helpers ─────────────────────────

/** `_en` documents the English reason at the call site; the receipt only prints Arabic. */
function free(ar: string, _en: string): CancellationFee {
  return { allowed: true, free: true, amountIqd: 0, payer: 'none', splits: [], scoringHit: false, label_ar: 'إلغاء مجاني', label_en: 'Free cancellation', reason_ar: ar };
}

function notAllowed(): CancellationFee {
  return {
    allowed: false,
    free: false,
    amountIqd: 0,
    payer: 'none',
    splits: [],
    scoringHit: false,
    label_ar: 'ما ينلغي',
    label_en: 'Cannot be cancelled',
    reason_ar: 'بعد الاستلام ما ينلغي، افتح شكوى',
  };
}

/**
 * Builds a fee from its splits: each split rounded to the city step, zero splits dropped, and the
 * total capped at the fare (largest split trimmed first, so the cap never invents money).
 */
function fee(
  capIqd: number,
  r: CancellationRules,
  payer: CancellationFee['payer'],
  rawSplits: Array<{ to: FeeParty; amountIqd: number }>,
  label_ar: string,
  label_en: string,
  reason_ar: string,
): CancellationFee {
  const splits = rawSplits.map((s) => ({ to: s.to, amountIqd: Math.max(0, roundTo(s.amountIqd, r.roundingStep)) })).filter((s) => s.amountIqd > 0);
  let total = splits.reduce((a, s) => a + s.amountIqd, 0);
  const cap = Math.max(0, capIqd);
  if (total > cap) {
    let excess = total - cap;
    for (const s of [...splits].sort((a, b) => b.amountIqd - a.amountIqd)) {
      const cut = Math.min(s.amountIqd, excess);
      s.amountIqd -= cut;
      excess -= cut;
      if (excess === 0) break;
    }
    total = cap;
  }
  const kept = splits.filter((s) => s.amountIqd > 0);
  if (total === 0) return free(reason_ar, label_en);
  return { allowed: true, free: false, amountIqd: total, payer, splits: kept, scoringHit: false, label_ar, label_en, reason_ar };
}
