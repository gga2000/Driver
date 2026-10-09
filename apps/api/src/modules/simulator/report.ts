import { AZIZIYAH_MONEY_RULES, rideSearchStartsAt, type Order, type Trip } from '@driver/contracts';
import { checkInvariants, type InvariantResult, type SimSnapshot } from './invariants.js';

/**
 * The simulation report (plan Step 7): counts by terminal state, p50/p95 time-to-accept and
 * time-to-deliver, the revenue split, every invariant with its count, and the violations with their
 * first examples. `simulation-report.json` is this object; CI fails when `violations` is non-empty.
 */

export interface Percentiles {
  n: number;
  p50: number | null;
  p95: number | null;
}

export interface RunInfo {
  seed: number;
  orders: number;
  drivers: number;
  restaurants: number;
  customers: number;
  tickSec: number;
  speed: number;
  mode: 'in_process' | 'live';
  startedAt: Date;
  endedAt: Date;
  wallMs: number;
  supply: Record<string, number>;
  refusals: Record<string, number>;
  placeRefused: number;
}

export interface SimulationReport {
  version: 1;
  ok: boolean;
  run: RunInfo;
  orders: {
    planned: number;
    placed: number;
    placeRefused: number;
    delivered: number;
    deliveredShare: number;
    byState: Record<string, number>;
    byType: Record<string, Record<string, number>>;
  };
  trips: { total: number; byState: Record<string, number>; byVertical: Record<string, number> };
  timings: {
    /** Order placed → a driver accepted the job (seconds). */
    timeToAcceptSec: { food: Percentiles; ride: Percentiles; all: Percentiles };
    /** Order placed → delivered / ride completed (seconds). */
    timeToDeliverSec: { food: Percentiles; ride: Percentiles; all: Percentiles };
  };
  revenue: {
    /** What customers paid for closed orders. */
    gmvIqd: number;
    platformIqd: number;
    couriersIqd: number;
    merchantsIqd: number;
    roundingIqd: number;
    pointsIssued: number;
  };
  activity: {
    offersObserved: number;
    replays: { duplicate: number; fresh: number; late: number };
    quarantinedEvents: number;
    batchedPickups: number;
    maxHotWaitMin: number | null;
    merchantHandovers: number;
    merchantHandoverIqd: number;
    /** "الخردة علينا": drop-offs where the courier had no change and the rest went to the wallet. */
    noChangeCredits: number;
    noChangeCreditIqd: number;
    /** M-3: owed cancellation fees paid with a later order's cash (`debt_settled`, `CASH_DEBT_COLLECT`). */
    owedFeesSettled: number;
    owedFeesSettledIqd: number;
    /** G-91 shift-guarantee top-ups the Sunday settlement paid for the day's shifts (06:00–15:00 and 15:00–02:00). */
    guaranteeTopUps: number;
    guaranteeTopUpIqd: number;
  };
  invariants: InvariantResult[];
  violations: Array<{ invariant: string; count: number; examples: string[] }>;
}

const isGuaranteeTopUp = (e: { type: string; memo?: string | undefined }) => e.type === 'driver_incentive' && (e.memo ?? '').startsWith('guarantee:');
const isOwedFeeSettled = (e: { type: string; memo?: string | undefined }) => e.type === 'debt_settled' && e.memo === 'owed_fees';

export function percentiles(values: readonly number[]): Percentiles {
  if (values.length === 0) return { n: 0, p50: null, p95: null };
  const v = [...values].sort((a, b) => a - b);
  const at = (p: number) => v[Math.min(v.length - 1, Math.max(0, Math.ceil(p * v.length) - 1))]!;
  return { n: v.length, p50: Math.round(at(0.5)), p95: Math.round(at(0.95)) };
}

function count<T>(items: readonly T[], key: (t: T) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const t of items) out[key(t)] = (out[key(t)] ?? 0) + 1;
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
}

function acceptedAt(trips: readonly Trip[], orderId: string): number | null {
  let best: number | null = null;
  for (const t of trips) {
    if (!t.acceptedAt || !t.orders.some((o) => o.orderId === orderId)) continue;
    const at = t.acceptedAt.getTime();
    if (best === null || at < best) best = at;
  }
  return best;
}

const isRide = (o: Order) => o.type === 'ride';
/** When the wait starts: placement, or for a ride booked «بعدين» its search (the rider isn't waiting before). */
const waitStartsAt = (o: Order) => (isRide(o) && o.scheduledFor ? rideSearchStartsAt(o.scheduledFor).getTime() : o.placedAt.getTime());

