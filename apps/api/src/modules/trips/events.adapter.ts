import type { LatLng } from '@driver/contracts';
import type { Tx } from '../../shared/db/unit-of-work.js';
import type { EventsService } from '../events/index.js';

/**
 * The trips module's only path to the event log, kept to this one file on purpose.
 *
 * TODO(M2 Step 3 merge): once `EventsService.emit(tx, event, aggregate)` lands (transactional
 * outbox, top-level `orderId` / `deviceUptimeMs`, late-replay quarantine), make
 * `EventsServiceAdapter.emit` a direct call and drop the payload folding below. Callers already
 * pass the `tx` they are inside, so nothing else changes.
 */
export interface TripDomainEvent {
  type: string;
  actorId: string;
  /** Device wall time when the driver's phone recorded it; server time otherwise. */
  occurredAt: Date;
  tripId?: string;
  orderId?: string;
  location?: LatLng;
  payload: Record<string, unknown>;
  idempotencyKey?: string;
  deviceUptimeMs?: number;
}

export interface TripEventEmitter {
  emit(tx: Tx | undefined, event: TripDomainEvent, aggregate: { name: string; id: string }): Promise<void>;
}

export const TRIP_EVENTS = Symbol('TRIP_EVENTS');

export class EventsServiceAdapter implements TripEventEmitter {
  constructor(private readonly events: Pick<EventsService, 'emit'>) {}

  async emit(_tx: Tx | undefined, event: TripDomainEvent, aggregate: { name: string; id: string }): Promise<void> {
    const { orderId, deviceUptimeMs, payload, ...rest } = event;
    this.events.emit(
      {
        ...rest,
        payload: { ...payload, ...(orderId !== undefined ? { orderId } : {}), ...(deviceUptimeMs !== undefined ? { deviceUptimeMs } : {}) },
      },
      aggregate,
    );
  }
}

/** Test double: keeps every emitted event in order and can forward them to listeners (a fake outbox). */
export class RecordingTripEvents implements TripEventEmitter {
  readonly events: Array<TripDomainEvent & { aggregate: { name: string; id: string } }> = [];
  private readonly listeners: Array<(e: TripDomainEvent & { aggregate: { name: string; id: string } }) => Promise<void> | void> = [];
  private delivered = 0;

  async emit(_tx: Tx | undefined, event: TripDomainEvent, aggregate: { name: string; id: string }): Promise<void> {
    if (event.idempotencyKey && this.events.some((e) => e.idempotencyKey === event.idempotencyKey)) return;
    this.events.push({ ...event, aggregate });
  }

  onEvent(fn: (e: TripDomainEvent & { aggregate: { name: string; id: string } }) => Promise<void> | void): void {
    this.listeners.push(fn);
  }

  /** Delivers everything emitted since the last call, in order (like the outbox publisher). */
  async deliver(): Promise<number> {
    let n = 0;
    while (this.delivered < this.events.length) {
      const e = this.events[this.delivered]!;
      this.delivered += 1;
      for (const fn of this.listeners) await fn(e);
      n += 1;
    }
    return n;
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
