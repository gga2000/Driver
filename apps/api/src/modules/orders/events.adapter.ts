import type { Tx } from '../../shared/db/unit-of-work.js';
import type { EventsService, OutboxRow } from '../events/index.js';

/**
 * The orders module's only path to the event log, plus its subscription to trip events.
 *
 * TODO(M2 Step 3 merge): once `EventsService.emit(tx, event, aggregate)` lands, make `emit` a direct
 * call (top-level `orderId`, no payload folding), and register `subscribeToTrips` as a named,
 * idempotent subscriber in the new registry. Callers already pass their `tx`.
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

export class EventsServiceAdapter implements OrderEventEmitter {
  constructor(private readonly events: Pick<EventsService, 'emit' | 'subscribe'>) {}

  async emit(_tx: Tx | undefined, event: OrderDomainEvent, aggregate: { name: string; id: string }): Promise<void> {
    const { orderId, payload, ...rest } = event;
    this.events.emit({ ...rest, payload: { ...payload, orderId } }, aggregate);
  }

  /** Delivers published trip/stop events (aggregate `trip`) to `handler`. */
  subscribeToTrips(handler: (e: TripEventEnvelope) => Promise<unknown>): () => void {
    return this.events.subscribe('*', (row: OutboxRow) => {
      if (row.aggregate !== 'trip') return;
      const { actorId, occurredAt, orderId, ...payload } = row.payload as { actorId?: string; occurredAt?: string; orderId?: string } & Record<string, unknown>;
      void handler({
        type: row.type,
        tripId: row.aggregateId,
        actorId: actorId ?? 'system',
        occurredAt: occurredAt ? new Date(occurredAt) : row.createdAt,
        ...(orderId ? { orderId } : {}),
        payload,
      });
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
