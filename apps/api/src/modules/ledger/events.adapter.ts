import { Logger } from '@nestjs/common';
import type { Event } from '@driver/contracts';
import type { Tx } from '../../shared/db/unit-of-work.js';
import type { EventsService } from '../events/index.js';

/**
 * The ledger's only contact with the events module (copy of the identity adapter pattern).
 *
 * TODO(M2 Step 3 merge): when `EventsService.emit(tx, event, aggregate)` (transactional outbox) and
 * the named, idempotent subscriber registry land, replace both bodies with direct calls and delete
 * this file. Ledger services already pass the `tx` they are inside and register named handlers.
 */
export type LedgerHandler = (payload: Record<string, unknown>, meta: { eventId?: string; type: string }) => Promise<void>;

export interface LedgerEventBus {
  emit(tx: Tx | undefined, event: Omit<Event, 'id' | 'recordedAt'>, aggregate: { name: string; id: string }): Promise<Event>;
  /** Registers a named handler for one event type. */
  subscribe(name: string, type: string, handler: LedgerHandler): void;
}

export class EventsServiceLedgerBus implements LedgerEventBus {
  private readonly logger = new Logger('LedgerEvents');

  constructor(private readonly events: Pick<EventsService, 'emit' | 'subscribe'>) {}

  async emit(_tx: Tx | undefined, event: Omit<Event, 'id' | 'recordedAt'>, aggregate: { name: string; id: string }): Promise<Event> {
    return this.events.emit(event, aggregate);
  }

  subscribe(name: string, type: string, handler: LedgerHandler): void {
    // The M1 bus delivers synchronously from `drain()`; the handler's promise is awaited by nobody,
    // so failures are logged here. Step 3's registry retries with backoff instead.
    this.events.subscribe(type, (row) => {
      handler(row.payload, { eventId: row.id, type: row.type }).catch((err: unknown) =>
        this.logger.error(`${name} failed on ${row.type} ${row.id}: ${(err as Error).message}`, (err as Error).stack),
      );
    });
  }
}

/** Test double: records emitted events and lets tests publish to the registered handlers, awaited. */
export class RecordingLedgerBus implements LedgerEventBus {
  readonly emitted: Array<Omit<Event, 'id' | 'recordedAt'> & { aggregate: { name: string; id: string } }> = [];
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
