import { describe, expect, it } from 'vitest';
import type { EventHandler, PublishedEvent } from '../events/index.js';
import type { NotifyLookups } from './notify.lookups.js';
import { NOTIFY_EVENT_TYPES, NOTIFY_SUBSCRIBER, registerNotifySubscribers, requestsFor } from './notify.subscribers.js';
import { notifyHarness } from './test-harness.js';

const AT = new Date('2026-10-04T09:30:00Z'); // 12:30 Baghdad

function event(type: string, payload: Record<string, unknown>, extra: Partial<PublishedEvent> = {}): PublishedEvent {
  return { id: `ev-${type}`, outboxId: 'ob1', type, actorId: 'actor', occurredAt: AT, recordedAt: AT, payload, aggregate: 'x', aggregateId: 'x', skewMs: 0, flagged: false, quarantined: false, ...extra };
}

const lookups: NotifyLookups = {
  order: async (id) => (id === 'ride_1' ? { id, type: 'ride', customerId: 'cust', merchantOrgId: null, totalIqd: 4000, itemCount: 0 } : id === 'ord_1' ? { id, type: 'food', customerId: 'cust', merchantOrgId: 'org_k', totalIqd: 12_500, itemCount: 3 } : null),
  storeName: async (orgId) => (orgId === 'org_k' ? 'مطعم خالد' : null),
  orgPeople: async (orgId, kinds) => (orgId !== 'org_k' ? [] : kinds.includes('merchant_staff') ? ['staff', 'owner'] : ['owner']),
  firstName: async (personId) => ({ drv: 'حيدر', courier: 'كرار' })[personId] ?? null,
  booking: async (id) => (id === 'bk_1' ? { riderId: 'cust', seats: 'A1', departAt: new Date('2026-10-05T04:30:00Z'), route: 'العزيزية ← بغداد', place: 'كراج البوابة 1', vehicle: 'كيا · 12345', pin: '4821' } : null),
  child: async (ref) => (ref === 'chref_z' ? { guardianId: 'guardian', childFirstName: 'زينب' } : null),
  stopPlace: async () => 'مدرسة الرافدين',
  tripZones: async () => ({ pickup: 'العزيزية (مركز)', dropoff: 'شارع ٣٠' }),
};

const deps = (h: ReturnType<typeof notifyHarness>) => ({ engine: h.engine, repo: h.repo, lookups, receiptBaseUrl: 'https://driver.iq/r' });

