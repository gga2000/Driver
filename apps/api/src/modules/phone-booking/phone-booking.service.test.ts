import { describe, expect, it } from 'vitest';
import { type Actor, type AppContext, type SessionClaims } from '@driver/contracts';
import { appRouter } from '@driver/contracts/router';
import { DevSmsProvider } from '../../shared/messaging/sms.js';
import { InMemoryQueue } from '../../shared/queue.js';
import { ConfigService } from '../config/index.js';
import { AuditLogService, InMemoryControlsRepository, StaffNames } from '../controls/index.js';
import { createInMemoryEvents } from '../events/index.js';
import { invitePhoneHint, normalizeIraqiPhone, shortDisplayName, type IdentityService } from '../identity/index.js';
import { NotifyEngine, type NotifyJob } from '../notify/notify.engine.js';
import { InMemoryNotifyRepository } from '../notify/notify.repository.js';
import { NotifyService } from '../notify/notify.service.js';
import { DevPushProvider } from '../notify/providers/push.js';
import { DevWhatsAppProvider } from '../notify/providers/whatsapp.js';
import { HOME, KITCHEN, ordersHarness } from '../orders/test-harness.js';
import { serverFees } from '../orders/index.js';
import { PricingService } from '../pricing/index.js';
import { InMemoryPhoneBookingsRepository } from './phone-booking.repository.js';
import { baghdadDay, carText, PhoneBookingService, phoneBookingStatus, type PhoneBookingSources, type PhoneBookingVehicle } from './phone-booking.service.js';

const HAIDER: Actor = { personId: 'p_haider', sessionId: 's-h' };
const CALLER = '0771 234 5678';
const LANDMARKS = [
  { id: 'lm_mosque', name_ar: 'جامع العزيزية الكبير', pin: KITCHEN, zoneId: 'centre' },
  { id: 'lm_market', name_ar: 'سوق الخضرة', pin: HOME, zoneId: 'zakur' },
];
const ZONES: Record<string, string> = { centre: 'المركز', zakur: 'الزكور' };

