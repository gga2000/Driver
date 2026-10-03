import type { Event } from '@driver/contracts';
import type { Tx } from '../../shared/db/unit-of-work.js';
import type { EventsService } from '../events/index.js';

/**
 * The only place dispatch touches the events module: a direct call to the transactional
 * `EventsService.emit(tx, event, aggregate)` with the `tx` dispatch is inside. The interface exists
 * so unit tests can record instead.
 */
export interface DispatchEventEmitter {
  emit(tx: Tx | undefined, event: Omit<Event, 'id' | 'recordedAt'>, aggregate: { name: string; id: string }): Promise<Event>;
}

export class EventsServiceAdapter implements DispatchEventEmitter {
  constructor(private readonly events: Pick<EventsService, 'emit'>) {}

  emit(tx: Tx | undefined, event: Omit<Event, 'id' | 'recordedAt'>, aggregate: { name: string; id: string }): Promise<Event> {
    return this.events.emit(tx, event, aggregate);
  }
}

/** Test double: keeps every emitted event in order. */
export class RecordingEventEmitter implements DispatchEventEmitter {
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

  ofType(type: string) {
    return this.events.filter((e) => e.type === type);
  }

  last(type: string) {
    return [...this.events].reverse().find((e) => e.type === type);
  }
}

export const DISPATCH_EVENTS = Symbol('DISPATCH_EVENTS');
