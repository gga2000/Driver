import type { Event } from '@driver/contracts';
import type { Tx } from '../../shared/db/unit-of-work.js';
import type { EventsService, PublishedEvent } from '../events/index.js';

/**
 * The ledger's only contact with the events module: the transactional `EventsService.emit(tx, …)`
 * and named, idempotent subscribers in the events registry (`ledger:<event type>`). A handler's
 * postings and its delivery record commit in one transaction, so a redelivered event posts nothing;
 * a throwing handler is retried with backoff by the outbox publisher. Quarantined late replays are
 * never delivered here (edge-case §10: never settled).
 */
export type LedgerHandler = (payload: Record<string, unknown>, meta: { eventId?: string; type: string }) => Promise<void>;

export interface LedgerEventBus {
  emit(tx: Tx | undefined, event: Omit<Event, 'id' | 'recordedAt'>, aggregate: { name: string; id: string }): Promise<Event>;
  /** Registers a named handler for one event type. */
  subscribe(name: string, type: string, handler: LedgerHandler): void;
}

/**
 * The payload a ledger handler parses: the producer's payload with the envelope's actor, device
 * time and top-level trip/order ids underneath (payload keys win). Dates arrive as ISO strings,
 * as they would off the wire.
 */
export function ledgerPayload(e: PublishedEvent): Record<string, unknown> {
  return {
    actorId: e.actorId,
    occurredAt: e.occurredAt.toISOString(),
    ...(e.tripId ? { tripId: e.tripId } : {}),
    ...(e.orderId ? { orderId: e.orderId } : {}),
    ...e.payload,
  };
}

export class EventsServiceLedgerBus implements LedgerEventBus {
  constructor(private readonly events: Pick<EventsService, 'emit' | 'subscribe'>) {}

  emit(tx: Tx | undefined, event: Omit<Event, 'id' | 'recordedAt'>, aggregate: { name: string; id: string }): Promise<Event> {
    return this.events.emit(tx, event, aggregate);
  }

  subscribe(name: string, type: string, handler: LedgerHandler): void {
    this.events.subscribe(name, [type], (e) => handler(ledgerPayload(e), { eventId: e.id, type: e.type }));
  }
}

/** Test double: records emitted events and lets tests publish to the registered handlers, awaited. */
export class RecordingLedgerBus implements LedgerEventBus {
  readonly emitted: Array<Omit<Event, 'id' | 'recordedAt' | 'aggregate'> & { aggregate: { name: string; id: string } }> = [];
  readonly handlers = new Map<string, Array<{ name: string; handler: LedgerHandler }>>();
  private seq = 0;

  async emit(_tx: Tx | undefined, event: Omit<Event, 'id' | 'recordedAt'>, aggregate: { name: string; id: string }): Promise<Event> {
    this.emitted.push({ ...event, aggregate });
    this.seq += 1;
    return { ...event, id: `ev_${this.seq}`, recordedAt: event.occurredAt };
  }

  subscribe(name: string, type: string, handler: LedgerHandler): void {
    const list = this.handlers.get(type) ?? [];
    list.push({ name, handler });
    this.handlers.set(type, list);
  }

  async publish(type: string, payload: Record<string, unknown>): Promise<void> {
    for (const { handler } of this.handlers.get(type) ?? []) await handler(payload, { type });
  }

  types(): string[] {
    return this.emitted.map((e) => e.type);
  }

  last(type: string) {
    return [...this.emitted].reverse().find((e) => e.type === type);
  }
}
