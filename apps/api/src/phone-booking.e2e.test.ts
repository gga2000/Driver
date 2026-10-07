import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { createTRPCClient, httpBatchLink, TRPCClientError } from '@trpc/client';
import { transformer, type AppRouter, type RoleKind } from '@driver/contracts';
import { AppModule } from './app.module.js';
import { AuditLogService } from './modules/controls/index.js';
import { DispatchService } from './modules/dispatch/index.js';
import { DISPATCH_REPOSITORY, type DispatchRepository } from './modules/dispatch/dispatch.repository.js';
import { DISPATCH_QUEUE, type TimerJob } from './modules/dispatch/offer.orchestrator.js';
import { IdentityService } from './modules/identity/index.js';
import { NOTIFY_QUEUE } from './modules/notify/index.js';
import { COURIER_VEHICLES, type InMemoryCourierVehicles } from './modules/tracking/index.js';
import { TripsService } from './modules/trips/index.js';
import { TrpcService } from './trpc/trpc.module.js';
import { CLOCK, FakeClock } from './shared/clock.js';
import type { InMemoryQueue } from './shared/queue.js';

const CALLER = '0771 777 4321';

/**
 * «حجز بالتلفون» over the wire (taxi/tuktuk step 4): support books a ride for a caller without the
 * app; a taxi driver takes it through dispatch like any ride; the caller gets the SMS; and when he
 * later signs in with that number the ride is in his history.
 */
