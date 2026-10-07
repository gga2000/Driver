import { describe, expect, it } from 'vitest';
import { GARAGE_TAXI_EVENTS } from '@driver/contracts';
import type { PublishedEvent } from '../events/index.js';
import type { NotifyLookups } from './notify.lookups.js';
import { NOTIFY_EVENT_TYPES, requestsFor } from './notify.subscribers.js';
import { notifyHarness } from './test-harness.js';

const AT = new Date('2026-10-08T05:10:00Z'); // 8:10 Baghdad

function event(type: string, payload: Record<string, unknown>, orderId: string | null = null): PublishedEvent {
  return { id: `ev-${type}`, outboxId: 'ob1', type, actorId: 'system:garage_taxi', occurredAt: AT, recordedAt: AT, payload, aggregate: 'garage_taxi', aggregateId: 'gt1', ...(orderId ? { orderId } : {}), skewMs: 0, flagged: false, quarantined: false };
}

const lookups = {} as NotifyLookups;
type Sent = { sent: Array<{ title: string; body: string; data: Record<string, string> }> };

const late = (over: Record<string, unknown> = {}) =>
  event(
    GARAGE_TAXI_EVENTS.late,
    {
      bookingId: 'bk1',
      departureId: 'dep1',
      orderId: 'ord1',
      riderId: 'cust',
      driverId: 'courier',
      lateMin: 6,
      expectedAt: '2026-10-08T05:36:00.000Z',
      departAt: '2026-10-08T05:30:00.000Z',
      garageId: 'mp_garage_bab1',
      garageAr: 'كراج البوابة 1',
      seats: ['back_right'],
      ...over,
    },
    'ord1',
  );

describe('taxi ideas x3 / x4: the pushes', () => {
  it('subscribes to every garage-taxi event', () => {
    for (const type of Object.values(GARAGE_TAXI_EVENTS)) expect(NOTIFY_EVENT_TYPES).toContain(type);
  });

  it('x3: the rider hears the minutes and that the driver knows; the الرجعة driver hears the seat and that it is our taxi', async () => {
    const h = notifyHarness({ start: AT.toISOString() });
    await h.register('cust');
    await h.register('courier', 'ExponentPushToken[courier-1]', 'partner');
    const reqs = await requestsFor(late(), { engine: h.engine, repo: h.repo, lookups, receiptBaseUrl: '' });
    expect(reqs.map((r) => [r.template, r.to])).toEqual([
      ['garage_taxi_late', 'cust'],
      ['rajaa_rider_taxi_late', 'courier'],
    ]);
    for (const r of reqs) await h.service.dispatch(r);
    await h.run();
    const sent = (h.push as unknown as Sent).sent;
    expect(sent[0]).toMatchObject({ title: 'التكسي متأخر 6 دقايق', body: 'توصل كراج البوابة 1 تقريباً 8:36 ص. خبرنا سايق الرجعة إنك جاي بتكسينا.' });
    expect(sent[0]!.data).toMatchObject({ deepLink: 'driver://order/ord1' });
    expect(sent[1]).toMatchObject({ title: 'راكبك جاي بتكسينا، متأخر 6 دقايق', body: 'راكب (ورا يمين) يوصل الكراج تقريباً 8:36 ص. التأخير من التكسي اللي دزيناه إله.' });
    expect(sent[1]!.data).toMatchObject({ deepLink: 'driver-partner://intercity/departure/dep1' });
  });

  it('x3: nothing without a rider, an order or a time; no driver line without a driver', async () => {
    const h = notifyHarness();
    const deps = { engine: h.engine, repo: h.repo, lookups, receiptBaseUrl: '' };
    expect(await requestsFor(late({ riderId: null }), deps)).toEqual([]);
    expect(await requestsFor(late({ expectedAt: 'nope' }), deps)).toEqual([]);
    expect((await requestsFor(late({ driverId: null }), deps)).map((r) => r.template)).toEqual(['garage_taxi_late']);
  });

  it('x4: booked, dropped and refused each reach the rider with their own link', async () => {
    const h = notifyHarness({ start: AT.toISOString() });
    await h.register('cust');
    const deps = { engine: h.engine, repo: h.repo, lookups, receiptBaseUrl: '' };
    const reqs = [
      ...(await requestsFor(event(GARAGE_TAXI_EVENTS.placed, { bookingId: 'bk2', orderId: 'ord2', riderId: 'cust', garageId: 'mp_garage_bab1', garageAr: 'كراج البوابة 1' }, 'ord2'), deps)),
      ...(await requestsFor(event(GARAGE_TAXI_EVENTS.dropped, { bookingId: 'bk2', riderId: 'cust', reason: 'trip_cancelled' }), deps)),
      ...(await requestsFor(event(GARAGE_TAXI_EVENTS.failed, { bookingId: 'bk2', riderId: 'cust', code: 'new_customer_cash_cap', garageAr: 'كراج البوابة 1' }), deps)),
    ];
    expect(reqs.map((r) => r.template)).toEqual(['garage_taxi_placed', 'garage_taxi_dropped', 'garage_taxi_failed']);
    for (const r of reqs) await h.service.dispatch(r);
    await h.run();
    const sent = (h.push as unknown as Sent).sent;
    expect(sent.map((s) => s.title)).toEqual(['طلبنالك التكسي', 'ما طلبنا التكسي', 'ما گدرنا نطلبلك التكسي']);
    expect(sent[0]!.body).toBe('السيارة قربت على كراج البوابة 1. التكسي جاي ينتظرك هناك.');
    expect(sent.map((s) => s.data['deepLink'])).toEqual(['driver://order/ord2', 'driver://rajaa/pass/bk2', 'driver://ride']);
  });
});
