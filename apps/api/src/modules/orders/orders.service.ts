import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import {
  DriverError,
  PlaceOrderInput,
  TERMINAL_ORDER_STATES,
  type CancellationFee,
  type DisputeKind,
  type Order,
  type OrderSearchPage,
  type OrderState,
  type Trip,
} from '@driver/contracts';
import type { z } from 'zod';
import { CLOCK, type Clock } from '../../shared/clock.js';
import { UnitOfWork, type Tx } from '../../shared/db/unit-of-work.js';
import type { Queue } from '../../shared/queue.js';
import type { CancellationSubject } from '../pricing/index.js';
import { ORDER_EVENTS, type OrderEventEmitter, type TripEventEnvelope } from './events.adapter.js';
import { ACTIVE_ORDER_STATES, decodeCursor, encodeCursor, isLate, toSummary } from './history.js';
import { MERCHANT_DIRECTORY, type MerchantDirectory, type MerchantProfile } from './merchants.port.js';
import { DISPUTABLE_STATES, MERCHANT_ORDER_TYPES, canOrderTransition, orderEventType, vehicleRequirement } from './order.machine.js';
import { CATERING_ABOVE_IQD, DEFAULT_TIMEZONE, ORDERS_RULES } from './orders.config.js';
import {
  ORDERS_REPOSITORY,
  type LineUnavailability,
  type NewLine,
  type OrderAggregate,
  type OrderLineRecord,
  type OrderPatch,
  type OrderRecord,
  type OrderSearchFilter,
  type OrdersRepository,
} from './orders.repository.js';
import { activePauseWindow } from './pause.js';
import { PARTICIPANT_RESOLVER, allocatePoints, assertLineTags, orderPoints, resolveParticipants, type ParticipantResolver } from './participants.js';

/** The slice of trips the orders module drives (courier release, cancellations, rider completion). */
export interface OrdersTripsPort {
  activeForOrder(orderId: string): Promise<Trip | null>;
  detachOrder(tripId: string, orderId: string, actorId?: string, reason?: string): Promise<Trip>;
  cancel(tripId: string, by: 'driver' | 'customer' | 'platform', actorId: string, reason: string): Promise<Trip>;
  customerComplete(tripId: string, customerId: string, reason?: string): Promise<Trip>;
}

export interface OrdersPricingPort {
  cancellationFee(subject: CancellationSubject, at: Date, cityId?: string): CancellationFee;
}

export const ORDERS_TRIPS = Symbol('ORDERS_TRIPS');
export const ORDERS_PRICING = Symbol('ORDERS_PRICING');
export const ORDERS_QUEUE = Symbol('ORDERS_QUEUE');

export const ORDER_JOBS = {
  autoReject: 'merchant.autoReject',
  autoClose: 'order.autoClose',
  partialTimeout: 'order.partialTimeout',
  offerToMerchant: 'order.offerToMerchant',
  readyOverdue: 'merchant.readyOverdue',
  courierRelease: 'merchant.courierRelease',
} as const;

export interface OrderTimerJob {
  orderId: string;
  /** The run the job belongs to (offer time, proposal time, promised-ready time); stale runs are no-ops. */
  refMs?: number;
}

const SYSTEM = 'system';
const PRE_PICKUP_COURIER_STATES = ['accepted', 'en_route_to_pickup', 'arrived_pickup'];

type PlaceInput = z.input<typeof PlaceOrderInput>;

/**
 * Orders (plan Step 4): the commercial object. Merchant acceptance within 90 s (auto-accept
 * merchants skip it; auto-rejects inside a declared pause window do not score), partial accept
 * with 60 s customer approval, scheduled-order offer timing, merchant heartbeat and courier
 * release, cancellation fees from pricing, 2-h auto-close, participant points, the merchant cash
 * account events on cash collection, and the reaction to trip events (`onTripEvent`).
 *
 * Every mutation runs in one unit of work and emits its domain events through the adapter;
 * timers are delayed queue jobs that re-check state when they fire.
 */
@Injectable()
export class OrdersService implements OnModuleInit {
  constructor(
    @Inject(ORDERS_REPOSITORY) private readonly repo: OrdersRepository,
    @Inject(ORDER_EVENTS) private readonly events: OrderEventEmitter,
    private readonly uow: UnitOfWork,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(ORDERS_QUEUE) private readonly queue: Queue<OrderTimerJob>,
    @Inject(ORDERS_TRIPS) private readonly trips: OrdersTripsPort,
    @Inject(ORDERS_PRICING) private readonly pricing: OrdersPricingPort,
    @Inject(MERCHANT_DIRECTORY) private readonly merchants: MerchantDirectory,
    @Inject(PARTICIPANT_RESOLVER) private readonly participants: ParticipantResolver,
  ) {}

  onModuleInit(): void {
    this.queue.process((job) => this.handleTimer(job.name, job.data));
  }

  // ───────────────────────── placing ─────────────────────────

