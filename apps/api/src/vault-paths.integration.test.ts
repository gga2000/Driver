import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DriverError, PriceRequest, type Actor } from '@driver/contracts';
import { AZIZIYAH_RESTAURANTS } from '@driver/contracts/seeds';
import { AppModule } from './app.module.js';
import { EventsService } from './modules/events/index.js';
import { IdentityService, swallowedVaultLogFailures } from './modules/identity/index.js';
import { KHAT_REPOSITORY, type KhatRepository } from './modules/khat/index.js';
import { OrdersService } from './modules/orders/index.js';
import { PricingService } from './modules/pricing/index.js';
import { SafetyService } from './modules/safety/index.js';
import { ShareLinksService } from './modules/tracking/index.js';
import { TripsService } from './modules/trips/index.js';
import { CLOCK, FakeClock } from './shared/clock.js';
import { PrismaService } from './shared/db/prisma.service.js';

/**
 * Every server path that reads a name or a number from the vault on behalf of someone who is not a
 * person (vault_accessor_fk: CRIT2-01 SOS, LOAD-02 notify sends, CRIT2-02 share page, CRIT2-03 خطوط
 * pager) and the ride booked with a kept quote (LOAD-01), on a real Postgres through the app's own
 * wiring (AppModule, the outbox, the notify engine). Each path used to die on the access log's foreign
 * key to people (or, for rides, on orders.quote_id → quotes). Skipped without DATABASE_URL.
 */
const url = process.env['DATABASE_URL'];
const KITCHEN = { lat: 32.9105, lng: 45.0665 };
const STREET_30 = { lat: 32.9098, lng: 45.0628 };
const DAY = '2026-10-03T10:00:00Z'; // Saturday 13:00 in Baghdad: kitchens open, no prayer pause
const NIGHT = '2026-10-03T19:30:00Z'; // 22:30 in Baghdad: a night ride (w9 auto-share, s2 safe arrival)

async function waitFor<T>(what: string, fn: () => Promise<T | null | undefined | false>, ms = 20_000): Promise<T> {
  const until = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > until) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

