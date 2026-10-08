import { Injectable } from '@nestjs/common';
import { isTestEvent } from '../../shared/test-scope.js';
import type { EventHandler, StoredEvent } from './events.types.js';

export interface SubscribeOptions {
  /**
   * Also receive quarantined events (late replays). Off by default: settlement subscribers (the
   * ledger, orders reacting to trip evidence) must never act on them (edge-case §10). Support-style
   * subscribers opt in.
   */
  quarantined?: boolean;
  /**
   * Also receive events of the store reviewers' test kitchen (a `test_` order or trip, BENCH-04).
   * Off by default, so dispatch, the ledger, learning and every other real-world effect never see a
   * test order; only the order's own flow, live updates and the test-kitchen runner opt in.
   */
  test?: boolean;
}

export interface Subscription {
  name: string;
  types: readonly string[] | '*';
  handler: EventHandler;
  quarantined: boolean;
  test: boolean;
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
    const sub: Subscription = { name, types, handler, quarantined: opts.quarantined ?? false, test: opts.test ?? false };
    this.subs.set(name, sub);
    return () => {
      if (this.subs.get(name) === sub) this.subs.delete(name);
    };
  }

  /** Subscribers that should receive `event`, in registration order. */
  matching(event: Pick<StoredEvent, 'type' | 'quarantined' | 'aggregate' | 'aggregateId' | 'orderId' | 'tripId'>): Subscription[] {
    const test = isTestEvent(event);
    return [...this.subs.values()].filter((s) => (!event.quarantined || s.quarantined) && (!test || s.test) && matchesType(s.types, event.type));
  }

  names(): string[] {
    return [...this.subs.keys()];
  }
}

export function matchesType(types: readonly string[] | '*', type: string): boolean {
  if (types === '*') return true;
  return types.some((t) => t === '*' || t === type || (t.endsWith('.*') && type.startsWith(t.slice(0, -1))));
}