function harness(opts: { vehicle?: PhoneBookingVehicle | null; link?: boolean } = {}) {
  const h = ordersHarness('2026-10-07T07:00:00Z');
  const ev = createInMemoryEvents({ clock: h.clock, uow: h.uow });
  const pricing = new PricingService(new ConfigService());

  // Identity on maps: the number → person, the vault name and number per person (reads logged).
  const vault = new Map<string, { phone: string; name: string | null }>([['p_haider', { phone: '+9647700000002', name: 'حيدر جاسم' }], ['d1', { phone: '+9647701110001', name: 'عباس كريم' }]]);
  const vaultLog: string[] = [];
  let seq = 0;
  const idOf = (raw: string) => {
    const e164 = normalizeIraqiPhone(raw);
    return [...vault.entries()].find(([, v]) => v.phone === e164)?.[0] ?? null;
  };
  const identity = {
    personIdByPhone: async (raw: string) => idOf(raw),
    ensurePersonByPhone: async (raw: string, _actor: string, _via: string, o: { name?: string } = {}) => {
      const found = idOf(raw);
      if (found) {
        const v = vault.get(found)!;
        if (o.name && !v.name) v.name = o.name;
        return found;
      }
      const id = `p_caller_${++seq}`;
      vault.set(id, { phone: normalizeIraqiPhone(raw), name: o.name ?? null });
      return id;
    },
    displayNamesFor: async (ids: readonly string[], accessor: string, purpose: string) => {
      for (const id of ids) vaultLog.push(`${id}:name:${accessor}:${purpose}`);
      return Object.fromEntries(ids.filter((id) => vault.has(id)).map((id) => [id, { displayName: vault.get(id)!.name ? shortDisplayName(vault.get(id)!.name!) : null, deleted: false }]));
    },
    firstNamesFor: async (ids: readonly string[], accessor: string, purpose: string) => {
      for (const id of ids) vaultLog.push(`${id}:first:${accessor}:${purpose}`);
      return Object.fromEntries(ids.map((id) => [id, vault.get(id)?.name?.split(' ')[0] ?? null]));
    },
    invitePhoneHints: async (ids: readonly string[], accessor: string, purpose: string) => {
      for (const id of ids) vaultLog.push(`${id}:phone:${accessor}:${purpose}`);
      return Object.fromEntries(ids.filter((id) => vault.has(id)).map((id) => [id, invitePhoneHint(vault.get(id)!.phone)]));
    },
  } as unknown as IdentityService;

  const nrepo = new InMemoryNotifyRepository();
  const queue = new InMemoryQueue<NotifyJob>('notify', () => h.clock.now());
  const sms = new DevSmsProvider(false);
  const contacts = { contact: async (to: string, o: { phone: boolean }) => ({ locale: 'ar-IQ' as const, phoneE164: o.phone ? (vault.get(to)?.phone ?? null) : null }) };
  const engine = new NotifyEngine(nrepo, { push: { expo: new DevPushProvider(false), fcm: new DevPushProvider(false) }, sms, whatsapp: new DevWhatsAppProvider(false) }, contacts, queue, h.clock, { retryBaseMs: 1000, maxAttempts: 3, receiptDelaySec: 60 });
  queue.process((job) => engine.process(job.data));
  const notify = new NotifyService(undefined, engine, nrepo, h.clock);

  const controls = new InMemoryControlsRepository();
  const staff = new StaffNames(identity, h.clock);
  const vehicle: PhoneBookingVehicle | null = opts.vehicle === undefined ? { vehicleClass: 'car', plate: '23456 واسط', label: 'كيا سيراتو · فضي' } : opts.vehicle;
  const sources: PhoneBookingSources = {
    landmarks: async (cityId) => (cityId === 'aziziyah' ? LANDMARKS : []),
    zoneName: (_city, pin) => ZONES[LANDMARKS.find((l) => l.pin === pin)?.zoneId ?? ''] ?? null,
    fare: (q) => serverFees(pricing, { cityId: q.cityId, type: 'ride', rideVertical: q.vertical, pickup: q.pickup, dropoff: q.dropoff, options: { doorPickup: false }, at: q.at }).fareIqd,
    minutes: async (from, to, v, at) => (await h.eta.minutes(from, to, v, at)).minutes,
    ride: async (orderId) => {
      const c = await h.trips.courierOf(orderId);
      return c ? { trip: await h.trips.get(c.tripId), driverId: c.courierId } : null;
    },
    vehicle: async () => vehicle,
    // The driver 1.2 km south of the mosque when he takes it.
    driverPin: async () => ({ lat: KITCHEN.lat - 0.011, lng: KITCHEN.lng }),
    shareLink: async (_person, orderId) => (opts.link === false ? null : `https://driver.iq/share/tok_${orderId.slice(-4)}`),
  };
  const svc = new PhoneBookingService(new InMemoryPhoneBookingsRepository(), sources, identity, h.orders, notify, ev.events, new AuditLogService(controls, staff, h.clock), staff, h.uow, h.clock);
  svc.onModuleInit();

  /** What `orders.onTripEvent` would emit through the outbox (the orders harness records its own events instead). */
  const publish = async (type: 'order.matched' | 'stop.arrived', orderId: string, payload: Record<string, unknown>) => {
    await h.uow.run((tx) => ev.events.emit(tx, { type, actorId: 'd1', occurredAt: h.clock.now(), orderId, payload }, { name: 'order', id: orderId }));
    await queue.drain();
  };
  const quoteNow = () => svc.quote(HAIDER, { cityId: 'aziziyah', pickupId: 'lm_mosque', dropoffId: 'lm_market' });
  const book = async (patch: Partial<Parameters<PhoneBookingService['book']>[1]> = {}) => {
    const q = await quoteNow();
    const vertical = patch.vertical ?? 'taxi';
    return svc.book(HAIDER, { cityId: 'aziziyah', phone: CALLER, name: 'أبو حسين', pickupId: 'lm_mosque', dropoffId: 'lm_market', vertical, fareIqd: q.options.find((o) => o.vertical === vertical)!.fareIqd, clientRequestId: 'phone-0001', ...patch });
  };
  return { ...h, svc, ev, vault, vaultLog, controls, sms, nrepo, queue, publish, quoteNow, book, pricing };
}

