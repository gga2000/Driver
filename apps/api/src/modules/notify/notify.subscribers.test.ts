import { describe, expect, it } from 'vitest';
import type { EventHandler, PublishedEvent } from '../events/index.js';
import type { NotifyLookups } from './notify.lookups.js';
import { decodeRajaaPassPush } from '@driver/contracts';
import { NOTIFY_EVENT_TYPES, NOTIFY_SUBSCRIBER, passUpdatesFor, registerNotifySubscribers, requestsFor } from './notify.subscribers.js';
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
  departurePasses: async (id) => (id === 'dep_1' ? passes : null),
};

/** dep_1: two riders still to board (garage, meeting point), one checked in, one cancelled. */
let passes: Awaited<ReturnType<NotifyLookups['departurePasses']>> & object = [];
const pass = (bookingId: string, riderId: string, state: string, over: Partial<(typeof passes)[number]> = {}) => ({
  bookingId,
  riderId,
  state,
  departAt: new Date('2026-10-04T15:30:00Z'),
  stop: 'كراج النهضة',
  pickupKind: 'garage' as const,
  toCity: 'العزيزية',
  seatIds: ['back_left'],
  pin: '5481',
  carKm: 1.2,
  fareIqd: 10_000,
  ...over,
});

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
    // Menu photo service (maps k3): the visit's photos are handed over — «صور المنيو جاهزة» to the owners.
    expect(await one(event('menu_photos.shot', { requestId: 'mpr_1', merchantOrgId: 'org_k', photos: 4 }))).toEqual([{ template: 'menu_photos_ready', to: 'owner', params: { store: 'مطعم خالد' } }]);
    expect(await one(event('menu_photos.shot', { requestId: 'mpr_1' }))).toEqual([]);
    expect(await one(event('ops.cash_received', { courierId: 'courier', amountIqd: 60_000, courierCashAfterIqd: -15_000 }))).toEqual([{ template: 'courier_cash_receipt', to: 'courier', params: { amount: '60,000', date: '2026-10-04', balance: '-15,000' } }]);
    expect(await one(event('wallet.topped_up', { customerId: 'cust', amountIqd: 25_000, reference: 'TU-7' }))).toEqual([{ template: 'wallet_topup_receipt', to: 'cust', params: { amount: '25,000', date: '2026-10-04', reference: 'TU-7' } }]);
    // "الخردة علينا": "+7,250 دينار رصيد (الباقي)" when the courier had no change.
    expect(await one(event('order.change_to_wallet', { customerId: 'cust', courierId: 'courier', tripId: 't1', amountIqd: 7_250, collectedIqd: 25_000, totalIqd: 17_750 }, { orderId: 'ord_1' }))).toEqual([{ template: 'cash_change_credit', to: 'cust', params: { amount: '\u2066+7,250\u2069' } }]);
    expect(await one(event('order.change_to_wallet', { customerId: 'cust', amountIqd: 0 }, { orderId: 'ord_1' }))).toEqual([]);
    // The tip after a 4–5 rating (Ali, 2026-10-06): «علي كرمك 1,000 دينار» to the driver who carried it.
    expect(await one(event('order.tipped', { customerId: 'cust', courierId: 'courier', tripId: 't1', amountIqd: 1000 }, { orderId: 'ord_1' }))).toEqual([{ template: 'tip_received', to: 'courier', params: { name: 'الزبون', amount: '1,000', id: '1284' } }]);
    expect(await one(event('order.tipped', { customerId: 'drv', courierId: 'courier', tripId: 't1', amountIqd: 2000 }, { orderId: 'ord_1' }))).toEqual([{ template: 'tip_received', to: 'courier', params: { name: 'حيدر', amount: '2,000', id: '1284' } }]);
    expect(await one(event('order.tipped', { customerId: 'cust', courierId: 'courier', amountIqd: 0 }, { orderId: 'ord_1' }))).toEqual([]);
    // Joy l4: the customer's kind words after a 4–5 rating, to the courier who carried it (unknown keys dropped).
    expect(await one(event('order.complimented', { customerId: 'drv', courierId: 'courier', tripId: 't1', keys: ['fast', 'polite', 'shouty'] }, { orderId: 'ord_1' }))).toEqual([
      { template: 'compliment_received', to: 'courier', params: { name: 'حيدر', words: 'سريع، مؤدب', id: '1284' } },
    ]);
    expect(await one(event('order.complimented', { customerId: 'cust', courierId: 'courier', tripId: 't1', keys: [] }, { orderId: 'ord_1' }))).toEqual([]);
    // S-7 follow-up: support answered a driver's pay objection — the push opens that job's receipt.
    expect(await one(event('support.replied', { ticketId: 'tk1', customerId: null, text: 'نراجع\nالحساب', driverId: 'drv', jobKey: 't_ride', jobAt: '2026-10-03T15:30:00.000Z' }))).toEqual([
      { template: 'driver_pay_reply', to: 'drv', params: { text: 'نراجع الحساب', key: 't_ride', at: '2026-10-03T15%3A30%3A00.000Z' } },
    ]);
    expect(await one(event('support.resolved', { ticketId: 'tk1', resolution: 'الحساب صحيح', driverId: 'drv', jobKey: 't_ride', jobAt: '2026-10-03T15:30:00.000Z' }))).toEqual([
      { template: 'driver_pay_resolved', to: 'drv', params: { text: 'الحساب صحيح', key: 't_ride', at: '2026-10-03T15%3A30%3A00.000Z' } },
    ]);
    // A customer's ticket (no driver on it) is not this push.
    expect(await one(event('support.replied', { ticketId: 'tk2', customerId: 'cust', text: 'هلا' }))).toEqual([]);
    expect(await one(event('seat.booked', { bookingId: 'bk_1' }))).toEqual([
      { template: 'rajaa_boarding_pass', to: 'cust', params: { route: 'العزيزية ← بغداد', date: '2026-10-05', time: '7:30 ص', seat: 'A1', vehicle: 'كيا · 12345', place: 'كراج البوابة 1', pin: '4821', bookingId: 'bk_1' } },
    ]);
    expect(await one(event('khat.child_tapped_out', { childRef: 'chref_z', stopId: 'st1', notifyGuardian: true }, { tripId: 'trp_1' }))).toEqual([{ template: 'khat_child_arrived', to: 'guardian', params: { child: 'زينب', place: 'مدرسة الرافدين', time: '12:30 م' } }]);
    expect(await one(event('khat.child_tapped_out', { childRef: 'chref_z', notifyGuardian: false }))).toEqual([]);
    // The late sweep (Ali, 2026-10-06): "نسيت تتأكد إن السيارة فاضية؟" to the run's driver.
    expect(await one(event('khat.sweep_missed', { alertId: 'ksw_1', driverId: 'drv', tripId: 'trp_1' }, { tripId: 'trp_1' }))).toEqual([{ template: 'khat_sweep_reminder', to: 'drv', params: {} }]);
    expect(await one(event('khat.sweep_missed', { alertId: 'ksw_1' }, { tripId: 'trp_1' }))).toEqual([]);
    expect(await one(event('dispatch.offer_sent', { driverId: 'drv' }, { tripId: 'trp_1' }))).toEqual([{ template: 'partner_new_job', to: 'drv', params: { pickup: 'العزيزية (مركز)', dropoff: 'شارع ٣٠' } }]);
    // A ride's wave offers it to several drivers at once: each hears «طلب جديد», once.
    expect(await one(event('dispatch.wave_sent', { wave: 1, driverIds: ['d1', 'd2', 'd1'], seconds: 15 }, { tripId: 'trp_1' }))).toEqual([
      { template: 'partner_new_job', to: 'd1', params: { pickup: 'العزيزية (مركز)', dropoff: 'شارع ٣٠' } },
      { template: 'partner_new_job', to: 'd2', params: { pickup: 'العزيزية (مركز)', dropoff: 'شارع ٣٠' } },
    ]);
    expect(await one(event('dispatch.wave_sent', { wave: 1, driverIds: [] }, { tripId: 'trp_1' }))).toEqual([]);
    // Maps program o5: "send drivers here" is one push per free driver around the zone.
    expect(await one(event('dispatch.zone_nudged', { zoneId: 'centre', zoneName_ar: 'العزيزية (مركز)', driverIds: ['d1', 'd2'] }))).toEqual([
      { template: 'partner_zone_nudge', to: 'd1', params: { zone: 'العزيزية (مركز)' } },
      { template: 'partner_zone_nudge', to: 'd2', params: { zone: 'العزيزية (مركز)' } },
    ]);
    // Ride step 3 (n4): «نبّهه» — one soft «راكب ينتظرك» to the nudged driver.
    expect(await one(event('dispatch.offer_nudged', { offerId: 'do_1', driverId: 'drv' }, { tripId: 'trp_1', actorId: 'cust' }))).toEqual([{ template: 'ride_nudge', to: 'drv', params: {} }]);
    expect(await one(event('dispatch.offer_nudged', { offerId: 'do_1' }, { tripId: 'trp_1' }))).toEqual([]);
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

  it('w9 + r2: the trusted people hear «وصلت بالسلامة» and get auto-shared links only when the rider turned it on', async () => {
    const h = notifyHarness();
    const on = { autoShareRajaa: true, autoShareNight: true, notifyOnArrival: true };
    const off = { autoShareRajaa: false, autoShareNight: false, notifyOnArrival: false };
    const make = (prefs: typeof on, contacts = 2) => ({
      ...deps(h),
      lookups: {
        ...lookups,
        booking: async (id: string) => (id === 'bk_1' ? { ...(await lookups.booking('bk_1'))!, firstSeat: 'back_left' } : null),
        firstName: async (personId: string) => (personId === 'cust' ? 'زينب' : null),
        safety: async () => ({ prefs, contacts }),
        shareLink: async (_p: string, s: { bookingId: string } | { orderId: string }) => `https://driver.iq/share/shr_${'bookingId' in s ? s.bookingId : s.orderId}`,
      },
    });
    const one = async (e: PublishedEvent, d = make(on)) => (await requestsFor(e, d)).map((r) => ({ template: r.template, to: r.to, params: r.params }));

    // Arrival (09:30Z = 12:30 Baghdad): once per booking, on its first seat, to each trusted person.
    const arrived = event('seat.completed', { seatId: 'bk_1.back_left', customerId: 'cust' });
    expect(await one(arrived)).toEqual([
      { template: 'rajaa_arrived_contact', to: 'tc:cust:0', params: { name: 'زينب', route: 'العزيزية ← بغداد', time: '12:30 م' } },
      { template: 'rajaa_arrived_contact', to: 'tc:cust:1', params: { name: 'زينب', route: 'العزيزية ← بغداد', time: '12:30 م' } },
    ]);
    expect(await one(event('seat.completed', { seatId: 'bk_1.back_right', customerId: 'cust' }))).toEqual([]);
    expect(await one(arrived, make(off))).toEqual([]);
    expect(await one(arrived, make(on, 0))).toEqual([]);

    // Boarding: the trip's link when «شارك رحلات الرجعة تلقائياً» is on.
    expect(await one(event('seat.checked_in', { bookingId: 'bk_1', riderId: 'cust' }), make(on, 1))).toEqual([
      { template: 'trip_shared_contact', to: 'tc:cust:0', params: { name: 'زينب', what: 'الرجعة العزيزية ← بغداد', link: 'https://driver.iq/share/shr_bk_1' } },
    ]);
    expect(await one(event('seat.checked_in', { bookingId: 'bk_1', riderId: 'cust' }), make(off))).toEqual([]);

    // A ride matched at night (22:00 Baghdad) is shared; by day it is not.
    const night = event('order.matched', { driverId: 'drv' }, { orderId: 'ride_1', actorId: 'drv', occurredAt: new Date('2026-10-04T19:00:00Z') });
    expect((await one(night, make(on, 1))).map((r) => r.template)).toEqual(['ride_matched', 'trip_shared_contact']);
    expect((await one(event('order.matched', { driverId: 'drv' }, { orderId: 'ride_1', actorId: 'drv' }), make(on, 1))).map((r) => r.template)).toEqual(['ride_matched']);
  });
});

