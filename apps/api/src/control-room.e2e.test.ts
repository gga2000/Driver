import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { createTRPCClient, httpBatchLink, TRPCClientError } from '@trpc/client';
import { transformer, type AppRouter, type RoleKind } from '@driver/contracts';
import { AZIZIYAH_RESTAURANTS } from '@driver/contracts/seeds';
import { createApp } from './bootstrap.js';
import { CatalogService, seedStorefronts } from './modules/catalog/index.js';
import { DispatchService } from './modules/dispatch/index.js';
import { EventsService } from './modules/events/index.js';
import { IdentityService } from './modules/identity/index.js';
import { LedgerService } from './modules/ledger/index.js';
import { OrdersService } from './modules/orders/index.js';
import { OrgsService } from './modules/orgs/index.js';
import { TripsService } from './modules/trips/index.js';

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
const ZAKUR = { lat: 32.887, lng: 45.0765 };
const SYSTEM = { personId: 'system:e2e', sessionId: 'e2e' };
type Client = ReturnType<typeof createTRPCClient<AppRouter>>;

/**
 * Launch control room over the wire: role gates on every procedure, the kill switches and the zone
 * throttle refusing `orders.place` / `routes.holdSeat` with friendly Arabic, dispatch held to
 * suggest-only, the public banner, the approvals queue (no deciding on your own item), the support
 * desk (a dispute opens a ticket, refunds within limits post to the ledger), the cash desk and the wall.
 */