describe('PhoneBookingService — quote', () => {
  it('quotes both vehicles at the server price between two landmarks, with the ride minutes', async () => {
    const h = harness();
    const q = await h.quoteNow();
    expect(q.pickup).toEqual({ id: 'lm_mosque', name_ar: 'جامع العزيزية الكبير', zoneId: 'centre', zoneName_ar: 'المركز' });
    expect(q.dropoff).toMatchObject({ id: 'lm_market', zoneName_ar: 'الزكور' });
    expect(q.options.map((o) => o.vertical)).toEqual(['taxi', 'tuktuk']);
    for (const o of q.options) {
      const fare = serverFees(h.pricing, { cityId: 'aziziyah', type: 'ride', rideVertical: o.vertical, pickup: { zoneKey: 'centre', pin: KITCHEN }, dropoff: { zoneKey: 'zakur', pin: HOME }, options: { doorPickup: false }, at: h.clock.now() }).fareIqd;
      expect(o).toMatchObject({ fareIqd: fare, totalIqd: fare });
      expect(o.rideMin).toBeGreaterThan(0);
    }
    // The tuktuk is the cheaper one, as in the app.
    expect(q.options[1]!.fareIqd).toBeLessThan(q.options[0]!.fareIqd);
  });

  it('refuses a place that is not a landmark of the city', async () => {
    const h = harness();
    await expect(h.svc.quote(HAIDER, { cityId: 'aziziyah', pickupId: 'lm_mosque', dropoffId: 'lm_nowhere' })).rejects.toMatchObject({ code: 'phone_booking_place_unknown' });
  });
});

describe('PhoneBookingService — booking', () => {
  it('creates the caller in the vault with the name heard and places his ordinary cash ride', async () => {
    const h = harness();
    const row = await h.book();
    const personId = [...h.vault.entries()].find(([, v]) => v.phone === '+9647712345678')![0];
    expect(h.vault.get(personId)!.name).toBe('أبو حسين');
    const order = await h.orders.get(row.orderId);
    expect(order).toMatchObject({ type: 'ride', state: 'placed', ordererId: personId, paymentMethod: 'cash', totalIqd: row.totalIqd });
    expect(row).toMatchObject({ callerName: 'أبو حسين', phoneHint: '0771 ••• 5678', vertical: 'taxi', pickupName: 'جامع العزيزية الكبير', dropoffName: 'سوق الخضرة', status: 'searching', driver: null, bookedByName: 'حيدر', cancellable: true, note: null });
    expect(row.ticket).toMatch(/^#\d{4}$/);
    // The caller's own history has it: signing in later with the number shows the ride.
    expect((await h.orders.listForPerson(personId)).map((o) => o.id)).toEqual([row.orderId]);
  });

  it('keeps a name the number already has and books the vehicle asked for, with the note for the driver', async () => {
    const h = harness();
    h.vault.set('p_known', { phone: '+9647712345678', name: 'زهراء علي' });
    const row = await h.book({ name: 'أم علي', vertical: 'tuktuk', note: 'يم باب الجامع، لابسة عباية' });
    expect(h.vault.get('p_known')!.name).toBe('زهراء علي');
    expect(row).toMatchObject({ callerName: 'زهراء ع.', vertical: 'tuktuk', note: 'يم باب الجامع، لابسة عباية' });
    const order = await h.orders.get(row.orderId);
    expect(order).toMatchObject({ ordererId: 'p_known', note: 'يم باب الجامع، لابسة عباية' });
  });

  it('audits who booked it, once, and a double click is the same ride', async () => {
    const h = harness();
    const a = await h.book();
    const b = await h.book();
    expect(b.orderId).toBe(a.orderId);
    const audit = await h.controls.audit({ subjectKind: 'order', subjectId: a.orderId, limit: 10 });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actorId: 'p_haider', action: 'ride.phone_booked', cityId: 'aziziyah', detail: { vertical: 'taxi', pickupId: 'lm_mosque', dropoffId: 'lm_market', totalIqd: a.totalIqd } });
    expect(audit[0]!.summaryAr).toBe(`حجز تكسي بالتلفون من جامع العزيزية الكبير لـسوق الخضرة (${a.ticket})`);
  });

  it('refuses a fare that is not the server price (price_changed) and a bad number (phone_invalid)', async () => {
    const h = harness();
    const q = await h.quoteNow();
    await expect(h.book({ fareIqd: q.options[0]!.fareIqd + 250 })).rejects.toMatchObject({ code: 'price_changed' });
    await expect(h.book({ phone: '0123' })).rejects.toMatchObject({ code: 'phone_invalid' });
    expect(await h.svc.today(HAIDER, { cityId: 'aziziyah' })).toEqual([]);
  });

  it('tells staff whether the number is known, its name and earlier phone rides', async () => {
    const h = harness();
    expect(await h.svc.caller(HAIDER, { phone: CALLER })).toEqual({ known: false, name: null, phoneRides: 0 });
    await h.book();
    h.clock.advance(60_000);
    expect(await h.svc.caller(HAIDER, { phone: '+964 771 234 5678' })).toEqual({ known: true, name: 'أبو حسين', phoneRides: 1 });
    await expect(h.svc.caller(HAIDER, { phone: '12' })).rejects.toMatchObject({ code: 'phone_invalid' });
  });
});

