import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { CLOCK, type Clock } from '../../shared/clock.js';
import { UnitOfWork, afterCommit, type Tx } from '../../shared/db/unit-of-work.js';
import { EVENTS_REPOSITORY, newId, type EventsRepository } from './events.repository.js';
import type { Aggregate, EventHandler, NewEvent, OutboxFailure, OutboxStats, StoredEvent } from './events.types.js';
import { OutboxPublisher } from './outbox.publisher.js';
import { SubscriberRegistry, type SubscribeOptions } from './subscriber.registry.js';
import { assessSkew, isLateReplay } from './timestamps.js';

/**
 * The read model the trips module provides for late-replay quarantine. Structural copy of trips'
 * `TripOrderLookup`: the events module cannot import trips (trips imports events), so it resolves
 * the provider by the registered symbol trips binds it to.
 */
export interface TripOrderDetachments {
  /** `detached_at` of the latest attachment of `orderId` to `tripId`; null while attached or unknown. */
  detachedAt(tripId: string, orderId: string): Promise<Date | null>;
}

export const TRIP_ORDER_LOOKUP_TOKEN = Symbol.for('driver.trips.TripOrderLookup');

/**
 * Append-only actor event log and transactional outbox (plan Step 3, architecture §2).
 *
 * `emit(tx, event, aggregate)` writes the `events` row and its `outbox` row in the caller's
 * transaction — both commit with the aggregate change or neither does. Nothing is published
 * inline: after the commit the outbox publisher is poked and delivers to named subscribers.
 *
 * On receipt the server stamps `recordedAt`, flags device skew, and quarantines late offline
 * replays (`late_replay`) so they are kept for support and never reach settlement.
 */
@Injectable()
export class EventsService {
  private readonly logger = new Logger(EventsService.name);
  private tripOrders: TripOrderDetachments | null | undefined;
  private readonly poked = new WeakSet<object>();

  constructor(
    @Inject(EVENTS_REPOSITORY) private readonly repo: EventsRepository,
    readonly registry: SubscriberRegistry,
    readonly publisher: OutboxPublisher,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly uow: UnitOfWork,
    @Optional() private readonly moduleRef?: ModuleRef,
  ) {}

  /** Binds the trip/order detachment lookup explicitly (tests, the simulator). */
  useTripOrderLookup(lookup: TripOrderDetachments | null): void {
    this.tripOrders = lookup;
  }

  /**
   * Records `event` for `aggregate` inside `tx` (or a transaction of its own when `tx` is
   * undefined). A repeated idempotency key returns the first event and writes nothing.
   */
  async emit(tx: Tx | undefined, event: NewEvent, aggregate: Aggregate): Promise<StoredEvent> {
    if (!tx) return this.uow.run((t) => this.emit(t, event, aggregate));
    if (event.idempotencyKey) {
      const existing = await this.repo.findByIdempotencyKey(event.idempotencyKey, tx);
      if (existing) return existing;
    }
    const recordedAt = this.clock.now();
    const skew = assessSkew(event.occurredAt, recordedAt);
    const lateReplay = await this.isLateReplay(event, recordedAt);
    const stored: StoredEvent = {
      id: newId('ev', recordedAt),
      type: event.type,
      actorId: event.actorId,
      occurredAt: event.occurredAt,
      recordedAt,
      aggregate: aggregate.name,
      aggregateId: aggregate.id,
      payload: event.payload ?? {},
      ...(event.tripId ? { tripId: event.tripId } : {}),
      ...(event.orderId ? { orderId: event.orderId } : {}),
      ...(event.location ? { location: event.location } : {}),
      ...(event.idempotencyKey ? { idempotencyKey: event.idempotencyKey } : {}),
      ...(event.deviceUptimeMs !== undefined ? { deviceUptimeMs: event.deviceUptimeMs } : {}),
      skewMs: skew.skewMs,
      flagged: skew.flagged,
      ...(skew.flagReason ? { flagReason: skew.flagReason } : {}),
      quarantined: lateReplay,
      ...(lateReplay ? { quarantineReason: 'late_replay' } : {}),
    };
    const { event: saved, inserted } = await this.repo.insert(stored, tx);
    if (inserted) await this.pokeAfterCommit(tx);
    return saved;
  }

  /** Registers a named, idempotent subscriber (see `SubscriberRegistry`). */
  subscribe(name: string, types: readonly string[] | '*', handler: EventHandler, opts?: SubscribeOptions): () => void {
    return this.registry.subscribe(name, types, handler, opts);
  }

  forActor(actorId: string): Promise<StoredEvent[]> {
    return this.repo.find({ actorId });
  }

  forTrip(tripId: string): Promise<StoredEvent[]> {
    return this.repo.find({ tripId });
  }

  forOrder(orderId: string): Promise<StoredEvent[]> {
    return this.repo.find({ orderId });
  }

  /** Events of one aggregate (`merchant`/`org_1`…), in recording order. */
  forAggregate(name: string, id: string): Promise<StoredEvent[]> {
    return this.repo.find({ aggregate: { name, id } });
  }

  async pendingOutbox(): Promise<number> {
    return (await this.repo.outboxStats()).pending;
  }

  outboxStats(): Promise<OutboxStats> {
    return this.repo.outboxStats();
  }

  /** The most recent failed outbox rows, newest first (Console system page). */
  async recentFailedOutbox(limit = 20): Promise<OutboxFailure[]> {
    const rows = await this.repo.outbox({ status: 'failed', newestFirst: true, limit });
    return rows.map((r) => ({
      id: r.id,
      eventId: r.eventId,
      type: r.type,
      aggregate: r.aggregate,
      aggregateId: r.aggregateId,
      attempts: r.attempts,
      lastError: r.lastError ?? null,
      createdAt: r.createdAt,
    }));
  }

  /** Drains everything due now (tests, the simulator, a Console "drain" button). */
  drain(): Promise<number> {
    return this.publisher.drainUntilIdle();
  }

  // ───────────────────────── internals ─────────────────────────

  /** One poke per transaction, after it commits; immediately when `tx` is not a managed transaction. */
  private async pokeAfterCommit(tx: Tx): Promise<void> {
    if (this.poked.has(tx as object)) return;
    if (afterCommit(tx, () => this.publisher.poke())) {
      this.poked.add(tx as object);
      return;
    }
    await this.publisher.poke();
  }

  private async isLateReplay(event: NewEvent, recordedAt: Date): Promise<boolean> {
    if (!event.tripId || !event.orderId) return false;
    const lookup = this.lookup();
    if (!lookup) return false;
    return isLateReplay(event, recordedAt, await lookup.detachedAt(event.tripId, event.orderId));
  }

  private lookup(): TripOrderDetachments | null {
    if (this.tripOrders !== undefined) return this.tripOrders;
    if (!this.moduleRef) return null;
    try {
      this.tripOrders = this.moduleRef.get<TripOrderDetachments>(TRIP_ORDER_LOOKUP_TOKEN, { strict: false });
    } catch {
      this.logger.debug('no TripOrderLookup bound yet; late-replay quarantine inactive');
      return null;
    }
    return this.tripOrders;
  }
}