  async place(ordererId: string, raw: PlaceInput): Promise<Order> {
    const input = PlaceOrderInput.parse(raw);
    const merchantType = MERCHANT_ORDER_TYPES.includes(input.type);
    if (merchantType && !input.merchantOrgId) throw new DriverError('merchant_required');
    // Review A.11: one merchant per order; a second merchant starts a second order.
    for (const l of input.lines) if (l.merchantOrgId && l.merchantOrgId !== input.merchantOrgId) throw new DriverError('one_merchant_per_order');
    const lines = input.type === 'ride' ? [] : input.lines;
    if ((merchantType || input.type === 'errand') && lines.length === 0) throw new DriverError('order_empty');

    const now = this.clock.now();
    let profile: MerchantProfile | null = null;
    if (merchantType) {
      profile = await this.merchants.profile(input.merchantOrgId!);
      if (!profile) throw new DriverError('org_not_found');
      if (!input.scheduledFor && activePauseWindow(now, profile.pauseWindows, DEFAULT_TIMEZONE)) throw new DriverError('merchant_paused');
    }
    const participants = await resolveParticipants(input.participants, this.participants);
    assertLineTags(lines, participants);

    const newLines: NewLine[] = lines.map((l) => ({
      catalogItemId: l.catalogItemId ?? null,
      freeText: l.freeText ?? null,
      qty: l.qty,
      unitPriceIqd: l.unitPriceIqd,
      modifiers: l.modifiers,
      participantRef: l.participantRef ?? null,
      note: l.note ?? null,
      pointsEligible: l.pointsEligible,
    }));
    const itemsTotal = newLines.reduce((a, l) => a + lineValue(l), 0);
    const itemCount = newLines.reduce((a, l) => a + l.qty, 0);
    const total =
      input.type === 'ride'
        ? Math.max(0, (input.fareIqd ?? 0) + input.tipIqd - input.discountIqd)
        : Math.max(0, itemsTotal + input.deliveryFeeIqd + input.serviceFeeIqd + input.tipIqd - input.discountIqd);
    const caps = merchantType || input.type === 'errand' ? vehicleRequirement(itemsTotal, itemCount) : null;

    return this.uow.run(async (tx) => {
      const agg = await this.repo.create(
        {
          cityId: input.cityId,
          type: input.type,
          ordererId,
          merchantOrgId: input.merchantOrgId ?? null,
          householdOrgId: input.householdOrgId ?? null,
          quoteId: input.quoteId ?? null,
          paymentMethod: input.paymentMethod,
          itemsTotalIqd: itemsTotal,
          deliveryFeeIqd: input.type === 'ride' ? 0 : input.deliveryFeeIqd,
          serviceFeeIqd: input.type === 'ride' ? 0 : input.serviceFeeIqd,
          discountIqd: input.discountIqd,
          tipIqd: input.tipIqd,
          totalIqd: total,
          note: input.note ?? null,
          scheduledFor: input.scheduledFor ?? null,
          minVehicleClass: caps?.minVehicleClass ?? null,
          placedAt: now,
        },
        newLines,
        participants.map((p) => ({ ref: p.ref, role: p.role, personId: p.personId, phoneHash: p.phoneHash, label: p.label, note: p.note })),
        tx,
      );
      const order = agg.order;
      await this.emit(tx, 'order.placed', ordererId, order, {
        type: order.type,
        cityId: order.cityId,
        merchantOrgId: order.merchantOrgId,
        totalIqd: order.totalIqd,
        itemsTotalIqd: order.itemsTotalIqd,
        paymentMethod: order.paymentMethod,
        minVehicleClass: order.minVehicleClass,
        cateringRequest: caps?.catering ?? false,
        scheduledFor: order.scheduledFor?.toISOString() ?? null,
        participantCount: agg.participants.length,
      });
      for (const l of agg.lines) if (l.participantId) await this.emit(tx, 'line.tagged', ordererId, order, { lineId: l.id, participantId: l.participantId });
      if (caps?.catering) await this.emit(tx, 'order.catering_request', SYSTEM, order, { itemsTotalIqd: itemsTotal, dispatcherCard: true });

      if (merchantType && profile) {
        const offerAt = order.scheduledFor ? new Date(order.scheduledFor.getTime() - (profile.defaultPrepMin + ORDERS_RULES.scheduledLeadMin) * 60_000) : now;
        if (offerAt.getTime() <= now.getTime()) await this.offerToMerchant(order, profile, tx);
        else await this.queue.add(ORDER_JOBS.offerToMerchant, { orderId: order.id }, { delayMs: offerAt.getTime() - now.getTime(), jobId: `order:${order.id}:offer` });
      }
      return this.view(order.id, tx);
    });
  }

  /**
   * The merchant sees the order (review A.12: scheduled orders arrive at T − prep − 10 min).
   * Auto-accept merchants (domain §2) skip acceptance; everyone else gets the 90-s clock.
   */
  private async offerToMerchant(order: OrderRecord, profile: MerchantProfile, tx: Tx): Promise<void> {
    if (order.merchantOfferedAt || order.state !== 'placed') return;
    const now = this.clock.now();
    const offered = await this.repo.update(order.id, { merchantOfferedAt: now }, tx);
    const catering = order.itemsTotalIqd > CATERING_ABOVE_IQD;
    await this.emit(tx, 'order.offered_to_merchant', SYSTEM, offered, {
      merchantOrgId: order.merchantOrgId,
      acceptBy: new Date(now.getTime() + ORDERS_RULES.merchantAcceptSec * 1000).toISOString(),
      autoAccept: profile.autoAccept && !catering,
    });
    if (profile.autoAccept && !catering) {
      await this.accept(offered, profile.defaultPrepMin, SYSTEM, tx, { auto: true });
      return;
    }
    await this.queue.add(ORDER_JOBS.autoReject, { orderId: order.id, refMs: now.getTime() }, { delayMs: ORDERS_RULES.merchantAcceptSec * 1000, jobId: `order:${order.id}:autoReject:${now.getTime()}` });
  }

  // ───────────────────────── merchant side ─────────────────────────