describe('الرجعة lock-screen pass updates (customer d-8 follow-up)', () => {
  const dep = (type: string, payload: Record<string, unknown> = {}) => event(type, { departureId: 'dep_1', ...payload }, { aggregate: 'departure', aggregateId: 'dep_1', id: `ev-${type}` });
  const decoded = async (e: PublishedEvent) => (await passUpdatesFor(e, lookups)).map((r) => ({ to: r.to, template: r.template, push: decodeRajaaPassPush(r.data) }));

  it('boarding reaches every rider still to board, with the car\'s distance to his own stop', async () => {
    passes = [pass('bk_a', 'r_a', 'booked'), pass('bk_b', 'r_b', 'booked', { stop: 'جسر ديالى', pickupKind: 'meeting_point', carKm: 6.4 }), pass('bk_c', 'r_c', 'checked_in'), pass('bk_d', 'r_d', 'cancelled')];
    const out = await decoded(dep('departure.boarding'));
    expect(out.map((o) => [o.to, o.template, o.push?.phase, o.push?.stop, o.push?.carKm])).toEqual([
      ['r_a', 'rajaa_pass_update', 'boarding', 'كراج النهضة', 1.2],
      ['r_b', 'rajaa_pass_update', 'boarding', 'جسر ديالى', 6.4],
    ]);
    expect(out[0]!.push).toMatchObject({ bookingId: 'bk_a', pin: '5481', seatIds: ['back_left'], toCity: 'العزيزية', sentAt: AT });
  });

  it('a seat event updates only its booking: on board, then gone when cancelled or a prepaid no-show', async () => {
    passes = [pass('bk_a', 'r_a', 'checked_in'), pass('bk_b', 'r_b', 'booked')];
    expect((await decoded(dep('seat.checked_in', { bookingId: 'bk_a', riderId: 'r_a' }))).map((o) => [o.to, o.push?.phase, o.push?.carKm])).toEqual([['r_a', 'on_board', null]]);
    passes = [pass('bk_a', 'r_a', 'checked_in'), pass('bk_b', 'r_b', 'no_show')];
    expect((await decoded(dep('seat.no_show', { seatId: 'bk_b.back_left' }))).map((o) => [o.to, o.push?.phase])).toEqual([['r_b', 'gone']]);
    expect(await decoded(dep('seat.checked_in', {}))).toEqual([]);
  });

  it('on the road for those on board, arrived with the fare, nothing for an unknown departure', async () => {
    passes = [pass('bk_a', 'r_a', 'checked_in'), pass('bk_b', 'r_b', 'no_show')];
    expect((await decoded(dep('departure.departed'))).map((o) => [o.to, o.push?.phase])).toEqual([['r_a', 'on_road']]);
    passes = [pass('bk_a', 'r_a', 'completed', { fareIqd: 12_500 })];
    expect((await decoded(dep('departure.arrived'))).map((o) => [o.to, o.push?.phase, o.push?.fareIqd])).toEqual([['r_a', 'arrived', 12_500]]);
    expect(await passUpdatesFor(event('departure.departed', { departureId: 'dep_x' }), lookups)).toEqual([]);
    expect(await passUpdatesFor(event('order.accepted', {}, { orderId: 'ord_1' }), lookups)).toEqual([]);
  });

  it('is subscribed, and goes through requestsFor next to any message the event already sends', async () => {
    for (const t of ['departure.boarding', 'departure.departed', 'departure.arrived', 'seat.checked_in', 'departure.cancelled']) expect(NOTIFY_EVENT_TYPES).toContain(t);
    passes = [pass('bk_a', 'r_a', 'booked')];
    const h = notifyHarness();
    expect((await requestsFor(dep('departure.boarding'), deps(h))).map((r) => r.template)).toEqual(['rajaa_pass_update']);
  });
});

