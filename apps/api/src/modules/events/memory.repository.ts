import { afterCommit, onRollback, type Tx } from '../../shared/db/unit-of-work.js';
import type { EventFilter, EventsRepository, OutboxFilter } from './events.repository.js';
import { newId } from './events.repository.js';
import type { OutboxPatch, OutboxRecord, OutboxStats, StoredEvent } from './events.types.js';
import { OUTBOX_LEASE_MS } from './timestamps.js';

interface Delivery {
  outboxId: string;
  subscriber: string;
  deliveredAt: Date | null;
  attempts: number;
  lastError: string | null;
}

const aggKey = (name: string, id: string) => `${name}\u0000${id}`;

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
 * `claimDue` mirrors the Postgres claim: the claimed rows' next attempt moves `OUTBOX_LEASE_MS` ahead
 * at once, so a concurrent drain skips them, and a batch that dies mid-way comes back after the lease.
 */
export class InMemoryEventsRepository implements EventsRepository {
  private readonly events: StoredEvent[] = [];
  private readonly rows: OutboxRecord[] = [];
  private readonly deliveries = new Map<string, Delivery>();
  private readonly staged = new Map<object, Staged>();
  // Indexes over the committed rows (the simulator writes hundreds of thousands): same answers as a
  // full scan, in recording order.
  private readonly byIdempotencyKey = new Map<string, StoredEvent>();
  private readonly byActor = new Map<string, StoredEvent[]>();
  private readonly byTrip = new Map<string, StoredEvent[]>();
  private readonly byOrder = new Map<string, StoredEvent[]>();
  private readonly byAggregate = new Map<string, StoredEvent[]>();
  /** Recording position of every committed event (for `before`). */
  private readonly position = new Map<string, number>();
  private readonly rowsById = new Map<string, OutboxRecord>();
  /** Pending rows in insertion order (oldest first), what `claimDue` scans. */
  private readonly pendingRows = new Map<string, OutboxRecord>();
  private readonly stats: OutboxStats = { pending: 0, published: 0, failed: 0 };
  private readonly deliveriesByRow = new Map<string, Map<string, Delivery>>();

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
      if (e.idempotencyKey && this.byIdempotencyKey.has(e.idempotencyKey)) continue;
      this.pushEvent(e);
      const row = s.outbox.find((r) => r.eventId === e.id);
      if (row) this.pushRow(row);
    }
    for (const d of s.delivered) this.applyDelivered(d.outboxId, d.subscriber, d.at);
  }

  private visibleEvents(tx?: Tx): StoredEvent[] {
    const s = tx ? this.staged.get(tx as object) : undefined;
    return s ? [...this.events, ...s.events] : this.events;
  }

  private pushEvent(e: StoredEvent): void {
    this.position.set(e.id, this.events.length);
    this.events.push(e);
    if (e.idempotencyKey && !this.byIdempotencyKey.has(e.idempotencyKey)) this.byIdempotencyKey.set(e.idempotencyKey, e);
    const add = (m: Map<string, StoredEvent[]>, k: string | undefined) => {
      if (k === undefined) return;
      const list = m.get(k);
      if (list) list.push(e);
      else m.set(k, [e]);
    };
    add(this.byActor, e.actorId);
    add(this.byTrip, e.tripId);
    add(this.byOrder, e.orderId);
    add(this.byAggregate, aggKey(e.aggregate, e.aggregateId));
  }

  private pushRow(row: OutboxRecord): void {
    this.rows.push(row);
    this.rowsById.set(row.id, row);
    this.stats[row.status] += 1;
    if (row.status === 'pending') this.pendingRows.set(row.id, row);
  }

  // ───────────────────────── events ─────────────────────────

  async findByIdempotencyKey(key: string, tx?: Tx): Promise<StoredEvent | null> {
    const committed = this.byIdempotencyKey.get(key);
    if (committed) return committed;
    const s = tx ? this.staged.get(tx as object) : undefined;
    return s?.events.find((e) => e.idempotencyKey === key) ?? null;
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
      this.pushEvent(event);
      this.pushRow(row);
    }
    return { event, inserted: true };
  }

  async find(filter: EventFilter, tx?: Tx): Promise<StoredEvent[]> {
    // Narrow by an index when the filter has a key (the rest of the filter still applies below);
    // this transaction's staged events come last, after every committed one, as in a full scan.
    const indexed = filter.tripId
      ? this.byTrip.get(filter.tripId)
      : filter.orderId
        ? this.byOrder.get(filter.orderId)
        : filter.actorId
          ? this.byActor.get(filter.actorId)
          : filter.aggregate
            ? this.byAggregate.get(aggKey(filter.aggregate.name, filter.aggregate.id))
            : null;
    const staged = tx ? this.staged.get(tx as object) : undefined;
    const keyed = Boolean(filter.tripId || filter.orderId || filter.actorId || filter.aggregate);
    const all = keyed ? [...(indexed ?? []), ...(staged?.events ?? [])] : this.visibleEvents(tx);
    let scope = all;
    if (filter.before) {
      const pos = (e: StoredEvent): number => this.position.get(e.id) ?? this.events.length + (staged?.events.indexOf(e) ?? 0);
      const stop = this.position.get(filter.before.id) ?? (staged && staged.events.some((e) => e.id === filter.before!.id) ? this.events.length + staged.events.findIndex((e) => e.id === filter.before!.id) : -1);
      if (stop >= 0) scope = all.filter((e) => pos(e) < stop);
    }
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
    return { ...this.stats };
  }

  async outbox(filter: OutboxFilter = {}): Promise<OutboxRecord[]> {
    const rows = this.rows.filter((r) => (!filter.status || r.status === filter.status) && (!filter.eventId || r.eventId === filter.eventId)).map((r) => ({ ...r }));
    if (filter.newestFirst) rows.reverse();
    return filter.limit === undefined ? rows : rows.slice(0, filter.limit);
  }

  async claimDue<T>(now: Date, limit: number, fn: (rows: OutboxRecord[], tx: Tx | undefined) => Promise<T>, leaseMs = OUTBOX_LEASE_MS): Promise<T> {
    // Selection and the lease happen synchronously, before the first await: two drains started
    // together can never pick the same row.
    const leaseUntil = new Date(now.getTime() + leaseMs);
    const claimed: OutboxRecord[] = [];
    for (const r of this.pendingRows.values()) {
      if (claimed.length >= limit) break;
      if (r.nextAttemptAt.getTime() <= now.getTime()) claimed.push(r);
    }
    for (const r of claimed) r.nextAttemptAt = leaseUntil;
    return fn(
      claimed.map((r) => ({ ...r })),
      undefined,
    );
  }

  async updateOutbox(id: string, patch: OutboxPatch): Promise<void> {
    const row = this.rowsById.get(id);
    if (!row) throw new Error(`outbox row ${id} not found`);
    if (patch.status !== undefined && patch.status !== row.status) {
      this.stats[row.status] -= 1;
      this.stats[patch.status] += 1;
      if (patch.status === 'pending') this.pendingRows.set(row.id, row);
      else this.pendingRows.delete(row.id);
      row.status = patch.status;
    }
    if (patch.attempts !== undefined) row.attempts = patch.attempts;
    if (patch.lastError !== undefined) row.lastError = patch.lastError ?? undefined;
    if (patch.nextAttemptAt !== undefined) row.nextAttemptAt = patch.nextAttemptAt;
    if (patch.publishedAt !== undefined) row.publishedAt = patch.publishedAt ?? undefined;
  }

  // ───────────────────────── deliveries ─────────────────────────

  /** One process, one drain at a time (`OutboxPublisher`): nothing to wait for. */
  async lockDelivery(): Promise<void> {}

  async deliveredTo(outboxId: string, tx?: Tx): Promise<Set<string>> {
    const names = new Set<string>();
    for (const d of this.deliveriesByRow.get(outboxId)?.values() ?? []) if (d.deliveredAt) names.add(d.subscriber);
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
      const forRow = this.deliveriesByRow.get(outboxId) ?? new Map<string, Delivery>();
      forRow.set(subscriber, d);
      this.deliveriesByRow.set(outboxId, forRow);
    }
    return d;
  }
}
