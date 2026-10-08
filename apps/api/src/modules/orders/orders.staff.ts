import { Inject, Injectable } from '@nestjs/common';
import {
  DriverError,
  encodeDomainEvent,
  orderTicketNumber,
  type Actor,
  type CancellationFee,
  type FaultParty,
  type LedgerEvent,
  type OrderState,
  type ResolveDisputeInput,
  type StaffActionResult,
  type StaffCancelOrderInput,
  type StaffChargeCourierInput,
  type StaffCloseOrderInput,
  type StaffCourierLostInput,
  type StaffMarkDeliveredInput,
  type StuckOrder,
  type StuckOrdersInput,
  type StuckReason,
  type Trip,
} from '@driver/contracts';
import { CLOCK, type Clock } from '../../shared/clock.js';
import { UnitOfWork, type Tx } from '../../shared/db/unit-of-work.js';
import type { PostingGroup } from '../ledger/index.js';
import type { OrderDomainEvent } from './events.adapter.js';
import { MERCHANT_DIRECTORY, type MerchantDirectory } from './merchants.port.js';
import { MERCHANT_ORDER_TYPES } from './order.machine.js';
import { ORDERS_RULES } from './orders.config.js';
import { ORDERS_REPOSITORY, type OrderRecord, type OrdersRepository } from './orders.repository.js';
import { ORDERS_TRIPS, OrdersService, type OrdersTripsPort } from './orders.service.js';
import { ORDER_OUTCOME_RULES, type DisputeOutcome, type OrderOutcomeRules } from './outcomes.config.js';
import type { OrdersStaffBridge, PlatformFailurePort } from './staff-bridge.js';

const SYSTEM = 'system';
const MIN = 60_000;
const HOUR = 60 * MIN;

/** The ledger as the staff toolkit uses it: its own posting groups (idempotent by id) and reads. */
export interface StaffLedgerPort {
  recordAll(group: PostingGroup, tx?: Tx): Promise<unknown>;
  hasGroup(groupId: string): Promise<boolean>;
  eventsForOrder(orderId: string): Promise<LedgerEvent[]>;
}

/** The Console audit log (`console_audit_log`, controls module). */
export interface StaffAuditPort {
  record(input: { cityId: string | null; actorId: string; action: string; subjectKind: string; subjectId: string; summaryAr: string; detail?: Record<string, unknown> }, tx?: Tx): Promise<{ id: string }>;
}

/** The order's own event log (events module), oldest first: when a dispute opened, what was already sent. */
export interface OrderEventLog {
  /** The order's events, oldest first (`actorId` where the log has it). */
  eventsOf(orderId: string): Promise<Array<{ type: string; occurredAt: Date; payload: Record<string, unknown>; actorId?: string }>>;
}

/**
 * Where `order.stuck` / `order.unstuck` live: one aggregate of their own (`STUCK_BOARD`), not the
 * order's, because they change no order state; each still carries its `orderId`. The watchdog reads
 * the board to know which orders are on the list now, including ones that since left the live states.
 */
export interface StuckBoardPort {
  /** Every mark on the board, oldest first. */
  marks(): Promise<Array<{ type: string; orderId: string; occurredAt: Date; payload: Record<string, unknown> }>>;
  emit(tx: Tx | undefined, event: OrderDomainEvent): Promise<void>;
}

export const STUCK_BOARD = { name: 'stuck_board', id: 'orders' } as const;

export interface OrdersStaffPorts {
  ledger: StaffLedgerPort;
  audit: StaffAuditPort;
  roles: { hasRole(personId: string, kind: 'admin'): Promise<boolean> };
  eventLog: OrderEventLog;
  /** Without it the watchdog emits no stuck/unstuck events. */
  stuckBoard?: StuckBoardPort;
}

export const ORDERS_STAFF_PORTS = Symbol('ORDERS_STAFF_PORTS');

/** Food waiting for its kitchen's answer longer than this is stuck (the 90-s offer plus retries). */
const MERCHANT_ANSWER_STUCK_MIN = 5;
/** A ride or errand with nobody taking it this long is stuck. */
const UNMATCHED_STUCK_MIN = 15;
/** Food on the way this long after pickup is presumed lost (NTF-13 watchdog). */
const PICKED_UP_STUCK_MIN = 60;
/** A delivered order the 2-h auto-close missed by this much. */
const NOT_CLOSED_GRACE_MIN = 10;
/** A complaint nobody answered for this long is overdue (the Console's red queue). */
const DISPUTE_OVERDUE_H = 24;