describe.skipIf(!url)('vault-reading paths and kept quotes on Postgres (needs DATABASE_URL)', () => {
  const clock = new FakeClock(DAY);
  const run = Date.now().toString(36);
  const base = Date.now();
  const phone = (n: number) => `0772${String((base + n * 7919) % 10_000_000).padStart(7, '0')}`;
  let app: INestApplication;
  let db: PrismaService['prisma'];
  const people = { customer: '', trusted: '', driver: '', dispatcher: '' };
  const as = (personId: string): Actor => ({ personId, sessionId: `s_${run}` });
  const state = { rideId: '', tripId: '', failuresBefore: 0 };

  /** The notify rows of one template for one recipient (the "send row"). */
  const deliveries = (template: string, personId: string) => db.notifyDelivery.findMany({ where: { template, personId }, orderBy: { createdAt: 'asc' } });

  const quoteFor = (vertical: 'taxi' | 'tuktuk') =>
    app.get(PricingService).keepQuote(
      PriceRequest.parse({ cityId: 'aziziyah', vertical, stops: [{ zoneId: 'centre', type: 'pickup', pin: KITCHEN }, { zoneId: 'street_30', type: 'dropoff', pin: STREET_30 }], options: { doorPickup: false, streetHandover: false }, at: clock.now() }),
    );
  const rideInput = (quote: { id: string; total: number }, clientRequestId: string, extra: Record<string, unknown> = {}) => ({
    cityId: 'aziziyah',
    type: 'ride' as const,
    rideVertical: 'taxi' as const,
    fareIqd: quote.total,
    quoteId: quote.id,
    pickup: { zoneKey: 'centre', pin: KITCHEN },
    dropoff: { zoneKey: 'street_30', pin: STREET_30 },
    clientRequestId,
    ...extra,
  });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(CLOCK).useValue(clock).compile();
    app = moduleRef.createNestApplication({ logger: ['error'] });
    await app.init();
    db = app.get(PrismaService).prisma;
    const identity = app.get(IdentityService);
    people.customer = await identity.ensurePersonByPhone(phone(1), 'system:test', 'vault_paths_it', { name: 'زينب علي' });
    people.trusted = await identity.ensurePersonByPhone(phone(2), 'system:test', 'vault_paths_it', { name: 'سارة علي' });
    people.driver = await identity.ensurePersonByPhone(phone(3), 'system:test', 'vault_paths_it', { name: 'حيدر كاظم' });
    people.dispatcher = await identity.ensurePersonByPhone(phone(4), 'system:test', 'vault_paths_it', { name: 'علي حسين' });
    await db.role.create({ data: { personId: people.dispatcher, kind: 'dispatcher' } });
    // The trusted sister has the app; she is also the emergency contact (the first trusted person).
    await identity.updateProfile(as(people.customer), {
      trustedContacts: [{ name: 'سارة', phone: phone(2), relation: 'sibling' }],
      safety: { autoShareNight: true, notifyOnArrival: true },
    });
    state.failuresBefore = swallowedVaultLogFailures();
  }, 60_000);

  afterAll(async () => {
    if (!app) return;
    // Let the outbox finish what this boot wrote before the app (and its Prisma client) closes.
    for (let i = 0; i < 50 && (await db.outbox.count({ where: { status: 'pending', attempts: 0 } })) > 0; i++) await new Promise((r) => setTimeout(r, 100));
    await app.close();
  });

  it('OTP sign-in, then the self profile read from the vault', async () => {
    const identity = app.get(IdentityService);
    const p = phone(5);
    await identity.requestOtp({ phone: p, purpose: 'login' });
    const { code } = await identity.devLastOtp(p);
    const login = await identity.verifyOtp({ phone: p, code: code! });
    const claims = await identity.verifyAccessToken(login.tokens.accessToken);
    const me = await identity.me({ personId: claims.sub, sessionId: claims.sid });
    expect(me.personId).toBe(login.personId);
  });

  it('LOAD-01: a ride books with its kept quote; a second order on the quote is refused, the replay is not', async () => {
    const orders = app.get(OrdersService);
    const quote = await quoteFor('taxi');
    expect(await db.quote.findUnique({ where: { id: quote.id } })).toMatchObject({ totalIqd: quote.total, acceptedAt: null });
    const ride = await orders.place(people.customer, rideInput(quote, `ride-${run}-1`));
    expect(ride).toMatchObject({ state: 'placed', totalIqd: quote.total });
    state.rideId = ride.id;
    expect((await db.quote.findUnique({ where: { id: quote.id } }))?.acceptedAt).not.toBeNull();
    // The same tap again (flaky network): the same order back.
    expect((await orders.place(people.customer, rideInput(quote, `ride-${run}-1`))).id).toBe(ride.id);
    // Another order on the same quote: refused like a price change (the app re-quotes).
    await expect(orders.place(people.customer, rideInput(quote, `ride-${run}-2`))).rejects.toSatisfy((e: unknown) => e instanceof DriverError && e.code === 'price_changed');
    // An unknown quote is refused the same way (never a foreign-key 500).
    await expect(orders.place(people.customer, rideInput({ id: 'q_not_kept', total: quote.total }, `ride-${run}-3`))).rejects.toSatisfy((e: unknown) => e instanceof DriverError && e.code === 'price_changed');
    // Dispatch builds the trip on the same quote (trips.quote_id is a foreign key to quotes too).
    const trip = await waitFor('the ride trip', () => app.get(TripsService).activeForOrder(ride.id));
    expect(trip.quoteId).toBe(quote.id);
    state.tripId = trip.id;
  }, 60_000);

  it('CRIT2-02: the share page with a driver assigned shows his first name', async () => {
    expect(state.tripId).not.toBe('');
    // The driver takes the ride (dispatch's accept, stood in by the row it writes).
    await db.trip.update({ where: { id: state.tripId }, data: { courierId: people.driver, acceptedAt: clock.now(), state: 'en_route_to_pickup' } });
    const shares = app.get(ShareLinksService);
    const link = await shares.createShareLink(as(people.customer), { orderId: state.rideId });
    const page = await shares.shared({ token: link.token });
    expect(page).toMatchObject({ status: 'to_pickup', subject: 'ride', driverFirstName: 'حيدر' });
  }, 30_000);

  it('CRIT2-01: SOS with an emergency contact — the incident, ops paged, the contact message, the contact page', async () => {
    const safety = app.get(SafetyService);
    const sos = await safety.sos(as(people.customer), { subject: { kind: 'order', id: state.rideId }, position: { lat: KITCHEN.lat, lng: KITCHEN.lng, accuracyM: 12, at: clock.now() }, clientId: `sos-${run}-press` });
    expect(sos.state).toBe('open');
    const incident = await db.safetyIncident.findFirstOrThrow({ where: { raiserId: people.customer, clientId: `sos-${run}-press` } });
    expect(incident.contactSet).toBe(true);
    // The on-shift dispatcher is paged (the `safety:alerts` subscriber, inside the outbox transaction).
    await waitFor('the dispatcher page', async () => (await deliveries('sos_dispatch_alert', people.dispatcher)).find((d) => d.eventId === incident.raiseEventId));
    // After the cancel window the emergency contact gets the WhatsApp with the live link…
    clock.advanceSeconds(30);
    await safety.notifyContact(incident.id);
    const sent = await waitFor('the emergency contact message sent', async () => (await deliveries('sos_emergency_contact', `ec:${people.customer}`)).find((d) => d.status === 'sent' || d.status === 'delivered'));
    expect(sent.reason).toBeNull();
    // …and the page that link opens shows the person's first name (accessor `sos_link:<incident>`).
    const token = safety.linkOf(incident.id).split('/').pop()!;
    expect(await safety.shared({ token })).toMatchObject({ status: 'live', firstName: 'زينب' });
  }, 60_000);

  it('LOAD-02: «الدليفري يوصل بعد دقيقتين» on a food order reads the names and is queued', async () => {
    clock.set(DAY);
    const khalid = AZIZIYAH_RESTAURANTS.find((r) => r.key === 'khalid')!;
    const food = await app.get(OrdersService).place(people.customer, {
      cityId: 'aziziyah',
      type: 'food',
      merchantOrgId: khalid.orgId,
      lines: [{ catalogItemId: `${khalid.orgId}_pepsi`, qty: 2 }],
      dropoff: { zoneKey: 'street_30', pin: STREET_30 },
    });
    const e = await app.get(EventsService).emit(undefined, { type: 'stop.courier_near', actorId: people.driver, occurredAt: clock.now(), orderId: food.id, payload: { stopId: `stop_${run}`, distanceM: 600 } }, { name: 'order', id: food.id });
    const row = await waitFor('the courier_arriving row', async () => (await deliveries('courier_arriving', people.customer)).find((d) => d.eventId === e.id));
    expect(row.orderId).toBe(food.id);
  }, 60_000);

  it('G0-10: a gift order texts the person receiving it once, the number read from the vault', async () => {
    clock.set(DAY);
    const khalid = AZIZIYAH_RESTAURANTS.find((r) => r.key === 'khalid')!;
    const gift = await app.get(OrdersService).place(people.customer, {
      cityId: 'aziziyah',
      type: 'food',
      merchantOrgId: khalid.orgId,
      lines: [{ catalogItemId: `${khalid.orgId}_pepsi`, qty: 2 }],
      dropoff: { zoneKey: 'street_30', pin: STREET_30 },
      participants: [{ ref: 'r', role: 'recipient', label: 'أمي', phone: phone(9) }],
      gift: { hidePrices: false },
    });
    const participant = (await db.participant.findFirst({ where: { orderId: gift.id, role: 'recipient' } }))!;
    const e = await app.get(EventsService).emit(undefined, { type: 'stop.courier_near', actorId: people.driver, occurredAt: clock.now(), orderId: gift.id, payload: { stopId: `stop_g_${run}`, distanceM: 280 } }, { name: 'order', id: gift.id });
    const row = await waitFor('the gift SMS sent', async () => (await deliveries('gift_courier_near', `gr:${participant.id}`)).find((d) => d.eventId === e.id && d.status === 'sent'));
    // The vault read is logged against the sender (the last test checks no log row was lost).
    expect(row.channel).toBe('sms');
  }, 60_000);

  it('LOAD-02: a night ride booked for someone else — the rider SMS (rider name), the trusted people (contacts), the safe arrival (trusted accounts)', async () => {
    clock.set(NIGHT);
    const orders = app.get(OrdersService);
    const quote = await quoteFor('taxi');
    const ride = await orders.place(people.customer, rideInput(quote, `ride-${run}-mama`, { rider: { from: 'typed', name: 'ماما', phone: phone(6) } }));
    const riderId = ride.participants.find((p) => p.role === 'rider')?.personId;
    expect(riderId).toBeTruthy();
    const events = app.get(EventsService);
    const matched = await events.emit(undefined, { type: 'order.matched', actorId: people.driver, occurredAt: clock.now(), orderId: ride.id, payload: {} }, { name: 'order', id: ride.id });
    await waitFor('ride_matched to the booker', async () => (await deliveries('ride_matched', people.customer)).find((d) => d.eventId === matched.id));
    await waitFor('ride_for_rider to the rider', async () => (await deliveries('ride_for_rider', riderId!)).find((d) => d.eventId === matched.id));
    // The night auto-share goes to the trusted sister's number (`tc:<rider>:0`, read when it is sent).
    const shared = await waitFor('trip_shared_contact sent', async () =>
      (await deliveries('trip_shared_contact', `tc:${people.customer}:0`)).find((d) => d.eventId === matched.id && (d.status === 'sent' || d.status === 'delivered')),
    );
    expect(shared.reason).toBeNull();
    const done = await events.emit(undefined, { type: 'order.completed', actorId: people.driver, occurredAt: clock.now(), orderId: ride.id, payload: {} }, { name: 'order', id: ride.id });
    await waitFor('ride_rider_arrived («مشوار ماما وصل») to the booker', async () => (await deliveries('ride_rider_arrived', people.customer)).find((d) => d.eventId === done.id));
    // s2: the booker's own night ride ends → his trusted sister, who has the app, hears he arrived.
    const own = await events.emit(undefined, { type: 'order.completed', actorId: people.driver, occurredAt: clock.now(), orderId: state.rideId, payload: {} }, { name: 'order', id: state.rideId });
    await waitFor('ride_safe_arrival to the trusted account', async () => (await deliveries('ride_safe_arrival', people.trusted)).find((d) => d.eventId === own.id));
  }, 90_000);

  it('CRIT2-03: the خطوط sweep alert pages the desk with the driver’s name', async () => {
    const khat = app.get<KhatRepository>(KHAT_REPOSITORY);
    const now = clock.now();
    const { alert } = await khat.raiseSweepAlert({ tripId: state.tripId, cityId: 'aziziyah', driverId: people.driver, childrenTotal: 2, lastDropAt: now, lastDropZone: 'centre', runEndedAt: new Date(now.getTime() - 6 * 60_000), raisedAt: now });
    const e = await app.get(EventsService).emit(undefined, { type: 'khat.sweep_missed', actorId: people.driver, occurredAt: now, tripId: state.tripId, payload: { alertId: alert.id, driverId: people.driver } }, { name: 'trip', id: state.tripId });
    const page = await waitFor('the desk page', async () => (await deliveries('khat_sweep_dispatch_alert', people.dispatcher)).find((d) => d.eventId === e.id));
    expect(JSON.stringify(page.payload)).toContain('حيدر ك.');
  }, 60_000);

  it('no vault read on these paths lost its access log row', () => {
    expect(swallowedVaultLogFailures()).toBe(state.failuresBefore);
  });
});
