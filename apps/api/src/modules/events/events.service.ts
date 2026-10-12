import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { MONEY_ALARM_PENDING_SEC, OUTBOX_REQUEUE_MAX } from '@driver/contracts';
import { CLOCK, type Clock } from '../../shared/clock.js';
import { UnitOfWork, afterCommit, type Tx } from '../../shared/db/unit-of-work.js';
import { EVENTS_REPOSITORY, newId, type EventsRepository, type OutboxRequeueSelect } from './events.repository.js';
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

/** The ledger names its outbox subscribers `ledger:<event type>` (ledger.subscribers.ts). */
export const LEDGER_SUBSCRIBER_PREFIX = 'ledger:';

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

  /**
   * A person's events, in recording order (indexed `actor_id`). `from` bounds `occurredAt`
   * (inclusive) and `types` narrows them, on the (actor_id, occurred_at) index.
   */
  forActor(actorId: string, opts: { from?: Date; types?: readonly string[] } = {}): Promise<StoredEvent[]> {
    return this.repo.find({ actorId, ...(opts.from ? { from: opts.from } : {}), ...(opts.types ? { types: opts.types } : {}) });
  }

  /** When the person's first event happened, or null when he has none (one index read). */
  firstActivityOf(actorId: string): Promise<Date | null> {
    return this.repo.firstOccurredAt(actorId);
  }

  /** How many of the person's events have one of `types`, counting no further than `cap`. */
  countForActor(actorId: string, types: readonly string[], cap: number): Promise<number> {
    return this.repo.countUpTo(actorId, types, cap);
  }

  forTrip(tripId: string): Promise<StoredEvent[]> {
    return this.repo.find({ tripId });
  }

  forOrder(orderId: string): Promise<StoredEvent[]> {
    return this.repo.find({ orderId });
  }

  /**
   * Events of several orders (indexed `order_id`), in recording order; `types` narrows them. An
   * empty id list reads nothing.
   */
  async forOrders(orderIds: readonly string[], opts: { types?: readonly string[] } = {}): Promise<StoredEvent[]> {
    if (orderIds.length === 0) return [];
    return this.repo.find({ orderIds, ...(opts.types ? { types: opts.types } : {}) });
  }

  /**
   * Events of one aggregate (`merchant`/`org_1`…), in recording order. `from`/`to` bound
   * `occurredAt` (from inclusive, to exclusive) and `types` narrows them, on the
   * (aggregate, aggregate_id, occurred_at) index.
   */
  forAggregate(name: string, id: string, opts: { from?: Date; to?: Date; types?: readonly string[] } = {}): Promise<StoredEvent[]> {
    return this.repo.find({
      aggregate: { name, id },
      ...(opts.from ? { from: opts.from } : {}),
      ...(opts.to ? { to: opts.to } : {}),
      ...(opts.types ? { types: opts.types } : {}),
    });
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

  /**
   * Admin re-drive (Console System page): failed rows back to pending with attempts reset, inside
   * `tx` when given so the caller's audit row commits with it; the drain is poked after the commit.
   * A subscriber that already delivered a row is skipped on the retry (its delivery record).
   */
  async requeueFailedOutbox(select: OutboxRequeueSelect, tx?: Tx): Promise<string[]> {
    const ids = await this.repo.requeueFailed(select, this.clock.now(), OUTBOX_REQUEUE_MAX, tx);
    if (ids.length > 0) {
      if (tx) await this.pokeAfterCommit(tx);
      else await this.publisher.poke();
    }
    return ids;
  }

  /**
   * Money stuck in the outbox: failed rows a ledger subscriber never posted, and how long the oldest
   * pending row of a type a ledger subscriber takes has waited (a slow push or SMS row is not money). Either one (any failed, or older than 2 min) is the money alarm.
   */
  async moneyAlarm(): Promise<{ ledgerFailed: number; oldestPendingSec: number; alarm: boolean }> {
    const stuck = await this.repo.stuckFor(LEDGER_SUBSCRIBER_PREFIX, this.registry.typesFor(LEDGER_SUBSCRIBER_PREFIX));
    const oldestPendingSec = stuck.oldestPendingAt ? Math.max(0, Math.floor((this.clock.now().getTime() - stuck.oldestPendingAt.getTime()) / 1000)) : 0;
    return { ledgerFailed: stuck.failed, oldestPendingSec, alarm: stuck.failed > 0 || oldestPendingSec > MONEY_ALARM_PENDING_SEC };
  }

  /**
   * Drains everything due now (tests, the simulator, a Console "drain" button), waiting for a drain
   * already running to finish first, so a caller never sees an event its commit wrote still undelivered.
   */
  drain(): Promise<number> {
    return this.publisher.drainAll();
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