/** States an order can be stuck in (the stuck list reads only these). */
const STUCK_WATCH_STATES: readonly OrderState[] = ['placed', 'merchant_accepted', 'preparing', 'ready', 'picked_up', 'delivered', 'matched', 'completed', 'disputed'];
const CANCELLABLE: readonly OrderState[] = ['placed', 'merchant_accepted', 'preparing', 'ready', 'matched'];
const COOKED: readonly OrderState[] = ['preparing', 'ready'];

type Funder = { kind: 'platform' } | { kind: 'courier'; driverId: string } | { kind: 'merchant'; merchantId: string };

/** M-2: the fee a customer sees when the delay is ours (free, no one paid by him). */
export const PLATFORM_FAILURE_FEE: CancellationFee = {
  allowed: true,
  free: true,
  amountIqd: 0,
  payer: 'none',
  splits: [],
  scoringHit: false,
  label_ar: 'إلغاء ببلاش: التأخير من صوبنا',
  label_en: 'Free cancel: the delay is on us',
  reason_ar: 'الطلب تأخر من صوبنا، فالإلغاء ببلاش',
};

function payerAccount(o: Pick<OrderRecord, 'ordererId' | 'householdOrgId'>): string {
  return o.householdOrgId ? `household:${o.householdOrgId}` : `customer:${o.ordererId}`;
}

function fundingAccount(f: Funder): string {
  return f.kind === 'courier' ? `driver:${f.driverId}` : f.kind === 'merchant' ? `merchant_cash:${f.merchantId}` : 'platform';
}

const iqd = (n: number) => n.toLocaleString('en-US');

/**
 * W3 staff way-out and money outcomes (plan §W3; docs/api/staff-ops.md). Staff end any stuck order
 * with a reason that lands in the Console audit log; every money outcome Ali has not decided yet
 * (M-1 disputes, M-2 platform failure, M-10 courier lost) is behind its switch in
 * `OrderOutcomeRules`, off by default, and refused with `money_rule_off` while off. Corrections are
 * new posting groups (stable ids, so a replay posts nothing), never edits.
 *
 * State moves go through `OrdersService.staffBridge()`: the same machine check, conditional update,
 * events and close (money and points) as every other move.
 */
@Injectable()
export class OrdersStaffService implements PlatformFailurePort {
  constructor(
    private readonly orders: OrdersService,
    @Inject(ORDERS_REPOSITORY) private readonly repo: OrdersRepository,
    private readonly uow: UnitOfWork,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(ORDERS_TRIPS) private readonly trips: OrdersTripsPort,
    @Inject(MERCHANT_DIRECTORY) private readonly merchants: MerchantDirectory,
    @Inject(ORDER_OUTCOME_RULES) readonly rules: OrderOutcomeRules,
    @Inject(ORDERS_STAFF_PORTS) private readonly ports: OrdersStaffPorts,
  ) {}

  private get bridge(): OrdersStaffBridge {
    return this.orders.staffBridge();
  }

  // ───────────────────────── staff actions ─────────────────────────

  /**
   * NTF-10: cancel a live order before pickup. Default: the platform cancels (`platform_cancelled`),
   * free for the customer; a wallet order was never charged (the ledger charges at close), so its
   * hold is released by the order ending. `onBehalfOfCustomer`: his own cancel, with his normal fee.
   * Kitchen pay for cooked food only with the M-2 switch on and the platform as payer.
   */
  async cancel(actor: Actor, input: StaffCancelOrderInput): Promise<StaffActionResult> {
    const before = await this.load(input.orderId);
    if (before.state === 'customer_cancelled' || before.state === 'platform_cancelled') return this.result(before, false, 0, null);
    if (!CANCELLABLE.includes(before.state)) throw new DriverError(before.state === 'picked_up' ? 'order_cancel_after_pickup' : 'order_state_conflict');
    if (input.onBehalfOfCustomer) {
      // His own cancel (fee, trip, household hand-off): exactly what his tap would have done.
      await this.orders.cancel(before.ordererId, { orderId: before.id, reason: 'staff_on_behalf' });
      return this.uow.run(async (tx) => {
        const after = await this.load(before.id, tx);
        const audit = await this.audit(tx, actor, after, 'order.ops_cancel', `ألغى الطلب بطلب الزبون: ${input.reason}`, { onBehalfOfCustomer: true, feeIqd: after.cancellationFeeIqd });
        return this.result(after, true, 0, audit);
      });
    }
    return this.uow.run(async (tx) => {
      const order = await this.load(input.orderId, tx);
      if (!CANCELLABLE.includes(order.state)) throw new DriverError('order_state_conflict');
      const { trip } = await this.bridge.feeFor(order);
      const now = this.clock.now();
      const next = await this.bridge.move(
        order,
        'platform_cancelled',
        actor.personId,
        tx,
        { cancelledAt: now, cancellationReason: 'staff_cancelled', cancellationFeeIqd: 0 },
        this.bridge.cancelled(order, { by: 'platform', reason: 'staff_cancelled', free: true, feeIqd: 0, tripId: trip?.id }),
      );
      if (trip) {
        if (order.type === 'ride') await this.trips.cancel(trip.id, 'platform', actor.personId, 'staff_cancelled');
        else await this.trips.detachOrder(trip.id, order.id, actor.personId, 'order_cancelled');
      }
      const posted = COOKED.includes(order.state) ? await this.payKitchenForFailure(order, tx, 'staff_cancelled') : 0;
      await this.bridge.emit(tx, 'order.ops_cancelled', actor.personId, next, { customerId: order.ordererId, from: order.state, kitchenPaidIqd: posted });
      const audit = await this.audit(tx, actor, next, 'order.ops_cancel', `ألغى الطلب (ببلاش على الزبون): ${input.reason}`, { from: order.state, kitchenPaidIqd: posted, reason: input.reason });
      return this.result(next, true, posted, audit);
    });
  }

