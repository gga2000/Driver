import { TERMINAL_ORDER_STATES, type LedgerEvent, type Order, type Trip } from '@driver/contracts';
import type { HandoverRecord, HotWaitRecord, ObservedOffer, ReplayRecord } from './context.js';

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
  merchants: Array<{ merchantId: string; balanceIqd: number }>;
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
  customerTotalStepIqd: 500,
  maxHotWaitMin: 10,
  pointsCapPerOrder: 50,
};

const MAX_EXAMPLES = 5;
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

/** G-88's exception: a 250 component on the receipt (fees, or a ride fare) allows a 250 step. */
export const has250Component = (o: Pick<Order, 'type' | 'totalIqd' | 'tipIqd' | 'deliveryFeeIqd' | 'serviceFeeIqd'>) =>
  (o.type === 'ride' ? [o.totalIqd - o.tipIqd] : [o.deliveryFeeIqd, o.serviceFeeIqd]).some((f) => f % 500 !== 0);

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
    name: 'customer_totals_multiple_of_500',
    description: 'customer totals (and cash collected) are multiples of 500 — 250 with a 250 component — and rounding never leaves a cash customer owing',
    run: (s) => {
      const bad: string[] = [];
      const rows = byOrder(s.ledger);
      for (const o of s.orders) {
        const step = has250Component(o) ? 250 : RULES.customerTotalStepIqd;
        if (o.totalIqd % step !== 0) bad.push(`${o.id} (${o.type}) total ${o.totalIqd}`);
        const r = rows.get(o.id) ?? [];
        const collected = sum(r, (e) => e.type === 'cash_collected' || e.type === 'cash_rounding_credit');
        if (collected % step !== 0) bad.push(`${o.id} (${o.type}) collected ${collected}`);
        if (o.state !== 'closed' || o.paymentMethod !== 'cash') continue;
        const groups = new Set(moneyGroupsOf(s.ledger, o.id));
        const payer = `customer:${o.ordererId}`;
        const net = r.filter((e) => e.postingGroupId && groups.has(e.postingGroupId)).reduce((n, e) => n + (e.toAccount === payer ? e.amount : 0) - (e.fromAccount === payer ? e.amount : 0), 0);
        if (net !== 0) bad.push(`${o.id} (${o.type}) customer left at ${net} after paying ${collected} for ${o.totalIqd}`);
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
