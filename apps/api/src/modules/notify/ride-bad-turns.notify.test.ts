import { describe, expect, it } from 'vitest';
import type { PublishedEvent } from '../events/index.js';
import type { NotifyLookups, OrderFacts } from './notify.lookups.js';
import { NOTIFY_EVENT_TYPES, requestsFor } from './notify.subscribers.js';
import { notifyHarness } from './test-harness.js';

const AT = new Date('2026-10-08T20:30:00Z'); // 23:30 Baghdad: inside quiet hours

function event(type: string, payload: Record<string, unknown>, opts: { orderId?: string; actorId?: string; tripId?: string } = {}): PublishedEvent {
  return {
    id: `ev-${type}`,
    outboxId: 'ob1',
    type,
    actorId: opts.actorId ?? 'system',
    occurredAt: AT,
    recordedAt: AT,
    payload,
    aggregate: opts.orderId ? 'order' : 'trip',
    aggregateId: opts.orderId ?? opts.tripId ?? 'trip_1',
    ...(opts.orderId ? { orderId: opts.orderId } : {}),
    ...(opts.tripId ? { tripId: opts.tripId } : {}),
    skewMs: 0,
    flagged: false,
    quarantined: false,
  };
}

const ride: OrderFacts = { id: 'ord_1', type: 'ride', customerId: 'cust', merchantOrgId: null, totalIqd: 3000, itemCount: 0 };
const lookupsWith = (order: OrderFacts | null): NotifyLookups =>
  ({ order: async (id: string) => (order && id === order.id ? order : null), firstName: async (id: string) => (id === 'drv_haider' ? 'حيدر' : null) }) as unknown as NotifyLookups;
const deps = (order: OrderFacts | null = ride) => {
  const h = notifyHarness();
  return { engine: h.engine, repo: h.repo, lookups: lookupsWith(order), receiptBaseUrl: '' };
};
type Sent = { sent: Array<{ title: string; body: string; data: Record<string, string> }> };

describe('NTF-04: a ride\'s bad turns reach the rider', () => {
  it('the driver who took the ride cancelled: «حيدر لغى المشوار», sent at night too, no credit promised', async () => {
    expect(NOTIFY_EVENT_TYPES).toContain('order.driver_cancelled');
    const h = notifyHarness({ start: AT.toISOString() });
    await h.register('cust');
    const reqs = await requestsFor(event('order.driver_cancelled', { tripId: 'trip_1', customerCreditIqd: 500 }, { orderId: 'ord_1', actorId: 'drv_haider' }), { engine: h.engine, repo: h.repo, lookups: lookupsWith(ride), receiptBaseUrl: '' });
    expect(reqs.map((r) => ({ template: r.template, to: r.to }))).toEqual([{ template: 'ride_driver_cancelled', to: 'cust' }]);
    await h.service.dispatch(reqs[0]!);
    await h.run();
    const push = (h.push as unknown as Sent).sent[0]!;
    expect(push.title).toBe('حيدر لغى المشوار');
    expect(push.body).toBe('لا تشيل هم، دا ندورلك سايق ثاني هسة');
    expect(push.body).not.toContain('دينار');
    expect(push.data).toMatchObject({ deepLink: 'driver://order/ord_1' });
  });

  it('no driver by the free-cancel time: «ما لگينا سايق هسة» with the three choices, found by the order on the event', async () => {
    expect(NOTIFY_EVENT_TYPES).toContain('dispatch.free_cancel_available');
    const h = notifyHarness({ start: AT.toISOString() });
    await h.register('cust');
    const reqs = await requestsFor(event('dispatch.free_cancel_available', { afterSec: 180, orderId: 'ord_1', vertical: 'taxi' }, { tripId: 'trip_1' }), { engine: h.engine, repo: h.repo, lookups: lookupsWith(ride), receiptBaseUrl: '' });
    expect(reqs.map((r) => ({ template: r.template, to: r.to, orderId: r.orderId }))).toEqual([{ template: 'ride_no_driver', to: 'cust', orderId: 'ord_1' }]);
    await h.service.dispatch(reqs[0]!);
    await h.run();
    const push = (h.push as unknown as Sent).sent[0]!;
    expect(push.title).toBe('ما لگينا سايق هسة');
    expect(push.body).toBe('تگدر تنتظر، أو تلغي ببلاش، أو تحجز لوقت ثاني');
  });

  it('a ride booked for someone else tells the rider too; food and requests without an order send nothing', async () => {
    const forMum = { ...ride, riderId: 'mum' };
    const reqs = await requestsFor(event('order.driver_cancelled', {}, { orderId: 'ord_1', actorId: 'drv_x' }), deps(forMum));
    expect(reqs.map((r) => [r.to, r.params?.['driver']])).toEqual([
      ['cust', 'السايق'],
      ['mum', 'السايق'],
    ]);
    expect(await requestsFor(event('dispatch.free_cancel_available', { afterSec: 180, orderId: 'ord_1' }), deps({ ...ride, type: 'food' }))).toEqual([]);
    expect(await requestsFor(event('dispatch.free_cancel_available', { afterSec: 180 }), deps())).toEqual([]);
  });
});

describe('NTF-05: a ride booked for later says when the search for its driver starts', () => {
  it('maps dispatch.booked_search_started to «دا ندورلك سايق هسة» for the orderer, opening the live ride', async () => {
    const h = notifyHarness({ start: AT.toISOString() });
    await h.register('cust');
    const reqs = await requestsFor(event('dispatch.booked_search_started', { orderId: 'ord_1', scheduledFor: '2026-10-08T21:00:00.000Z' }, { tripId: 'trip_1' }), { engine: h.engine, repo: h.repo, lookups: lookupsWith(ride), receiptBaseUrl: '' });
    expect(reqs.map((r) => ({ template: r.template, to: r.to }))).toEqual([{ template: 'booked_ride_searching', to: 'cust' }]);
    await h.service.dispatch(reqs[0]!);
    await h.run();
    const push = (h.push as unknown as Sent).sent[0]!;
    expect(push.title).toBe('دا ندورلك سايق هسة');
    expect(push.body).toBe('مشوارك باچر 12 بالليل. نخبرك أول ما يقبل سايق');
    expect(push.data).toMatchObject({ deepLink: 'driver://order/ord_1' });
  });
});