  /**
   * NTF-10: the courier handed the food over but his app never recorded it. Picked up → delivered as
   * the courier's drop-off would have (a cash order's cash counts as collected by him), then the
   * normal 2-h close. A late drop-off from his app afterwards is a no-op.
   */
  async markDelivered(actor: Actor, input: StaffMarkDeliveredInput): Promise<StaffActionResult> {
    return this.uow.run(async (tx) => {
      const order = await this.load(input.orderId, tx);
      if (order.state === 'delivered') return this.result(order, false, 0, null);
      if (order.state !== 'picked_up') throw new DriverError('order_state_conflict');
      const courier = await this.trips.courierOf(order.id);
      if (!courier) throw new DriverError('order_state_conflict');
      const cash = order.paymentMethod === 'cash' ? (input.cashCollectedIqd ?? order.totalIqd) : undefined;
      await this.bridge.delivered(order, { type: 'stop.completed', tripId: courier.tripId, actorId: courier.courierId, occurredAt: this.clock.now(), orderId: order.id, payload: { vertical: courier.vertical, staffId: actor.personId, ...(cash !== undefined ? { cashCollectedIqd: cash } : {}) } }, tx);
      const next = await this.load(order.id, tx);
      const audit = await this.audit(tx, actor, next, 'order.ops_mark_delivered', `سجّل الطلب واصل: ${input.reason}`, { courierId: courier.courierId, cashCollectedIqd: cash ?? null, reason: input.reason });
      return this.result(next, true, 0, audit);
    });
  }

  /** NTF-10: close a delivered order (or completed ride) now; money settles as on the auto-close. Disputes go through `resolveDispute`. */
  async close(actor: Actor, input: StaffCloseOrderInput): Promise<StaffActionResult> {
    return this.uow.run(async (tx) => {
      const order = await this.load(input.orderId, tx);
      if (order.state === 'closed') return this.result(order, false, 0, null);
      if (order.state !== 'delivered' && order.state !== 'completed') throw new DriverError('order_state_conflict');
      await this.bridge.close(order, actor.personId, 'staff_closed', tx);
      const next = await this.load(order.id, tx);
      const audit = await this.audit(tx, actor, next, 'order.ops_close', `سكّر الطلب: ${input.reason}`, { reason: input.reason });
      return this.result(next, true, 0, audit);
    });
  }