describe('notify subscribers: events → notifications', () => {
  it('maps every subscribed event to its template, recipient and params', async () => {
    const h = notifyHarness();
    const d = deps(h);
    const one = async (e: PublishedEvent) => (await requestsFor(e, d)).map((r) => ({ template: r.template, to: r.to, params: r.params }));
    expect(await one(event('order.accepted', {}, { orderId: 'ord_1' }))).toEqual([{ template: 'order_accepted', to: 'cust', params: { merchant: 'مطعم خالد', orderId: 'ord_1' } }]);
    expect(await one(event('order.offered_to_merchant', { merchantOrgId: 'org_k' }, { orderId: 'ord_1' }))).toEqual([
      { template: 'merchant_new_order', to: 'staff', params: { id: '1284', items: '3 أصناف', orderId: 'ord_1' } },
      { template: 'merchant_new_order', to: 'owner', params: { id: '1284', items: '3 أصناف', orderId: 'ord_1' } },
    ]);
    expect(await one(event('order.delivered', {}, { orderId: 'ord_1' }))).toEqual([{ template: 'order_receipt', to: 'cust', params: { merchant: 'مطعم خالد', amount: '12,500', receiptUrl: 'https://driver.iq/r/ord_1', orderId: 'ord_1' } }]);
    expect(await one(event('order.completed', {}, { orderId: 'ride_1', actorId: 'drv' }))).toEqual([{ template: 'ride_receipt', to: 'cust', params: { amount: '4,000', driver: 'حيدر', receiptUrl: 'https://driver.iq/r/ride_1', orderId: 'ride_1' } }]);
    expect(await one(event('order.completed', {}, { orderId: 'ord_1' }))).toEqual([]);
    // Maps program SP5b: "الدليفري يوصل بعد دقيقتين" with the cash to have ready; rides never get it.
    expect(await one(event('stop.courier_near', { stopId: 's2', distanceM: 480 }, { orderId: 'ord_1', actorId: 'courier' }))).toEqual([
      { template: 'courier_arriving', to: 'cust', params: { name: '', courier: 'كرار', merchant: 'مطعم خالد', amount: '12,500', orderId: 'ord_1' } },
    ]);
    expect(await one(event('stop.courier_near', { stopId: 's2' }, { orderId: 'ride_1', actorId: 'drv' }))).toEqual([]);
    expect(await one(event('merchant.paid_by_courier', { handoverId: 'MH-1', merchantId: 'org_k', courierId: 'courier', amountIqd: 45_000, merchantBalanceIqd: 5_000 }))).toEqual([
      { template: 'merchant_cash_handover', to: 'owner', params: { store: 'مطعم خالد', amount: '45,000', courier: 'كرار', date: '2026-10-04', balance: '5,000', reference: 'MH-1' } },
    ]);
    expect(await one(event('ops.cash_received', { courierId: 'courier', amountIqd: 60_000, courierCashAfterIqd: -15_000 }))).toEqual([{ template: 'courier_cash_receipt', to: 'courier', params: { amount: '60,000', date: '2026-10-04', balance: '-15,000' } }]);
    expect(await one(event('wallet.topped_up', { customerId: 'cust', amountIqd: 25_000, reference: 'TU-7' }))).toEqual([{ template: 'wallet_topup_receipt', to: 'cust', params: { amount: '25,000', date: '2026-10-04', reference: 'TU-7' } }]);
    // "الخردة علينا": "+7,250 دينار رصيد (الباقي)" when the courier had no change.
    expect(await one(event('order.change_to_wallet', { customerId: 'cust', courierId: 'courier', tripId: 't1', amountIqd: 7_250, collectedIqd: 25_000, totalIqd: 17_750 }, { orderId: 'ord_1' }))).toEqual([{ template: 'cash_change_credit', to: 'cust', params: { amount: '\u2066+7,250\u2069' } }]);
    expect(await one(event('order.change_to_wallet', { customerId: 'cust', amountIqd: 0 }, { orderId: 'ord_1' }))).toEqual([]);
    expect(await one(event('seat.booked', { bookingId: 'bk_1' }))).toEqual([
      { template: 'rajaa_boarding_pass', to: 'cust', params: { route: 'العزيزية ← بغداد', date: '2026-10-05', time: '7:30 ص', seat: 'A1', vehicle: 'كيا · 12345', place: 'كراج البوابة 1', pin: '4821', bookingId: 'bk_1' } },
    ]);
    expect(await one(event('khat.child_tapped_out', { childRef: 'chref_z', stopId: 'st1', notifyGuardian: true }, { tripId: 'trp_1' }))).toEqual([{ template: 'khat_child_arrived', to: 'guardian', params: { child: 'زينب', place: 'مدرسة الرافدين', time: '12:30 م' } }]);
    expect(await one(event('khat.child_tapped_out', { childRef: 'chref_z', notifyGuardian: false }))).toEqual([]);
    // The late sweep (Ali, 2026-10-06): "نسيت تتأكد إن السيارة فاضية؟" to the run's driver.
    expect(await one(event('khat.sweep_missed', { alertId: 'ksw_1', driverId: 'drv', tripId: 'trp_1' }, { tripId: 'trp_1' }))).toEqual([{ template: 'khat_sweep_reminder', to: 'drv', params: {} }]);
    expect(await one(event('khat.sweep_missed', { alertId: 'ksw_1' }, { tripId: 'trp_1' }))).toEqual([]);
    expect(await one(event('dispatch.offer_sent', { driverId: 'drv' }, { tripId: 'trp_1' }))).toEqual([{ template: 'partner_new_job', to: 'drv', params: { pickup: 'العزيزية (مركز)', dropoff: 'شارع ٣٠' } }]);
    // Maps program o5: "send drivers here" is one push per free driver around the zone.
    expect(await one(event('dispatch.zone_nudged', { zoneId: 'centre', zoneName_ar: 'العزيزية (مركز)', driverIds: ['d1', 'd2'] }))).toEqual([
      { template: 'partner_zone_nudge', to: 'd1', params: { zone: 'العزيزية (مركز)' } },
      { template: 'partner_zone_nudge', to: 'd2', params: { zone: 'العزيزية (مركز)' } },
    ]);
    expect(await one(event('order.accepted', {}, { orderId: 'gone' }))).toEqual([]);
    // M-12: the kitchen's one "+5 د" — the customer hears "المطعم زاد 5 دقايق".
    expect(await one(event('order.prep_extended', { minutes: 5 }, { orderId: 'ord_1' }))).toEqual([{ template: 'order_prep_extended', to: 'cust', params: { merchant: 'مطعم خالد', orderId: 'ord_1' } }]);
    // J1c f4: the two ride peaks reach a phone in a pocket — a driver took it, and he is at the pickup.
    expect(await one(event('order.matched', { tripId: 'trp_1', driverId: 'drv' }, { orderId: 'ride_1', actorId: 'drv' }))).toEqual([{ template: 'ride_matched', to: 'cust', params: { driver: 'حيدر', orderId: 'ride_1' } }]);
    expect(await one(event('order.matched', { driverId: 'drv' }, { orderId: 'ord_1', actorId: 'drv' }))).toEqual([]);
    expect(await one(event('stop.arrived', { stopId: 's1', stopType: 'pickup' }, { orderId: 'ride_1', actorId: 'drv' }))).toEqual([{ template: 'driver_arrived', to: 'cust', params: { driver: 'حيدر', orderId: 'ride_1' } }]);
    expect(await one(event('stop.arrived', { stopId: 's2', stopType: 'dropoff' }, { orderId: 'ride_1', actorId: 'drv' }))).toEqual([]);
    expect(await one(event('stop.arrived', { stopId: 's1', stopType: 'pickup' }, { orderId: 'ord_1', actorId: 'courier' }))).toEqual([]);
    expect(await one(event('order.prep_extended', { minutes: 5 }, { orderId: 'ride_1' }))).toEqual([]);
    // The honest-delay promise, step one: "آسفين، طلبك تأخر شوية" with the new time (12:55 Baghdad).
    expect(await one(event('order.late_apology', { customerId: 'cust', promisedAt: '2026-10-04T09:20:00Z', etaAt: '2026-10-04T09:55:00Z' }, { orderId: 'ord_1' }))).toEqual([
      { template: 'order_late_apology', to: 'cust', params: { time: '12:55 م', orderId: 'ord_1' } },
    ]);
    expect(await one(event('order.late_apology', { customerId: 'cust', etaAt: 'not a time' }, { orderId: 'ord_1' }))).toEqual([]);
  });

  it('the late apology is a push with an SMS twin: title, the new time, the order screen', async () => {
    const h = notifyHarness();
    let handler: EventHandler | undefined;
    registerNotifySubscribers({ subscribe: (_n, _t, fn) => ((handler = fn), () => undefined) }, deps(h));
    await h.register('cust', 'ExponentPushToken[c1]', 'customer', 's1');
    const apology = event('order.late_apology', { customerId: 'cust', etaAt: '2026-10-04T09:55:00Z' }, { orderId: 'ord_1' });
    const ctx = { tx: undefined as never, subscriber: NOTIFY_SUBSCRIBER };
    await handler!(apology, ctx);
    await handler!(apology, ctx); // at-least-once outbox: still one message
    await h.run();
    const rows = await h.rows({ orderId: 'ord_1' });
    expect(rows.map((r) => [r.template, r.channel])).toEqual([['order_late_apology', 'push']]);
    expect(rows[0]!.payload).toMatchObject({ title: 'آسفين، طلبك تأخر شوية', body: 'يوصلك تقريباً الساعة 12:55 م. تگدر تتابعه من صفحة الطلب' });
  });

  it('registers one named subscriber; a redelivered event notifies once; sign-out drops the session tokens', async () => {
    const h = notifyHarness();
    let handler: EventHandler | undefined;
    const events = {
      subscribe: (name: string, types: readonly string[] | '*', fn: EventHandler) => {
        expect(name).toBe(NOTIFY_SUBSCRIBER);
        expect(types).toEqual(NOTIFY_EVENT_TYPES);
        handler = fn;
        return () => undefined;
      },
    };
    registerNotifySubscribers(events, deps(h));
    await h.register('cust', 'ExponentPushToken[c1]', 'customer', 's1');
    const delivered = event('order.delivered', {}, { orderId: 'ord_1' });
    const ctx = { tx: undefined as never, subscriber: NOTIFY_SUBSCRIBER };
    await handler!(delivered, ctx);
    await handler!(delivered, ctx); // at-least-once outbox
    await h.run();
    expect((await h.rows({ orderId: 'ord_1' })).map((r) => [r.channel, r.status])).toEqual([
      ['push', 'sent'],
      ['whatsapp', 'delivered'],
    ]);
    await handler!(event('session.signed_out', { personId: 'cust', sessionId: 's1' }), ctx);
    expect(await h.repo.tokensOf('cust')).toEqual([]);
  });

  it('a failing lookup skips the message instead of failing the outbox delivery', async () => {
    const h = notifyHarness();
    let handler: EventHandler | undefined;
    registerNotifySubscribers({ subscribe: (_n, _t, fn) => ((handler = fn), () => undefined) }, { ...deps(h), lookups: { ...lookups, order: async () => Promise.reject(new Error('db hiccup')) } });
    await expect(handler!(event('order.delivered', {}, { orderId: 'ord_1' }), { tx: undefined as never, subscriber: NOTIFY_SUBSCRIBER })).resolves.toBeUndefined();
    expect(await h.rows()).toEqual([]);
  });
});