describe('joy w4 / w6 notifications', () => {
  const one = async (e: PublishedEvent) => (await requestsFor(e, deps(notifyHarness()))).map((r) => ({ template: r.template, to: r.to, params: r.params }));

  it('the payer hears about a request that waits for him, with the kitchen and the amount', async () => {
    expect(await one(event('org.payer_approval_requested', { orgId: 'h1', orderId: 'ord_1', payerId: 'payer', amountIqd: 32_000, requestId: 'pay_1', reason: 'order_limit' }, { actorId: 'drv' }))).toEqual([
      { template: 'household_approval', to: 'payer', params: { name: 'حيدر', what: 'مطعم خالد · ', amount: '32,000' } },
    ]);
    expect(await one(event('org.payer_approval_requested', { payerId: 'payer', amountIqd: 9_000, orderId: 'gone' }, { actorId: 'nobody' }))).toEqual([
      { template: 'household_approval', to: 'payer', params: { name: 'فرد من العائلة', what: '', amount: '9,000' } },
    ]);
    expect(await one(event('org.payer_approval_requested', { amountIqd: 9_000 }))).toEqual([]);
  });

  it('«شهرك» is ready: one marketing push to that person, with the month for the link', async () => {
    expect(await one(event('insights.month_ready', { personId: 'cust', month: '2026-09' }))).toEqual([{ template: 'month_ready', to: 'cust', params: { month: '2026-09' } }]);
    expect(await one(event('insights.month_ready', { personId: 'cust', month: 'September' }))).toEqual([]);
    expect(NOTIFY_EVENT_TYPES).toEqual(expect.arrayContaining(['org.payer_approval_requested', 'insights.month_ready']));
  });
});