describe('PhoneBookingService — today and cancel', () => {
  it("lists today's bookings (Baghdad day), newest first, with the driver and plate once taken", async () => {
    const h = harness();
    const first = await h.book();
    h.clock.advance(5 * 60_000);
    const second = await h.book({ clientRequestId: 'phone-0002', phone: '07801112233', name: 'حسين' });
    const trip = await h.tripFor(first.orderId, { vertical: 'taxi', vehicleClass: 'car' });
    let rows = await h.svc.today(HAIDER, { cityId: 'aziziyah' });
    expect(rows.map((r) => r.orderId)).toEqual([second.orderId, first.orderId]);
    expect(rows[1]).toMatchObject({ status: 'driver_coming', driver: { firstName: 'عباس', vehicleLabel: 'كيا سيراتو · فضي', plate: '23456 واسط' }, cancellable: true });
    expect(rows[1]!.since).toEqual(trip.acceptedAt);
    expect(rows[0]).toMatchObject({ status: 'searching', driver: null, callerName: 'حسين' });

    await h.pickup(trip.id);
    rows = await h.svc.today(HAIDER, { cityId: 'aziziyah' });
    expect(rows[1]).toMatchObject({ status: 'on_trip', cancellable: false });

    // Tomorrow (Baghdad) the list starts empty.
    h.clock.set(new Date('2026-10-07T21:00:00Z'));
    expect(await h.svc.today(HAIDER, { cityId: 'aziziyah' })).toEqual([]);
  });

  it('reads caller names and numbers from the vault once per ten minutes per staff member', async () => {
    const h = harness();
    await h.book();
    const reads = () => h.vaultLog.filter((l) => l.startsWith('p_caller_1:')).length;
    const after = reads();
    await h.svc.today(HAIDER, { cityId: 'aziziyah' });
    await h.svc.today(HAIDER, { cityId: 'aziziyah' });
    expect(reads()).toBe(after);
    h.clock.advance(11 * 60_000);
    await h.svc.today(HAIDER, { cityId: 'aziziyah' });
    expect(reads()).toBe(after + 2);
    expect(h.vaultLog).toContain('p_caller_1:phone:p_haider:phone_booking_list');
  });

  it('cancels for the caller with the app rules (preview first) and audits it', async () => {
    const h = harness();
    const row = await h.book();
    expect(await h.svc.cancelPreview(HAIDER, { orderId: row.orderId })).toMatchObject({ allowed: true, free: true, amountIqd: 0 });
    const cancelled = await h.svc.cancel(HAIDER, { orderId: row.orderId });
    expect(cancelled).toMatchObject({ status: 'cancelled', cancellable: false });
    expect((await h.orders.get(row.orderId)).state).toBe('customer_cancelled');
    // A second click changes nothing and writes no second audit row.
    await h.svc.cancel(HAIDER, { orderId: row.orderId });
    const audit = await h.controls.audit({ subjectKind: 'order', subjectId: row.orderId, limit: 10 });
    expect(audit.map((a) => a.action).sort()).toEqual(['ride.phone_booked', 'ride.phone_cancelled']);
  });

  it('refuses an order that was not booked by phone', async () => {
    const h = harness();
    await expect(h.svc.cancel(HAIDER, { orderId: 'ord_app' })).rejects.toMatchObject({ code: 'phone_booking_not_found' });
    await expect(h.svc.cancelPreview(HAIDER, { orderId: 'ord_app' })).rejects.toMatchObject({ code: 'phone_booking_not_found' });
  });
});