  /**
   * NTF-13: the courier disappeared with the food. The order leaves «on the way» for a dispute
   * (`courier_lost`, default «the courier pays the food») and is never re-dispatched to the kitchen.
   * With `COURIER_LOST_REFUND` (M-10) it ends at once: nothing charged to the customer (`refunded`),
   * the kitchen paid its food by the platform, and the customer told.
   */
  async courierLost(actor: Actor, input: StaffCourierLostInput): Promise<StaffActionResult> {
    return this.uow.run(async (tx) => {
      const order = await this.load(input.orderId, tx);
      if ((order.state === 'disputed' || order.state === 'refunded') && (await this.courierLostEvent(order.id))) return this.result(order, false, 0, null);
      if (order.state !== 'picked_up') throw new DriverError('order_state_conflict');
      const courier = await this.trips.courierOf(order.id);
      let next = await this.bridge.move(order, 'disputed', actor.personId, tx, {}, { kind: 'courier_lost', openedBy: 'staff', defaultOutcome: 'courier_pays_food_cost', tripId: courier?.tripId ?? null, courierId: courier?.courierId ?? null, note: input.reason });
      let posted = 0;
      if (this.rules.courierLost.refund) {
        next = await this.bridge.move(next, 'refunded', actor.personId, tx, { refundState: 'credited' }, { outcome: 'courier_lost', refundIqd: 0 });
        posted = await this.payKitchen(order, tx, `order:${order.id}:courier_lost:kitchen`, 'courier_lost:food');
        await this.bridge.emit(tx, 'order.courier_lost', actor.personId, next, { customerId: order.ordererId, courierId: courier?.courierId ?? null, kitchenPaidIqd: posted });
      }
      const audit = await this.audit(tx, actor, next, 'order.ops_courier_lost', `الدليفري اختفى بالطلب: ${input.reason}`, { courierId: courier?.courierId ?? null, refunded: this.rules.courierLost.refund, kitchenPaidIqd: posted });
      return this.result(next, true, posted, audit);
    });
  }

  /** M-10 second step (after ops confirms): the lost food's cost on the courier's cash account (`COURIER_LOST_CHARGE`). */
  async chargeCourier(actor: Actor, input: StaffChargeCourierInput): Promise<StaffActionResult> {
    if (!this.rules.courierLost.chargeCourier) throw new DriverError('money_rule_off');
    const lost = await this.courierLostEvent(input.orderId);
    const order = await this.load(input.orderId);
    const courierId = typeof lost?.payload['courierId'] === 'string' ? (lost.payload['courierId'] as string) : null;
    if (!lost || !courierId) throw new DriverError('order_state_conflict');
    const groupId = `order:${order.id}:courier_lost:charge`;
    if (await this.ports.ledger.hasGroup(groupId)) return this.result(order, false, 0, null);
    const amount = order.itemsTotalIqd;
    return this.uow.run(async (tx) => {
      await this.ports.ledger.recordAll(
        { id: groupId, kind: 'money', occurredAt: this.clock.now(), refs: { orderId: order.id }, lines: [{ type: 'adjustment', amount, fromAccount: `cash:${courierId}`, toAccount: 'platform', memo: 'courier_lost:food_cost' }], controls: [{ account: `cash:${courierId}`, net: -amount }] },
        tx,
      );
      const audit = await this.audit(tx, actor, order, 'order.ops_charge_courier', `حمّل الدليفري كلفة الأكل ${iqd(amount)} دينار: ${input.reason}`, { courierId, amountIqd: amount, ledgerGroupId: groupId });
      return this.result(order, true, amount, audit);
    });
  }

  // ───────────────────────── disputes (M-1, NTF-01) ─────────────────────────

  /**
   * Ends a complaint. Outcomes on an order that reached the customer: `stands` (closed: money
   * settles, merchant and courier paid), `refund_full` / `refund_partial` (closed the same way, then
   * a `refund` line from the party at fault — the courier's earnings, the merchant's cash account,
   * or the platform — back to the payer's wallet; full ends in `refunded`), `redelivery` (closed;
   * support arranges the resend). On one that never reached him (unreachable at the door, courier
   * cancelled after pickup, courier lost): `void` — `refunded`, nothing charged, nobody paid.
   * Each outcome needs its switch (`DISPUTE_OUTCOMES`); a refund above the agent limit needs admin.
   */
  async resolveDispute(actor: Actor, input: ResolveDisputeInput): Promise<StaffActionResult> {
    if (!this.rules.disputes.outcomes.includes(input.outcome)) throw new DriverError('money_rule_off');
    const order = await this.load(input.orderId);
    if (order.state !== 'disputed') {
      if ((order.state === 'closed' || order.state === 'refunded') && (await this.resolvedEvent(order.id))) return this.result(order, false, 0, null);
      throw new DriverError('order_state_conflict');
    }
    const amount = input.outcome === 'refund_full' ? await this.refundable(order) : input.outcome === 'refund_partial' ? (input.amountIqd ?? 0) : 0;
    if (amount > (await this.refundable(order))) throw new DriverError('refund_exceeds_order');
    if (amount > this.rules.disputes.agentLimitIqd && !(await this.ports.roles.hasRole(actor.personId, 'admin'))) throw new DriverError('refund_needs_escalation');
    const funder = amount > 0 ? await this.funderFor(input.faultParty, order) : null;
    return this.uow.run((tx) => this.applyOutcome(order.id, input.outcome, amount, funder, actor.personId, input.reason, tx, false));
  }

