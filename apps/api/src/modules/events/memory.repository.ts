import { afterCommit, onRollback, type Tx } from '../../shared/db/unit-of-work.js';
import type { EventFilter, EventsRepository } from './events.repository.js';
import { newId } from './events.repository.js';
import type { OutboxPatch, OutboxRecord, OutboxStats, OutboxStatus, StoredEvent } from './events.types.js';

interface Delivery {
  outboxId: string;
  subscriber: string;
  deliveredAt: Date | null;
  attempts: number;
  lastError: string | null;
}

interface Staged {
  events: StoredEvent[];
  outbox: OutboxRecord[];
  delivered: Array<{ outboxId: string; subscriber: string; at: Date }>;
}

/**
 * In-memory twin of `PrismaEventsRepository` that honours the unit of work: writes made inside a
 * `UnitOfWork.run` transaction are staged and only become visible to other readers when it
 * commits; a rollback discards them (no event, no outbox row, no delivery record). Writes with no
 * managed transaction apply at once.
 *
 * `claimDue` simulates `FOR NO KEY UPDATE SKIP LOCKED`: rows are locked by the claiming drain until
 * its callback settles, and a concurrent drain skips them.
 */
export class InMemoryEventsRepository implements EventsRepository {
  private readonly events: StoredEvent[] = [];
  private readonly rows: OutboxRecord[] = [];
  private readonly deliveries = new Map<string, Delivery>();
  private readonly staged = new Map<object, Staged>();
  private readonly locked = new Set<string>();

  // ───────────────────────── staging ─────────────────────────

  private bucket(tx: Tx | undefined): Staged | null {
    if (!tx) return null;
    const existing = this.staged.get(tx as object);
    if (existing) return existing;
    const fresh: Staged = { events: [], outbox: [], delivered: [] };
    if (!afterCommit(tx, () => this.commit(tx as object))) return null; // unmanaged: apply now
    onRollback(tx, () => void this.staged.delete(tx as object));
    this.staged.set(tx as object, fresh);
    return fresh;
  }

  private commit(key: object): void {
    const s = this.staged.get(key);
    this.staged.delete(key);
    if (!s) return;
    for (const e of s.events) {
      // ON CONFLICT DO NOTHING against a concurrent transaction that committed the same key first.
      if (e.idempotencyKey && this.events.some((x) => x.idempotencyKey === e.idempotencyKey)) continue;
      this.events.push(e);
      const row = s.outbox.find((r) => r.eventId === e.id);
      if (row) this.rows.push(row);
    }
    for (const d of s.delivered) this.applyDelivered(d.outboxId, d.subscriber, d.at);
  }

  private visibleEvents(tx?: Tx): StoredEvent[] {
    const s = tx ? this.staged.get(tx as object) : undefined;
    return s ? [...this.events, ...s.events] : this.events;
  }

  // ───────────────────────── events ─────────────────────────

  async findByIdempotencyKey(key: string, tx?: Tx): Promise<StoredEvent | null> {
    return this.visibleEvents(tx).find((e) => e.idempotencyKey === key) ?? null;
  }

  async insert(event: StoredEvent, tx?: Tx): Promise<{ event: StoredEvent; inserted: boolean }> {
    if (event.idempotencyKey) {
      const dup = await this.findByIdempotencyKey(event.idempotencyKey, tx);
      if (dup) return { event: dup, inserted: false };
    }
    const row: OutboxRecord = {
      id: newId('ob', event.recordedAt),
      eventId: event.id,
      aggregate: event.aggregate,
      aggregateId: event.aggregateId,
      type: event.type,
      event,
      status: 'pending',
      attempts: 0,
      idempotencyKey: event.idempotencyKey,
      nextAttemptAt: event.recordedAt,
      createdAt: event.recordedAt,
    };
    const s = this.bucket(tx);
    if (s) {
      s.events.push(event);
      s.outbox.push(row);
    } else {
      this.events.push(event);
      this.rows.push(row);
    }
    return { event, inserted: true };
  }