describe('PhoneBookingService — the caller’s SMS', () => {
  it('texts the driver, car, plate, minutes away and the trip link when a driver takes it; then «وصل» with the fare', async () => {
    const h = harness();
    const row = await h.book();
    const trip = await h.tripFor(row.orderId, { vertical: 'taxi', vehicleClass: 'car' });
    await h.publish('order.matched', row.orderId, { tripId: trip.id, driverId: 'd1' });
    const pickup = trip.stops.find((s) => s.type === 'pickup')!;
    await h.publish('stop.arrived', row.orderId, { stopId: pickup.id, stopType: 'pickup' });
    // A drop-off arrival says nothing.
    await h.publish('stop.arrived', row.orderId, { stopId: 'x', stopType: 'dropoff' });
    const texts = h.sms.sentTo('+9647712345678').map((m) => m.body);
    expect(texts).toEqual([
      `درايفر: عباس جاي ياخذك: كيا سيراتو · فضي، لوحة 23456 واسط. يوصلك بعد 3 دقايق. تابعه: https://driver.iq/share/tok_${row.orderId.slice(-4)}`,
      `درايفر: عباس وصل وينتظرك: كيا سيراتو · فضي، لوحة 23456 واسط. الأجرة ${row.totalIqd.toLocaleString('en-US')} دينار كاش.`,
    ]);
    expect(row.totalIqd).toBe(4000);
    // Logged like every message, against the caller and the order.
    const log = (await h.nrepo.log({ personId: [...h.vault.keys()].find((k) => k.startsWith('p_caller'))!, limit: 10 })).filter((d) => d.channel === 'sms');
    expect(log.map((d) => d.template).sort()).toEqual(['phone_driver_arrived', 'phone_ride_matched']);
  });

  it('says only what it knows: no plate on file, no link', async () => {
    const h = harness({ vehicle: null, link: false });
    const row = await h.book({ vertical: 'tuktuk' });
    const trip = await h.tripFor(row.orderId, { vertical: 'taxi', vehicleClass: 'tuktuk' });
    await h.publish('order.matched', row.orderId, { tripId: trip.id, driverId: 'd1' });
    expect(h.sms.sentTo('+9647712345678').map((m) => m.body)).toEqual([expect.stringMatching(/^درايفر: عباس جاي ياخذك: تكتك\. يوصلك بعد (دقيقة|دقيقتين|\d+ دقايق|\d+ دقيقة)\.$/)]);
  });

  it('is silent for a ride booked in the app', async () => {
    const h = harness();
    const order = await h.orders.place('c1', { cityId: 'aziziyah', type: 'ride', rideVertical: 'taxi', options: { doorPickup: false }, paymentMethod: 'cash', pickup: { zoneKey: 'centre', pin: KITCHEN }, dropoff: { zoneKey: 'zakur', pin: HOME } });
    await h.publish('order.matched', order.id, { driverId: 'd1' });
    expect(h.sms.sent).toEqual([]);
  });
});

