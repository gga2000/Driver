import { describe, expect, it } from 'vitest';
import type { PublishedEvent } from '../events/index.js';
import type { NotifyLookups } from './notify.lookups.js';
import { NOTIFY_EVENT_TYPES, requestsFor } from './notify.subscribers.js';
import { notifyHarness } from './test-harness.js';

const AT = new Date('2026-10-08T03:30:00Z'); // 6:30 Baghdad: inside quiet hours

function event(type: string, payload: Record<string, unknown>, orderId: string | null = null): PublishedEvent {
  return { id: `ev-${type}`, outboxId: 'ob1', type, actorId: 'system', occurredAt: AT, recordedAt: AT, payload, aggregate: orderId ? 'order' : 'person', aggregateId: orderId ?? 'cust', ...(orderId ? { orderId } : {}), skewMs: 0, flagged: false, quarantined: false };
}

const lookups = {} as NotifyLookups;
const deps = () => {
  const h = notifyHarness();
  return { engine: h.engine, repo: h.repo, lookups, receiptBaseUrl: 'https://driver.iq/r' };
};
type Sent = { sent: Array<{ title: string; body: string; data: Record<string, string> }> };

describe('a ride booked for later: the reminder half an hour before (step 4, c10)', () => {
  it('maps order.ride_reminder to «مشوارك 7:00 ص» for the rider, opening the booking', async () => {
    const reqs = await requestsFor(event('order.ride_reminder', { customerId: 'cust', scheduledFor: '2026-10-08T04:00:00.000Z', searchAt: '2026-10-08T03:45:00.000Z' }, 'ord_1'), deps());
    expect(reqs.map((r) => ({ template: r.template, to: r.to, orderId: r.orderId }))).toEqual([{ template: 'ride_booked_reminder', to: 'cust', orderId: 'ord_1' }]);
    expect(await requestsFor(event('order.ride_reminder', { customerId: 'cust', scheduledFor: 'nope', searchAt: 'nope' }, 'ord_1'), deps())).toEqual([]);
    expect(NOTIFY_EVENT_TYPES).toContain('order.ride_reminder');
  });

  it('goes out in quiet hours (his own booking), with its deep link; the ride-updates switch silences it', async () => {
    const h = notifyHarness({ start: AT.toISOString() });
    await h.register('cust');
    const [req] = await requestsFor(event('order.ride_reminder', { customerId: 'cust', scheduledFor: '2026-10-08T04:00:00.000Z', searchAt: '2026-10-08T03:45:00.000Z' }, 'ord_1'), { engine: h.engine, repo: h.repo, lookups, receiptBaseUrl: '' });
    await h.service.dispatch(req!);
    await h.run();
    const push = (h.push as unknown as Sent).sent[0]!;
    expect(push.title).toBe('مشوارك 7:00 ص');
    expect(push.body).toBe('نبدي ندوّر سايق 6:45 ص. ما تحتاجه؟ ألغيه ببلاش قبل ما يقبل سايق.');
    expect(push.data).toMatchObject({ deepLink: 'driver://ride/booked/ord_1' });
    await h.service.setPreferences(h.actor('cust'), { orderUpdates: false });
    await h.service.dispatch({ ...req!, eventId: 'e2' });
    expect((await h.rows({ personId: 'cust' })).map((r) => [r.status, r.reason])).toEqual([
      ['sent', null],
      ['suppressed', 'preference:orderUpdates'],
    ]);
  });
});

describe('«نفس مشوار البارحة؟» (step 4, o4)', () => {
  const due = (over: Record<string, unknown> = {}) =>
    event('same_ride.due', {
      personId: 'cust',
      date: '2026-10-08',
      at: '2026-10-08T04:30:00.000Z',
      vertical: 'taxi',
      doorPickup: true,
      from: '32.910000,45.060000,centre,pl_home',
      to: '32.920000,45.070000,street_30',
      route: 'البيت ← شارع 30',
      afterWeekend: false,
      ...over,
    });

  it('maps same_ride.due to the offer (Thursday\'s on a Sunday), and drops a malformed one', async () => {
    expect((await requestsFor(due(), deps())).map((r) => [r.template, r.to])).toEqual([['same_ride_offer', 'cust']]);
    expect((await requestsFor(due({ afterWeekend: true }), deps())).map((r) => r.template)).toEqual(['same_ride_after_weekend']);
    expect(await requestsFor(due({ vertical: 'bus' }), deps())).toEqual([]);
    expect(NOTIFY_EVENT_TYPES).toContain('same_ride.due');
  });

  it('reads «نفس مشوار البارحة؟» at 7:20, opens choose filled in, and has its own off switch', async () => {
    const h = notifyHarness({ start: '2026-10-08T04:20:00Z' });
    await h.register('cust');
    const [req] = await requestsFor(due(), { engine: h.engine, repo: h.repo, lookups, receiptBaseUrl: '' });
    await h.service.dispatch(req!);
    await h.run();
    const push = (h.push as unknown as Sent).sent[0]!;
    expect(push.title).toBe('نفس مشوار البارحة؟');
    expect(push.body).toBe('البيت ← شارع 30 · 7:30 ص. اطلبه بدگة وحدة.');
    expect(push.data).toMatchObject({ deepLink: 'driver://ride/again?from=32.910000,45.060000,centre,pl_home&to=32.920000,45.070000,street_30&v=taxi&door=1' });
    await h.service.setPreferences(h.actor('cust'), { sameRide: false });
    await h.service.dispatch({ ...req!, eventId: 'e2' });
    expect((await h.rows({ personId: 'cust' })).map((r) => [r.status, r.reason])).toEqual([
      ['sent', null],
      ['suppressed', 'preference:sameRide'],
    ]);
  });
});
