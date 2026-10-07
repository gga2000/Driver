import { describe, expect, it } from 'vitest';
import type { PublishedEvent } from '../events/index.js';
import type { NotifyLookups } from './notify.lookups.js';
import { NOTIFY_EVENT_TYPES, requestsFor } from './notify.subscribers.js';
import { notifyHarness } from './test-harness.js';

const AT = new Date('2026-10-07T17:00:00Z'); // 20:00 Baghdad, the evening before

function due(payload: Record<string, unknown>): PublishedEvent {
  return { id: 'ev-due', outboxId: 'ob1', type: 'regular_trip.due', actorId: 'system', occurredAt: AT, recordedAt: AT, payload, aggregate: 'person', aggregateId: 'cust', skewMs: 0, flagged: false, quarantined: false };
}

const lookups = {} as NotifyLookups;
const reminder = { regularTripId: 'rgt_1', day: '2026-10-08', route: 'البيت ← الدائرة', time: '7:30 ص' };

describe('regular trip reminder (joy r5)', () => {
  it('maps regular_trip.due to «تأكد رحلتك؟» for the rider, opening that day', async () => {
    const h = notifyHarness();
    const reqs = await requestsFor(due({ personId: 'cust', regularTripId: 'rgt_1', date: '2026-10-08', at: '2026-10-08T04:30:00.000Z', route: 'البيت ← الدائرة' }), { engine: h.engine, repo: h.repo, lookups, receiptBaseUrl: 'https://driver.iq/r' });
    expect(reqs.map((r) => ({ template: r.template, to: r.to, params: r.params }))).toEqual([{ template: 'regular_trip_reminder', to: 'cust', params: { ...reminder, time: expect.any(String) } }]);
    expect(await requestsFor(due({ personId: 'cust', regularTripId: 'rgt_1', date: '2026-10-08', at: 'nope' }), { engine: h.engine, repo: h.repo, lookups, receiptBaseUrl: '' })).toEqual([]);
    expect(NOTIFY_EVENT_TYPES).toContain('regular_trip.due');
  });

  it('goes out with its deep link, and only with its switch on', async () => {
    const h = notifyHarness({ start: '2026-10-07T17:00:00Z' });
    await h.register('cust');
    await h.service.dispatch({ eventId: 'e1', template: 'regular_trip_reminder', to: 'cust', params: reminder });
    await h.run();
    const push = (h.push as unknown as { sent: Array<{ title: string; body: string; data: Record<string, string> }> }).sent[0]!;
    expect(push.title).toBe('تأكد رحلتك؟');
    expect(push.body).toBe('البيت ← الدائرة · 7:30 ص. ما نحجزها إلا لمن تگول أكدها.');
    expect(push.data).toMatchObject({ deepLink: 'driver://regular/rgt_1?date=2026-10-08' });
    await h.service.setPreferences(h.actor('cust'), { regularTrips: false });
    await h.service.dispatch({ eventId: 'e2', template: 'regular_trip_reminder', to: 'cust', params: reminder });
    expect((await h.rows({ personId: 'cust' })).map((r) => [r.status, r.reason])).toEqual([
      ['sent', null],
      ['suppressed', 'preference:regularTrips'],
    ]);
  });

  it('waits out quiet hours and stays silent on a quiet day', async () => {
    let quiet = false;
    const h = notifyHarness({ start: '2026-10-07T20:30:00Z', quietDay: async () => quiet }); // 23:30 Baghdad
    await h.register('cust');
    const [late] = await h.service.dispatch({ eventId: 'e1', template: 'regular_trip_reminder', to: 'cust', params: reminder });
    expect(late).toMatchObject({ status: 'deferred' });
    quiet = true;
    h.clock.set('2026-10-08T05:00:00Z');
    await h.run();
    expect((await h.rows({ personId: 'cust' })).map((r) => [r.status, r.reason])).toEqual([['suppressed', 'quiet_day']]);
  });
});