  private async applyOutcome(orderId: string, outcome: DisputeOutcome, amount: number, funder: Funder | null, actorId: string, reason: string, tx: Tx, auto: boolean): Promise<StaffActionResult> {
    const order = await this.load(orderId, tx);
    if (order.state !== 'disputed') throw new DriverError('order_state_conflict');
    const reached = order.deliveredAt !== null;
    if (outcome === 'void' ? reached : !reached) throw new DriverError('order_state_conflict');
    if (outcome === 'void') {
      await this.bridge.move(order, 'refunded', actorId, tx, { refundState: 'none' }, { outcome, refundIqd: 0 });
    } else {
      await this.bridge.close(order, actorId, `dispute_${outcome}`, tx);
      if (amount > 0 && funder) {
        const from = fundingAccount(funder);
        const to = payerAccount(order);
        await this.ports.ledger.recordAll(
          { id: `dispute:${order.id}:refund`, kind: 'money', occurredAt: this.clock.now(), refs: { orderId: order.id }, lines: [{ type: 'refund', amount, fromAccount: from, toAccount: to, memo: `dispute:${order.id}:${funder.kind}` }], controls: [{ account: to, net: amount }] },
          tx,
        );
        const closed = await this.load(order.id, tx);
        if (outcome === 'refund_full') await this.bridge.move(closed, 'refunded', actorId, tx, { refundState: 'credited' }, { outcome, refundIqd: amount });
        else await this.repo.update(order.id, { refundState: 'credited' }, tx);
      }
    }
    const next = await this.load(order.id, tx);
    await this.bridge.emit(tx, 'order.dispute_resolved', actorId, next, { customerId: order.ordererId, outcome, refundIqd: amount, funder: funder?.kind ?? null, auto, ...(outcome === 'redelivery' ? { redelivery: true } : {}) });
    const summary = { stands: 'الطلب يبقى مثل ما هو', refund_full: `رجّع ${iqd(amount)} دينار كامل`, refund_partial: `رجّع ${iqd(amount)} دينار`, redelivery: 'نرجع نوصل الطلب', void: 'الطلب ما صار، ما يندفع عليه شي' }[outcome];
    const audit = await this.ports.audit.record({ cityId: order.cityId, actorId, action: 'order.ops_resolve_dispute', subjectKind: 'order', subjectId: order.id, summaryAr: `${auto ? 'تلقائياً: ' : ''}${summary} — ${reason}`, detail: { outcome, refundIqd: amount, funder: funder?.kind ?? null, auto, reason } }, tx);
    return this.result(next, true, amount, audit.id);
  }

  /** What may still go back on this order: what it cost less refunds already posted for it (support's and disputes'). */
  private async refundable(order: OrderRecord): Promise<number> {
    const back = (await this.ports.ledger.eventsForOrder(order.id)).filter((e) => (e.type === 'refund' || e.type === 'credit_issued') && (e.memo?.startsWith('dispute:') || e.memo?.startsWith('support:'))).reduce((a, e) => a + e.amount, 0);
    return Math.max(0, order.totalIqd - back);
  }

  private async funderFor(fault: FaultParty, order: OrderRecord): Promise<Funder> {
    if (fault === 'courier') {
      const c = await this.trips.courierOf(order.id);
      if (c) return { kind: 'courier', driverId: c.courierId };
    }
    if (fault === 'merchant' && order.merchantOrgId) return { kind: 'merchant', merchantId: order.merchantOrgId };
    return { kind: 'platform' };
  }

  // ───────────────────────── platform failure (M-2, NTF-11) ─────────────────────────

  /** Which failure of ours this order is in now, if any: no courier for ready food, kitchen silent, driver never came. */
  async failureOf(order: OrderRecord, trip: Trip | null, now = this.clock.now()): Promise<StuckReason | null> {
    const r = this.rules.platformFailure;
    const t = now.getTime();
    if (MERCHANT_ORDER_TYPES.includes(order.type)) {
      if (order.state === 'ready' && order.readyAt && t - order.readyAt.getTime() >= r.noCourierAfterMin * MIN && !trip?.courierId) return 'no_courier';
      if ((order.state === 'merchant_accepted' || order.state === 'preparing') && order.promisedReadyAt && t - order.promisedReadyAt.getTime() >= r.kitchenSilentAfterMin * MIN) {
        const profile = order.merchantOrgId ? await this.merchants.profile(order.merchantOrgId) : null;
        const hb = profile?.lastHeartbeatAt?.getTime() ?? null;
        if (hb === null || t - hb > ORDERS_RULES.heartbeatStaleMs) return 'kitchen_silent';
      }
      return null;
    }
    if (order.type === 'ride' && order.state === 'matched' && trip?.acceptedAt) {
      const arrived = trip.stops.some((s) => s.type === 'pickup' && s.arrivedAt);
      if (!arrived && t - trip.acceptedAt.getTime() >= r.driverNoShowAfterMin * MIN) return 'ride_driver_no_show';
    }
    return null;
  }

