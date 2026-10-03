import type { Event, LatLng } from '@driver/contracts';
import type { Tx } from '../../shared/db/unit-of-work.js';

/** The aggregate an event belongs to (`trip`/`trp_1`, `order`/`ord_9`, `person`/`p_1`…). */
export interface Aggregate {
  name: string;
  id: string;
}

/** What a module hands to `EventsService.emit`. Ids and timestamps the server owns are not here. */
export interface NewEvent {
  type: string;
  actorId: string;
  /** Device wall time for actions recorded on a phone; server time otherwise. */
  occurredAt: Date;
  payload?: Record<string, unknown>;
  tripId?: string | undefined;
  orderId?: string | undefined;
  location?: LatLng | undefined;
  /** Repeating a key returns the first event and writes nothing (client retries, offline replays). */
  idempotencyKey?: string | undefined;
  /** Device monotonic uptime when the action happened; marks the event as device-recorded. */
  deviceUptimeMs?: number | undefined;
}

export type FlagReason = 'device_ahead' | 'device_stale' | 'device_skew';
export type QuarantineReason = 'late_replay';

/** An event as stored: the contract shape plus everything decided on receipt. */
export interface StoredEvent extends Event {
  aggregate: string;
  aggregateId: string;
  payload: Record<string, unknown>;
  /** occurredAt − recordedAt in ms (positive: device clock ahead of the server). */
  skewMs: number;
  flagged: boolean;
  quarantined: boolean;
}

export type OutboxStatus = 'pending' | 'published' | 'failed';

export interface OutboxRecord {
  id: string;
  eventId: string;
  aggregate: string;
  aggregateId: string;
  type: string;
  /** The full stored event, as delivered to subscribers. */
  event: StoredEvent;
  status: OutboxStatus;
  attempts: number;
  idempotencyKey?: string | undefined;
  lastError?: string | undefined;
  nextAttemptAt: Date;
  publishedAt?: Date | undefined;
  createdAt: Date;
}

export interface OutboxPatch {
  status?: OutboxStatus;
  attempts?: number;
  lastError?: string | null;
  nextAttemptAt?: Date;
  publishedAt?: Date | null;
}

export interface OutboxStats {
  pending: number;
  published: number;
  failed: number;
}

/** A failed outbox row as the Console shows it. */
export interface OutboxFailure {
  id: string;
  eventId: string;
  type: string;
  aggregate: string;
  aggregateId: string;
  attempts: number;
  lastError: string | null;
  createdAt: Date;
}

/** What a subscriber receives: the stored event plus the outbox row it came from. */
export interface PublishedEvent extends StoredEvent {
  outboxId: string;
}

export interface DeliveryContext {
  /** The subscriber's own transaction: write through it (or any `uow.run` inside) and the delivery record commits with your effects. */
  tx: Tx;
  subscriber: string;
}

export type EventHandler = (event: PublishedEvent, ctx: DeliveryContext) => Promise<void>;

/** JSON form of a stored event (the outbox `payload` column). */
export interface EventEnvelope extends Omit<StoredEvent, 'occurredAt' | 'recordedAt'> {
  occurredAt: string;
  recordedAt: string;
}

export function toEnvelope(e: StoredEvent): EventEnvelope {
  return JSON.parse(JSON.stringify(e)) as EventEnvelope;
}

export function fromEnvelope(raw: unknown): StoredEvent {
  const env = raw as EventEnvelope;
  return { ...env, occurredAt: new Date(env.occurredAt), recordedAt: new Date(env.recordedAt) };
}