describe('launch control room (e2e)', () => {
  let app: NestExpressApplication;
  let origin: string;
  let seq = 0;
  const anon = () => createTRPCClient<AppRouter>({ links: [httpBatchLink({ url: `${origin}/trpc`, transformer })] });
  const as = (token: string) => createTRPCClient<AppRouter>({ links: [httpBatchLink({ url: `${origin}/trpc`, transformer, headers: { authorization: `Bearer ${token}` } })] });

  /** Signs a fresh person in through identity (no per-IP OTP limit on the service path) and grants roles. */
  async function person(roles: Array<RoleKind | { kind: RoleKind; orgId: string }> = []): Promise<{ client: Client; personId: string }> {
    seq += 1;
    const phone = `07719${String(seq).padStart(6, '0')}`;
    const identity = app.get(IdentityService);
    await identity.requestOtp({ phone, purpose: 'login' });
    const { code } = await identity.devLastOtp(phone);
    const res = await identity.verifyOtp({ phone, code: code!, device: { fingerprint: `cr-e2e-${phone}`, platform: 'web' } });
    await identity.updateProfile({ personId: res.personId, sessionId: 'e2e' }, { name: `موظف ${seq}` });
    for (const r of roles) await identity.grantRole(SYSTEM, typeof r === 'string' ? { personId: res.personId, kind: r } : { personId: res.personId, kind: r.kind, orgId: r.orgId });
    return { client: as(res.tokens.accessToken), personId: res.personId };
  }

  const errOf = async (p: Promise<unknown>): Promise<{ code: string | undefined; message: string; retryAfterSec?: number }> => {
    try {
      await p;
      return { code: 'ok', message: '' };
    } catch (err) {
      if (!(err instanceof TRPCClientError)) throw err;
      const data = err.data as { code?: string; message_ar?: string; retryAfterSec?: number } | undefined;
      return { code: data?.code, message: data?.message_ar ?? err.message, ...(data?.retryAfterSec !== undefined ? { retryAfterSec: data.retryAfterSec } : {}) };
    }
  };
  const codeOf = async (p: Promise<unknown>) => (await errOf(p)).code;

  async function upload(client: Client): Promise<string> {
    const ticket = await client.places.photoUpload.mutate({ contentType: 'image/jpeg', sizeBytes: JPEG.length });
    const res = await fetch(new URL(ticket.uploadUrl, origin), { method: 'PUT', headers: ticket.headers, body: JPEG });
    expect(res.status).toBe(200);
    return ticket.uploadId;
  }

  let khalid: Awaited<ReturnType<typeof seedStorefronts>>[number];
  const order = (client: Client, zoneKey = 'zakur', extra: Record<string, unknown> = {}) =>
    client.orders.place.mutate({
      cityId: 'aziziyah',
      type: 'food',
      merchantOrgId: khalid.orgId,
      lines: [{ catalogItemId: khalid.itemIds.get('liver_plate')!, qty: 1 }],
      paymentMethod: 'cash',
      dropoff: { zoneKey, pin: ZAKUR },
      ...extra,
    });

  beforeAll(async () => {
    app = await createApp();
    await app.listen(0);
    const address = app.getHttpServer().address();
    origin = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
    // Open at any hour: no opening hours on file.
    khalid = (await seedStorefronts(app.get(OrgsService), app.get(CatalogService), AZIZIYAH_RESTAURANTS.slice(0, 1).map((r) => ({ ...r, hours: [] })), 'cr-owner'))[0]!;
    await app.get(OrgsService).settled();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('kill switches and the zone throttle', () => {
    it('only admin / dispatcher change controls; console roles read them; others are kept out', async () => {
      const dispatcher = await person(['dispatcher']);
      const support = await person(['support']);
      const customer = await person();
      const set = { scope: 'vertical' as const, key: 'parcel', active: true, reason: 'اختبار الصلاحيات' };
      expect(await codeOf(anon().ops.controls.view.query({}))).toBe('unauthorized');
      expect(await codeOf(customer.client.ops.controls.view.query({}))).toBe('forbidden');
      expect(await codeOf(support.client.ops.controls.setSwitch.mutate(set))).toBe('forbidden');
      expect(await codeOf(customer.client.ops.controls.setCapacity.mutate({ zoneKey: 'zakur', maxActive: 3 }))).toBe('forbidden');
      const view = await support.client.ops.controls.view.query({});
      // 34 Aziziyah zones plus the الرجعة corridor ends (الكوت، بغداد).
      expect(view.zones.length).toBe(36);
      expect(view.verticals.map((v) => v.key)).toContain('food');
      expect(view.corridors.map((c) => c.key)).toEqual(['aziziyah_baghdad', 'aziziyah_kut']);
      expect(view.restaurants.map((r) => r.key)).toContain(khalid.orgId);
      expect(await codeOf(dispatcher.client.ops.controls.setSwitch.mutate({ ...set, key: 'no_such_vertical' }))).toBe('control_invalid');
      const on = await dispatcher.client.ops.controls.setSwitch.mutate(set);
      expect(on).toMatchObject({ scope: 'vertical', key: 'parcel', label_ar: 'الطرود', active: true, setByName: expect.any(String) });
      await dispatcher.client.ops.controls.setSwitch.mutate({ ...set, active: false, reason: 'رجعت' });
      const audit = await support.client.ops.controls.audit.query({ subjectKind: 'kill_switch' });
      expect(audit.slice(0, 2).map((a) => a.action)).toEqual(['kill_switch.off', 'kill_switch.on']);
      expect(audit[1]!.summary_ar).toContain('الطرود');
    });

    it('a vertical, restaurant or zone switch refuses orders.place with a friendly Arabic message (the switch’s own when set)', async () => {
      const admin = await person(['admin']);
      const customer = await person();
      await admin.client.ops.controls.setSwitch.mutate({ scope: 'vertical', key: 'food', active: true, reason: 'مطر قوي' });
      const v = await errOf(order(customer.client));
      expect(v).toMatchObject({ code: 'service_paused', message: 'خدمة الأكل موقّفة هسة. جرّب بعدين' });
      await admin.client.ops.controls.setSwitch.mutate({ scope: 'vertical', key: 'food', active: false, reason: 'خلص المطر' });

      await admin.client.ops.controls.setSwitch.mutate({ scope: 'restaurant', key: khalid.orgId, active: true, reason: 'عطل بالفرن', message_ar: 'مطعم خالد عنده عطل، يرجع بعد ساعة' });
      expect(await errOf(order(customer.client))).toMatchObject({ code: 'service_paused', message: 'مطعم خالد عنده عطل، يرجع بعد ساعة' });
      await admin.client.ops.controls.setSwitch.mutate({ scope: 'restaurant', key: khalid.orgId, active: false, reason: 'تصلّح' });

      // A zone switch limited to taxis leaves food alone; the drop-off zone switched off for all stops it.
      await admin.client.ops.controls.setSwitch.mutate({ scope: 'zone', key: 'zakur', vertical: 'taxi', active: true, reason: 'طريق مغلق للسيارات' });
      expect((await order(customer.client)).state).toBeTruthy();
      await admin.client.ops.controls.setSwitch.mutate({ scope: 'zone', key: 'zakur', active: true, reason: 'طريق مغلق' });
      const z = await errOf(order(customer.client));
      expect(z.code).toBe('service_paused');
      expect(z.message).toBe('ما نگدر نخدم منطقة زاكور هسة. جرّب بعدين');
      await admin.client.ops.controls.setSwitch.mutate({ scope: 'zone', key: 'zakur', active: false, reason: 'انفتح' });
      expect((await order(customer.client)).state).toBeTruthy();
    });

    it('the zone throttle refuses at capacity with the honest wait; queue mode lets an order scheduled after the wait through', async () => {
      const dispatcher = await person(['dispatcher']);
      const c1 = await person();
      const c2 = await person();
      await dispatcher.client.ops.controls.setCapacity.mutate({ zoneKey: 'hashimi', maxActive: 1 });
      await order(c1.client, 'hashimi');
      const full = await errOf(order(c2.client, 'hashimi'));
      expect(full).toEqual({ code: 'zone_at_capacity', message: 'الطلبات هواية هسة بمنطقتك، جرّب بعد ربع ساعة', retryAfterSec: 900 });
      const view = await dispatcher.client.ops.controls.view.query({});
      expect(view.zones.find((z) => z.zoneKey === 'hashimi')).toMatchObject({ maxActive: 1, active: 1, state: 'full', load: 1 });

      await dispatcher.client.ops.controls.setCapacity.mutate({ zoneKey: 'hashimi', maxActive: 1, mode: 'queue', etaMin: 30 });
      const queued = await errOf(order(c2.client, 'hashimi'));
      expect(queued.code).toBe('zone_at_capacity');
      expect(queued.message).toContain('احجز طلبك لبعد نص ساعة');
      const later = await order(c2.client, 'hashimi', { scheduledFor: new Date(Date.now() + 40 * 60_000) });
      expect(later.scheduledFor).not.toBeNull();
      await dispatcher.client.ops.controls.setCapacity.mutate({ zoneKey: 'hashimi', maxActive: null });
      expect((await order(c2.client, 'hashimi')).id).toBeTruthy();
    });

    it('a switch with "hold dispatch" turns new jobs in its zone suggest-only for the dispatcher', async () => {
      const admin = await person(['admin']);
      const customer = await person();
      const placed = await order(customer.client, 'shukri');
      await admin.client.ops.controls.setSwitch.mutate({ scope: 'zone', key: 'street_30', active: true, holdDispatch: true, reason: 'زحمة شديدة' });
      const orders = app.get(OrdersService);
      await orders.merchantAccept('cr-staff', { orderId: placed.id, prepMinutes: 1 });
      await orders.markReady('cr-staff', { orderId: placed.id });
      const trip = await app.get(TripsService).activeForOrder(placed.id);
      expect(trip).not.toBeNull();
      const req = await app.get(DispatchService).getRequest(trip!.id);
      expect(req).toMatchObject({ suggestOnly: true, status: 'awaiting_dispatcher' });
      await admin.client.ops.controls.setSwitch.mutate({ scope: 'zone', key: 'street_30', active: false, reason: 'خفّت' });
    });

    it('a corridor switch refuses new الرجعة holds', async () => {
      const admin = await person(['admin']);
      const driver = await person(['intercity_driver']);
      const rider = await person();
      const dep = await driver.client.routes.driver.announce.mutate({
        garageId: 'mp_garage_bab1',
        corridorId: 'aziziyah_kut',
        departAt: new Date(Date.now() + 50 * 60_000),
        latestDepartureAt: new Date(Date.now() + 80 * 60_000),
        vehicle: { kind: 'saloon', layout: 4, plate: 'واسط 77001' },
      });
      await admin.client.ops.controls.setSwitch.mutate({ scope: 'corridor', key: 'aziziyah_kut', active: true, reason: 'سيطرة مغلقة' });
      const refused = await errOf(rider.client.routes.holdSeat.mutate({ departureId: dep.id, selection: { kind: 'seats', seatIds: ['back_left'] }, travellingAs: 'rijal' }));
      expect(refused).toMatchObject({ code: 'service_paused', message: 'حجز العزيزية ⇄ الكوت موقّف مؤقتاً' });
      await admin.client.ops.controls.setSwitch.mutate({ scope: 'corridor', key: 'aziziyah_kut', active: false, reason: 'انفتحت' });
      expect((await rider.client.routes.holdSeat.mutate({ departureId: dep.id, selection: { kind: 'seats', seatIds: ['back_left'] }, travellingAs: 'rijal' })).state).toBe('held');
    });
  });

  describe('status banner', () => {
    it('anyone reads it (per app), only admin sets or clears it, and it always expires within a day', async () => {
      const admin = await person(['admin']);
      const dispatcher = await person(['dispatcher']);
      expect(await anon().system.banner.query({ app: 'customer' })).toBeNull();
      const input = { severity: 'warning' as const, audiences: ['customer' as const, 'partner' as const], message_ar: 'الشبكة بطيئة بالعزيزية، الطلبات توصل بس تتأخر شوية', expiresAt: new Date(Date.now() + 2 * 3_600_000) };
      expect(await codeOf(dispatcher.client.system.setBanner.mutate(input))).toBe('forbidden');
      expect(await codeOf(admin.client.system.setBanner.mutate({ ...input, expiresAt: new Date(Date.now() + 30 * 3_600_000) }))).toBe('banner_invalid');
      const set = await admin.client.system.setBanner.mutate(input);
      expect(set).toMatchObject({ active: true, severity: 'warning' });
      expect(await anon().system.banner.query({ app: 'customer' })).toMatchObject({ id: set.id, severity: 'warning', message_ar: input.message_ar });
      expect(await anon().system.banner.query({ app: 'merchant' })).toBeNull();
      expect((await dispatcher.client.system.banners.query())[0]).toMatchObject({ id: set.id, active: true });
      await admin.client.system.clearBanner.mutate({ bannerId: set.id });
      expect(await anon().system.banner.query({ app: 'partner' })).toBeNull();
    });
  });

  describe('approvals queue', () => {
    it('lists documents, deals, landmark photos, onboarding drafts and fleet vehicles; nobody decides on his own item', async () => {
      const orgs = app.get(OrgsService);
      const identity = app.get(IdentityService);
      // Field ops who also drives: his own document is in the queue but not his to decide.
      const opsA = await person(['field_ops', 'courier']);
      const opsB = await person(['field_ops']);
      const admin = await person(['admin']);
      const customer = await person();
      const courier = await person(['courier']);
      const ownUpload = await upload(opsA.client);
      const ownDoc = await opsA.client.driverAccount.uploadDocument.mutate({ kind: 'licence', uploadId: ownUpload });
      const doc = await courier.client.driverAccount.uploadDocument.mutate({ kind: 'national_id_front', uploadId: await upload(courier.client) });

      // A deal waiting for platform approval.
      const owner = await person([{ kind: 'merchant_owner', orgId: khalid.orgId }]);
      const deal = await owner.client.merchantAdmin.deals.propose.mutate({
        merchantOrgId: khalid.orgId,
        type: 'percent',
        value: 10,
        nameAr: 'خصم الافتتاح',
        schedule: { startsAt: new Date(), endsAt: new Date(Date.now() + 7 * 86_400_000), days: [] },
      });
      expect(deal.state).toBe('pending_approval');
      // A landmark photo and a merchant draft by field ops A.
      const photo = await opsA.client.ops.addLandmarkPhoto.mutate({ target: { kind: 'landmark', id: 'new:zakur' }, uploadId: await upload(opsA.client), localNames: ['يم جامع الزكور'] });
      const draft = await opsA.client.ops.merchantOnboarding.mutate({
        cityId: 'aziziyah',
        name: 'فلافل أبو علي',
        type: 'restaurant',
        contact: { name: 'أبو علي', phone: '07719888001' },
        location: { zoneKey: 'hashimi' },
        menuPhotoUploadIds: [await upload(opsA.client)],
        shopPhotoUploadId: await upload(opsA.client),
      });
      // A fleet owner's new vehicle.
      const fleetOwner = await person();
      const fleet = await orgs.create({ type: 'fleet', name: 'أسطول الربيعي', cityId: 'aziziyah', ownerId: fleetOwner.personId });
      await identity.grantRole(SYSTEM, { personId: fleetOwner.personId, kind: 'fleet_owner', orgId: fleet.id });
      const vehicle = await fleetOwner.client.fleet.addVehicle.mutate({ plate: 'واسط 55123', vehicleClass: 'tuktuk' });

      expect(await codeOf(customer.client.approvals.list.query({}))).toBe('forbidden');
      const listA = await opsA.client.approvals.list.query({});
      const kinds = new Set(listA.items.map((i) => i.kind));
      // Field ops see documents, photos, drafts and vehicles; deals are admin / support.
      expect([...kinds].sort()).toEqual(['driver_document', 'fleet_vehicle', 'landmark_photo', 'merchant_onboarding']);
      const own = listA.items.find((i) => i.refId === ownDoc.id)!;
      expect(own).toMatchObject({ ownItem: true, photos: [] });
      expect(listA.items.find((i) => i.refId === photo.photoId)).toMatchObject({ ownItem: true, title_ar: 'معلم جديد: يم جامع الزكور' });
      expect(listA.items.find((i) => i.refId === draft.onboardingId)).toMatchObject({ ownItem: true, title_ar: 'فلافل أبو علي', photos: [{ label_ar: 'واجهة المحل' }], compare: [{ label_ar: 'المنيو 1' }] });
      const docItem = (await opsB.client.approvals.list.query({ kind: 'driver_document' })).items.find((i) => i.refId === doc.id)!;
      expect(docItem).toMatchObject({ ownItem: false, takesExpiry: true });
      expect(docItem.photos[0]!.url).toMatch(/\/files\//);

      expect(await codeOf(opsA.client.approvals.decide.mutate({ kind: 'driver_document', refId: ownDoc.id, decision: 'approve' }))).toBe('approval_own_item');
      expect(await codeOf(opsA.client.approvals.decide.mutate({ kind: 'landmark_photo', refId: photo.photoId, decision: 'approve' }))).toBe('approval_own_item');
      expect(await codeOf(opsA.client.approvals.decide.mutate({ kind: 'merchant_onboarding', refId: draft.onboardingId, decision: 'approve' }))).toBe('approval_own_item');
      expect(await codeOf(opsB.client.approvals.decide.mutate({ kind: 'merchant_deal', refId: deal.dealId, decision: 'approve' }))).toBe('forbidden');
      expect(await codeOf(fleetOwner.client.approvals.decide.mutate({ kind: 'fleet_vehicle', refId: vehicle.vehicleId, decision: 'approve' }))).toBe('forbidden');
      expect(await codeOf(opsB.client.approvals.decide.mutate({ kind: 'driver_document', refId: doc.id, decision: 'reject' }))).toBe('invalid_input');

      await opsB.client.approvals.decide.mutate({ kind: 'driver_document', refId: doc.id, decision: 'approve', expiresAt: new Date(Date.now() + 365 * 86_400_000) });
      expect(await codeOf(opsB.client.approvals.decide.mutate({ kind: 'driver_document', refId: doc.id, decision: 'approve' }))).toBe('approval_state_conflict');
      await opsB.client.approvals.decide.mutate({ kind: 'driver_document', refId: ownDoc.id, decision: 'reject', reason: 'الصورة مو واضحة' });
      await opsB.client.approvals.decide.mutate({ kind: 'landmark_photo', refId: photo.photoId, decision: 'approve' });
      await admin.client.approvals.decide.mutate({ kind: 'merchant_deal', refId: deal.dealId, decision: 'approve' });
      await opsB.client.approvals.decide.mutate({ kind: 'fleet_vehicle', refId: vehicle.vehicleId, decision: 'reject', reason: 'اللوحة ما تطابق السنوية' });
      await opsB.client.approvals.decide.mutate({ kind: 'merchant_onboarding', refId: draft.onboardingId, decision: 'approve' });

      // Activation opens the Merchant app for the owner; the deal is live; the vehicle is off the road.
      const contact = (await identity.personIdByPhone('07719888001'))!;
      expect(await identity.hasRole(contact, 'merchant_owner', draft.merchantOrgId)).toBe(true);
      expect((await owner.client.merchantAdmin.deals.list.query({ merchantOrgId: khalid.orgId }))[0]).toMatchObject({ state: 'approved' });
      expect((await fleetOwner.client.fleet.vehicles.query({})).find((v) => v.vehicleId === vehicle.vehicleId)).toMatchObject({ active: false });
      const after = await admin.client.approvals.list.query({});
      expect(after.items.map((i) => i.refId)).not.toEqual(expect.arrayContaining([doc.id, ownDoc.id, photo.photoId, deal.dealId, vehicle.vehicleId, draft.onboardingId]));
      const audit = await admin.client.ops.controls.audit.query({ subjectKind: 'approval' });
      expect(audit.map((a) => a.action)).toEqual(expect.arrayContaining(['approval.approve', 'approval.reject']));
      expect(audit.find((a) => a.subjectId === `merchant_onboarding:${draft.onboardingId}`)?.summary_ar).toBe('فعّل فلافل أبو علي');
    });
  });

  describe('support desk', () => {
    it('a dispute opens a ticket by itself; refunds post to the ledger within the agent, customer and escalation limits', async () => {
      const agent = await person(['support']);
      const finance = await person(['finance']);
      const admin = await person(['admin']);
      const customer = await person();
      const courierP = await person();
      expect(await codeOf(courierP.client.support.list.query({}))).toBe('forbidden');

      // A delivered food order the customer disputes.
      const placed = await order(customer.client, 'zakur');
      const orders = app.get(OrdersService);
      await orders.merchantAccept('cr-staff', { orderId: placed.id, prepMinutes: 1 });
      await orders.markReady('cr-staff', { orderId: placed.id });
      // The order machine's dispute event (what orders.openDispute emits once delivered) opens the ticket.
      await app.get(EventsService).emit(
        undefined,
        { type: 'order.disputed', actorId: customer.personId, occurredAt: new Date(), orderId: placed.id, payload: { kind: 'cold_or_late', note: 'وصل بارد وبعد ساعة، هذا غش', openedBy: 'customer' } },
        { name: 'order', id: placed.id },
      );
      const ticket = (await agent.client.support.list.query({})).rows.find((r) => r.orderId === placed.id)!;
      expect(ticket).toMatchObject({ kind: 'dispute', subject: 'الطلب تأخّر أو وصل بارد', channel: 'in_app' });
      expect(ticket.urgencyReasons).toContain('زعلان');
      expect(ticket).toMatchObject({ orderId: placed.id, customerId: customer.personId, status: 'open', slaState: expect.stringMatching(/ok|due_soon/) });

      const view = await agent.client.support.get.query({ ticketId: ticket.id });
      expect(view.order).toMatchObject({ id: placed.id, merchantName: khalid.seed.nameAr, lines: [{ name: 'وجبة كبد', qty: 1 }] });
      expect(view.timeline.map((e) => e.type)).toContain('order.placed');
      expect(view.suggestion).toMatchObject({ cannedKey: 'late_sorry' });
      expect(view.limits).toMatchObject({ agentDailyCapIqd: 10_000, agentUsedTodayIqd: 0, customerMonthlyCapIqd: 25_000, escalateAboveIqd: 25_000 });
      expect(view.canned.length).toBeGreaterThan(5);

      const reply = await agent.client.support.reply.mutate({ ticketId: ticket.id, text: 'حقّك علينا، دا نتابع ويا المطعم', cannedKey: 'late_sorry' });
      expect(reply.ticket).toMatchObject({ status: 'waiting', firstResponseAt: expect.any(Date) });

      // Agent: 5,000 now (refund within the order), then over the daily cap → finance.
      const key = `rf-${Date.now()}`;
      const r1 = await agent.client.support.refund.mutate({ ticketId: ticket.id, amountIqd: 5000, method: 'wallet', faultParty: 'platform', idempotencyKey: key });
      expect(r1.ticket.refundedIqd).toBe(5000);
      // The same click twice posts once.
      expect((await agent.client.support.refund.mutate({ ticketId: ticket.id, amountIqd: 5000, method: 'wallet', faultParty: 'platform', idempotencyKey: key })).ticket.refundedIqd).toBe(5000);
      expect(r1.ledger.some((l) => l.type === 'credit_issued' && l.amountIqd === 5000)).toBe(true);
      const credit = (await app.get(LedgerService).eventsFor(`customer:${customer.personId}`)).filter((e) => e.type === 'credit_issued');
      expect(credit.map((e) => [e.amount, e.fromAccount])).toEqual([[5000, 'platform']]);
      expect(await codeOf(agent.client.support.refund.mutate({ ticketId: ticket.id, amountIqd: placed.totalIqd - 5000 + 250, method: 'wallet', idempotencyKey: `${key}-b` }))).toBe('refund_exceeds_order');

      // A second, bigger case for the same customer: agent cap, finance's 25,000 single limit, the customer cap.
      const t2 = await agent.client.support.open.mutate({ kind: 'complaint', channel: 'whatsapp', subject: 'المندوب ما رجّع الباقي', customerId: customer.personId });
      expect(await codeOf(agent.client.support.refund.mutate({ ticketId: t2.id, amountIqd: 6000, method: 'wallet', idempotencyKey: `${key}-c` }))).toBe('refund_over_agent_limit');
      expect(await codeOf(finance.client.support.refund.mutate({ ticketId: t2.id, amountIqd: 25_250, method: 'wallet', idempotencyKey: `${key}-d` }))).toBe('refund_needs_escalation');
      await finance.client.support.refund.mutate({ ticketId: t2.id, amountIqd: 20_000, method: 'points', idempotencyKey: `${key}-e` });
      expect(await codeOf(finance.client.support.refund.mutate({ ticketId: t2.id, amountIqd: 500, method: 'wallet', idempotencyKey: `${key}-f` }))).toBe('refund_customer_cap');
      const points = (await app.get(LedgerService).eventsFor(`points:${customer.personId}`)).filter((e) => e.memo?.startsWith('support:'));
      expect(points.map((e) => e.amount)).toEqual([2000]);

      await agent.client.support.attributeFault.mutate({ ticketId: t2.id, faultParty: 'courier', note: 'ما رجّع الباقي' });
      const esc = await agent.client.support.escalate.mutate({ ticketId: t2.id, reason: 'يحتاج قرار علي' });
      expect(esc.ticket).toMatchObject({ status: 'escalated', faultParty: 'courier', escalatedTo: 'admin' });
      const done = await admin.client.support.resolve.mutate({ ticketId: t2.id, resolution: 'تعوّض بالنقاط وانحسبت على المندوب' });
      expect(done.ticket).toMatchObject({ status: 'resolved', slaState: 'met' });
      expect(await codeOf(agent.client.support.reply.mutate({ ticketId: t2.id, text: 'شي ثاني؟' }))).toBe('ticket_closed');
      expect(done.entries.map((e) => e.kind)).toEqual(['opened', 'refund', 'fault', 'escalate', 'resolve']);

      // The context panel's customer card: their orders, the credits so far and the other ticket.
      const card = await agent.client.support.customer.query({ ticketId: ticket.id });
      expect(card).toMatchObject({ customerId: customer.personId, orders: 1, refunded30dIqd: 25_000, disputes30d: 1 });
      expect(card!.recentTickets.map((r) => r.id)).toEqual([t2.id]);
      expect(await codeOf(courierP.client.support.customer.query({ ticketId: ticket.id }))).toBe('forbidden');

      const list = await agent.client.support.list.query({});
      expect(list.counts.resolvedToday).toBeGreaterThanOrEqual(1);
      expect(list.rows.every((r) => r.status !== 'resolved')).toBe(true);
    });
  });

  describe('cash desk and the wall', () => {
    it('finance reads the desk and exports CSV (audited); the wall shows the six week-one metrics', async () => {
      const finance = await person(['finance']);
      const dispatcher = await person(['dispatcher']);
      const customer = await person();
      expect(await codeOf(customer.client.finance.desk.query({}))).toBe('forbidden');
      expect(await codeOf(dispatcher.client.finance.exportSettlement.mutate({ kind: 'couriers' }))).toBe('forbidden');
      const desk = await dispatcher.client.finance.desk.query({});
      expect(desk.nightly).toMatchObject({ ok: true, message_ar: 'الدفتر متوازن' });
      expect(desk.round.at.getUTCHours()).toBe(20); // 23:00 Baghdad
      const csv = await finance.client.finance.exportSettlement.mutate({ kind: 'merchants' });
      expect(csv.filename).toMatch(/^driver-merchants-\d{4}-\d{2}-\d{2}\.csv$/);
      expect(csv.csv.split('\r\n')[0]).toBe('﻿merchant_id,name,payable_iqd,mode,exposure_cap_iqd,over_exposure');
      expect((await finance.client.ops.controls.audit.query({ subjectKind: 'export' }))[0]).toMatchObject({ action: 'finance.export', subjectId: csv.filename });

      const wall = await dispatcher.client.metrics.wall.query({});
      expect(wall.metrics.map((m) => m.key)).toEqual(['median_delivery', 'acceptance', 'disputes_24h', 'orders_day', 'rajaa_seats', 'ledger']);
      expect(wall.ordersByDay).toHaveLength(7);
      expect(wall.metrics.find((m) => m.key === 'orders_day')!.value).toBeGreaterThan(0);
      expect(wall.metrics.find((m) => m.key === 'ledger')).toMatchObject({ ok: true, display: 'متوازن' });
      expect(wall.metrics.find((m) => m.key === 'disputes_24h')).toMatchObject({ value: 0, ok: true });
      // S-K6: every tile says which way is better; minutes are written out (no bare "د").
      expect(wall.metrics.filter((m) => m.key !== 'ledger').every((m) => m.better === 'up' || m.better === 'down')).toBe(true);
      expect(wall.metrics.find((m) => m.key === 'orders_day')!.previous).toEqual(expect.any(Number));
      const med = wall.metrics.find((m) => m.key === 'median_delivery')!;
      expect(med.display === '—' || med.display.endsWith('دقيقة')).toBe(true);
      // S-K5: the round carries tonight's progress.
      expect(desk.round).toMatchObject({ collectedIqd: expect.any(Number), targetIqd: desk.round.totalIqd + (desk.round.collectedIqd ?? 0) });
    });
  });
});