  /** `PlatformFailurePort`: the free fee instead of the normal one, only with `PLATFORM_FAILURE_FREE_CANCEL` on. */
  async freeFeeFor(order: OrderRecord, trip: Trip | null, fee: CancellationFee): Promise<CancellationFee | null> {
    if (!this.rules.platformFailure.freeCancel || !fee.allowed || fee.free) return null;
    return (await this.failureOf(order, trip)) ? PLATFORM_FAILURE_FEE : null;
  }

  /**
   * The customer cancelled free because of a platform failure (`order.cancelled`, his own cancel, free,
   * from preparing/ready — the normal rule charges the food there): the kitchen is paid the food it
   * cooked by the platform when M-2's payer is the platform. Idempotent per order.
   */
  async onOrderCancelled(payload: Record<string, unknown>): Promise<void> {
    if (payload['by'] !== 'customer' || payload['free'] !== true || !COOKED.includes(payload['from'] as OrderState)) return;
    const orderId = typeof payload['orderId'] === 'string' ? payload['orderId'] : null;
    if (!orderId) return;
    const agg = await this.repo.find(orderId);
    if (!agg || !MERCHANT_ORDER_TYPES.includes(agg.order.type)) return;
    await this.uow.run((tx) => this.payKitchenForFailure(agg.order, tx, 'customer_free_cancel'));
  }

  private async payKitchenForFailure(order: OrderRecord, tx: Tx, why: string): Promise<number> {
    const r = this.rules.platformFailure;
    if (!r.freeCancel || r.cookedFoodPayer !== 'platform') return 0;
    return this.payKitchen(order, tx, `order:${order.id}:platform_failure`, `platform_failure:${why}`);
  }

  /** The platform pays the kitchen the food it cooked (items at menu price), as one idempotent group. */
  private async payKitchen(order: OrderRecord, tx: Tx, groupId: string, memo: string): Promise<number> {
    if (!order.merchantOrgId || order.itemsTotalIqd <= 0) return 0;
    if (await this.ports.ledger.hasGroup(groupId)) return 0;
    const to = `merchant_cash:${order.merchantOrgId}`;
    await this.ports.ledger.recordAll({ id: groupId, kind: 'money', occurredAt: this.clock.now(), refs: { orderId: order.id }, lines: [{ type: 'credit_issued', amount: order.itemsTotalIqd, fromAccount: 'platform', toAccount: to, memo }], controls: [{ account: to, net: order.itemsTotalIqd }] }, tx);
    return order.itemsTotalIqd;
  }

  // ───────────────────────── the stuck list and the watchdog ─────────────────────────

  /** NTF-10: every live order past its state's deadline, oldest first, with the actions that apply. */
  async stuck(input: StuckOrdersInput): Promise<StuckOrder[]> {
    const now = this.clock.now();
    const live = await this.repo.findMany({ cityId: input.cityId, states: STUCK_WATCH_STATES });
    const out: StuckOrder[] = [];
    for (const o of live) {
      const s = await this.stuckOf(o, now);
      if (s) out.push(s);
    }
    return out.sort((a, b) => a.since.getTime() - b.since.getTime()).slice(0, input.limit);
  }

