import type { LedgerEvent } from '@driver/contracts';
import { INVARIANTS, type SimSnapshot } from './invariants.js';

/**
 * Deliberate rule breaks, one per invariant: each mutates an end-of-run snapshot the way the bug it
 * guards against would. Tests use them to prove every check fires; `pnpm sim --inject-fault <name>`
 * shows the gate failing with that violation's name (plan Step 7 acceptance).
 */

let seq = 0;
const row = (over: Partial<LedgerEvent>): LedgerEvent => ({
  id: `fault_${(seq += 1)}`,
  kind: 'money',
  type: 'adjustment',
  amount: 100,
  currency: 'IQD',
  fromAccount: 'platform',
  toAccount: 'rounding',
  occurredAt: new Date(0),
  recordedAt: new Date(0),
  ...over,
});

function first<T>(items: readonly T[], what: string, pred: (t: T) => boolean = () => true): T {
  const found = items.find(pred);
  if (!found) throw new Error(`fault needs ${what} in the snapshot`);
  return found;
}

export const FAULTS: Readonly<Record<string, (s: SimSnapshot) => void>> = {
  ledger_money_balanced: (s) => void s.ledger.push(row({ fromAccount: 'points_pool', toAccount: 'platform' })),
  ledger_points_balanced: (s) => void s.ledger.push(row({ kind: 'points', type: 'points_earned', fromAccount: 'platform', toAccount: 'points:fault' })),
  orders_terminal: (s) => {
    first(s.orders, 'an order').state = 'picked_up';
  },
  trips_terminal: (s) => {
    first(s.trips, 'a trip').state = 'en_route_to_pickup';
  },
  stop_completed_after_arrived: (s) => {
    const trip = first(s.trips, 'a trip with a completed stop', (t) => t.stops.some((st) => st.state === 'completed'));
    first(trip.stops, 'a completed stop', (st) => st.state === 'completed').arrivedAt = null;
  },
  completed_trip_has_no_pending_stop: (s) => {
    const trip = first(s.trips, 'a completed trip', (t) => t.state === 'completed');
    trip.stops[trip.stops.length - 1]!.state = 'pending';
  },
  outbox_drained: (s) => {
    s.outbox.failed += 1;
  },
  idempotent_replays: (s) => void s.replays.push({ driverId: 'fault', key: 'fault.1', action: 'complete', tripId: 'trip_fault', orderId: 'ord_fault', kind: 'duplicate', detached: false, eventsAdded: 1, quarantinedAdded: 0, ledgerAdded: 3, outcome: 'accepted' }),
  quarantined_never_settled: (s) => {
    const settled = first(s.ledger, 'a ledger row with a trip and an order', (e) => Boolean(e.tripId && e.orderId));
    s.quarantined.push({ id: 'ev_fault', type: 'stop.completed', tripId: settled.tripId!, orderId: settled.orderId!, recordedAt: new Date(settled.occurredAt.getTime() - 1000) });
  },
  fee_within_fare: (s) => {
    const o = first(s.orders, 'an order');
    o.cancellationFeeIqd = o.totalIqd + 500;
  },
  customer_cash_rounds_to_250: (s) => {
    first(s.orders, 'a cash order', (o) => o.paymentMethod === 'cash').totalIqd += 100;
  },
  no_offer_to_over_cap_driver: (s) => void s.offers.push({ tripId: 'trip_fault', driverId: 'fault', at: 0, kind: 'dispatch.offer_sent', overCap: true, owedIqd: 80_000, capIqd: 75_000 }),
  batched_hot_wait_within_10_min: (s) => void s.hotWaits.push({ orderId: 'ord_fault', courierId: 'fault', readyAtMs: 0, departAtMs: 12.5 * 60_000, waitMin: 12.5, rawWaitMin: 12.5, kitchenLateMin: 0, courierOffline: false }),
  no_points_on_money_accounts: (s) => void s.ledger.push(row({ kind: 'points', type: 'points_earned', fromAccount: 'points_pool', toAccount: 'driver:fault' })),
  one_balanced_group_per_closed_order: (s) => {
    const o = first(s.orders, 'a closed order', (x) => x.state === 'closed' && x.type === 'food');
    const group = `order:${o.id}:money`;
    for (const e of s.ledger.filter((x) => x.postingGroupId === group)) s.ledger.push({ ...e, id: `${e.id}_dup`, postingGroupId: `${group}:dup` });
  },
  merchant_cash_reconciles: (s) => {
    first(s.merchants, 'a merchant').balanceIqd += 1000;
  },
  points_per_food_order_capped: (s) => {
    const o = first(s.orders, 'a food order', (x) => x.type === 'food');
    s.ledger.push(row({ kind: 'points', type: 'points_earned', amount: 60, fromAccount: 'points_pool', toAccount: 'points:fault', orderId: o.id, postingGroupId: `points:${o.id}:fault` }));
  },
  late_credit_once_per_delivery: (s) => {
    // The honest-delay credit posted twice for one delivery (a retried sweep without the per-order key).
    const o = first(s.orders, 'a food order', (x) => x.type === 'food');
    for (let i = 0; i < 2; i++) s.ledger.push(row({ type: 'credit_issued', amount: 1000, fromAccount: 'platform', toAccount: `customer:${o.ordererId}`, orderId: o.id, postingGroupId: `late_promise:${o.id}` }));
  },
  tip_after_rating_once_and_to_the_driver: (s) => {
    // The tip posted for a courier who never carried the order (a client-chosen driver id).
    const o = first(s.orders, 'a delivered food order', (x) => x.type === 'food' && x.deliveredAt !== null);
    s.ledger.push(row({ type: 'tip', amount: 1000, fromAccount: `customer:${o.ordererId}`, toAccount: 'driver:fault', orderId: o.id, memo: 'after_rating', postingGroupId: `tip:${o.id}`, occurredAt: o.deliveredAt! }));
  },
  shift_guarantee_once_and_exact: (s) => {
    // The same shift's top-up posted a second time (a Sunday re-run without the once-per-shift key).
    // Switched off (Aziziyah, Ali 2026-10-06) nobody is covered: any courier who answered an offer is paid.
    const driverId = s.guarantee?.covered[0] ?? first(s.guarantee?.offers ?? [], 'a driver who answered an offer').driverId;
    const w = first(s.guarantee?.windows ?? [], 'a settled shift');
    const paid = s.ledger.find((e) => e.type === 'driver_incentive' && e.memo === `guarantee:${w.id}`);
    const to = paid?.toAccount ?? `driver:${driverId}`;
    for (let i = 0; i < 2; i++) s.ledger.push(row({ type: 'driver_incentive', amount: 2500, fromAccount: 'platform', toAccount: to, memo: `guarantee:${w.id}`, postingGroupId: `incentive:guarantee:fault:${i}` }));
  },
  booked_ride_waits_for_its_search: (s) => {
    // A ride booked «بعدين» broadcast as soon as it was placed (the request's start time ignored).
    const o = first(s.orders, 'a ride booked for later', (x) => x.type === 'ride' && x.scheduledFor !== null);
    const trip = first(s.trips, 'its trip', (t) => t.orders.some((l) => l.orderId === o.id));
    s.offers.push({ tripId: trip.id, driverId: 'fault', at: o.placedAt.getTime(), kind: 'dispatch.offer_sent', overCap: false, owedIqd: 0, capIqd: 75_000 });
  },
  no_unexpected_errors: (s) => void s.errors.push({ where: 'fault', message: 'TypeError: boom' }),
};

export function injectFault(s: SimSnapshot, name: string): void {
  const f = FAULTS[name];
  if (!f) throw new Error(`unknown fault ${name}; one of: ${INVARIANTS.map((i) => i.name).join(', ')}`);
  f(s);
}
