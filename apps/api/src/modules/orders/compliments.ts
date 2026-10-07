import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  COMPLIMENT_RULES,
  COURIER_COMPLIMENTS_RECENT,
  complimentKeysFor,
  complimentReason,
  complimentUntil,
  countCompliments,
  DriverError,
  OrderComplimentedPayload,
  orderTicketNumber,
  type ComplimentInput,
  type ComplimentKey,
  type ComplimentOffer,
  type ComplimentResult,
  type CourierCompliments,
} from '@driver/contracts';
import { CLOCK, type Clock } from '../../shared/clock.js';
import { DistributedKeyedLock } from '../../shared/db/advisory-lock.js';
import { UnitOfWork } from '../../shared/db/unit-of-work.js';
import { EventsService } from '../events/index.js';
import { ORDER_COMPLIMENTS_REPOSITORY, type ComplimentRecord, type OrderComplimentsRepository } from './compliments.repository.js';
import { ORDERS_TRIPS, OrdersService, type OrdersTripsPort } from './orders.service.js';

/** The event the notify module turns into «زينب قالتلك: سريع، مؤدب» for the courier. */
export const ORDER_COMPLIMENTED_EVENT = 'order.complimented';

/**
 * «شنو عجبك بـ حيدر؟» (joy l4, docs/api/compliments-and-live.md): one-tap kind words for the courier
 * or driver after a good rating. Asked when the orderer rated the delivery ≥ `minRating`, the order
 * reached him (delivered / closed / completed), a courier carried it, and within `windowHours` of
 * delivery. Words come from the order type's own set (presets only, never free text). One set per
 * order: a replay — even with other words — returns the first. No money; the tip flow is separate.
 */
@Injectable()
export class OrderComplimentsService {
  private readonly lock: DistributedKeyedLock;

  constructor(
    private readonly orders: OrdersService,
    @Inject(ORDERS_TRIPS) private readonly trips: OrdersTripsPort,
    @Inject(ORDER_COMPLIMENTS_REPOSITORY) private readonly repo: OrderComplimentsRepository,
    private readonly events: EventsService,
    @Inject(CLOCK) private readonly clock: Clock,
    @Optional() uow?: UnitOfWork,
  ) {
    this.lock = new DistributedKeyedLock(uow, 'orders.compliment');
  }

  async options(customerId: string, orderId: string): Promise<ComplimentOffer> {
    const order = await this.orders.get(orderId);
    if (order.ordererId !== customerId) throw new DriverError('forbidden');
    const sent = await this.repo.forOrder(orderId);
    if (sent) return { orderId, offered: true, reason: null, keys: [...complimentKeysFor(order.type)], untilAt: complimentUntil(order), sent: { keys: sent.keys, at: sent.createdAt } };
    let reason = complimentReason(order, this.clock.now());
    if (!reason && !(await this.trips.courierOf(orderId))) reason = 'no_driver';
    return { orderId, offered: reason === null, reason, keys: reason === null ? [...complimentKeysFor(order.type)] : [], untilAt: reason === null ? complimentUntil(order) : null, sent: null };
  }

  async send(customerId: string, input: ComplimentInput): Promise<ComplimentResult> {
    return this.lock.run(input.orderId, async (tx) => {
      const order = await this.orders.get(input.orderId);
      if (order.ordererId !== customerId) throw new DriverError('forbidden');
      const prior = await this.repo.forOrder(order.id, tx);
      if (prior) return { orderId: order.id, keys: prior.keys, at: prior.createdAt };
      const allowed = complimentKeysFor(order.type);
      const keys = [...new Set(input.keys)];
      if (keys.length === 0 || keys.length > COMPLIMENT_RULES.maxKeys || keys.some((k) => !allowed.includes(k))) throw new DriverError('compliment_invalid');
      const now = this.clock.now();
      if (complimentReason(order, now)) throw new DriverError('compliment_not_offered');
      const courier = await this.trips.courierOf(order.id);
      if (!courier) throw new DriverError('compliment_not_offered');
      const row = await this.repo.create({ orderId: order.id, courierId: courier.courierId, customerId, orderType: order.type, keys, createdAt: now }, tx);
      await this.events.emit(
        tx,
        {
          type: ORDER_COMPLIMENTED_EVENT,
          actorId: customerId,
          occurredAt: now,
          orderId: order.id,
          tripId: courier.tripId,
          idempotencyKey: `compliment:${order.id}`,
          payload: OrderComplimentedPayload.parse({ customerId, courierId: courier.courierId, tripId: courier.tripId, keys: row.keys }),
        },
        // Its own aggregate: kind words change no order state.
        { name: 'compliment', id: order.id },
      );
      return { orderId: order.id, keys: row.keys, at: row.createdAt };
    });
  }

  /** A courier's compliments, newest first (Partner «كلام الزبائن», the shift summary). */
  forCourier(courierId: string, range?: { from?: Date | undefined; to?: Date | undefined }): Promise<ComplimentRecord[]> {
    return this.repo.forCourier(courierId, range);
  }

  /** «كلام الزبائن»: every word counted, and the latest ones with the order ticket (never who said it). */
  async courierView(courierId: string): Promise<CourierCompliments> {
    const rows = await this.repo.forCourier(courierId);
    return {
      customers: rows.length,
      counts: countCompliments(rows),
      recent: rows.slice(0, COURIER_COMPLIMENTS_RECENT).map((r) => ({ keys: r.keys, at: r.createdAt, ticket: orderTicketNumber(r.orderId), orderType: r.orderType })),
    };
  }

  /** This shift's words counted (the shift summary). */
  async countsBetween(courierId: string, from: Date, to: Date): Promise<Array<{ key: ComplimentKey; count: number }>> {
    return countCompliments(await this.repo.forCourier(courierId, { from, to }));
  }
}