  private async stuckOf(o: OrderRecord, now: Date): Promise<StuckOrder | null> {
    const t = now.getTime();
    const over = (since: Date | null, min: number) => since !== null && t - since.getTime() >= min * MIN;
    let reason: StuckReason | null = null;
    let since: Date | null = null;
    let failure = false;
    const merchant = MERCHANT_ORDER_TYPES.includes(o.type);
    switch (o.state) {
      case 'placed': {
        if (o.scheduledFor && o.scheduledFor.getTime() > t) return null;
        since = o.merchantOfferedAt ?? o.placedAt;
        if (o.heldForPayer) return null;
        if (merchant ? over(since, MERCHANT_ANSWER_STUCK_MIN) : over(since, UNMATCHED_STUCK_MIN)) reason = merchant ? 'merchant_no_answer' : o.type === 'ride' ? 'ride_no_driver' : 'no_courier';
        break;
      }
      case 'merchant_accepted':
      case 'preparing':
      case 'ready':
      case 'matched': {
        const trip = o.state === 'ready' || o.state === 'matched' ? await this.trips.activeForOrder(o.id) : null;
        const f = await this.failureOf(o, trip, now);
        if (f) {
          reason = f;
          failure = true;
          since = o.state === 'ready' ? o.readyAt : o.state === 'matched' ? (trip?.acceptedAt ?? null) : o.promisedReadyAt;
        }
        break;
      }
      case 'picked_up':
        since = o.pickedUpAt;
        if (over(since, PICKED_UP_STUCK_MIN)) reason = 'courier_lost';
        break;
      case 'delivered':
      case 'completed':
        since = o.deliveredAt;
        if (over(since, ORDERS_RULES.autoCloseMs / MIN + NOT_CLOSED_GRACE_MIN)) reason = o.state === 'completed' ? 'ride_not_closed' : 'not_closed';
        break;
      case 'disputed':
        since = (await this.disputedAt(o.id)) ?? o.deliveredAt ?? o.pickedUpAt ?? o.placedAt;
        reason = t - since.getTime() >= DISPUTE_OVERDUE_H * HOUR ? 'dispute_overdue' : 'dispute_open';
        break;
      default:
        return null;
    }
    if (!reason || !since) return null;
    return {
      orderId: o.id,
      ticket: orderTicketNumber(o.id),
      type: o.type,
      state: o.state,
      reason,
      since,
      minutes: Math.max(0, Math.floor((t - since.getTime()) / MIN)),
      platformFailure: failure,
      totalIqd: o.totalIqd,
      paymentMethod: o.paymentMethod,
      actions: actionsFor(o.state),
    };
  }

  /**
   * DB-driven watchdog, run every few minutes (`OrdersStaffJob`): with M-2 on, tells each customer we
   * failed that he may cancel free (once per order); with M-1's deadline switch on, escalates a
   * complaint after 48 h (once) and lets one that reached the customer stand after 72 h. Returns how
   * many things it did.
   */
  async sweep(cityId?: string): Promise<number> {
    const now = this.clock.now();
    let done = 0;
    if (this.rules.platformFailure.freeCancel) {
      const live = await this.repo.findMany({ ...(cityId ? { cityId } : {}), states: ['merchant_accepted', 'preparing', 'ready', 'matched'] });
      for (const o of live) {
        const trip = o.state === 'ready' || o.state === 'matched' ? await this.trips.activeForOrder(o.id) : null;
        const f = await this.failureOf(o, trip, now);
        if (!f || (await this.hasEvent(o.id, 'order.free_cancel_offered'))) continue;
        await this.uow.run((tx) => this.bridge.emit(tx, 'order.free_cancel_offered', SYSTEM, o, { customerId: o.ordererId, failure: f }));
        done++;
      }
    }
    const auto = this.rules.disputes.auto;
    if (auto.enabled) {
      for (const o of await this.repo.findMany({ ...(cityId ? { cityId } : {}), states: ['disputed'] })) {
        const at = (await this.disputedAt(o.id)) ?? o.deliveredAt ?? o.placedAt;
        const age = now.getTime() - at.getTime();
        if (age >= auto.standsAfterH * HOUR && o.deliveredAt) {
          await this.uow.run((tx) => this.applyOutcome(o.id, 'stands', 0, null, SYSTEM, `ما انحسمت خلال ${auto.standsAfterH} ساعة`, tx, true));
          done++;
        } else if (age >= auto.escalateAfterH * HOUR && !(await this.hasEvent(o.id, 'order.dispute_escalated'))) {
          await this.uow.run(async (tx) => {
            await this.bridge.emit(tx, 'order.dispute_escalated', SYSTEM, o, { to: 'admin', afterH: auto.escalateAfterH, disputedAt: at.toISOString() });
            await this.ports.audit.record({ cityId: o.cityId, actorId: SYSTEM, action: 'order.dispute_escalated', subjectKind: 'order', subjectId: o.id, summaryAr: `شكوى ما انحسمت خلال ${auto.escalateAfterH} ساعة، صعدت للإدارة`, detail: { disputedAt: at.toISOString() } }, tx);
          });
          done++;
        }
      }
    }
    return done;
  }

