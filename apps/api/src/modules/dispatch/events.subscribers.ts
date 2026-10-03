import { Logger } from '@nestjs/common';
import { z } from 'zod';
import { DeliveryPoint, DriverError, decodeDomainEvent, type LatLng, type OrderType, type VehicleClass, type Vertical } from '@driver/contracts';
import type { EventsService, PublishedEvent } from '../events/index.js';
import type { OfferOrchestrator } from './offer.orchestrator.js';
import type { TripOffersPort } from './ports.js';
import type { ZoneDirectory } from './zones.js';

/** Subscriber names, and so the dedupe keys in `subscriber_deliveries`. */
export const DISPATCH_AUTO_ASSIGN_SUBSCRIBER = 'dispatch:auto-assign';
export const DISPATCH_TRIP_SUBSCRIBER = 'dispatch:trip-events';
export const DISPATCH_REDISPATCH_SUBSCRIBER = 'dispatch:redispatch';
export const DISPATCH_READY_SUBSCRIBER = 'dispatch:order-ready';
export const DISPATCH_RIDE_SUBSCRIBER = 'dispatch:ride-request';

/** The ride part of `order.placed` (orders adds it for `type: 'ride'`). */
const RidePlaced = z.object({
  type: z.literal('ride'),
  cityId: z.string().min(1),
  paymentMethod: z.string(),
  totalIqd: z.number(),
  ride: z.object({ vertical: z.enum(['taxi', 'tuktuk']), pickup: DeliveryPoint.nullable(), dropoff: DeliveryPoint.nullable(), quoteId: z.string().nullable() }),
});

export const AUTO_ASSIGN_EVENTS = ['order.accepted', 'order.auto_accepted'] as const;
export const DISPATCH_TRIP_EVENTS = ['trip.accepted', 'trip.declined', 'trip.timed_out', 'trip.completed', 'trip.cancelled', 'stop.completed'] as const;

/** Merchant order types dispatch auto-assigns, and the vertical whose policy applies. */
const VERTICAL_OF: Partial<Record<OrderType, Vertical>> = { food: 'food', grocery_catalog: 'grocery' };

/**
 * How dispatch hears about the rest of the platform (plan Step 5, all through the outbox, all
 * idempotent):
 *
 * - `dispatch:auto-assign` on `order.accepted` / `order.auto_accepted` (the spec calls the state
 *   `merchant_accepted`; these are its domain §6 event names): builds the courier trip (pickup at
 *   the merchant, drop-off at the customer's point) and requests a courier timed to arrive 2 min
 *   before ready — the orchestrator starts at readyAt − (ETA + 2 min). A redelivery finds the live
 *   trip and the live request and changes nothing.
 * - `dispatch:redispatch` on `order.courier_unassigned` with `redispatch`: the courier's trip ended
 *   before pickup (taken off an unreachable courier, dropped, released): a new courier trip and a
 *   new request, timed to the promised ready time as on acceptance.
 * - `dispatch:ride-request` on `order.placed` for rides: builds the ride's trip and starts the
 *   taxi / tuktuk policy (smart broadcast), so a placed ride reaches drivers without a dispatcher.
 * - `dispatch:order-ready` on `order.ready`: a kitchen that finishes early starts the courier search
 *   now instead of at the timed start (the request moves its ready time to now).
 * - `dispatch:trip-events`: `trip.accepted` / `trip.declined` from the Partner app (or the echo of
 *   dispatch's own calls) settle the offer; `trip.timed_out` is the echo of dispatch's own timer
 *   (dispatch owns offer timers) and is ignored; `trip.completed` frees the courier (`jobFinished`);
 *   `trip.cancelled` withdraws offers and frees him (`cancel`); a completed pickup marks the job
 *   picked up for batching.
 */
export class DispatchSubscribers {
  private readonly logger = new Logger(DispatchSubscribers.name);

  constructor(
    private readonly orchestrator: OfferOrchestrator,
    private readonly trips: TripOffersPort,
    private readonly zones: ZoneDirectory,
  ) {}

  register(events: Pick<EventsService, 'subscribe'>): Array<() => void> {
    return [
      events.subscribe(DISPATCH_AUTO_ASSIGN_SUBSCRIBER, AUTO_ASSIGN_EVENTS, (e) => this.onOrderAccepted(e)),
      events.subscribe(DISPATCH_REDISPATCH_SUBSCRIBER, ['order.courier_unassigned'], (e) => this.onCourierUnassigned(e)),
      events.subscribe(DISPATCH_READY_SUBSCRIBER, ['order.ready'], (e) => this.onOrderReady(e)),
      events.subscribe(DISPATCH_RIDE_SUBSCRIBER, ['order.placed'], (e) => this.onRidePlaced(e)),
      events.subscribe(DISPATCH_TRIP_SUBSCRIBER, DISPATCH_TRIP_EVENTS, (e) => this.onTripEvent(e)),
    ];
  }

  async onOrderAccepted(e: Pick<PublishedEvent, 'type' | 'orderId' | 'aggregateId' | 'payload'>): Promise<void> {
    const p = decodeDomainEvent(e.type === 'order.auto_accepted' ? 'order.auto_accepted' : 'order.accepted', e.payload);
    await this.requestCourier(e.orderId ?? e.aggregateId, { ...p, readyAt: p.promisedReadyAt });
  }