  /**
   * Merchant accepts with a prep time. Listing unavailable lines opens the partial-accept flow
   * (review A.4) instead: the customer has 60 s to approve the reduced order or cancel free.
   */
  async merchantAccept(actorId: string, input: { orderId: string; prepMinutes: number; unavailableLineIds?: string[] | undefined }): Promise<Order> {
    return this.uow.run(async (tx) => {
      const agg = await this.load(input.orderId, tx);
      const order = agg.order;
      if (!MERCHANT_ORDER_TYPES.includes(order.type) || order.state !== 'placed' || !order.merchantOfferedAt) throw new DriverError('order_state_conflict');
      if (pendingProposal(agg.lines)) throw new DriverError('order_state_conflict');
      const unavailable = [...new Set(input.unavailableLineIds ?? [])];
      if (unavailable.length === 0) {
        await this.accept(order, input.prepMinutes, actorId, tx, { auto: false });
        return this.view(order.id, tx);
      }
      const ids = new Set(agg.lines.map((l) => l.id));
      if (unavailable.some((id) => !ids.has(id)) || unavailable.length >= agg.lines.length) throw new DriverError('partial_accept_invalid');
      const now = this.clock.now();
      const marker: LineUnavailability = { kind: 'unavailable', state: 'proposed', proposedAt: now.toISOString(), prepMinutes: input.prepMinutes };
      for (const id of unavailable) await this.repo.updateLine(id, { substitution: marker }, tx);
      const removed = agg.lines.filter((l) => unavailable.includes(l.id)).reduce((a, l) => a + lineValue(l), 0);
      const deadline = new Date(now.getTime() + ORDERS_RULES.partialApprovalSec * 1000);
      await this.emit(tx, 'order.partial_proposed', actorId, order, {
        unavailableLineIds: unavailable,
        reducedItemsTotalIqd: order.itemsTotalIqd - removed,
        reducedTotalIqd: Math.max(0, order.totalIqd - removed),
        deadline: deadline.toISOString(),
        prepMinutes: input.prepMinutes,
      });
      await this.queue.add(ORDER_JOBS.partialTimeout, { orderId: order.id, refMs: now.getTime() }, { delayMs: ORDERS_RULES.partialApprovalSec * 1000, jobId: `order:${order.id}:partial:${now.getTime()}` });
      return this.view(order.id, tx);
    });
  }

  /**
   * Merchant rejects. Before acceptance it is a plain rejection (scored); after acceptance it is a
   * late rejection: scoring hit + 500 customer credit funded by the merchant (spec §4).
   */
  async merchantReject(actorId: string, input: { orderId: string; reason: string }): Promise<Order> {
    return this.uow.run(async (tx) => {
      const { order } = await this.load(input.orderId, tx);
      if (!MERCHANT_ORDER_TYPES.includes(order.type)) throw new DriverError('order_state_conflict');
      const late = order.state === 'merchant_accepted' || order.state === 'preparing';
      const now = this.clock.now();
      const next = await this.move(order, 'merchant_rejected', actorId, tx, { cancelledAt: now, cancellationReason: input.reason }, {
        reason: input.reason,
        auto: false,
        scored: true,
        afterAccept: late,
        customerCreditIqd: late ? ORDERS_RULES.merchantLateRejectCreditIqd : 0,
        creditFundedBy: late ? 'merchant' : null,
      });
      await this.releaseTrip(next, 'merchant_rejected');
      return this.view(order.id, tx);
    });
  }

  async markPreparing(actorId: string, input: { orderId: string }): Promise<Order> {
    return this.uow.run(async (tx) => {
      const { order } = await this.load(input.orderId, tx);
      await this.move(order, 'preparing', actorId, tx, { preparingAt: this.clock.now() });
      return this.view(order.id, tx);
    });
  }

  async markReady(actorId: string, input: { orderId: string }): Promise<Order> {
    return this.uow.run(async (tx) => {
      const { order } = await this.load(input.orderId, tx);
      if (order.state === 'ready') return this.view(order.id, tx);
      await this.move(order, 'ready', actorId, tx, { readyAt: this.clock.now() });
      return this.view(order.id, tx);
    });
  }

  async merchantHeartbeat(merchantOrgId: string): Promise<void> {
    await this.merchants.heartbeat(merchantOrgId, this.clock.now());
  }

  // ───────────────────────── customer side ─────────────────────────

  /** Partial-accept answer (review A.4): approve the reduced order, or cancel free. */
  async respondPartial(actorId: string, input: { orderId: string; approve: boolean }): Promise<Order> {
    return this.uow.run(async (tx) => {
      const agg = await this.load(input.orderId, tx);
      const order = agg.order;
      if (order.ordererId !== actorId) throw new DriverError('forbidden');
      const proposal = pendingProposal(agg.lines);
      const now = this.clock.now();
      if (!proposal || order.state !== 'placed' || now.getTime() > proposal.proposedAt.getTime() + ORDERS_RULES.partialApprovalSec * 1000) {
        throw new DriverError('partial_accept_not_pending');
      }
      if (!input.approve) {
        for (const l of proposal.lines) await this.repo.updateLine(l.id, { substitution: { ...l.substitution!, state: 'restored' } }, tx);
        await this.emit(tx, 'order.partial_declined', actorId, order, { unavailableLineIds: proposal.lines.map((l) => l.id) });
        await this.move(order, 'customer_cancelled', actorId, tx, { cancelledAt: now, cancellationReason: 'partial_declined', cancellationFeeIqd: 0 }, { by: 'customer', reason: 'partial_declined', feeIqd: 0, free: true });
        return this.view(order.id, tx);
      }
      for (const l of proposal.lines) await this.repo.updateLine(l.id, { substitution: { ...l.substitution!, state: 'removed' } }, tx);
      const removed = proposal.lines.reduce((a, l) => a + lineValue(l), 0);
      const reduced = await this.repo.update(order.id, { itemsTotalIqd: order.itemsTotalIqd - removed, totalIqd: Math.max(0, order.totalIqd - removed) }, tx);
      await this.emit(tx, 'order.partial_approved', actorId, order, { removedLineIds: proposal.lines.map((l) => l.id), removedIqd: removed, itemsTotalIqd: reduced.itemsTotalIqd, totalIqd: reduced.totalIqd });
      await this.accept(reduced, proposal.prepMinutes, actorId, tx, { auto: false, partial: true });
      return this.view(order.id, tx);
    });
  }

  /** Fee the customer would pay to cancel now (dispatch & pricing §4). */
  async cancellationPreview(orderId: string): Promise<CancellationFee> {
    const { order } = await this.load(orderId);
    return this.feeFor(order);
  }