  /**
   * The Console's "Today" list: `order.stuck` when an order enters the stuck list (`stuck()`), and
   * `order.unstuck` when it leaves it, whatever moved it (a staff action, the customer, a timer).
   * Stuck is computed on read, so this watchdog (`OrdersStaffJob`, every 5 minutes) is the detection
   * point: it compares the list now with the board's open marks. Each mark is once per stuck episode
   * (idempotency key on the order and the episode's `since`), so a second pod or a restart repeats
   * nothing. Runs whatever the money switches say: it only records, never moves an order.
   */
  async watchStuck(cityId?: string): Promise<number> {
    const board = this.ports.stuckBoard;
    if (!board) return 0;
    const now = this.clock.now();
    const open = new Map<string, { cityId: string; since: string; at: Date }>();
    for (const m of await board.marks()) {
      if (m.type === 'order.unstuck') open.delete(m.orderId);
      else if (m.type === 'order.stuck') open.set(m.orderId, { cityId: String(m.payload['cityId']), since: String(m.payload['since']), at: m.occurredAt });
    }
    const live = await this.repo.findMany({ ...(cityId ? { cityId } : {}), states: STUCK_WATCH_STATES });
    const stuckNow = new Set<string>();
    let done = 0;
    for (const o of live) {
      const s = await this.stuckOf(o, now);
      if (!s) continue;
      stuckNow.add(o.id);
      if (open.has(o.id)) continue;
      const since = s.since.toISOString();
      await this.uow.run((tx) =>
        board.emit(tx, { type: 'order.stuck', actorId: SYSTEM, occurredAt: now, orderId: o.id, idempotencyKey: `order.stuck:${o.id}:${since}`, payload: encodeDomainEvent('order.stuck', { orderId: o.id, cityId: o.cityId, reason: s.reason, since: s.since }) }),
      );
      done++;
    }
    for (const [orderId, mark] of open) {
      if (stuckNow.has(orderId) || (cityId && mark.cityId !== cityId)) continue;
      const by = await this.leftStuckBy(orderId, mark.at);
      await this.uow.run((tx) =>
        board.emit(tx, { type: 'order.unstuck', actorId: by, occurredAt: now, orderId, idempotencyKey: `order.unstuck:${orderId}:${mark.since}`, payload: encodeDomainEvent('order.unstuck', { orderId, cityId: mark.cityId, by }) }),
      );
      done++;
    }
    return done;
  }

  /** Who moved the order off the list: the actor of its latest own event after it went on it (`system` when none). */
  private async leftStuckBy(orderId: string, stuckAt: Date): Promise<string> {
    const after = (await this.ports.eventLog.eventsOf(orderId)).filter((e) => e.occurredAt.getTime() >= stuckAt.getTime() && e.type !== 'order.stuck' && e.type !== 'order.unstuck' && e.actorId);
    return after.length > 0 ? after[after.length - 1]!.actorId! : SYSTEM;
  }

  // ───────────────────────── helpers ─────────────────────────

  private async load(orderId: string, tx?: Tx): Promise<OrderRecord> {
    const agg = await this.repo.find(orderId, tx);
    if (!agg) throw new DriverError('order_not_found');
    return agg.order;
  }

  private async disputedAt(orderId: string): Promise<Date | null> {
    const opened = (await this.ports.eventLog.eventsOf(orderId)).filter((e) => e.type === 'order.disputed');
    return opened.length > 0 ? opened[opened.length - 1]!.occurredAt : null;
  }

  private async hasEvent(orderId: string, type: string): Promise<boolean> {
    return (await this.ports.eventLog.eventsOf(orderId)).some((e) => e.type === type);
  }

  private async courierLostEvent(orderId: string) {
    return (await this.ports.eventLog.eventsOf(orderId)).find((e) => e.type === 'order.disputed' && e.payload['kind'] === 'courier_lost') ?? null;
  }

  private async resolvedEvent(orderId: string) {
    return (await this.ports.eventLog.eventsOf(orderId)).find((e) => e.type === 'order.dispute_resolved') ?? null;
  }

  private async audit(tx: Tx, actor: Actor, order: OrderRecord, action: string, summaryAr: string, detail: Record<string, unknown>): Promise<string> {
    const row = await this.ports.audit.record({ cityId: order.cityId, actorId: actor.personId, action, subjectKind: 'order', subjectId: order.id, summaryAr, detail }, tx);
    return row.id;
  }

  private result(order: OrderRecord, changed: boolean, postedIqd: number, auditId: string | null): StaffActionResult {
    return { orderId: order.id, state: order.state, changed, postedIqd, auditId };
  }
}

function actionsFor(state: OrderState): StuckOrder['actions'] {
  if (CANCELLABLE.includes(state)) return ['cancel'];
  if (state === 'picked_up') return ['markDelivered', 'courierLost'];
  if (state === 'delivered' || state === 'completed') return ['close'];
  if (state === 'disputed') return ['resolveDispute'];
  return [];
}

