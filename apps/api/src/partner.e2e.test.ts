import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { createTRPCClient, httpBatchLink, TRPCClientError } from '@trpc/client';
import { transformer, type AppRouter } from '@driver/contracts';
import { AZIZIYAH_RESTAURANTS } from '@driver/contracts/seeds';
import { createApp } from './bootstrap.js';
import { CatalogService, seedStorefronts } from './modules/catalog/index.js';
import { DispatchService } from './modules/dispatch/index.js';
import { IdentityService } from './modules/identity/index.js';
import { OrdersService } from './modules/orders/index.js';
import { OrgsService } from './modules/orgs/index.js';
import { TripsService } from './modules/trips/index.js';

const STREET_30 = { lat: 32.9095, lng: 45.0635 };
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
const ZAKUR = { lat: 32.887, lng: 45.0765 };

/** Driver Partner over the wire: role gate, presence, the open offer with named pay, the job. */
describe('partner API (e2e)', () => {
  let app: NestExpressApplication;
  let origin: string;
  const anon = () => createTRPCClient<AppRouter>({ links: [httpBatchLink({ url: `${origin}/trpc`, transformer })] });
  const as = (token: string) => createTRPCClient<AppRouter>({ links: [httpBatchLink({ url: `${origin}/trpc`, transformer, headers: { authorization: `Bearer ${token}` } })] });

  async function signIn(phone: string) {
    const c = anon();
    await c.identity.requestOtp.mutate({ phone });
    const { code } = await c.identity.devLastOtp.query({ phone });
    const res = await c.identity.verifyOtp.mutate({ phone, code: code!, device: { fingerprint: `e2e-${phone}`, platform: 'web' } });
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
    app = await createApp();
    await app.listen(0);
    const address = app.getHttpServer().address();
    origin = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
  });

  afterAll(async () => {
    await app.close();
  });

  it('customers are kept out; a courier goes online, sees the offer with its pay, accepts, and gets the job', async () => {
    const customer = await signIn('07714440001');
    expect(await errCode(customer.client.partner.status.query())).toBe('forbidden');
    expect(await errCode(anon().partner.status.query())).toBe('unauthorized');

    const courier = await signIn('07714440002');
    await app.get(IdentityService).grantRole({ personId: 'system:e2e', sessionId: 'e2e' }, { personId: courier.personId, kind: 'courier' });
    const off = await courier.client.partner.status.query();
    expect(off).toMatchObject({ online: false, canDrive: true, modes: ['courier'], activeTripId: null, offerId: null, today: { earningsIqd: 0, jobs: 0 } });

    // The online gate (scoring §2): no daily selfie check-in yet → refused with a typed code.
    expect(off.gate).toMatchObject({ canGoOnline: false, reasons: [{ code: 'checkin_required' }] });
    expect(await errCode(courier.client.partner.goOnline.mutate({ at: STREET_30, vehicleClass: 'bike' }))).toBe('online_checkin_required');
    const challenge = await courier.client.driverAccount.checkInChallenge.mutate();
    const ticket = await courier.client.places.photoUpload.mutate({ contentType: 'image/jpeg', sizeBytes: JPEG.length });
    expect((await fetch(new URL(ticket.uploadUrl, origin), { method: 'PUT', headers: ticket.headers, body: JPEG })).status).toBe(200);
    expect(await courier.client.driverAccount.submitCheckIn.mutate({ challengeId: challenge.challengeId, uploadId: ticket.uploadId })).toMatchObject({ result: 'passed', verifiedToday: true });
    expect((await courier.client.partner.status.query()).gate).toEqual({ canGoOnline: true, reasons: [] });

    const on = await courier.client.partner.goOnline.mutate({ at: STREET_30, vehicleClass: 'bike' });
    expect(on).toMatchObject({ online: true, zoneId: 'street_30', vehicleClass: 'bike' });
    expect(await courier.client.partner.currentOffer.query()).toBeNull();

    // A cash order from a seeded restaurant, accepted by the kitchen and handed to him by the dispatcher.
    // No opening hours on file (= open), so the test runs at any hour: orders.place refuses a closed kitchen.
    const [khalid] = await seedStorefronts(app.get(OrgsService), app.get(CatalogService), AZIZIYAH_RESTAURANTS.slice(0, 1).map((r) => ({ ...r, hours: [] })), 'e2e-owner');
    await app.get(OrgsService).settled();
    const orders = app.get(OrdersService);
    const placed = await orders.place(customer.personId, {
      cityId: 'aziziyah',
      type: 'food',
      merchantOrgId: khalid!.orgId,
      lines: [{ catalogItemId: khalid!.itemIds.get('liver_plate')!, qty: 1 }],
      paymentMethod: 'cash',
      dropoff: { zoneKey: 'zakur', pin: ZAKUR },
    });
    await orders.merchantAccept('e2e-staff', { orderId: placed.id, prepMinutes: 15 });
    await orders.markPreparing('e2e-staff', { orderId: placed.id });
    const trip = await app.get(TripsService).activeForOrder(placed.id);
    await app.get(DispatchService).override({ personId: 'e2e-dispatcher', sessionId: 'e2e' }, { tripId: trip!.id, driverId: courier.personId, reason: 'e2e' });

    const offer = await courier.client.partner.currentOffer.query();
    expect(offer).toMatchObject({ tripId: trip!.id, vertical: 'food', pickup: { label: khalid!.seed.nameAr }, dropoff: { zoneId: 'zakur' }, batch: null, merchant: { state: 'preparing' } });
    expect(offer!.pay.totalIqd).toBe(placed.deliveryFeeIqd);
    expect(offer!.collectIqd).toBe(placed.totalIqd);
    expect((await courier.client.partner.status.query()).offerId).toBe(offer!.offerId);

    await courier.client.dispatch.respond.mutate({ offerId: offer!.offerId, accept: true });
    expect(await courier.client.partner.currentOffer.query()).toBeNull();
    const job = await courier.client.partner.activeJob.query();
    expect(job).toMatchObject({ tripId: trip!.id, merchant: { name: khalid!.seed.nameAr } });
    expect(job!.stops.map((s) => s.type)).toEqual(['pickup', 'dropoff']);
    expect(job!.currentStopId).toBe(job!.stops[0]!.stopId);
    expect(job!.stops[1]!.collectIqd).toBe(placed.totalIqd);
    expect((await courier.client.partner.status.query()).activeTripId).toBe(trip!.id);

    expect((await courier.client.partner.goOffline.mutate()).online).toBe(false);
  });
});