  /**
   * Customer cancellation: free until the merchant accepts (or, scheduled, until it was offered),
   * fee after, never after pickup (that is a dispute). Rides cancel their trip; deliveries are
   * detached from theirs (the courier en route gets 500 of the fee).
   */
  async cancel(actorId: string, input: { orderId: string; reason?: string | undefined }): Promise<Order> {
    return this.uow.run(async (tx) => {
      const { order } = await this.load(input.orderId, tx);
      if (order.ordererId !== actorId) throw new DriverError('forbidden');
      if (order.state === 'customer_cancelled') return this.view(order.id, tx);
      const fee = await this.feeFor(order);
      if (!fee.allowed) throw new DriverError(order.state === 'picked_up' ? 'order_cancel_after_pickup' : 'order_state_conflict');
      const now = this.clock.now();
      const reason = input.reason ?? 'customer_request';
      await this.move(order, 'customer_cancelled', actorId, tx, { cancelledAt: now, cancellationReason: reason, cancellationFeeIqd: fee.amountIqd }, {
        by: 'customer',
        reason,
        feeIqd: fee.amountIqd,
        free: fee.free,
        payer: fee.payer,
        splits: fee.splits,
        label_ar: fee.label_ar,
        reason_ar: fee.reason_ar,
      });
      const trip = await this.trips.activeForOrder(order.id);
      if (trip) {
        if (order.type === 'ride') await this.trips.cancel(trip.id, 'customer', actorId, reason);
        else await this.trips.detachOrder(trip.id, order.id, actorId, 'order_cancelled');
      }
      return this.view(order.id, tx);
    });
  }

  /** Domain §9: the customer may open a dispute until `closed`; after that, support only. */
  async openDispute(actorId: string, input: { orderId: string; kind: DisputeKind; note?: string | undefined }): Promise<Order> {
    return this.uow.run(async (tx) => {
      const { order } = await this.load(input.orderId, tx);
      if (order.ordererId !== actorId) throw new DriverError('forbidden');
      if (order.state === 'disputed') return this.view(order.id, tx);
      if (order.state === 'closed' || order.state === 'refunded') throw new DriverError('dispute_window_closed');
      if (!DISPUTABLE_STATES.includes(order.state)) throw new DriverError('order_state_conflict');
      await this.move(order, 'disputed', actorId, tx, {}, { kind: input.kind, note: input.note ?? null, openedBy: 'customer', evidence: await this.evidence(order) });
      return this.view(order.id, tx);
    });
  }

  /** Rating closes the order early (domain §2). */
  async rate(actorId: string, input: { orderId: string }): Promise<Order> {
    return this.uow.run(async (tx) => {
      const { order } = await this.load(input.orderId, tx);
      if (order.ordererId !== actorId) throw new DriverError('forbidden');
      if (order.state === 'closed') return this.view(order.id, tx);
      if (!DISPUTABLE_STATES.includes(order.state)) throw new DriverError('order_state_conflict');
      await this.repo.update(order.id, { ratedAt: this.clock.now() }, tx);
      await this.close(order, actorId, 'rated', tx);
      return this.view(order.id, tx);
    });
  }

  /**
   * Customer-side ride completion (review B.24): the orderer or the rider taps "وصلت" and the ride
   * completes at the locked quote, even with the driver's phone dead.
   */
  async confirmRideArrived(actorId: string, input: { orderId: string }): Promise<Order> {
    return this.uow.run(async (tx) => {
      const agg = await this.load(input.orderId, tx);
      const order = agg.order;
      const isRider = agg.participants.some((p) => p.role === 'rider' && p.personId === actorId);
      if (order.ordererId !== actorId && !isRider) throw new DriverError('forbidden');
      if (order.type !== 'ride') throw new DriverError('order_type_not_supported');
      if (order.state === 'completed') return this.view(order.id, tx);
      if (order.state !== 'matched') throw new DriverError('order_state_conflict');
      const trip = await this.trips.activeForOrder(order.id);
      if (!trip) throw new DriverError('trip_not_found');
      await this.trips.customerComplete(trip.id, actorId);
      await this.completeRide(order, actorId, tx, { by: 'customer', tripId: trip.id });
      return this.view(order.id, tx);
    });
  }

  // ───────────────────────── trip events ─────────────────────────

  /**
   * Reacts to published trip events (at-least-once, so every branch re-checks state and is a no-op
   * on replay): ride matched on accept; picked up / delivered on stop hand-overs (with the cash
   * collection events of edge-case §3); unreachable failure → dispute with the default outcome;
   * driver cancellation after pickup → dispute (courier pays the food); rider completion.
   */
  async onTripEvent(e: TripEventEnvelope): Promise<void> {
    const p = e.payload;
    const ids = (k: string) => (Array.isArray(p[k]) ? (p[k] as string[]) : []);
    switch (e.type) {
      case 'trip.accepted':
        for (const id of ids('orderIds')) await this.whenOrder(id, (o, tx) => (o.type === 'ride' && o.state === 'placed' ? this.move(o, 'matched', e.actorId, tx, {}, { tripId: e.tripId, driverId: e.actorId }) : undefined));
        return;
      case 'stop.completed': {
        if (!e.orderId) return;
        const stopType = p['stopType'];
        if (stopType === 'pickup' || stopType === 'shop') await this.whenOrder(e.orderId, (o, tx) => this.pickedUp(o, e, tx));
        if (stopType === 'dropoff') await this.whenOrder(e.orderId, (o, tx) => this.delivered(o, e, tx));
        return;
      }
      case 'trip.completed':
        for (const id of ids('orderIds')) await this.whenOrder(id, (o, tx) => (o.type === 'ride' && o.state === 'matched' ? this.completeRide(o, e.actorId, tx, { by: String(p['by'] ?? 'driver'), tripId: e.tripId }) : undefined));
        return;
      case 'trip.order_failed':
      case 'trip.failed': {
        const failed = e.type === 'trip.order_failed' ? (e.orderId ? [e.orderId] : []) : ids('orderIds');
        for (const id of failed) await this.whenOrder(id, (o, tx) => this.unreachableDispute(o, e, tx));
        return;
      }
      case 'trip.cancelled':
        await this.onTripCancelled(e);
        return;
      default:
        return;
    }
  }

  // ───────────────────────── reads ─────────────────────────