  async find(filter: EventFilter, tx?: Tx): Promise<StoredEvent[]> {
    const all = this.visibleEvents(tx);
    const stop = filter.before ? all.findIndex((e) => e.id === filter.before!.id) : -1;
    const scope = stop >= 0 ? all.slice(0, stop) : all;
    return scope.filter(
      (e) =>
        (!filter.actorId || e.actorId === filter.actorId) &&
        (!filter.tripId || e.tripId === filter.tripId) &&
        (!filter.orderId || e.orderId === filter.orderId) &&
        (!filter.aggregate || (e.aggregate === filter.aggregate.name && e.aggregateId === filter.aggregate.id)),
    );
  }

  // ───────────────────────── outbox ─────────────────────────

  async outboxStats(): Promise<OutboxStats> {
    const stats: OutboxStats = { pending: 0, published: 0, failed: 0 };
    for (const r of this.rows) stats[r.status] += 1;
    return stats;
  }

  async outbox(filter: { status?: OutboxStatus; eventId?: string } = {}): Promise<OutboxRecord[]> {
    return this.rows.filter((r) => (!filter.status || r.status === filter.status) && (!filter.eventId || r.eventId === filter.eventId)).map((r) => ({ ...r }));
  }

  async claimDue<T>(now: Date, limit: number, fn: (rows: OutboxRecord[], tx: Tx | undefined) => Promise<T>): Promise<T> {
    // Selection and locking happen synchronously, before the first await: two drains started
    // together can never pick the same row.
    const claimed = this.rows
      .filter((r) => r.status === 'pending' && r.nextAttemptAt.getTime() <= now.getTime() && !this.locked.has(r.id))
      .slice(0, limit);
    for (const r of claimed) this.locked.add(r.id);
    try {
      return await fn(
        claimed.map((r) => ({ ...r })),
        undefined,
      );
    } finally {
      for (const r of claimed) this.locked.delete(r.id);
    }
  }

  async updateOutbox(id: string, patch: OutboxPatch): Promise<void> {
    const row = this.rows.find((r) => r.id === id);
    if (!row) throw new Error(`outbox row ${id} not found`);
    if (patch.status !== undefined) row.status = patch.status;
    if (patch.attempts !== undefined) row.attempts = patch.attempts;
    if (patch.lastError !== undefined) row.lastError = patch.lastError ?? undefined;
    if (patch.nextAttemptAt !== undefined) row.nextAttemptAt = patch.nextAttemptAt;
    if (patch.publishedAt !== undefined) row.publishedAt = patch.publishedAt ?? undefined;
  }

  // ───────────────────────── deliveries ─────────────────────────

  async deliveredTo(outboxId: string, tx?: Tx): Promise<Set<string>> {
    const names = new Set<string>();
    for (const d of this.deliveries.values()) if (d.outboxId === outboxId && d.deliveredAt) names.add(d.subscriber);
    const s = tx ? this.staged.get(tx as object) : undefined;
    for (const d of s?.delivered ?? []) if (d.outboxId === outboxId) names.add(d.subscriber);
    return names;
  }

  async markDelivered(outboxId: string, subscriber: string, at: Date, tx?: Tx): Promise<void> {
    const s = this.bucket(tx);
    if (s) s.delivered.push({ outboxId, subscriber, at });
    else this.applyDelivered(outboxId, subscriber, at);
  }

  async recordDeliveryFailure(outboxId: string, subscriber: string, error: string): Promise<void> {
    const d = this.delivery(outboxId, subscriber);
    d.attempts += 1;
    d.lastError = error;
  }

  /** Delivery records (tests and the Console). */
  allDeliveries(): Delivery[] {
    return [...this.deliveries.values()].map((d) => ({ ...d }));
  }

  private applyDelivered(outboxId: string, subscriber: string, at: Date): void {
    const d = this.delivery(outboxId, subscriber);
    d.attempts += 1;
    d.deliveredAt = at;
    d.lastError = null;
  }

  private delivery(outboxId: string, subscriber: string): Delivery {
    const key = `${outboxId}\u0000${subscriber}`;
    let d = this.deliveries.get(key);
    if (!d) {
      d = { outboxId, subscriber, deliveredAt: null, attempts: 0, lastError: null };
      this.deliveries.set(key, d);
    }
    return d;
  }
}