export function buildReport(snapshot: SimSnapshot, run: RunInfo, plannedOrders: number): SimulationReport {
  const invariants = checkInvariants(snapshot);
  const violations = invariants.filter((i) => i.violations > 0).map((i) => ({ invariant: i.name, count: i.violations, examples: i.examples }));
  const orders = snapshot.orders;
  const delivered = orders.filter((o) => o.deliveredAt !== null && (o.state === 'closed' || o.state === 'delivered' || o.state === 'completed'));

  const accept = { food: [] as number[], ride: [] as number[] };
  const deliver = { food: [] as number[], ride: [] as number[] };
  for (const o of orders) {
    const k = isRide(o) ? 'ride' : 'food';
    const acc = acceptedAt(snapshot.trips, o.id);
    if (acc !== null) accept[k].push((acc - waitStartsAt(o)) / 1000);
    if (o.deliveredAt && delivered.includes(o)) deliver[k].push((o.deliveredAt.getTime() - waitStartsAt(o)) / 1000);
  }

  let platform = 0;
  let couriers = 0;
  let rounding = 0;
  let merchants = 0;
  let points = 0;
  for (const e of snapshot.ledger) {
    if (e.kind === 'points') {
      if (['points_earned', 'points_pending', 'organizer_bonus', 'referral_bonus'].includes(e.type)) points += e.amount;
      continue;
    }
    const net = (acct: (a: string) => boolean) => (acct(e.toAccount) ? e.amount : 0) - (acct(e.fromAccount) ? e.amount : 0);
    platform += net((a) => a === 'platform');
    couriers += net((a) => a.startsWith('driver:'));
    rounding += net((a) => a === 'rounding');
    if (e.type === 'merchant_payable' || e.type === 'cancellation_fee' || (e.type === 'commission_accrued' && e.fromAccount.startsWith('merchant_cash:'))) merchants += net((a) => a.startsWith('merchant_cash:'));
  }

  const closed = orders.filter((o) => o.state === 'closed');
  const hot = snapshot.hotWaits.map((h) => h.waitMin);
  return {
    version: 1,
    ok: violations.length === 0,
    run,
    orders: {
      planned: plannedOrders,
      placed: orders.length,
      placeRefused: run.placeRefused,
      delivered: delivered.length,
      deliveredShare: orders.length ? Math.round((delivered.length / orders.length) * 1000) / 1000 : 0,
      byState: count(orders, (o) => o.state),
      byType: {
        food: count(orders.filter((o) => !isRide(o)), (o) => o.state),
        ride: count(orders.filter(isRide), (o) => o.state),
      },
    },
    trips: { total: snapshot.trips.length, byState: count(snapshot.trips, (t) => t.state), byVertical: count(snapshot.trips, (t) => t.vertical) },
    timings: {
      timeToAcceptSec: { food: percentiles(accept.food), ride: percentiles(accept.ride), all: percentiles([...accept.food, ...accept.ride]) },
      timeToDeliverSec: { food: percentiles(deliver.food), ride: percentiles(deliver.ride), all: percentiles([...deliver.food, ...deliver.ride]) },
    },
    revenue: {
      gmvIqd: closed.reduce((s, o) => s + o.totalIqd, 0),
      platformIqd: platform,
      couriersIqd: couriers,
      merchantsIqd: merchants,
      roundingIqd: rounding,
      pointsIssued: points,
    },
    activity: {
      offersObserved: snapshot.offers.length,
      replays: {
        duplicate: snapshot.replays.filter((r) => r.kind === 'duplicate').length,
        fresh: snapshot.replays.filter((r) => r.kind === 'fresh').length,
        late: snapshot.replays.filter((r) => r.kind === 'fresh' && r.detached).length,
      },
      quarantinedEvents: snapshot.quarantined.length,
      batchedPickups: snapshot.hotWaits.length,
      maxHotWaitMin: hot.length ? Math.max(...hot) : null,
      merchantHandovers: snapshot.handovers.length,
      merchantHandoverIqd: snapshot.handovers.reduce((s, h) => s + h.amountIqd, 0),
      noChangeCredits: snapshot.ledger.filter((e) => e.type === 'cash_change_to_wallet').length,
      noChangeCreditIqd: snapshot.ledger.filter((e) => e.type === 'cash_change_to_wallet').reduce((s, e) => s + e.amount, 0),
      owedFeesSettled: snapshot.ledger.filter(isOwedFeeSettled).length,
      owedFeesSettledIqd: snapshot.ledger.filter(isOwedFeeSettled).reduce((s, e) => s + e.amount, 0),
      guaranteeTopUps: snapshot.ledger.filter(isGuaranteeTopUp).length,
      guaranteeTopUpIqd: snapshot.ledger.filter(isGuaranteeTopUp).reduce((s, e) => s + e.amount, 0),
    },
    invariants,
    violations,
  };
}

// ───────────────────────── the printed summary (Arabic + English) ─────────────────────────

const fmt = (n: number | null | undefined) => (n === null || n === undefined ? '—' : n.toLocaleString('en-US'));
const mins = (sec: number | null) => (sec === null ? '—' : `${(sec / 60).toFixed(1)} min`);