  async get(orderId: string): Promise<Order> {
    return this.view(orderId);
  }

  async listActive(filter: { cityId?: string | undefined; merchantOrgId?: string | undefined }): Promise<Order[]> {
    const live = (await this.repo.findMany({ ...(filter.cityId ? { cityId: filter.cityId } : {}), ...(filter.merchantOrgId ? { merchantOrgId: filter.merchantOrgId } : {}) })).filter(
      (o) => !TERMINAL_ORDER_STATES.includes(o.state),
    );
    return Promise.all(live.map((o) => this.view(o.id)));
  }

  async listForPerson(personId: string): Promise<Order[]> {
    const orders = await this.repo.forPerson(personId);
    return Promise.all(orders.map((o) => this.view(o.id)));
  }

  /** Console history: any state, newest first, keyset-paginated by an opaque cursor. */
  async search(input: Omit<OrderSearchFilter, 'after'> & { cursor?: string | undefined }): Promise<OrderSearchPage> {
    const { cursor, ...filter } = input;
    const rows = await this.repo.search({ ...filter, after: decodeCursor(cursor), limit: input.limit + 1 });
    const page = rows.slice(0, input.limit);
    const now = this.clock.now();
    return { rows: page.map((o) => toSummary(o, now)), nextCursor: rows.length > input.limit ? encodeCursor(page.at(-1)!) : null };
  }

  /** Right-now bar: orders placed in the last hour, active orders and how many of them are late. */
  async liveStats(cityId: string): Promise<{ ordersLastHour: number; activeOrders: number; lateOrders: number }> {
    const now = this.clock.now();
    const [ordersLastHour, active] = await Promise.all([
      this.repo.countPlacedSince(cityId, new Date(now.getTime() - 60 * 60_000)),
      this.repo.findMany({ cityId, states: ACTIVE_ORDER_STATES }),
    ]);
    return { ordersLastHour, activeOrders: active.length, lateOrders: active.filter((o) => isLate(o, now)).length };
  }

  /** Raw aggregate for authorisation checks in the transport layer. */
  async aggregate(orderId: string): Promise<OrderAggregate> {
    return this.load(orderId);
  }

  // ───────────────────────── timers ─────────────────────────

  async handleTimer(name: string, job: OrderTimerJob): Promise<void> {
    await this.uow.run(async (tx) => {
      const agg = await this.repo.find(job.orderId, tx);
      if (!agg) return;
      const order = agg.order;
      const now = this.clock.now();
      switch (name) {
        case ORDER_JOBS.offerToMerchant: {
          const profile = order.merchantOrgId ? await this.merchants.profile(order.merchantOrgId) : null;
          if (profile) await this.offerToMerchant(order, profile, tx);
          return;
        }
        case ORDER_JOBS.autoReject: {
          const offeredAt = order.merchantOfferedAt;
          if (order.state !== 'placed' || !offeredAt || offeredAt.getTime() !== job.refMs || pendingProposal(agg.lines)) return;
          const profile = order.merchantOrgId ? await this.merchants.profile(order.merchantOrgId) : null;
          // Review A.1: an auto-reject inside a declared pause window does not score.
          const pause = profile ? (activePauseWindow(now, profile.pauseWindows, DEFAULT_TIMEZONE) ?? activePauseWindow(offeredAt, profile.pauseWindows, DEFAULT_TIMEZONE)) : null;
          await this.move(order, 'merchant_rejected', SYSTEM, tx, { cancelledAt: now, cancellationReason: 'merchant_timeout' }, {
            reason: 'merchant_timeout',
            auto: true,
            scored: pause === null,
            pauseWindow: pause ? pause.reason ?? `${pause.start}-${pause.end}` : null,
            dispatchAlert: true,
          });
          return;
        }
        case ORDER_JOBS.partialTimeout: {
          const proposal = pendingProposal(agg.lines);
          if (order.state !== 'placed' || !proposal || proposal.proposedAt.getTime() !== job.refMs) return;
          for (const l of proposal.lines) await this.repo.updateLine(l.id, { substitution: { ...l.substitution!, state: 'restored' } }, tx);
          await this.move(order, 'platform_cancelled', SYSTEM, tx, { cancelledAt: now, cancellationReason: 'partial_timeout', cancellationFeeIqd: 0 }, { by: 'platform', reason: 'partial_timeout', feeIqd: 0, free: true });
          return;
        }
        case ORDER_JOBS.readyOverdue:
        case ORDER_JOBS.courierRelease: {
          if (!['merchant_accepted', 'preparing'].includes(order.state) || order.promisedReadyAt?.getTime() !== job.refMs || !order.merchantOrgId) return;
          const profile = await this.merchants.profile(order.merchantOrgId);
          const present = profile?.lastHeartbeatAt && now.getTime() - profile.lastHeartbeatAt.getTime() <= ORDERS_RULES.heartbeatStaleMs;
          if (present) return;
          if (name === ORDER_JOBS.readyOverdue) {
            await this.emit(tx, 'order.merchant_unresponsive', SYSTEM, order, { merchantOrgId: order.merchantOrgId, promisedReadyAt: order.promisedReadyAt?.toISOString() ?? null, lastHeartbeatAt: profile?.lastHeartbeatAt?.toISOString() ?? null, dispatcherCard: true, call: true });
            return;
          }
          const trip = await this.trips.activeForOrder(order.id);
          if (!trip?.courierId || !PRE_PICKUP_COURIER_STATES.includes(trip.state)) return;
          await this.trips.detachOrder(trip.id, order.id, SYSTEM, 'merchant_unresponsive');
          await this.emit(tx, 'order.courier_released', SYSTEM, order, {
            tripId: trip.id,
            courierId: trip.courierId,
            merchantOrgId: order.merchantOrgId,
            compensationIqd: ORDERS_RULES.courierReleaseCompensationIqd,
            chargedTo: 'merchant',
          });
          return;
        }
        case ORDER_JOBS.autoClose: {
          if (order.state === 'delivered' || order.state === 'completed') await this.close(order, SYSTEM, 'auto_2h', tx);
          return;
        }
        default:
          return;
      }
    });
  }