describe('taxi/tuktuk safety pushes (ride step 3: d3, s2)', () => {
  const NIGHT = new Date('2026-10-04T19:40:00Z'); // 22:40 Baghdad
  /** ride_2 was booked by cust for mum (s3); ride_1 is cust's own. */
  const rideLookups = (notifyOnArrival: boolean, accounts: string[] = ['sister', 'brother']): NotifyLookups => ({
    ...lookups,
    order: async (id) => (id === 'ride_2' ? { id, type: 'ride', customerId: 'cust', riderId: 'mum', merchantOrgId: null, totalIqd: 4000, itemCount: 0 } : lookups.order(id)),
    firstName: async (personId) => ({ drv: 'حيدر', mum: 'أم علي' })[personId] ?? null,
    safety: async () => ({ prefs: { autoShareRajaa: false, autoShareNight: false, notifyOnArrival }, contacts: 2 }),
    trustedAccounts: async (personId) => (personId === 'mum' || personId === 'cust' ? accounts : []),
  });
  const run = async (e: PublishedEvent, L: NotifyLookups) => (await requestsFor(e, { ...deps(notifyHarness()), lookups: L })).map((r) => ({ template: r.template, to: r.to, params: r.params }));

  it('«السايق قريب، اطلع هسة» goes to the orderer and the rider he booked for, rides only', async () => {
    const L = rideLookups(false);
    expect(await run(event('stop.driver_near', { stopId: 's1', etaSec: 50 }, { orderId: 'ride_1', actorId: 'drv' }), L)).toEqual([{ template: 'ride_near', to: 'cust', params: { orderId: 'ride_1' } }]);
    expect(await run(event('stop.driver_near', { stopId: 's1', etaSec: 50 }, { orderId: 'ride_2', actorId: 'drv' }), L)).toEqual([
      { template: 'ride_near', to: 'cust', params: { orderId: 'ride_2' } },
      { template: 'ride_near', to: 'mum', params: { orderId: 'ride_2' } },
    ]);
    expect(await run(event('stop.driver_near', { stopId: 's1', etaSec: 50 }, { orderId: 'ord_1' }), L)).toEqual([]);
    expect(NOTIFY_EVENT_TYPES).toContain('stop.driver_near');
  });

  it('«وصل بالسلامة»: a ride that ends at night reaches the rider’s trusted people who have the app', async () => {
    const done = event('order.completed', {}, { orderId: 'ride_2', actorId: 'drv', occurredAt: NIGHT });
    const out = await run(done, rideLookups(true));
    expect(out.map((r) => r.template)).toEqual(['ride_receipt', 'ride_safe_arrival', 'ride_safe_arrival']);
    expect(out.slice(1)).toEqual([
      { template: 'ride_safe_arrival', to: 'sister', params: { name: 'أم علي', time: '10:40 م' } },
      { template: 'ride_safe_arrival', to: 'brother', params: { name: 'أم علي', time: '10:40 م' } },
    ]);
  });

  it('nothing extra by day, with the switch off, or when no trusted person has the app', async () => {
    const byDay = event('order.completed', {}, { orderId: 'ride_2', actorId: 'drv' });
    const atNight = event('order.completed', {}, { orderId: 'ride_2', actorId: 'drv', occurredAt: NIGHT });
    expect((await run(byDay, rideLookups(true))).map((r) => r.template)).toEqual(['ride_receipt']);
    expect((await run(atNight, rideLookups(false))).map((r) => r.template)).toEqual(['ride_receipt']);
    expect((await run(atNight, rideLookups(true, []))).map((r) => r.template)).toEqual(['ride_receipt']);
  });

  it('a rider with no name on file is «واحد من أهلك»', async () => {
    const L = { ...rideLookups(true), firstName: async () => null };
    const out = await run(event('order.completed', {}, { orderId: 'ride_1', actorId: 'drv', occurredAt: NIGHT }), L);
    expect(out[1]!.params).toMatchObject({ name: 'واحد من أهلك' });
  });
});