  /**
   * The kitchen pressed "جاهز" before the promised time: a courier request still waiting for its
   * timed start (readyAt − ETA − 2 min) starts now, so the food does not sit on the counter.
   */
  async onOrderReady(e: Pick<PublishedEvent, 'orderId' | 'aggregateId'>): Promise<void> {
    const tripId = await this.trips.liveTripFor?.(e.orderId ?? e.aggregateId);
    if (tripId) await this.orchestrator.readyNow(tripId);
  }

  /**
   * A rider asked for a taxi / tuktuk: build the ride's trip (pickup → drop-off) and start the
   * vertical's policy (smart broadcast in waves). Food and other orders are ignored here. Idempotent:
   * a redelivery finds the live trip and the live request.
   */
  async onRidePlaced(e: Pick<PublishedEvent, 'orderId' | 'aggregateId' | 'payload'>): Promise<void> {
    const parsed = RidePlaced.safeParse(e.payload);
    if (!parsed.success || !this.trips.createRideTrip) return;
    const p = parsed.data;
    const orderId = e.orderId ?? e.aggregateId;
    const pickup = this.point(p.cityId, p.ride.pickup, orderId, 'pickup');
    const dropoff = this.point(p.cityId, p.ride.dropoff ?? p.ride.pickup, orderId, 'dropoff');
    const tripId = await this.trips.createRideTrip({ orderId, cityId: p.cityId, vertical: p.ride.vertical, pickup, dropoff, quoteId: p.ride.quoteId });
    await this.orchestrator.request({
      tripId,
      cityId: p.cityId,
      vertical: p.ride.vertical,
      zoneId: pickup.zoneKey,
      pickup: this.pin(p.cityId, pickup),
      dropoffZoneId: dropoff.zoneKey,
      cashIqd: p.paymentMethod === 'cash' ? p.totalIqd : 0,
    });
  }

  /** A courier trip ended before pickup and the order still needs one: build a new trip and request again. */
  async onCourierUnassigned(e: Pick<PublishedEvent, 'orderId' | 'aggregateId' | 'payload'>): Promise<void> {
    const p = decodeDomainEvent('order.courier_unassigned', e.payload);
    if (!p.redispatch) return;
    await this.requestCourier(e.orderId ?? e.aggregateId, { ...p, readyAt: p.promisedReadyAt ?? undefined });
  }

  /** Idempotent: an order already on a live trip keeps it, and a live request for that trip is returned as is. */
  private async requestCourier(
    orderId: string,
    p: { orderType: OrderType; cityId: string; pickup: DeliveryPoint | null; dropoff: DeliveryPoint | null; minVehicleClass: VehicleClass | null; paymentMethod: string; totalIqd: number; readyAt: Date | undefined },
  ): Promise<void> {
    const vertical = VERTICAL_OF[p.orderType];
    if (!vertical) return;
    const pickup = this.point(p.cityId, p.pickup, orderId, 'pickup');
    const dropoff = this.point(p.cityId, p.dropoff ?? p.pickup, orderId, 'dropoff');
    const tripId = await this.trips.createCourierTrip({ orderId, cityId: p.cityId, vertical, minVehicleClass: p.minVehicleClass, pickup, dropoff });
    await this.orchestrator.request({
      tripId,
      cityId: p.cityId,
      vertical,
      zoneId: pickup.zoneKey,
      pickup: this.pin(p.cityId, pickup),
      dropoffZoneId: dropoff.zoneKey,
      ...(p.readyAt ? { readyAt: p.readyAt } : {}),
      hot: vertical === 'food',
      minVehicleClass: p.minVehicleClass,
      cashIqd: p.paymentMethod === 'cash' ? p.totalIqd : 0,
    });
  }

  async onTripEvent(e: Pick<PublishedEvent, 'type' | 'tripId' | 'aggregateId' | 'actorId' | 'payload'>): Promise<void> {
    const tripId = e.tripId ?? e.aggregateId;
    switch (e.type) {
      case 'trip.accepted':
        return this.orchestrator.onTripAccepted(tripId, decodeDomainEvent('trip.accepted', e.payload).driverId);
      case 'trip.declined': {
        const p = decodeDomainEvent('trip.declined', e.payload);
        return this.orchestrator.onTripDeclined(tripId, p.driverId, { othersPendingOnTrip: p.othersPending });
      }
      case 'trip.completed':
        return this.orchestrator.jobFinished(tripId);
      case 'trip.cancelled':
        return this.orchestrator.cancel(tripId, e.actorId);
      case 'stop.completed': {
        const p = decodeDomainEvent('stop.completed', e.payload);
        if (p.stopType === 'pickup' || p.stopType === 'shop') await this.orchestrator.markPickedUp(tripId);
        return;
      }
      default:
        return; // trip.timed_out: the echo of dispatch's own offer timer
    }
  }

  /** A stop point with a zone dispatch knows; a missing place is anchored at the city's centre zone and logged. */
  private point(cityId: string, p: DeliveryPoint | null, orderId: string, what: string): DeliveryPoint {
    if (p) return p;
    const zoneKey = this.zones.defaultZone(cityId);
    if (!zoneKey) throw new DriverError('dispatch_not_found');
    this.logger.warn(`order ${orderId}: no ${what} point on file, anchored at zone ${zoneKey}`);
    return { zoneKey };
  }

  private pin(cityId: string, p: DeliveryPoint): LatLng | undefined {
    return p.pin ?? this.zones.centre(cityId, p.zoneKey) ?? this.zones.centre(cityId, this.zones.defaultZone(cityId) ?? '');
  }
}
