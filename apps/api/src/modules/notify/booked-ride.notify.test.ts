import { describe, expect, it } from 'vitest';
import type { PublishedEvent } from '../events/index.js';
import type { NotifyLookups } from './notify.lookups.js';
import { BOOKED_RIDE_EVENTS, bookedRideRequests, bookedWhen, NOTIFY_EVENT_TYPES } from './notify.subscribers.js';
import { notifyHarness } from './test-harness.js';

const NOW = new Date('2026-10-07T16:00:00Z'); // 19:00 Baghdad, the evening before
const RIDE = '2026-10-08T02:00:00.000Z'; // 05:00 Thursday

function ev(type: string, payload: Record<string, unknown>, at = NOW): PublishedEvent {
  return { id: `ev-${type}`, outboxId: 'ob1', type, actorId: 'system', occurredAt: at, recordedAt: at, tripId: 'trip1', payload, aggregate: 'trip', aggregateId: 'trip1', skewMs: 0, flagged: false, quarantined: false };
}

const lookups: Pick<NotifyLookups, 'order' | 'firstName' | 'tripZones'> = {
  order: async (id) => (id === 'o1' ? ({ id: 'o1', customerId: 'cust', type: 'ride' } as Awaited<ReturnType<NotifyLookups['order']>>) : null),
  firstName: async (id) => (id === 'd1' ? 'حسين' : null),
  tripZones: async () => ({ pickup: 'المركز', dropoff: 'الكراج' }),
};

const shape = (reqs: Awaited<ReturnType<typeof bookedRideRequests>>) => reqs.map((r) => ({ template: r.template, to: r.to, params: r.params }));

describe('booked rides: who hears what (review #28)', () => {
  it('reads the time without doubt: «باچر 5 الصبح», or the hour alone today', () => {
    expect(bookedWhen(new Date(RIDE), NOW)).toBe('باچر 5 الصبح');
    expect(bookedWhen(new Date('2026-10-07T17:30:00Z'), NOW)).toBe('8:30 بالليل');
  });

  it('the rider: «سايقك محجوز: حسين», the calm «بعدنا ندوّرلك سايق», and when the driver drops it', async () => {
    expect(shape(await bookedRideRequests(ev('dispatch.booked_confirmed', { orderId: 'o1', driverId: 'd1', scheduledFor: RIDE }), lookups))).toEqual([
      { template: 'booked_ride_confirmed', to: 'cust', params: { driver: 'حسين', when: 'باچر 5 الصبح', orderId: 'o1' } },
    ]);
    expect(shape(await bookedRideRequests(ev('dispatch.booked_unconfirmed', { orderId: 'o1', scheduledFor: RIDE }), lookups))).toEqual([
      { template: 'booked_ride_unconfirmed', to: 'cust', params: { driver: '', when: 'باچر 5 الصبح', orderId: 'o1' } },
    ]);
    expect(shape(await bookedRideRequests(ev('dispatch.booked_released', { orderId: 'o1', driverId: 'd1', scheduledFor: RIDE, reason: 'driver' }), lookups))[0]).toMatchObject({ template: 'booked_ride_released', to: 'cust' });
  });

  it('drivers: the favourite alone, then the best-placed — zones and times only', async () => {
    const fav = await bookedRideRequests(ev('dispatch.booked_offered', { orderId: 'o1', scheduledFor: RIDE, confirmBy: '2026-10-07T19:00:00.000Z', driverIds: ['fav'], favourite: true }), lookups);
    expect(shape(fav)).toEqual([{ template: 'partner_booked_favourite', to: 'fav', params: { when: 'باچر 5 الصبح', pickup: 'المركز', dropoff: 'الكراج', deadline: '10 بالليل' } }]);
    const all = await bookedRideRequests(ev('dispatch.booked_opened', { orderId: 'o1', scheduledFor: RIDE, confirmBy: '2026-10-07T19:00:00.000Z', driverIds: ['d1', 'd2', 'd1'] }), lookups);
    expect(all.map((r) => [r.template, r.to])).toEqual([
      ['partner_booked_offer', 'd1'],
      ['partner_booked_offer', 'd2'],
    ]);
    expect(await bookedRideRequests(ev('dispatch.booked_opened', { orderId: 'o1', scheduledFor: RIDE, driverIds: [] }), lookups)).toEqual([]);
  });

  it('the confirmed driver: the reminder an hour before, and a cancellation', async () => {
    const at = new Date('2026-10-08T01:00:00Z');
    expect(shape(await bookedRideRequests(ev('dispatch.booked_reminder', { orderId: 'o1', driverId: 'd1', scheduledFor: RIDE, showBy: '2026-10-08T01:30:00.000Z' }, at), lookups))).toEqual([
      { template: 'partner_booked_reminder', to: 'd1', params: { when: '5 الصبح', showBy: '4:30 الصبح' } },
    ]);
    expect(shape(await bookedRideRequests(ev('dispatch.booked_cancelled', { orderId: 'o1', driverId: 'd1', scheduledFor: RIDE }), lookups))).toEqual([{ template: 'partner_booked_cancelled', to: 'd1', params: { when: 'باچر 5 الصبح' } }]);
    expect(NOTIFY_EVENT_TYPES).toEqual(expect.arrayContaining([...BOOKED_RIDE_EVENTS]));
  });

  it('the rider’s pushes wait out quiet hours; the driver’s reminder goes out at 4 in the morning', async () => {
    const h = notifyHarness({ start: '2026-10-08T01:00:00Z' }); // 04:00 Baghdad
    await h.register('cust');
    await h.register('courier');
    const [rider] = await h.service.dispatch({ eventId: 'e1', template: 'booked_ride_released', to: 'cust', params: { driver: 'حسين', when: '5 الصبح', orderId: 'o1' } });
    expect(rider).toMatchObject({ status: 'deferred' });
    const [driver] = await h.service.dispatch({ eventId: 'e2', template: 'partner_booked_reminder', to: 'courier', params: { when: '5 الصبح', showBy: '4:30 الصبح' }, app: 'partner' });
    expect(driver?.status).not.toBe('deferred');
  });

  it('«سايقك محجوز: حسين» opens the booked ride', async () => {
    const h = notifyHarness({ start: '2026-10-07T16:00:00Z' });
    await h.register('cust');
    await h.service.dispatch({ eventId: 'e1', template: 'booked_ride_confirmed', to: 'cust', params: { driver: 'حسين', when: 'باچر 5 الصبح', orderId: 'o1' } });
    await h.run();
    const push = (h.push as unknown as { sent: Array<{ title: string; body: string; data: Record<string, string> }> }).sent[0]!;
    expect(push.title).toBe('سايقك محجوز: حسين');
    expect(push.body).toBe('مشوارك باچر 5 الصبح تأكد، ويجيك على الوكت');
    expect(push.data).toMatchObject({ deepLink: 'driver://ride/booked/o1' });
  });
});