  // ───────────────────────── internals ─────────────────────────

  private async load(orderId: string, tx?: Tx): Promise<OrderAggregate> {
    const agg = await this.repo.find(orderId, tx);
    if (!agg) throw new DriverError('order_not_found');
    return agg;
  }

  /** Runs `fn` on the order inside a unit of work; unknown orders (other modules' test data) are ignored. */
  private async whenOrder(orderId: string, fn: (o: OrderRecord, tx: Tx) => Promise<unknown> | undefined): Promise<void> {
    await this.uow.run(async (tx) => {
      const agg = await this.repo.find(orderId, tx);
      if (agg) await fn(agg.order, tx);
    });
  }

  private async accept(order: OrderRecord, prepMinutes: number, actorId: string, tx: Tx, opts: { auto: boolean; partial?: boolean }): Promise<OrderRecord> {
    const now = this.clock.now();
    const promisedReadyAt = new Date(now.getTime() + prepMinutes * 60_000);
    const next = await this.move(order, 'merchant_accepted', actorId, tx, { acceptedAt: now, promisedReadyAt }, {
      prepMinutes,
      promisedReadyAt: promisedReadyAt.toISOString(),
      minVehicleClass: order.minVehicleClass,
      auto: opts.auto,
      partial: opts.partial ?? false,
    }, opts.auto ? 'order.auto_accepted' : 'order.accepted');
    const ref = promisedReadyAt.getTime();
    await this.queue.add(ORDER_JOBS.readyOverdue, { orderId: order.id, refMs: ref }, { delayMs: (prepMinutes + ORDERS_RULES.readyOverdueMin) * 60_000, jobId: `order:${order.id}:readyOverdue:${ref}` });
    await this.queue.add(ORDER_JOBS.courierRelease, { orderId: order.id, refMs: ref }, { delayMs: (prepMinutes + ORDERS_RULES.courierReleaseMin) * 60_000, jobId: `order:${order.id}:courierRelease:${ref}` });
    return next;
  }

  private async pickedUp(order: OrderRecord, e: TripEventEnvelope, tx: Tx): Promise<unknown> {
    // Only orders still waiting for the courier move; anything later is a replay.
    const awaiting: readonly OrderState[] = MERCHANT_ORDER_TYPES.includes(order.type) ? ['merchant_accepted', 'preparing', 'ready'] : ['placed'];
    if (order.type === 'ride' || !awaiting.includes(order.state)) return;
    let o = order;
    const now = this.clock.now();
    if (o.state === 'merchant_accepted' || o.state === 'preparing') {
      // The courier has the food: the merchant's "ready" tap is implied.
      o = await this.move(o, 'ready', e.actorId, tx, { readyAt: now }, { implied: true, tripId: e.tripId });
    }
    return this.move(o, 'picked_up', e.actorId, tx, { pickedUpAt: now }, { tripId: e.tripId, courierId: e.actorId });
  }

  private async delivered(order: OrderRecord, e: TripEventEnvelope, tx: Tx): Promise<unknown> {
    if (order.type === 'ride') {
      return order.state === 'matched' ? this.completeRide(order, e.actorId, tx, { by: 'driver', tripId: e.tripId }) : undefined;
    }
    if (order.state !== 'picked_up') return;
    const now = this.clock.now();
    const next = await this.move(order, 'delivered', e.actorId, tx, { deliveredAt: now }, { tripId: e.tripId, courierId: e.actorId });
    const cash = typeof e.payload['cashCollectedIqd'] === 'number' ? (e.payload['cashCollectedIqd'] as number) : null;
    if (order.paymentMethod === 'cash') await this.cashCollected(next, e, cash ?? order.totalIqd, tx);
    await this.scheduleClose(next, now);
    return next;
  }

  /**
   * Edge-case §3 merchant cash account: a cash order creates `merchant_payable` net of commission
   * the moment the courier collects; the courier now holds the merchant's money until settlement.
   */
  private async cashCollected(order: OrderRecord, e: TripEventEnvelope, amountIqd: number, tx: Tx): Promise<void> {
    await this.emit(tx, 'order.cash_collected', e.actorId, order, { tripId: e.tripId, courierId: e.actorId, amountIqd, expectedIqd: order.totalIqd, discrepancyIqd: amountIqd - order.totalIqd });
    if (!order.merchantOrgId) return;
    const profile = await this.merchants.profile(order.merchantOrgId);
    const pct = profile?.commissionPct ?? ORDERS_RULES.defaultCommissionPct;
    const commission = Math.round((order.itemsTotalIqd * pct) / 100);
    await this.emit(tx, 'merchant.payable_accrued', SYSTEM, order, {
      merchantOrgId: order.merchantOrgId,
      courierId: e.actorId,
      grossIqd: order.itemsTotalIqd,
      commissionPct: pct,
      commissionIqd: commission,
      netIqd: order.itemsTotalIqd - commission,
      heldBy: 'courier',
    });
  }

  private async completeRide(order: OrderRecord, actorId: string, tx: Tx, payload: Record<string, unknown>): Promise<OrderRecord> {
    const now = this.clock.now();
    const next = await this.move(order, 'completed', actorId, tx, { deliveredAt: now }, payload);
    await this.scheduleClose(next, now);
    return next;
  }

  private async scheduleClose(order: OrderRecord, from: Date): Promise<void> {
    await this.queue.add(ORDER_JOBS.autoClose, { orderId: order.id, refMs: from.getTime() }, { delayMs: ORDERS_RULES.autoCloseMs, jobId: `order:${order.id}:autoClose` });
  }