describe('a ride booked for someone else (ride ideas c9/s3)', () => {
  /** ride_2 was booked by cust for mum («ماما»); ride_1 is cust's own. */
  const forMum = (over: Partial<NotifyLookups> = {}): NotifyLookups => ({
    ...lookups,
    order: async (id) => (id === 'ride_2' ? { id, type: 'ride', customerId: 'cust', riderId: 'mum', merchantOrgId: null, totalIqd: 4000, itemCount: 0 } : lookups.order(id)),
    firstName: async (personId) => ({ drv: 'حيدر', cust: 'علي' })[personId] ?? null,
    shareLink: async (personId, subject) => (personId === 'mum' && 'orderId' in subject ? `https://driver.iq/t/${subject.orderId}` : null),
    riderName: async (orderId) => (orderId === 'ride_2' ? 'ماما' : null),
    driverCar: async (tripId, driverId) => (tripId === 'trp_2' && driverId === 'drv' ? { car: 'تويوتا كورولا · أبيض', plate: 'بغداد 12345' } : null),
    ...over,
  });
  const run = async (e: PublishedEvent, L: NotifyLookups) => (await requestsFor(e, { ...deps(notifyHarness()), lookups: L })).map((r) => ({ template: r.template, to: r.to, params: r.params }));
  const matched = event('order.matched', { tripId: 'trp_2', driverId: 'drv' }, { orderId: 'ride_2', actorId: 'drv' });

  it('when a driver takes it, the rider gets who is coming and the live link; the booker as always', async () => {
    expect(await run(matched, forMum())).toEqual([
      { template: 'ride_matched', to: 'cust', params: { driver: 'حيدر', orderId: 'ride_2' } },
      { template: 'ride_for_rider', to: 'mum', params: { booker: 'علي', driver: 'حيدر', car: 'تويوتا كورولا · أبيض', plate: 'بغداد 12345', link: 'https://driver.iq/t/ride_2', orderId: 'ride_2' } },
    ]);
    // His own ride: nothing extra.
    expect((await run(event('order.matched', { tripId: 'trp_1' }, { orderId: 'ride_1', actorId: 'drv' }), forMum())).map((r) => r.template)).toEqual(['ride_matched']);
  });

  it('a night ride’s start code goes in the rider’s message (s1)', async () => {
    const out = await run(matched, forMum({ startCode: async (orderId) => (orderId === 'ride_2' ? '4821' : null) }));
    expect(out[1]).toMatchObject({ template: 'ride_for_rider', to: 'mum', params: { code: '4821' } });
  });

  it('no link, no message; an unknown car or booker name still says who is coming', async () => {
    expect((await run(matched, forMum({ shareLink: async () => null }))).map((r) => r.template)).toEqual(['ride_matched']);
    const out = await run(matched, forMum({ driverCar: async () => null, firstName: async (p) => (p === 'drv' ? 'حيدر' : null) }));
    expect(out[1]!.params).toMatchObject({ booker: 'واحد من أهلك', car: 'تكسي', plate: '—' });
  });

  it('«وصل» reaches the rider too; the booker hears «مشوار ماما وصل بالسلامة» when it ends', async () => {
    const arrived = event('stop.arrived', { stopId: 's1', stopType: 'pickup' }, { orderId: 'ride_2', actorId: 'drv' });
    expect((await run(arrived, forMum())).map((r) => [r.template, r.to])).toEqual([
      ['driver_arrived', 'cust'],
      ['driver_arrived', 'mum'],
    ]);
    const done = await run(event('order.completed', {}, { orderId: 'ride_2', actorId: 'drv' }), forMum());
    expect(done).toEqual([
      { template: 'ride_receipt', to: 'cust', params: { amount: '4,000', driver: 'حيدر', receiptUrl: 'https://driver.iq/r/ride_2', orderId: 'ride_2' } },
      { template: 'ride_rider_arrived', to: 'cust', params: { name: 'ماما', time: '12:30 م', orderId: 'ride_2' } },
    ]);
    expect((await run(event('order.completed', {}, { orderId: 'ride_1', actorId: 'drv' }), forMum())).map((r) => r.template)).toEqual(['ride_receipt']);
  });
});

