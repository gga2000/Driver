import type { LatLng } from '@driver/contracts';
import type { Tx } from '../../shared/db/unit-of-work.js';
import type { EventsService } from '../events/index.js';

/**
 * The routes module's only path to the event log: the transactional `EventsService.emit(tx, …)`.
 * Ledger-facing events (`seat.completed`, `seat.no_show`, `seat.late_meter_settled`,
 * `departure.cancelled`, and the request board's `order.closed` / `order.cancelled` ride facts) carry
 * their shared-contract payloads, encoded by the service before they get here; the ledger's
 * subscribers post them. Everything else is a notification or Console fact.
 */
export interface RoutesDomainEvent {
  type: string;
  actorId: string;
  occurredAt: Date;
  location?: LatLng;
  payload: Record<string, unknown>;
  idempotencyKey?: string;
}

export interface RoutesEventEmitter {
  emit(
    tx: Tx | undefined,
    event: RoutesDomainEvent,
    aggregate: { name: string; id: string },
  ): Promise<void>;
}

export const ROUTES_EVENTS = Symbol('ROUTES_EVENTS');

export class EventsServiceAdapter implements RoutesEventEmitter {
  constructor(private readonly events: Pick<EventsService, 'emit'>) {}

  async emit(
    tx: Tx | undefined,
    event: RoutesDomainEvent,
    aggregate: { name: string; id: string },
  ): Promise<void> {
    await this.events.emit(tx, event, aggregate);
  }
}

export type RecordedRoutesEvent = RoutesDomainEvent & { aggregate: { name: string; id: string } };

/** Test double: keeps every emitted event in order. */
export class RecordingRoutesEvents implements RoutesEventEmitter {
  readonly events: RecordedRoutesEvent[] = [];

  async emit(
    _tx: Tx | undefined,
    event: RoutesDomainEvent,
    aggregate: { name: string; id: string },
  ): Promise<void> {
    if (event.idempotencyKey && this.events.some((e) => e.idempotencyKey === event.idempotencyKey))
      return;
    this.events.push({ ...event, aggregate });
  }

  types(): string[] {
    return this.events.map((e) => e.type);
  }

  ofType(type: string): RecordedRoutesEvent[] {
    return this.events.filter((e) => e.type === type);
  }

  last(type: string): RecordedRoutesEvent | undefined {
    return [...this.events].reverse().find((e) => e.type === type);
  }
}