  /** `closed`: money settles (ledger subscribes) and points are allocated to participants. */
  private async close(order: OrderRecord, actorId: string, reason: string, tx: Tx): Promise<void> {
    const agg = (await this.repo.find(order.id, tx))!;
    const now = this.clock.now();
    const closed = await this.move(agg.order, 'closed', actorId, tx, { closedAt: now }, {
      reason,
      totalIqd: agg.order.totalIqd,
      itemsTotalIqd: agg.order.itemsTotalIqd,
      deliveryFeeIqd: agg.order.deliveryFeeIqd,
      serviceFeeIqd: agg.order.serviceFeeIqd,
      paymentMethod: agg.order.paymentMethod,
      merchantOrgId: agg.order.merchantOrgId,
    });
    const profile = closed.merchantOrgId ? await this.merchants.profile(closed.merchantOrgId) : null;
    const revenue =
      closed.type === 'ride'
        ? Math.round((closed.totalIqd * ORDERS_RULES.rideTakePct) / 100)
        : closed.serviceFeeIqd + Math.round((closed.itemsTotalIqd * (profile?.commissionPct ?? ORDERS_RULES.defaultCommissionPct)) / 100);
    const basePoints = orderPoints({ type: closed.type, platformRevenueIqd: revenue });
    const allocations = allocatePoints({
      type: closed.type,
      ordererId: closed.ordererId,
      basePoints,
      lines: agg.lines.filter((l) => l.substitution?.state !== 'removed').map((l) => ({ participantId: l.participantId, valueIqd: lineValue(l), pointsEligible: l.pointsEligible })),
      participants: agg.participants.map((p) => ({ id: p.id, role: p.role, personId: p.personId, phoneHash: p.phoneHash })),
    });
    await this.emit(tx, 'order.points_allocated', SYSTEM, closed, { platformRevenueIqd: revenue, basePoints, allocations });
    const expiresAt = new Date(now.getTime() + ORDERS_RULES.pendingPointsTtlDays * 86_400_000).toISOString();
    for (const a of allocations.filter((x) => x.pending)) {
      await this.emit(tx, 'points.pending', SYSTEM, closed, { phoneHash: a.phoneHash, participantId: a.participantId, points: a.points, expiresAt });
    }
  }

  private async unreachableDispute(order: OrderRecord, e: TripEventEnvelope, tx: Tx): Promise<unknown> {
    if (order.state !== 'picked_up' && order.state !== 'matched') return;
    // Domain §2/§9: food — the customer owes the cost; ride — the cancellation fee. Support may override.
    const defaultOutcome = order.type === 'ride' ? 'customer_owes_cancellation_fee' : 'customer_owes_cost';
    return this.move(order, 'disputed', SYSTEM, tx, {}, { kind: 'unreachable', openedBy: 'system', defaultOutcome, tripId: e.tripId, evidence: { ...e.payload, tripId: e.tripId } });
  }

  private async onTripCancelled(e: TripEventEnvelope): Promise<void> {
    const p = e.payload;
    const by = String(p['by'] ?? 'platform');
    const orderIds = Array.isArray(p['orderIds']) ? (p['orderIds'] as string[]) : [];
    const pickedUp = new Set(Array.isArray(p['pickedUpOrderIds']) ? (p['pickedUpOrderIds'] as string[]) : []);
    for (const id of orderIds) {
      await this.whenOrder(id, async (o, tx) => {
        if (TERMINAL_ORDER_STATES.includes(o.state) || o.state === 'disputed') return;
        if (by === 'driver' && o.state === 'picked_up' && pickedUp.has(o.id)) {
          // Spec §9: courier cancels after pickup → courier pays the food cost.
          return this.move(o, 'disputed', SYSTEM, tx, {}, { kind: 'courier_cancelled_after_pickup', openedBy: 'system', defaultOutcome: 'courier_pays_food_cost', tripId: e.tripId, courierId: p['courierId'] ?? null });
        }
        if (o.type === 'ride' && o.state === 'matched') {
          if (by === 'driver') {
            // Spec §4: driver cancel after accept = scoring hit; after arrival also 500 credit to the customer from the driver.
            const arrivedPickupAt = dateOrNull(p['arrivedPickupAt']);
            const fee = this.pricing.cancellationFee(
              { kind: 'trip', by: 'driver', state: arrivedPickupAt ? 'arrived_pickup' : 'en_route_to_pickup', acceptedAt: dateOrNull(p['acceptedAt']), arrivedPickupAt, fareIqd: o.totalIqd },
              e.occurredAt,
              o.cityId,
            );
            await this.emit(tx, 'order.driver_cancelled', e.actorId, o, { tripId: e.tripId, scoringHit: fee.scoringHit, customerCreditIqd: fee.amountIqd, creditFundedBy: fee.amountIqd > 0 ? 'driver' : null });
          }
          // The ride goes back to dispatch.
          return this.move(o, 'placed', SYSTEM, tx, {}, { tripId: e.tripId, reason: `trip_cancelled_by_${by}`, redispatch: true }, 'order.rematch_needed');
        }
        if (by !== 'customer') await this.emit(tx, 'order.courier_unassigned', SYSTEM, o, { tripId: e.tripId, by, reason: p['reason'] ?? null, redispatch: true });
        return undefined;
      });
    }
  }

  private async releaseTrip(order: OrderRecord, reason: string): Promise<void> {
    const trip = await this.trips.activeForOrder(order.id);
    if (trip) await this.trips.detachOrder(trip.id, order.id, SYSTEM, reason);
  }

  private async feeFor(order: OrderRecord): Promise<CancellationFee> {
    const trip = await this.trips.activeForOrder(order.id);
    const now = this.clock.now();
    if (order.type === 'ride' && trip && trip.acceptedAt) {
      const arrivedPickupAt = trip.stops.find((s) => s.type === 'pickup' && s.arrivedAt)?.arrivedAt ?? null;
      return this.pricing.cancellationFee({ kind: 'trip', by: 'customer', state: trip.state, acceptedAt: trip.acceptedAt, arrivedPickupAt, fareIqd: order.totalIqd }, now, order.cityId);
    }
    return this.pricing.cancellationFee(
      {
        kind: 'order',
        type: order.type,
        state: order.state,
        itemsTotalIqd: order.itemsTotalIqd,
        deliveryFeeIqd: order.deliveryFeeIqd,
        totalIqd: order.totalIqd,
        scheduledFor: order.scheduledFor,
        merchantOfferedAt: order.merchantOfferedAt,
        courierEnRoute: Boolean(trip?.courierId && PRE_PICKUP_COURIER_STATES.includes(trip.state)),
        courierAssigned: Boolean(trip?.courierId),
        receiptTotalIqd: order.receiptTotalIqd,
      },
      now,
      order.cityId,
    );
  }

