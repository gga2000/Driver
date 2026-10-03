import type { EventsRepository } from './events.repository.js';
import type { Aggregate, NewEvent, PublishedEvent, StoredEvent } from './events.types.js';
import type { Tx } from '../../shared/db/unit-of-work.js';
import type { Clock } from '../../shared/clock.js';
import { isDeviceRecorded } from './timestamps.js';

export const CONTRADICTION_SUBSCRIBER = 'events:contradiction-detector';
export const CONTRADICTION_ACTOR = 'system:events';
const WATCHED_AGGREGATES = new Set(['trip', 'order']);

interface Emitter {
  emit(tx: Tx | undefined, event: NewEvent, aggregate: Aggregate): Promise<StoredEvent>;
}

/**
 * Offline contradictions (domain §6, architecture §2.3). A device-recorded event on a trip or an
 * order (trip.*, stop.*, order.* …) whose `occurredAt` is older than the aggregate's last state
 * change made by someone else — e.g. the driver's offline "delivered" at 10:02 replayed after the
 * dispatcher cancelled at 10:05 — opens a dispute referencing both events. Nothing is rewritten:
 * both events stand and support decides.
 */
export class ContradictionDetector {
  constructor(
    private readonly repo: EventsRepository,
    private readonly events: Emitter,
    private readonly clock: Clock,
  ) {}

  /** The subscriber body; returns the dispute it opened, if any. */
  async check(e: PublishedEvent, tx: Tx): Promise<StoredEvent | null> {
    if (e.quarantined || !WATCHED_AGGREGATES.has(e.aggregate) || e.type.startsWith('dispute.')) return null;
    if (!isDeviceRecorded(e)) return null;
    const prior = await this.repo.find({ aggregate: { name: e.aggregate, id: e.aggregateId }, before: e }, tx);
    const last = [...prior]
      .reverse()
      .find((p) => !p.quarantined && p.actorId !== e.actorId && !p.type.startsWith('dispute.') && p.occurredAt.getTime() > e.occurredAt.getTime());
    if (!last) return null;
    return this.events.emit(
      tx,
      {
        type: 'dispute.opened',
        actorId: CONTRADICTION_ACTOR,
        occurredAt: this.clock.now(),
        ...(e.tripId ? { tripId: e.tripId } : {}),
        ...(e.orderId ? { orderId: e.orderId } : {}),
        payload: {
          reason: 'offline_contradiction',
          aggregate: e.aggregate,
          aggregateId: e.aggregateId,
          eventId: e.id,
          eventType: e.type,
          eventActorId: e.actorId,
          eventOccurredAt: e.occurredAt.toISOString(),
          contradictsEventId: last.id,
          contradictsType: last.type,
          contradictsActorId: last.actorId,
          contradictsOccurredAt: last.occurredAt.toISOString(),
        },
        idempotencyKey: `dispute.contradiction:${e.id}`,
      },
      { name: 'dispute', id: `contradiction:${e.id}` },
    );
  }
}
