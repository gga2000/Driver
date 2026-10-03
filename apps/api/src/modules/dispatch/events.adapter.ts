import type { Event } from '@driver/contracts';
import type { Tx } from '../../shared/db/unit-of-work.js';
import type { EventsService } from '../events/index.js';

/**
 * The only place dispatch touches the events module. Thin adapter over the current
 * `emit(event, aggregate)` signature.
 *
 * TODO(M2 Step 3 merge): once `EventsService.emit(tx, event, aggregate)` lands (transactional
 * outbox), replace the body with a direct call. Dispatch already passes the `tx` it is inside.
 */
export interface DispatchEventEmitter {
  emit(tx: Tx | undefined, event: Omit<Event, 'id' | 'recordedAt'>, aggregate: { name: string; id: string }): Promise<Event>;
}

export class EventsServiceAdapter implements DispatchEventEmitter {
  constructor(private readonly events: Pick<EventsService, 'emit'>) {}

  async emit(_tx: Tx | undefined, event: Omit<Event, 'id' | 'recordedAt'>, aggregate: { name: string; id: string }): Promise<Event> {
    return this.events.emit(event, aggregate);
  }
}

/** Test double: keeps every emitted event in order. */
export class RecordingEventEmitter implements DispatchEventEmitter {
  readonly events: Array<Omit<Event, 'id' | 'recordedAt'> & { aggregate: { name: string; id: string } }> = [];
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