  private async evidence(order: OrderRecord): Promise<Record<string, unknown>> {
    return {
      placedAt: order.placedAt.toISOString(),
      acceptedAt: order.acceptedAt?.toISOString() ?? null,
      promisedReadyAt: order.promisedReadyAt?.toISOString() ?? null,
      readyAt: order.readyAt?.toISOString() ?? null,
      pickedUpAt: order.pickedUpAt?.toISOString() ?? null,
      deliveredAt: order.deliveredAt?.toISOString() ?? null,
    };
  }

  private async move(
    order: OrderRecord,
    to: OrderState,
    actorId: string,
    tx: Tx,
    patch: OrderPatch = {},
    payload: Record<string, unknown> = {},
    eventType?: string,
  ): Promise<OrderRecord> {
    if (order.state === to) return order;
    if (!canOrderTransition(order.type, order.state, to)) throw new DriverError('order_state_conflict');
    const next = await this.repo.updateIf(order.id, order.state, { ...patch, state: to }, tx);
    if (!next) throw new DriverError('order_state_conflict');
    await this.emit(tx, eventType ?? orderEventType(to), actorId, next, { from: order.state, to, ...(to.endsWith('_cancelled') ? { cancelledState: to } : {}), ...payload });
    return next;
  }

  private async emit(tx: Tx | undefined, type: string, actorId: string, order: OrderRecord, payload: Record<string, unknown>): Promise<void> {
    await this.events.emit(tx, { type, actorId, occurredAt: this.clock.now(), orderId: order.id, payload }, { name: 'order', id: order.id });
  }

  private async view(orderId: string, tx?: Tx): Promise<Order> {
    return toOrderView(await this.load(orderId, tx));
  }
}

// ───────────────────────── helpers ─────────────────────────

export function lineValue(l: Pick<OrderLineRecord, 'qty' | 'unitPriceIqd' | 'modifiers'>): number {
  const mods = l.modifiers.reduce((a, m) => a + (typeof m.priceIqd === 'number' ? m.priceIqd : 0), 0);
  return l.qty * (l.unitPriceIqd + mods);
}

function pendingProposal(lines: readonly OrderLineRecord[]): { lines: OrderLineRecord[]; proposedAt: Date; prepMinutes: number } | null {
  const proposed = lines.filter((l) => l.substitution?.kind === 'unavailable' && l.substitution.state === 'proposed');
  if (proposed.length === 0) return null;
  const first = proposed[0]!.substitution!;
  return { lines: proposed, proposedAt: new Date(first.proposedAt), prepMinutes: first.prepMinutes };
}

function dateOrNull(v: unknown): Date | null {
  return typeof v === 'string' || v instanceof Date ? new Date(v) : null;
}

export function toOrderView(agg: OrderAggregate): Order {
  const { order, lines, participants } = agg;
  const proposal = pendingProposal(lines);
  const removedValue = proposal ? proposal.lines.reduce((a, l) => a + lineValue(l), 0) : 0;
  return {
    id: order.id,
    cityId: order.cityId,
    type: order.type,
    state: order.state,
    ordererId: order.ordererId,
    merchantOrgId: order.merchantOrgId,
    householdOrgId: order.householdOrgId,
    quoteId: order.quoteId,
    paymentMethod: order.paymentMethod,
    itemsTotalIqd: order.itemsTotalIqd,
    deliveryFeeIqd: order.deliveryFeeIqd,
    serviceFeeIqd: order.serviceFeeIqd,
    discountIqd: order.discountIqd,
    tipIqd: order.tipIqd,
    totalIqd: order.totalIqd,
    minVehicleClass: order.minVehicleClass,
    cateringRequest: MERCHANT_ORDER_TYPES.includes(order.type) && order.itemsTotalIqd > CATERING_ABOVE_IQD,
    lines: lines.map((l) => ({
      id: l.id,
      catalogItemId: l.catalogItemId,
      freeText: l.freeText,
      qty: l.qty,
      unitPriceIqd: l.unitPriceIqd,
      modifiers: l.modifiers,
      participantId: l.participantId,
      note: l.note,
      pointsEligible: l.pointsEligible,
      availability: l.substitution?.state === 'proposed' ? 'unavailable' : l.substitution?.state === 'removed' ? 'removed' : 'available',
    })),
    participants: participants.map((p) => ({ id: p.id, role: p.role, personId: p.personId, phoneOnly: p.personId === null && p.phoneHash !== null, label: p.label, note: p.note })),
    partial: proposal
      ? {
          unavailableLineIds: proposal.lines.map((l) => l.id),
          proposedAt: proposal.proposedAt,
          deadline: new Date(proposal.proposedAt.getTime() + ORDERS_RULES.partialApprovalSec * 1000),
          reducedItemsTotalIqd: order.itemsTotalIqd - removedValue,
          reducedTotalIqd: Math.max(0, order.totalIqd - removedValue),
        }
      : null,
    scheduledFor: order.scheduledFor,
    merchantOfferedAt: order.merchantOfferedAt,
    promisedReadyAt: order.promisedReadyAt,
    placedAt: order.placedAt,
    acceptedAt: order.acceptedAt,
    preparingAt: order.preparingAt,
    readyAt: order.readyAt,
    pickedUpAt: order.pickedUpAt,
    deliveredAt: order.deliveredAt,
    closedAt: order.closedAt,
    cancelledAt: order.cancelledAt,
    cancellationReason: order.cancellationReason,
    cancellationFeeIqd: order.cancellationFeeIqd,
    refundState: order.refundState,
    note: order.note,
  };
}
