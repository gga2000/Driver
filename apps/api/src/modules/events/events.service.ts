import { Injectable } from '@nestjs/common';
import type { Event } from '@driver/contracts';

export type NewEvent = Omit<Event, 'id' | 'recordedAt'>;

export interface OutboxRow {
  id: string;
  aggregate: string;
  aggregateId: string;
  type: string;
  payload: Record<string, unknown>;
  status: 'pending' | 'published';
  createdAt: Date;
}

type Subscriber = (row: OutboxRow) => void;

/**
 * Append-only event log plus a transactional-outbox shaped publisher.
 * Every state change in any module goes through `emit`, which stores the actor event and
 * writes an outbox row. `drain` is what the BullMQ worker will call in Milestone 2.
 */
@Injectable()
export class EventsService {
  private readonly log: Event[] = [];
  private readonly outbox: OutboxRow[] = [];
  private readonly subscribers = new Map<string, Subscriber[]>();
  private seq = 0;

  emit(event: NewEvent, aggregate: { name: string; id: string }): Event {
    if (event.idempotencyKey) {
      const dup = this.log.find((e) => e.idempotencyKey === event.idempotencyKey);
      if (dup) return dup;
    }
    this.seq += 1;
    const stored: Event = Object.freeze({ ...event, id: `ev_${this.seq}`, recordedAt: new Date() });
    this.log.push(stored);
    this.outbox.push({
      id: `ob_${this.seq}`,
      aggregate: aggregate.name,
      aggregateId: aggregate.id,
      type: event.type,
      payload: { ...event.payload, actorId: event.actorId, occurredAt: event.occurredAt.toISOString() },
      status: 'pending',
      createdAt: stored.recordedAt,
    });
    return stored;
  }

  subscribe(type: string, fn: Subscriber): () => void {
    const list = this.subscribers.get(type) ?? [];
    list.push(fn);
    this.subscribers.set(type, list);
    return () => this.subscribers.set(type, (this.subscribers.get(type) ?? []).filter((s) => s !== fn));
  }

  /** Publishes pending outbox rows to subscribers in order; returns how many were published. */
  drain(): number {
    let n = 0;
    for (const row of this.outbox) {
      if (row.status !== 'pending') continue;
      for (const fn of this.subscribers.get(row.type) ?? []) fn(row);
      for (const fn of this.subscribers.get('*') ?? []) fn(row);
      row.status = 'published';
      n += 1;
    }
    return n;
  }

  forActor(actorId: string): Event[] {
    return this.log.filter((e) => e.actorId === actorId);
  }

  forTrip(tripId: string): Event[] {
    return this.log.filter((e) => e.tripId === tripId);
  }

  pendingOutbox(): number {
    return this.outbox.filter((r) => r.status === 'pending').length;
  }
}