describe('phone booking helpers', () => {
  it('maps order and trip states to the Console status', () => {
    expect(phoneBookingStatus({ state: 'placed' }, null)).toBe('searching');
    expect(phoneBookingStatus({ state: 'matched' }, { state: 'accepted' })).toBe('driver_coming');
    expect(phoneBookingStatus({ state: 'matched' }, { state: 'en_route_to_pickup' })).toBe('driver_coming');
    expect(phoneBookingStatus({ state: 'matched' }, { state: 'arrived_pickup' })).toBe('driver_arrived');
    expect(phoneBookingStatus({ state: 'matched' }, { state: 'in_transit' })).toBe('on_trip');
    expect(phoneBookingStatus({ state: 'completed' }, { state: 'completed' })).toBe('done');
    expect(phoneBookingStatus({ state: 'customer_cancelled' }, null)).toBe('cancelled');
    expect(phoneBookingStatus({ state: 'failed' }, null)).toBe('cancelled');
  });

  it('writes the car as the label and plate, or the vehicle word alone', () => {
    expect(carText('taxi', { vehicleClass: 'car', plate: '12345 واسط', label: 'تويوتا كورولا · أبيض' })).toBe('تويوتا كورولا · أبيض، لوحة 12345 واسط');
    expect(carText('tuktuk', { vehicleClass: 'tuktuk', plate: '777 واسط', label: null })).toBe('تكتك، لوحة 777 واسط');
    expect(carText('taxi', null)).toBe('تكسي');
  });

  it("takes Baghdad's day for today", () => {
    expect(baghdadDay(new Date('2026-10-07T20:59:00Z'))).toEqual({ from: new Date('2026-10-06T21:00:00Z'), to: new Date('2026-10-07T21:00:00Z') });
    expect(baghdadDay(new Date('2026-10-07T21:00:00Z')).from).toEqual(new Date('2026-10-07T21:00:00Z'));
  });
});

describe('phoneBookings router', () => {
  const ctxFor = (roles: string[]) => {
    const calls: string[] = [];
    const port = new Proxy({}, { get: (_t, name: string) => async () => (calls.push(name), name === 'today' ? [] : name === 'caller' ? { known: false, name: null, phoneRides: 0 } : null) });
    const ctx = {
      auth: { sub: 'p_x', sid: 's' } as unknown as SessionClaims,
      identity: { hasRole: async (_p: string, kind: string) => roles.includes(kind) },
      phoneBookings: port,
    } as unknown as AppContext;
    return { caller: appRouter.createCaller(ctx), calls };
  };

  it('is for support, dispatchers and admins only', async () => {
    for (const role of ['support', 'dispatcher', 'admin']) {
      const { caller, calls } = ctxFor([role]);
      await caller.phoneBookings.today({ cityId: 'aziziyah' });
      await caller.phoneBookings.caller({ phone: CALLER });
      expect(calls).toEqual(['today', 'caller']);
    }
    for (const role of ['customer', 'field_ops', 'courier', 'merchant_owner']) {
      const { caller, calls } = ctxFor([role]);
      await expect(caller.phoneBookings.today({ cityId: 'aziziyah' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
      expect(calls).toEqual([]);
    }
  });

  it('checks the input: two different places, a name, a retry key', async () => {
    const { caller } = ctxFor(['support']);
    await expect(caller.phoneBookings.quote({ pickupId: 'lm_a', dropoffId: 'lm_a' })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(caller.phoneBookings.book({ phone: CALLER, name: '  ', pickupId: 'a', dropoffId: 'b', vertical: 'taxi', fareIqd: 2000, clientRequestId: 'phone-0001' })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(caller.phoneBookings.book({ phone: CALLER, name: 'علي', pickupId: 'a', dropoffId: 'b', vertical: 'bus' as 'taxi', fareIqd: 2000, clientRequestId: 'phone-0001' })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(caller.phoneBookings.book({ phone: CALLER, name: 'علي', pickupId: 'a', dropoffId: 'b', vertical: 'taxi', fareIqd: 2000, clientRequestId: 'x' })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });
});