export function summaryTable(r: SimulationReport): string {
  const rows: Array<[string, string, string]> = [
    ['الطلبات المخططة', 'Orders planned', fmt(r.orders.planned)],
    ['الطلبات المُرسلة', 'Orders placed', `${fmt(r.orders.placed)} (+${fmt(r.orders.placeRefused)} refused at checkout)`],
    ['تم التوصيل', 'Delivered / completed', `${fmt(r.orders.delivered)} (${(r.orders.deliveredShare * 100).toFixed(1)}%)`],
    ...Object.entries(r.orders.byState).map(([state, n]): [string, string, string] => ['  حالة نهائية', `  ${state}`, fmt(n)]),
    ['الرحلات', 'Trips', `${fmt(r.trips.total)} (${Object.entries(r.trips.byVertical).map(([v, n]) => `${v} ${n}`).join(', ')})`],
    ['زمن القبول (أكل)', 'Time to accept, food p50/p95', `${mins(r.timings.timeToAcceptSec.food.p50)} / ${mins(r.timings.timeToAcceptSec.food.p95)}`],
    ['زمن القبول (مشاوير)', 'Time to accept, rides p50/p95', `${mins(r.timings.timeToAcceptSec.ride.p50)} / ${mins(r.timings.timeToAcceptSec.ride.p95)}`],
    ['زمن التوصيل (أكل)', 'Time to deliver, food p50/p95', `${mins(r.timings.timeToDeliverSec.food.p50)} / ${mins(r.timings.timeToDeliverSec.food.p95)}`],
    ['زمن المشوار', 'Time to complete, rides p50/p95', `${mins(r.timings.timeToDeliverSec.ride.p50)} / ${mins(r.timings.timeToDeliverSec.ride.p95)}`],
    ['قيمة الطلبات', 'GMV (closed orders, IQD)', fmt(r.revenue.gmvIqd)],
    ['حصة المنصة', 'Platform (IQD)', fmt(r.revenue.platformIqd)],
    ['حصة السواق', 'Couriers & drivers (IQD)', fmt(r.revenue.couriersIqd)],
    ['حصة المطاعم', 'Merchants (IQD)', fmt(r.revenue.merchantsIqd)],
    ['النقاط', 'Points issued', fmt(r.revenue.pointsIssued)],
    ['إعادة إرسال', 'Replays dup / fresh / late', `${r.activity.replays.duplicate} / ${r.activity.replays.fresh} / ${r.activity.replays.late}`],
    ['أحداث محجوزة', 'Quarantined late replays', fmt(r.activity.quarantinedEvents)],
    ['تسليم فلوس المطاعم', 'Merchant hand-overs', `${fmt(r.activity.merchantHandovers)} (${fmt(r.activity.merchantHandoverIqd)} IQD)`],
    ['باقي الكاش للمحفظة', 'No-change credits to wallets', `${fmt(r.activity.noChangeCredits)} (${fmt(r.activity.noChangeCreditIqd)} IQD)`],
    ['رسوم انسددت ويا طلب', 'Owed fees paid with an order', `${fmt(r.activity.owedFeesSettled)} (${fmt(r.activity.owedFeesSettledIqd)} IQD)${r.activity.owedFeesSettled === 0 ? ' · switched off or none owed' : ''}`],
    ['تكملة ضمان الشفت', 'Shift-guarantee top-ups', `${fmt(r.activity.guaranteeTopUps)} (${fmt(r.activity.guaranteeTopUpIqd)} IQD)${AZIZIYAH_MONEY_RULES.guarantee.enabled ? '' : ' · switched off'}`],
    ['الثوابت', 'Invariants passed', `${r.invariants.length - r.violations.length}/${r.invariants.length}`],
  ];
  const w1 = Math.max(...rows.map((x) => x[0].length));
  const w2 = Math.max(...rows.map((x) => x[1].length));
  const head = `Driver (درايفر) simulation · seed ${r.run.seed} · ${r.run.orders} orders · ${r.run.drivers} drivers · ${r.run.restaurants} restaurants · ${(r.run.wallMs / 1000).toFixed(1)} s`;
  const lines = rows.map(([ar, en, v]) => `${en.padEnd(w2)}  ${v.padEnd(28)}  ${ar.padStart(w1)}`);
  const verdict = r.ok ? 'OK — لا مخالفات / no violations' : `FAILED — ${r.violations.length} invariant(s) violated / مخالفات`;
  const viol = r.violations.flatMap((v) => [`violation: ${v.invariant} (${v.count})`, ...v.examples.map((e) => `  · ${e}`)]);
  return [head, '-'.repeat(head.length), ...lines, '-'.repeat(head.length), verdict, ...viol].join('\n');
}