describe('W2: the turns that used to leave the customer staring at a screen', () => {
  const ETA = new Date('2026-10-04T09:52:00Z'); // 12:52 Baghdad
  const w2 = (over: Partial<NotifyLookups> = {}) => (h: ReturnType<typeof notifyHarness>) => ({
    ...deps(h),
    lookups: { ...lookups, deliveryEta: async (id: string) => (id === 'ord_1' ? ETA : null), stopOrder: async (tripId: string, stopId: string) => (tripId === 'trp_1' && stopId === 's2' ? 'ord_1' : null), ...over },
  });
  const run = async (e: PublishedEvent, over: Partial<NotifyLookups> = {}) => (await requestsFor(e, w2(over)(notifyHarness()))).map((r) => ({ template: r.template, to: r.to, params: r.params }));

  it('the kitchen said no, or never answered: told at once, naming the kitchen', async () => {
    expect(await run(event('order.rejected', { from: 'placed', to: 'merchant_rejected', reason: 'closing early' }, { orderId: 'ord_1' }))).toEqual([{ template: 'order_rejected', to: 'cust', params: { merchant: 'مطعم خالد', orderId: 'ord_1' } }]);
    expect(await run(event('order.rejected', { from: 'placed', to: 'merchant_rejected', reason: 'merchant_timeout' }, { orderId: 'ord_1', actorId: 'system' }))).toEqual([
      { template: 'order_kitchen_no_answer', to: 'cust', params: { merchant: 'مطعم خالد', orderId: 'ord_1' } },
    ]);
  });

  it('only what we cancelled is told; the household payer’s answer is named; his own cancel is silent', async () => {
    const cancel = (reason: string, cancelledState = 'platform_cancelled') => event('order.cancelled', { from: 'placed', to: cancelledState, cancelledState, by: 'platform', reason, free: true, feeIqd: 0 }, { orderId: 'ord_1' });
    expect(await run(cancel('payer_declined'))).toEqual([{ template: 'order_payer_declined', to: 'cust', params: { orderId: 'ord_1' } }]);
    expect(await run(cancel('payer_no_answer'))).toEqual([{ template: 'order_payer_no_answer', to: 'cust', params: { orderId: 'ord_1' } }]);
    expect(await run(cancel('partial_timeout'))).toEqual([{ template: 'order_cancelled', to: 'cust', params: { orderId: 'ord_1' } }]);
    expect(await run(cancel('changed_mind', 'customer_cancelled'))).toEqual([]);
  });

  it('picked up: the order screen’s own arrival time, or no time at all when none can be read', async () => {
    const picked = event('order.picked_up', { from: 'ready', to: 'picked_up', tripId: 'trp_1', courierId: 'courier' }, { orderId: 'ord_1', actorId: 'courier' });
    expect(await run(picked)).toEqual([{ template: 'order_picked_up', to: 'cust', params: { courier: 'كرار', orderId: 'ord_1', time: '12:52 م' } }]);
    expect(await run(picked, { deliveryEta: async () => null })).toEqual([{ template: 'order_on_the_way', to: 'cust', params: { courier: 'كرار', orderId: 'ord_1' } }]);
  });

  it('at the door, then can’t reach him: at once, and the minute-3 reminder found through its stop', async () => {
    expect(await run(event('stop.arrived', { stopId: 's2', stopType: 'dropoff' }, { orderId: 'ord_1', actorId: 'courier' }))).toEqual([{ template: 'courier_at_door', to: 'cust', params: { courier: 'كرار', orderId: 'ord_1' } }]);
    expect(await run(event('stop.arrived', { stopId: 's1', stopType: 'pickup' }, { orderId: 'ord_1', actorId: 'courier' }))).toEqual([]);
    expect(await run(event('trip.unreachable_started', { stopId: 's2' }, { orderId: 'ord_1', tripId: 'trp_1', actorId: 'courier' }))).toEqual([{ template: 'courier_unreachable', to: 'cust', params: { courier: 'كرار', orderId: 'ord_1' } }]);
    expect(await run(event('trip.unreachable_escalated', { stopId: 's2', courierId: 'courier' }, { tripId: 'trp_1', actorId: 'system' }))).toEqual([{ template: 'courier_unreachable_reminder', to: 'cust', params: { orderId: 'ord_1' } }]);
    expect(await run(event('trip.unreachable_escalated', { stopId: 's9' }, { tripId: 'trp_1', actorId: 'system' }))).toEqual([]);
  });

  it('rides keep their own messages: no delivery wording on a ride', async () => {
    expect(await run(event('order.picked_up', {}, { orderId: 'ride_1', actorId: 'drv' }))).toEqual([]);
    expect(await run(event('order.rejected', {}, { orderId: 'ride_1' }))).toEqual([]);
    expect((await run(event('stop.arrived', { stopType: 'pickup' }, { orderId: 'ride_1', actorId: 'drv' })))[0]?.template).toBe('driver_arrived');
  });
});
