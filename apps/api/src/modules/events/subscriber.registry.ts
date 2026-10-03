import { Injectable } from '@nestjs/common';
import type { EventHandler, StoredEvent } from './events.types.js';

export interface SubscribeOptions {
  /**
   * Also receive quarantined events (late replays). Off by default: settlement subscribers (the
   * ledger, orders reacting to trip evidence) must never act on them (edge-case §10). Support-style
   * subscribers opt in.
   */
  quarantined?: boolean;
}

export interface Subscription {
  name: string;
  types: readonly string[] | '*';
  handler: EventHandler;
  quarantined: boolean;
}

/**
 * Named, idempotent subscribers. The name is the dedupe key in `subscriber_deliveries`: once a
 * subscriber's effect for an outbox row has committed, a redelivery of that row skips it. Handlers
 * must still be idempotent (the outbox is at-least-once across crashes between steps).
 *
 * Types: exact (`order.closed`), a prefix pattern (`trip.*`), or `'*'` for everything.
 */
@Injectable()
export class SubscriberRegistry {
  private readonly subs = new Map<string, Subscription>();

  subscribe(name: string, types: readonly string[] | '*', handler: EventHandler, opts: SubscribeOptions = {}): () => void {
    if (!name) throw new Error('subscriber name is required');
    if (this.subs.has(name)) throw new Error(`subscriber ${name} is already registered`);
    const sub: Subscription = { name, types, handler, quarantined: opts.quarantined ?? false };
    this.subs.set(name, sub);
    return () => {
      if (this.subs.get(name) === sub) this.subs.delete(name);
    };
  }

  /** Subscribers that should receive `event`, in registration order. */
  matching(event: Pick<StoredEvent, 'type' | 'quarantined'>): Subscription[] {
    return [...this.subs.values()].filter((s) => (!event.quarantined || s.quarantined) && matchesType(s.types, event.type));
  }

  names(): string[] {
    return [...this.subs.keys()];
  }
}

export function matchesType(types: readonly string[] | '*', type: string): boolean {
  if (types === '*') return true;
  return types.some((t) => t === '*' || t === type || (t.endsWith('.*') && type.startsWith(t.slice(0, -1))));
}
