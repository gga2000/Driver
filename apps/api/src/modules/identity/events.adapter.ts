import type { Event } from '@driver/contracts';
import type { Tx } from '../../shared/db/unit-of-work.js';
import type { EventsService } from '../events/index.js';

/**
 * Identity's only path to the event log: a direct call to the transactional
 * `EventsService.emit(tx, event, aggregate)`, so the event and its outbox row commit with the
 * identity rows written in the same `tx`. The interface exists so unit tests can record instead.
 */
export interface IdentityEventEmitter {
  emit(tx: Tx | undefined, event: Omit<Event, 'id' | 'recordedAt'>, aggregate: { name: string; id: string }): Promise<Event>;
}

export class EventsServiceAdapter implements IdentityEventEmitter {
  constructor(private readonly events: Pick<EventsService, 'emit'>) {}

  emit(tx: Tx | undefined, event: Omit<Event, 'id' | 'recordedAt'>, aggregate: { name: string; id: string }): Promise<Event> {
    return this.events.emit(tx, event, aggregate);
  }
}

/** Test double: keeps every emitted event in order. */
export class RecordingEventEmitter implements IdentityEventEmitter {
  readonly events: Array<Omit<Event, 'id' | 'recordedAt' | 'aggregate'> & { aggregate: { name: string; id: string } }> = [];
  private seq = 0;

  async emit(_tx: Tx | undefined, event: Omit<Event, 'id' | 'recordedAt'>, aggregate: { name: string; id: string }): Promise<Event> {
    this.events.push({ ...event, aggregate });
    this.seq += 1;
    return { ...event, id: `ev_${this.seq}`, recordedAt: event.occurredAt };
  }

  types(): string[] {
    return this.events.map((e) => e.type);
  }

  last(type: string) {
    return [...this.events].reverse().find((e) => e.type === type);
  }
}

export const IDENTITY_EVENTS = Symbol('IDENTITY_EVENTS');