describe('book by phone (e2e)', () => {
  const clock = new FakeClock('2026-10-07T07:00:00Z'); // 10:00 Baghdad
  let app: NestExpressApplication;
  let origin: string;
  const anon = () => createTRPCClient<AppRouter>({ links: [httpBatchLink({ url: `${origin}/trpc`, transformer })] });
  const as = (token: string) => createTRPCClient<AppRouter>({ links: [httpBatchLink({ url: `${origin}/trpc`, transformer, headers: { authorization: `Bearer ${token}` } })] });

  async function signIn(phone: string, roles: RoleKind[] = []) {
    const c = anon();
    await c.identity.requestOtp.mutate({ phone });
    const { code } = await c.identity.devLastOtp.query({ phone });
    const res = await c.identity.verifyOtp.mutate({ phone, code: code!, device: { fingerprint: `e2e-${phone}`, platform: 'web' } });
    for (const kind of roles) await app.get(IdentityService).grantRole({ personId: 'system:e2e', sessionId: 'e2e' }, { personId: res.personId, kind });
    return { client: as(res.tokens.accessToken), personId: res.personId };
  }

  const errCode = async (p: Promise<unknown>) => {
    try {
      await p;
      return 'ok';
    } catch (err) {
      return err instanceof TRPCClientError ? (err.data as { code?: string } | undefined)?.code : String(err);
    }
  };

  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(CLOCK).useValue(clock).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ logger: ['error'] });
    app.get(TrpcService).mount(app);
    await app.listen(0);
    const address = app.getHttpServer().address();
    origin = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
  });

  afterAll(async () => {
    await app.close();
    vi.useRealTimers();
  });

  it('support books, a driver takes it, the caller is texted, and his history has the ride', async () => {
    const support = await signIn('07700088001', ['support']);
    await app.get(IdentityService).updateProfile({ personId: support.personId, sessionId: 'e2e' }, { name: 'نور حسن' });
    const courier = await signIn('07700088002', ['courier']);

    // Couriers and customers cannot book by phone.
    expect(await errCode(courier.client.phoneBookings.today.query({ cityId: 'aziziyah' }))).toBe('forbidden');

    const landmarks = await support.client.places.landmarks.query({ cityId: 'aziziyah' });
    const from = landmarks.find((l) => l.name_ar === 'باب الجامع الكبير')!;
    const to = landmarks.find((l) => l.name_ar === 'حديقة الشاشة')!;
    expect(await support.client.phoneBookings.caller.query({ phone: CALLER })).toEqual({ known: false, name: null, phoneRides: 0 });
    const quote = await support.client.phoneBookings.quote.query({ cityId: 'aziziyah', pickupId: from.id, dropoffId: to.id });
    const taxi = quote.options.find((o) => o.vertical === 'taxi')!;
    expect(taxi.fareIqd).toBeGreaterThan(0);

    // A driver in a taxi a few hundred metres away, with his car on file.
    const driver = await signIn('07700088003', ['driver']);
    await app.get(IdentityService).updateProfile({ personId: driver.personId, sessionId: 'e2e' }, { name: 'عباس كريم' });
    (app.get(COURIER_VEHICLES) as InMemoryCourierVehicles).register(driver.personId, { vehicleClass: 'car', plate: '23456 واسط', label: 'كيا سيراتو · فضي' });
    await app.get(DispatchService).presence.online(driver.personId, { cityId: 'aziziyah', at: { lat: from.pin.lat + 0.004, lng: from.pin.lng }, vehicle: 'car', tier: 'bronze', verticals: ['taxi', 'tuktuk'] });

    const row = await support.client.phoneBookings.book.mutate({ cityId: 'aziziyah', phone: CALLER, name: 'أبو حسين', pickupId: from.id, dropoffId: to.id, vertical: 'taxi', fareIqd: taxi.fareIqd, note: 'لابس دشداشة بيضة', clientRequestId: 'e2e-phone-0001' });
    expect(row).toMatchObject({ status: 'searching', callerName: 'أبو حسين', phoneHint: '0771 ••• 4321', bookedByName: 'نور', totalIqd: taxi.totalIqd, pickupName: 'باب الجامع الكبير', dropoffName: 'حديقة الشاشة' });

    // Dispatch offers it to the driver like any ride; he takes it.
    const trip = await app.get(TripsService).activeForOrder(row.orderId);
    expect(trip).toMatchObject({ vertical: 'taxi' });
    await app.get<InMemoryQueue<TimerJob>>(DISPATCH_QUEUE, { strict: false }).drain();
    const [offer] = await app.get<DispatchRepository>(DISPATCH_REPOSITORY, { strict: false }).listByTrip(trip!.id);
    expect(offer).toMatchObject({ driverId: driver.personId });
    await app.get(DispatchService).respond({ personId: driver.personId, sessionId: 's1' }, { offerId: offer!.id, accept: true });

    // «اتصل بالراكب» in the Partner app reaches the caller's number like any rider's (dev: the number itself).
    const call = await driver.client.chat.requestCall.mutate({ orderId: row.orderId, kind: 'customer_courier' });
    expect(call).toMatchObject({ counterpart: 'customer', mode: 'dev_direct', dial: '+9647717774321' });

    const [listed] = await support.client.phoneBookings.today.query({ cityId: 'aziziyah' });
    expect(listed).toMatchObject({ orderId: row.orderId, status: 'driver_coming', driver: { firstName: 'عباس', vehicleLabel: 'كيا سيراتو · فضي', plate: '23456 واسط' } });

    const sendQueued = () => app.get<InMemoryQueue<unknown>>(NOTIFY_QUEUE, { strict: false }).drain();
    await sendQueued();
    const log = await support.client.notify.log.query({ orderId: row.orderId });
    const sms = log.filter((d) => d.template === 'phone_ride_matched');
    expect(sms).toHaveLength(1);
    expect(sms[0]).toMatchObject({ channel: 'sms', status: 'sent' });
    expect(sms[0]!.body).toMatch(/^درايفر: عباس جاي ياخذك: كيا سيراتو · فضي، لوحة 23456 واسط\. يوصلك بعد (دقيقة|دقيقتين|\d+ دقايق|\d+ دقيقة)\. تابعه: https:\/\/driver\.iq\/share\//);

    // He arrives at the pickup: the second SMS, with the cash fare.
    const pickup = (await app.get(TripsService).get(trip!.id)).stops.find((s) => s.type === 'pickup')!;
    await app.get(TripsService).arrive(trip!.id, pickup.id, driver.personId, { pin: from.pin });
    await sendQueued();
    const arrived = (await support.client.notify.log.query({ orderId: row.orderId })).find((d) => d.template === 'phone_driver_arrived');
    expect(arrived?.body).toBe(`درايفر: عباس وصل وينتظرك: كيا سيراتو · فضي، لوحة 23456 واسط. الأجرة ${taxi.totalIqd.toLocaleString('en-US')} دينار كاش.`);
    expect((await support.client.phoneBookings.today.query({ cityId: 'aziziyah' }))[0]).toMatchObject({ status: 'driver_arrived' });

    // The audit names the staff member.
    const audit = await app.get(AuditLogService).list({ subjectKind: 'order', subjectId: row.orderId, limit: 10 });
    expect(audit.map((a) => [a.action, a.actorId, a.actorName])).toEqual([['ride.phone_booked', support.personId, 'نور']]);

    // Later the caller installs the app and signs in with that number: the ride is his.
    const caller = await signIn('07717774321');
    const history = await caller.client.orders.history.query();
    expect(history.map((h) => h.order.id)).toContain(row.orderId);
    expect(history.find((h) => h.order.id === row.orderId)!.order).toMatchObject({ type: 'ride', paymentMethod: 'cash', note: 'لابس دشداشة بيضة' });
  });
});
