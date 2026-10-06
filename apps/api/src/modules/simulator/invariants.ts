import { AFTER_TIP_MEMO, AZIZIYAH_MONEY_RULES, latePromiseTerms, TERMINAL_ORDER_STATES, shiftGuarantee, type LedgerEvent, type Order, type Trip } from '@driver/contracts';
import type { DoorCashRecord, HandoverRecord, HotWaitRecord, ObservedOffer, ReplayRecord } from './context.js';

/**
 * Named invariants (plan Step 7 + amendments). Each check is a pure function of the end-of-run
 * snapshot, counts how many things it checked, and lists violations with their first examples.
 * The simulator gate fails on any violation.
 */

export interface QuarantinedEvent {
  id: string;
  type: string;
  tripId: string | null;
  orderId: string | null;
  recordedAt: Date;
}

/** G-91 inputs the ledger does not hold: who is covered, their offer answers, the settled shifts. */
export interface GuaranteeSnapshot {
  /** Drivers the guarantee covers (city switch on, cap role covered: the bike couriers). */
  covered: string[];
  /** Every offer answer the drivers gave (accepted, declined, timed out), from the events log. */
  offers: Array<{ driverId: string; at: Date; accepted: boolean }>;
  /** The shifts starting on the day's date that were over when the Sunday settlement ran (empty in live runs). */
  windows: Array<{ id: string; from: Date; to: Date }>;
}

export interface SimSnapshot {
  orders: Order[];
  trips: Trip[];
  ledger: LedgerEvent[];
  quarantined: QuarantinedEvent[];
  outbox: { pending: number; published: number; failed: number };
  offers: ObservedOffer[];
  replays: ReplayRecord[];
  hotWaits: HotWaitRecord[];
  handovers: HandoverRecord[];
  /** Cash drop-offs as the couriers recorded them (absent in hand-built snapshots). */
  doorCash?: DoorCashRecord[];
  merchants: Array<{ merchantId: string; balanceIqd: number }>;
  /** Absent in hand-built snapshots. */
  guarantee?: GuaranteeSnapshot;
  errors: Array<{ where: string; message: string }>;
}

export interface InvariantResult {
  name: string;
  description: string;
  checked: number;
  violations: number;
  examples: string[];
}

export const RULES = {
  cashStepIqd: 250,
  /** "الخردة علينا": most that may go to a customer's wallet when the courier has no change. */
  changeToWalletMaxIqd: 25_000,
  maxHotWaitMin: 10,
  pointsCapPerOrder: 50,
};

const MAX_EXAMPLES = 5;
/** Posting group prefix of the honest-delay credit (tracking's `latePromiseGroupId`). */
const LATE_PROMISE_GROUP = 'late_promise:';
/** Posting group prefix of the tip after a good rating (`afterTipGroupId`). */
const AFTER_TIP_GROUP = 'tip:';
const TERMINAL_TRIPS = new Set(['completed', 'customer_cancelled', 'driver_cancelled', 'platform_cancelled', 'failed']);

export const isPointsAccount = (a: string) => a.startsWith('points:') || a.startsWith('points_pending:') || a === 'points_pool';

type Check = (s: SimSnapshot) => { checked: number; bad: string[] };

interface Definition {
  name: string;
  description: string;
  run: Check;
}

function bookNet(rows: readonly LedgerEvent[], points: boolean): { checked: number; net: number } {
  let net = 0;
  let checked = 0;
  for (const e of rows) {
    if ((e.kind === 'points') === points) checked += 1;
    if (isPointsAccount(e.toAccount) === points) net += e.amount;
    if (isPointsAccount(e.fromAccount) === points) net -= e.amount;
  }
  return { checked, net };
}

function moneyGroupsOf(rows: readonly LedgerEvent[], orderId: string): string[] {
  const groups = new Set<string>();
  for (const e of rows) {
    if (e.orderId !== orderId || e.kind !== 'money' || !e.postingGroupId) continue;
    if (e.postingGroupId.startsWith(`order:${orderId}:money`) || (e.postingGroupId.startsWith('trip:') && e.postingGroupId.endsWith(':money'))) groups.add(e.postingGroupId);
  }
  return [...groups];
}

