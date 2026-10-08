import { describe, expect, it } from 'vitest';
import { SubscriberRegistry } from './subscriber.registry.js';
import { isTestEvent, isTestId, newTestId, TEST_CREW_ID } from '../../shared/test-scope.js';

describe('the store reviewers test scope (BENCH-04)', () => {
  it('test ids carry the prefix; only order and trip ids make an event a test one', () => {
    expect(newTestId()).toMatch(/^test_[0-9a-f]{24}$/);
    expect(newTestId()).not.toBe(newTestId());
    expect(isTestId(undefined)).toBe(false);
    expect(isTestEvent({ aggregate: 'order', aggregateId: 'test_1' })).toBe(true);
    expect(isTestEvent({ aggregate: 'trip', aggregateId: 'test_1' })).toBe(true);
    expect(isTestEvent({ aggregate: 'merchant', aggregateId: 'org_1', orderId: 'test_1' })).toBe(
      true,
    );
    expect(isTestEvent({ aggregate: 'chat', aggregateId: 'x', tripId: 'test_1' })).toBe(true);
    // An id some client may have chosen (any other aggregate) never turns a real event into a test one.
    expect(isTestEvent({ aggregate: 'person', aggregateId: TEST_CREW_ID })).toBe(false);
    expect(isTestEvent({ aggregate: 'chat', aggregateId: 'test_thread', orderId: 'ord_1' })).toBe(
      false,
    );
  });

  it('the registry hands test events only to subscribers that opted in', () => {
    const registry = new SubscriberRegistry();
    const noop = async () => undefined;
    registry.subscribe('ledger:order.closed', ['order.closed'], noop);
    registry.subscribe('orders:trip-events', '*', noop, { test: true });
    const names = (e: { aggregate: string; aggregateId: string; orderId?: string }) =>
      registry.matching({ type: 'order.closed', quarantined: false, ...e }).map((s) => s.name);
    expect(names({ aggregate: 'order', aggregateId: 'ord_1', orderId: 'ord_1' })).toEqual([
      'ledger:order.closed',
      'orders:trip-events',
    ]);
    expect(names({ aggregate: 'order', aggregateId: 'test_1', orderId: 'test_1' })).toEqual([
      'orders:trip-events',
    ]);
  });
});
