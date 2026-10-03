import type { Tx } from '../../shared/db/unit-of-work.js';
import type { EventsService, PublishedEvent } from '../events/index.js';

/**
 * The orders module's only path to the event log, plus its subscription to trip events: a direct
 * call to the transactional `EventsService.emit(tx, event, aggregate)` (top-level `orderId`), and
 * one named, idempotent subscriber (`ORDERS_TRIP_SUBSCRIBER`) in the events registry.
 */
export interface OrderDomainEvent {
  type: string;
  actorId: string;
  occurredAt: Date;
  orderId: string;
  tripId?: string;
  payload: Record<string, unknown>;
  idempotencyKey?: string;
}

export interface OrderEventEmitter {
  emit(tx: Tx | undefined, event: OrderDomainEvent, aggregate: { name: string; id: string }): Promise<void>;
}

export const ORDER_EVENTS = Symbol('ORDER_EVENTS');

/** A trip event as the orders module consumes it (from the outbox). */
export interface TripEventEnvelope {
  type: string;
  tripId: string;
  actorId: string;
  occurredAt: Date;
  orderId?: string;
  payload: Record<string, unknown>;
}

/** Subscriber name, and so the dedupe key in `subscriber_deliveries`. */
export const ORDERS_TRIP_SUBSCRIBER = 'orders:trip-events';

/** A published trip-aggregate event as the orders module consumes it. */
export function toTripEnvelope(e: PublishedEvent): TripEventEnvelope {
  return {
    type: e.type,
    tripId: e.tripId ?? e.aggregateId,
    actorId: e.actorId,
    occurredAt: e.occurredAt,
    ...(e.orderId ? { orderId: e.orderId } : {}),
    payload: e.payload,
  };
}

export class EventsServiceAdapter implements OrderEventEmitter {
  constructor(private readonly events: Pick<EventsService, 'emit' | 'subscribe'>) {}

  async emit(tx: Tx | undefined, event: OrderDomainEvent, aggregate: { name: string; id: string }): Promise<void> {
    await this.events.emit(tx, event, aggregate);
  }

  /**
   * Delivers published trip/stop events (aggregate `trip`) to `handler` through the outbox. A
   * throwing handler is retried with backoff; once it succeeds the delivery is recorded and a
   * redelivery skips it. Quarantined late replays never arrive here.
   */
  subscribeToTrips(handler: (e: TripEventEnvelope) => Promise<unknown>): () => void {
    return this.events.subscribe(ORDERS_TRIP_SUBSCRIBER, '*', async (e) => {
      if (e.aggregate !== 'trip') return;
      await handler(toTripEnvelope(e));
    });
  }
}

/** Test double: keeps every emitted event in order. */
export class RecordingOrderEvents implements OrderEventEmitter {
  readonly events: Array<OrderDomainEvent & { aggregate: { name: string; id: string } }> = [];

  async emit(_tx: Tx | undefined, event: OrderDomainEvent, aggregate: { name: string; id: string }): Promise<void> {
    if (event.idempotencyKey && this.events.some((e) => e.idempotencyKey === event.idempotencyKey)) return;
    this.events.push({ ...event, aggregate });
  }

  types(orderId?: string): string[] {
    return this.events.filter((e) => !orderId || e.orderId === orderId).map((e) => e.type);
  }

  ofType(type: string) {
    return this.events.filter((e) => e.type === type);
  }

  last(type: string) {
    return [...this.events].reverse().find((e) => e.type === type);
  }
}