function byOrder(rows: readonly LedgerEvent[]): Map<string, LedgerEvent[]> {
  const m = new Map<string, LedgerEvent[]>();
  for (const e of rows) {
    if (!e.orderId) continue;
    const list = m.get(e.orderId) ?? [];
    list.push(e);
    m.set(e.orderId, list);
  }
  return m;
}

const sum = (rows: readonly LedgerEvent[], pred: (e: LedgerEvent) => boolean) => rows.filter(pred).reduce((s, e) => s + e.amount, 0);

export const INVARIANTS: readonly Definition[] = [
  {
    name: 'ledger_money_balanced',
    description: 'Σ over money accounts = 0',
    run: (s) => {
      const { checked, net } = bookNet(s.ledger, false);
      return { checked, bad: net === 0 ? [] : [`money book nets ${net}`] };
    },
  },
  {
    name: 'ledger_points_balanced',
    description: 'Σ over points accounts = 0',
    run: (s) => {
      const { checked, net } = bookNet(s.ledger, true);
      return { checked, bad: net === 0 ? [] : [`points book nets ${net}`] };
    },
  },
  {
    name: 'orders_terminal',
    description: 'every order ends in a terminal state',
    run: (s) => ({ checked: s.orders.length, bad: s.orders.filter((o) => !TERMINAL_ORDER_STATES.includes(o.state)).map((o) => `${o.id} (${o.type}) ended ${o.state}`) }),
  },
  {
    name: 'trips_terminal',
    description: 'every trip ends in a terminal state',
    run: (s) => ({ checked: s.trips.length, bad: s.trips.filter((t) => !TERMINAL_TRIPS.has(t.state)).map((t) => `${t.id} (${t.vertical}) ended ${t.state}`) }),
  },
  {
    name: 'stop_completed_after_arrived',
    description: 'no stop completed before it was arrived at',
    run: (s) => {
      const bad: string[] = [];
      let checked = 0;
      for (const t of s.trips)
        for (const st of t.stops) {
          if (st.state !== 'completed') continue;
          checked += 1;
          if (!st.arrivedAt || !st.completedAt || st.arrivedAt.getTime() > st.completedAt.getTime()) bad.push(`${t.id}/${st.id} completed ${st.completedAt?.toISOString() ?? '?'} arrived ${st.arrivedAt?.toISOString() ?? 'never'}`);
        }
      return { checked, bad };
    },
  },
  {
    name: 'completed_trip_has_no_pending_stop',
    description: 'no trip.completed with a pending (or arrived) stop',
    run: (s) => {
      const done = s.trips.filter((t) => t.state === 'completed');
      return { checked: done.length, bad: done.filter((t) => t.stops.some((st) => st.state === 'pending' || st.state === 'arrived')).map((t) => `${t.id} completed with ${t.stops.filter((st) => st.state === 'pending' || st.state === 'arrived').length} open stop(s)`) };
    },
  },
  {
    name: 'outbox_drained',
    description: 'outbox pending = 0 and failed = 0 after the final drain',
    run: (s) => ({ checked: s.outbox.pending + s.outbox.published + s.outbox.failed, bad: s.outbox.pending > 0 || s.outbox.failed > 0 ? [`pending ${s.outbox.pending}, failed ${s.outbox.failed}`] : [] }),
  },
  {
    name: 'idempotent_replays',
    description: 'a re-sent tap (same idempotency key) adds no events and no ledger rows',
    run: (s) => {
      const dups = s.replays.filter((r) => r.kind === 'duplicate');
      return { checked: dups.length, bad: dups.filter((r) => r.eventsAdded !== 0 || r.ledgerAdded !== 0).map((r) => `${r.key} (${r.action} on ${r.tripId}) by ${r.driverId}: +${r.eventsAdded} events, +${r.ledgerAdded} ledger rows`) };
    },
  },
  {
    name: 'quarantined_never_settled',
    description: 'late replays are quarantined and never posted to the ledger',
    run: (s) => {
      const bad: string[] = [];
      const late = s.replays.filter((r) => r.kind === 'fresh' && r.detached);
      for (const r of late) {
        if (r.ledgerAdded !== 0 || r.eventsAdded !== r.quarantinedAdded) bad.push(`${r.key} (${r.action} on ${r.tripId}/${r.orderId}): +${r.eventsAdded} events (${r.quarantinedAdded} quarantined), +${r.ledgerAdded} ledger rows`);
      }
      for (const q of s.quarantined) {
        if (!q.tripId || !q.orderId) continue;
        const settled = s.ledger.filter((e) => e.tripId === q.tripId && e.orderId === q.orderId && e.occurredAt.getTime() >= q.recordedAt.getTime());
        if (settled.length > 0) bad.push(`${q.type} ${q.id} (trip ${q.tripId}, order ${q.orderId}) settled by ${settled.map((e) => e.type).join(', ')}`);
      }
      return { checked: late.length + s.quarantined.length, bad };
    },
  },
  {
    name: 'fee_within_fare',
    description: 'no fee exceeds the fare it is taken from',
    run: (s) => {
      const bad: string[] = [];
      let checked = 0;
      const rows = byOrder(s.ledger);
      for (const o of s.orders) {
        const r = rows.get(o.id) ?? [];
        checked += 1;
        const fare = sum(r, (e) => e.type === 'fare' || e.type === 'parcel_fee');
        const take = sum(r, (e) => e.type === 'commission_accrued' && e.fromAccount.startsWith('driver:'));
        if (take > fare) bad.push(`${o.id}: take ${take} > fare ${fare}`);
        const items = sum(r, (e) => e.type === 'merchant_payable');
        const commission = sum(r, (e) => e.type === 'commission_accrued' && e.fromAccount.startsWith('merchant_cash:'));
        if (commission > items) bad.push(`${o.id}: commission ${commission} > items ${items}`);
        const delivery = sum(r, (e) => e.type === 'delivery_fee');
        if (delivery > o.deliveryFeeIqd) bad.push(`${o.id}: delivery lines ${delivery} > delivery fee ${o.deliveryFeeIqd}`);
        const cancel = sum(r, (e) => e.type === 'cancellation_fee');
        if (cancel > o.totalIqd || (o.cancellationFeeIqd ?? 0) > o.totalIqd) bad.push(`${o.id}: cancellation fee ${Math.max(cancel, o.cancellationFeeIqd ?? 0)} > total ${o.totalIqd}`);
      }
      return { checked, bad };
    },
  },
  {
    name: 'customer_cash_rounds_to_250',
    description:
      "cash totals (and cash collected) are multiples of 250; what a cash customer hands over above his price is change credited to his wallet — the rounding (< 250) plus, when the courier had no change, the recorded rest of the note (\"الخردة علينا\": cash orders only, ≤ 25,000, in 250s) — never a charge, he never ends up owing, and the courier's cash on hand is the whole note he recorded (Ali, 2026-10-04 / 2026-10-05)",
    run: (s) => {
      const bad: string[] = [];
      const rows = byOrder(s.ledger);
      const step = RULES.cashStepIqd;
      const door = new Map((s.doorCash ?? []).map((d) => [d.orderId, d]));
      for (const o of s.orders) {
        const r = rows.get(o.id) ?? [];
        const extra = sum(r, (e) => e.type === 'cash_change_to_wallet');
        if (o.paymentMethod !== 'cash') {
          if (extra > 0 || (o.changeToWalletIqd ?? 0) > 0) bad.push(`${o.id} (${o.type}) ${o.paymentMethod} order has change to the wallet ${extra}`);
          continue;
        }
        if (o.totalIqd % step !== 0) bad.push(`${o.id} (${o.type}) cash total ${o.totalIqd}`);
        const collected = sum(r, (e) => e.type === 'cash_collected' || e.type === 'cash_rounding_credit' || e.type === 'cash_change_to_wallet');
        if (collected % step !== 0) bad.push(`${o.id} (${o.type}) collected ${collected}`);
        if (r.some((e) => e.type === 'rounding_residue')) bad.push(`${o.id} (${o.type}) has a rounding_residue line (rounding must be change to the wallet)`);
        if (extra % step !== 0 || extra > RULES.changeToWalletMaxIqd) bad.push(`${o.id} (${o.type}) change to the wallet ${extra} (must be in ${step}s, ≤ ${RULES.changeToWalletMaxIqd})`);
        if (extra !== (o.changeToWalletIqd ?? 0)) bad.push(`${o.id} (${o.type}) ledger change to the wallet ${extra} ≠ the order's recorded ${o.changeToWalletIqd ?? 0}`);
        // Cash on hand == collected: what left the collector's cash account for this order is the note he recorded.
        const rec = door.get(o.id);
        if (rec && collected > 0) {
          const onHand = sum(r, (e) => e.fromAccount.startsWith('cash:') && (e.type === 'cash_collected' || e.type === 'cash_rounding_credit' || e.type === 'cash_change_to_wallet'));
          if (onHand !== rec.collectedIqd) bad.push(`${o.id} (${o.type}) courier cash on hand ${onHand} ≠ the ${rec.collectedIqd} he recorded`);
          if (extra !== rec.changeToWalletIqd) bad.push(`${o.id} (${o.type}) change to the wallet ${extra} ≠ the ${rec.changeToWalletIqd} he recorded`);
        }
        if (o.state !== 'closed') continue;
        const groups = new Set(moneyGroupsOf(s.ledger, o.id));
        const payer = `customer:${o.ordererId}`;
        const net = r.filter((e) => e.postingGroupId && groups.has(e.postingGroupId)).reduce((n, e) => n + (e.toAccount === payer ? e.amount : 0) - (e.fromAccount === payer ? e.amount : 0), 0);
        const rounding = net - extra;
        if (rounding < 0 || rounding >= step) bad.push(`${o.id} (${o.type}) customer left at ${net} after paying ${collected} for ${o.totalIqd} (rounding change must be 0–${step - 1}, plus ${extra} no-change credit)`);
        if (net !== (o.changeIqd ?? 0) + extra) bad.push(`${o.id} (${o.type}) wallet change ${net} ≠ the order's "الباقي رصيد" ${o.changeIqd ?? 0} + recorded no-change credit ${extra}`);
      }
      return { checked: s.orders.length, bad };
    },
  },
  {
    name: 'no_offer_to_over_cap_driver',
    description: 'over-cap drivers finish the current job and get no new offer',
    run: (s) => ({ checked: s.offers.length, bad: s.offers.filter((o) => o.overCap).map((o) => `${o.kind} for ${o.tripId} to ${o.driverId} owing ${o.owedIqd} ≥ cap ${o.capIqd}`) }),
  },
  {
    name: 'batched_hot_wait_within_10_min',
    description: 'no batched hot item waits more than 10 min from ready (courier-offline incidents excluded)',
    run: (s) => {
      const planned = s.hotWaits.filter((h) => !h.courierOffline);
      return { checked: planned.length, bad: planned.filter((h) => h.waitMin > RULES.maxHotWaitMin).map((h) => `${h.orderId} with ${h.courierId} waited ${h.waitMin} min`) };
    },
  },
  {
    name: 'no_points_on_money_accounts',
    description: 'points rows touch only points accounts, money rows only money accounts',
    run: (s) => ({
      checked: s.ledger.length,
      bad: s.ledger
        .filter((e) => isPointsAccount(e.fromAccount) !== (e.kind === 'points') || isPointsAccount(e.toAccount) !== (e.kind === 'points'))
        .map((e) => `${e.id} ${e.kind}/${e.type} ${e.fromAccount} → ${e.toAccount}`),
    }),
  },
  {
    name: 'one_balanced_group_per_closed_order',
    description: 'exactly one balanced money posting group per closed order',
    run: (s) => {
      const bad: string[] = [];
      const closed = s.orders.filter((o) => o.state === 'closed');
      for (const o of closed) {
        const groups = moneyGroupsOf(s.ledger, o.id);
        if (groups.length !== 1) {
          bad.push(`${o.id} (${o.type}) has ${groups.length} money groups${groups.length ? `: ${groups.join(', ')}` : ''}`);
          continue;
        }
        const lines = s.ledger.filter((e) => e.postingGroupId === groups[0]);
        const net = new Map<string, number>();
        for (const e of lines) {
          net.set(e.toAccount, (net.get(e.toAccount) ?? 0) + e.amount);
          net.set(e.fromAccount, (net.get(e.fromAccount) ?? 0) - e.amount);
        }
        const total = [...net.values()].reduce((a, b) => a + b, 0);
        if (total !== 0) bad.push(`${o.id}: group ${groups[0]} nets ${total}`);
      }
      return { checked: closed.length, bad };
    },
  },
  {
    name: 'merchant_cash_reconciles',
    description: 'merchant cash balance = Σ payable (net of commission and of the merchant’s own deals) − Σ paid by courier (+ cancellation fees)',
    run: (s) => {
      const bad: string[] = [];
      for (const m of s.merchants) {
        const acct = `merchant_cash:${m.merchantId}`;
        const payable =
          sum(s.ledger, (e) => e.toAccount === acct && e.type === 'merchant_payable') -
          sum(s.ledger, (e) => e.fromAccount === acct && e.type === 'commission_accrued') -
          // Merchant-funded deals (domain §11): items discounts and free deliveries the merchant pays for.
          sum(s.ledger, (e) => e.fromAccount === acct && e.type === 'promo_funded');
        const fees = sum(s.ledger, (e) => e.toAccount === acct && e.type === 'cancellation_fee');
        const paidLedger = sum(s.ledger, (e) => e.fromAccount === acct && e.type === 'merchant_paid_by_courier');
        const payouts = sum(s.ledger, (e) => e.fromAccount === acct && e.type === 'merchant_payout');
        const paidSim = s.handovers.filter((h) => h.merchantId === m.merchantId).reduce((a, h) => a + h.amountIqd, 0);
        const expected = payable + fees - paidLedger - payouts;
        if (expected !== m.balanceIqd) bad.push(`${m.merchantId}: balance ${m.balanceIqd} ≠ payable ${payable} + fees ${fees} − paid by couriers ${paidLedger} − payouts ${payouts}`);
        if (paidLedger !== paidSim) bad.push(`${m.merchantId}: ledger shows ${paidLedger} paid by couriers, hand-overs confirmed ${paidSim}`);
      }
      return { checked: s.merchants.length, bad };
    },
  },
  {
    name: 'points_per_food_order_capped',
    description: 'points earned ≤ 50 per food order',
    run: (s) => {
      const bad: string[] = [];
      const rows = byOrder(s.ledger);
      const food = s.orders.filter((o) => o.type === 'food' || o.type === 'grocery_catalog');
      for (const o of food) {
        const pts = sum(rows.get(o.id) ?? [], (e) => e.kind === 'points' && ['points_earned', 'points_pending', 'organizer_bonus'].includes(e.type));
        if (pts > RULES.pointsCapPerOrder) bad.push(`${o.id}: ${pts} points`);
      }
      return { checked: food.length, bad };
    },
  },
  {
    name: 'late_credit_once_per_delivery',
    description:
      'the honest-delay credit (late_promise:<order>) is posted at most once per order, only on food / catalog-grocery deliveries, platform → the orderer’s wallet, for the delivery fee he paid — or the fixed free-delivery credit when he paid none (Ali, 2026-10-06)',
    run: (s) => {
      const bad: string[] = [];
      const orders = new Map(s.orders.map((o) => [o.id, o]));
      const byGroup = new Map<string, LedgerEvent[]>();
      for (const e of s.ledger) {
        if (!e.postingGroupId?.startsWith(LATE_PROMISE_GROUP)) continue;
        byGroup.set(e.postingGroupId, [...(byGroup.get(e.postingGroupId) ?? []), e]);
      }
      for (const [group, lines] of byGroup) {
        const orderId = group.slice(LATE_PROMISE_GROUP.length);
        const o = orders.get(orderId);
        if (!o) {
          bad.push(`${group}: no such order`);
          continue;
        }
        if (o.type !== 'food' && o.type !== 'grocery_catalog') bad.push(`${o.id} (${o.type}): late credit on a non-delivery`);
        if (lines.length !== 1) bad.push(`${o.id}: ${lines.length} late-credit lines (one per order)`);
        const expected = latePromiseTerms(o)?.creditIqd ?? 0;
        for (const e of lines) {
          if (e.type !== 'credit_issued' || e.fromAccount !== 'platform' || e.toAccount !== `customer:${o.ordererId}`) bad.push(`${o.id}: late credit ${e.type} ${e.fromAccount} → ${e.toAccount} (must be platform → customer:${o.ordererId})`);
          if (e.amount !== expected) bad.push(`${o.id}: late credit ${e.amount} ≠ ${expected} (fee ${o.deliveryFeeIqd}${o.discount?.target === 'delivery' ? `, free-delivery deal ${o.discount.amountIqd}` : ''})`);
        }
      }
      return { checked: byGroup.size, bad };
    },
  },
  {
    name: 'tip_after_rating_once_and_to_the_driver',
    description:
      'the tip after a 4–5 rating (tip:<order>, Ali 2026-10-06) is one line per order, from the orderer’s own wallet to the driver whose trip carried it, 100 % (no take), one of the offered amounts (500 / 1,000 / 2,000), only on an order rated ≥ 4 with no tip at checkout, within 24 h of delivery',
    run: (s) => {
      const bad: string[] = [];
      const rules = AZIZIYAH_MONEY_RULES.afterTip;
      const orders = new Map(s.orders.map((o) => [o.id, o]));
      const trips = new Map(s.trips.map((t) => [t.id, t]));
      const byGroup = new Map<string, LedgerEvent[]>();
      for (const e of s.ledger) {
        if (!e.postingGroupId?.startsWith(AFTER_TIP_GROUP)) continue;
        byGroup.set(e.postingGroupId, [...(byGroup.get(e.postingGroupId) ?? []), e]);
      }
      for (const [group, lines] of byGroup) {
        const o = orders.get(group.slice(AFTER_TIP_GROUP.length));
        if (!o) {
          bad.push(`${group}: no such order`);
          continue;
        }
        if (lines.length !== 1) bad.push(`${o.id}: ${lines.length} tip lines (one per order)`);
        if ((o.rating?.delivery ?? 0) < rules.minRating) bad.push(`${o.id}: tipped with a ${o.rating?.delivery ?? 'missing'} rating`);
        if (o.tipIqd > 0) bad.push(`${o.id}: tipped again after a ${o.tipIqd} tip at checkout`);
        for (const e of lines) {
          const courier = e.tripId ? trips.get(e.tripId)?.courierId : null;
          if (e.type !== 'tip' || e.memo !== AFTER_TIP_MEMO) bad.push(`${o.id}: ${e.type} (${e.memo}) in the tip group`);
          if (e.fromAccount !== `customer:${o.ordererId}`) bad.push(`${o.id}: tip paid from ${e.fromAccount}, not customer:${o.ordererId}`);
          if (!courier || e.toAccount !== `driver:${courier}`) bad.push(`${o.id}: tip to ${e.toAccount}, not the trip's driver (${courier ?? 'none'})`);
          if (!rules.amountsIqd.includes(e.amount)) bad.push(`${o.id}: tip ${e.amount} is not one of ${rules.amountsIqd.join(' / ')}`);
          if (!o.deliveredAt || e.occurredAt.getTime() > o.deliveredAt.getTime() + rules.windowHours * 3_600_000) bad.push(`${o.id}: tip at ${e.occurredAt.toISOString()} outside the window after delivery`);
        }
      }
      return { checked: byGroup.size, bad };
    },
  },
  {
    name: 'shift_guarantee_once_and_exact',
    description:
      'G-91 shift guarantee: switched off (Ali, 2026-10-06; MoneyRules.guarantee.enabled false) → no top-up for any driver in any shift and nobody covered; when on, at most one top-up per driver per shift (06:00–15:00, 15:00–02:00), platform-funded, only to covered drivers who met the conditions (≥ 85 % acceptance, ≤ 1 cancel after accept, ≥ 3 completed jobs), equal to max(0, 10,000 − what the shift’s jobs earned) — recounted here from the trips, offer answers and ledger rows',
    run: (s) => {
      const bad: string[] = [];
      const g = AZIZIYAH_MONEY_RULES.guarantee;
      const snap = s.guarantee ?? { covered: [], offers: [], windows: [] };
      const rows = s.ledger.filter((e) => e.type === 'driver_incentive' && (e.memo ?? '').startsWith('guarantee:'));
      if (!g.enabled) {
        // Switched off: every driver who answered an offer, in every settled shift of the day, got nothing.
        for (const e of rows) bad.push(`${e.id}: guarantee ${e.amount} paid to ${e.toAccount} for ${(e.memo ?? '').slice('guarantee:'.length)} while the guarantee is switched off`);
        for (const driverId of snap.covered) bad.push(`${driverId} is covered while the guarantee is switched off`);
        const drivers = new Set(snap.offers.map((o) => o.driverId));
        return { checked: rows.length + snap.covered.length + drivers.size * snap.windows.length, bad };
      }
      const paid = new Map<string, number>();
      const count = new Map<string, number>();
      for (const e of rows) {
        if (e.fromAccount !== 'platform' || !e.toAccount.startsWith('driver:')) bad.push(`${e.id}: guarantee ${e.fromAccount} → ${e.toAccount} (must be platform → driver)`);
        const key = `${e.toAccount.slice('driver:'.length)}|${(e.memo ?? '').slice('guarantee:'.length)}`;
        paid.set(key, (paid.get(key) ?? 0) + e.amount);
        count.set(key, (count.get(key) ?? 0) + 1);
      }
      for (const [key, n] of count) if (n > 1) bad.push(`${key.replace('|', ' ')} paid ${n} times`);
      const covered = new Set(snap.covered);
      const settled = new Set(snap.windows.map((w) => w.id));
      for (const key of paid.keys()) {
        const [driverId, windowId] = key.split('|') as [string, string];
        if (!covered.has(driverId)) bad.push(`${driverId} is not covered but was paid for ${windowId}`);
        else if (!settled.has(windowId)) bad.push(`${driverId} paid for ${windowId}, not a settled shift of the day`);
      }
      let checked = rows.length;
      for (const driverId of snap.covered) {
        for (const w of snap.windows) {
          checked += 1;
          const inW = (at: Date | null) => at !== null && at.getTime() >= w.from.getTime() && at.getTime() < w.to.getTime();
          const answers = snap.offers.filter((o) => o.driverId === driverId && inW(o.at));
          const jobs = new Set(s.trips.filter((t) => t.courierId === driverId && t.state === 'completed' && inW(t.completedAt)).map((t) => t.id));
          const cancels = s.trips.filter((t) => t.courierId === driverId && t.state === 'driver_cancelled' && inW(t.cancelledAt)).length;
          const acct = `driver:${driverId}`;
          let earningsIqd = 0;
          for (const e of s.ledger) {
            if (!e.tripId || !jobs.has(e.tripId) || e.kind !== 'money' || ['driver_payout', 'driver_settlement', 'debt_settled'].includes(e.type)) continue;
            if (e.type === 'driver_incentive' && (e.memo ?? '').startsWith('guarantee')) continue;
            const signed = (e.toAccount === acct ? e.amount : 0) - (e.fromAccount === acct ? e.amount : 0);
            if (signed > 0 || (e.type === 'commission_accrued' && signed < 0)) earningsIqd += signed;
          }
          const check = shiftGuarantee({ offers: answers.length, accepted: answers.filter((a) => a.accepted).length, cancelsAfterAccept: cancels, completedJobs: jobs.size, earningsIqd }, g);
          const got = paid.get(`${driverId}|${w.id}`) ?? 0;
          if (got !== check.topUpIqd) {
            bad.push(
              `${driverId} ${w.id}: paid ${got}, rule gives ${check.topUpIqd} (${answers.filter((a) => a.accepted).length}/${answers.length} accepted, ${cancels} cancels, ${jobs.size} jobs, earned ${earningsIqd})`,
            );
          }
        }
      }
      return { checked, bad };
    },
  },
  {
    name: 'no_unexpected_errors',
    description: 'no service threw anything but a domain refusal',
    run: (s) => ({ checked: s.errors.length, bad: s.errors.map((e) => `${e.where}: ${e.message}`) }),
  },
];

export function checkInvariants(s: SimSnapshot): InvariantResult[] {
  return INVARIANTS.map((d) => {
    const { checked, bad } = d.run(s);
    return { name: d.name, description: d.description, checked, violations: bad.length, examples: bad.slice(0, MAX_EXAMPLES) };
  });
}
