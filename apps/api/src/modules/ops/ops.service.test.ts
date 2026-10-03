import { describe, expect, it } from 'vitest';
import type { DriverAccountService } from '../driver-account/index.js';
import { HandoverCodes } from '../driver-account/index.js';
import { createInMemoryEvents } from '../events/index.js';
import { harness as identityHarness } from '../identity/test-harness.js';
import { ledgerHarness, workedExample } from '../ledger/test-harness.js';
import { OrgsService } from '../orgs/index.js';
import { DevBlobStore, PlacesService, type BlobStore } from '../places/index.js';
import { InMemoryOpsRepository } from './ops.repository.js';
import { OpsService } from './ops.service.js';

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);

async function upload(blobs: BlobStore, ownerId: string): Promise<string> {
  const ticket = await blobs.createUpload({ ownerId, contentType: 'image/jpeg', sizeBytes: JPEG.length });
  const url = new URL(ticket.uploadUrl, 'http://local');
  await blobs.receive({ id: ticket.uploadId, exp: url.searchParams.get('exp') ?? undefined, sig: url.searchParams.get('sig') ?? undefined, contentType: 'image/jpeg', bytes: JPEG });
  return ticket.uploadId;
}

async function setup() {
  const id = identityHarness('2026-10-03T12:00:00Z');
  const clock = id.clock;
  const lh = ledgerHarness({ start: '2026-10-03T12:00:00Z' });
  const ev = createInMemoryEvents({ clock });
  const blobs = new DevBlobStore(clock, { secret: 'blob' });
  const codes = new HandoverCodes('handover-test-secret');
  const accounts = { verifyHandoverCode: (driverId: string, code: string) => codes.verify(driverId, code, clock.now()) } as unknown as DriverAccountService;
  const orgs = new OrgsService(undefined, clock);
  const repo = new InMemoryOpsRepository();
  const places = new PlacesService();
  const ops = new OpsService(repo, accounts, lh.merchantCash, lh.caps, lh.ledger, orgs, id.service, ev.events, blobs, ev.uow, clock, places);
  const staff = (await id.login('07700000001')).actor;
  return { id, clock, lh, ev, blobs, codes, orgs, repo, ops, staff, places };
}

describe('ops.recordCashReceipt', () => {
  it("takes cash against the courier's daily code, posts driver_settlement and frees his cap", async () => {
    const h = await setup();
    await h.lh.posting.orderMoney(workedExample({ orderId: 'o1', courierId: 'k1' }));
    const before = await h.lh.caps.status('k1');
    expect(before.owedIqd).toBeGreaterThan(0);
    const code = h.codes.code('k1', h.clock.now()).code;
    const r = await h.ops.recordCashReceipt(h.staff, { courierId: 'k1', amountIqd: 10000, code, idempotencyKey: 'receipt-0001' });
    expect(r.reference).toMatch(/^D-[0-9A-Z]{4}-[0-9A-Z]{4}$/);
    expect(r.courierOwedIqd).toBe(before.owedIqd - 10000);
    expect((await h.lh.ledger.eventsFor('cash:k1')).filter((e) => e.type === 'driver_settlement').map((e) => [e.amount, e.memo])).toEqual([[10000, `ops_round:${r.reference}`]]);
    expect((await h.ev.events.forActor(h.staff.personId)).find((e) => e.type === 'ops.cash_received')?.payload).toMatchObject({ courierId: 'k1', amountIqd: 10000, whatsappReceipt: true });
    // A retry with the same key returns the first receipt and posts nothing more.
    const again = await h.ops.recordCashReceipt(h.staff, { courierId: 'k1', amountIqd: 10000, code, idempotencyKey: 'receipt-0001' });
    expect(again.receiptId).toBe(r.receiptId);
    expect((await h.lh.ledger.eventsFor('cash:k1')).filter((e) => e.type === 'driver_settlement')).toHaveLength(1);
  });

  it('refuses a wrong code and more than the courier holds', async () => {
    const h = await setup();
    await h.lh.posting.orderMoney(workedExample({ orderId: 'o1', courierId: 'k1' }));
    const good = h.codes.code('k1', h.clock.now()).code;
    const bad = good === '0000' ? '0001' : '0000';
    await expect(h.ops.recordCashReceipt(h.staff, { courierId: 'k1', amountIqd: 1000, code: bad })).rejects.toMatchObject({ code: 'handover_code_invalid' });
    await expect(h.ops.recordCashReceipt(h.staff, { courierId: 'k1', amountIqd: 1_000_000, code: good })).rejects.toMatchObject({ code: 'cash_receipt_exceeds_held' });
  });
});

describe('ops.merchantOnboarding and tasks', () => {
  it('drafts the merchant org with the owner in the vault, keeps menu photos and opens a follow-up task', async () => {
    const h = await setup();
    const menu = [await upload(h.blobs, h.staff.personId), await upload(h.blobs, h.staff.personId)];
    const v = await h.ops.merchantOnboarding(h.staff, {
      cityId: 'aziziyah',
      name: 'مطعم الريف',
      type: 'restaurant',
      contact: { name: 'أبو حسن', phone: '07800000123' },
      location: { zoneKey: 'centre', pin: { lat: 32.91, lng: 45.06 } },
      menuPhotoUploadIds: menu,
    });
    expect(v).toMatchObject({ state: 'draft', menuPhotos: 2 });
    const org = h.orgs.get(v.merchantOrgId);
    expect(org).toMatchObject({ type: 'restaurant', name: 'مطعم الريف', cityId: 'aziziyah' });
    expect(h.orgs.merchantSettings(v.merchantOrgId).location).toEqual({ zoneKey: 'centre', pin: { lat: 32.91, lng: 45.06 } });
    const ownerId = h.repo.onboardings[0]!.contactPersonId;
    expect((await h.id.repo.readIdentity(ownerId))?.name).toBe('أبو حسن');
    expect(JSON.stringify(h.repo.onboardings[0])).not.toContain('07800000123');

    const tasks = await h.ops.myTasks(h.staff, {});
    expect(tasks.map((t) => [t.taskId, t.kind])).toEqual([[v.taskId, 'merchant_followup']]);
    const done = await h.ops.completeTask(h.staff, { taskId: v.taskId, note: 'المنيو انضاف' });
    expect(done.state).toBe('done');
    expect(await h.ops.myTasks(h.staff, {})).toEqual([]);
    await expect(h.ops.completeTask(h.staff, { taskId: 'otk_nope' })).rejects.toMatchObject({ code: 'task_not_found' });
  });

  it('refuses photos that are not the caller’s uploads', async () => {
    const h = await setup();
    await expect(
      h.ops.merchantOnboarding(h.staff, { cityId: 'aziziyah', name: 'x محل', type: 'grocer', contact: { name: 'a', phone: '07800000124' }, location: { zoneKey: 'centre' }, menuPhotoUploadIds: ['up_nope'] }),
    ).rejects.toMatchObject({ code: 'upload_invalid' });
  });

  it('lists couriers at half their cap or more as cash to collect, largest first', async () => {
    const h = await setup();
    for (const o of ['o1', 'o2', 'o3']) await h.lh.posting.orderMoney(workedExample({ orderId: o, courierId: 'k_big' }));
    await h.lh.posting.orderMoney(workedExample({ orderId: 'o4', courierId: 'k_small' }));
    const tasks = await h.ops.myTasks(h.staff, {});
    expect(tasks.map((t) => t.taskId)).toEqual(['cash:k_big']);
    expect(tasks[0]).toMatchObject({ kind: 'cash_collection', computed: true, refId: 'k_big' });
    expect(tasks[0]!.amountIqd).toBe((await h.lh.caps.status('k_big')).owedIqd);
  });
});

describe('ops.addLandmarkPhoto', () => {
  it('proposes the photo for Console approval', async () => {
    const h = await setup();
    const p = await h.ops.addLandmarkPhoto(h.staff, { target: { kind: 'landmark', id: 'lm_mosque' }, uploadId: await upload(h.blobs, h.staff.personId), localNames: ['يم الجامع الكبير'] });
    expect(p).toMatchObject({ state: 'proposed', target: { kind: 'landmark', id: 'lm_mosque' } });
    expect((await h.ev.events.forActor(h.staff.personId)).find((e) => e.type === 'landmark.proposed')?.payload).toMatchObject({ localNames: ['يم الجامع الكبير'] });
  });
});

describe('ops.cashHolders', () => {
  it('lists couriers holding cash with vault names, over-cap and most owed first', async () => {
    const h = await setup();
    const big = (await h.id.login('07700000061')).actor.personId;
    const small = (await h.id.login('07700000062')).actor.personId;
    await h.id.service.setName({ personId: big, sessionId: 's' }, 'حيدر');
    for (const o of ['o1', 'o2', 'o3']) await h.lh.posting.orderMoney(workedExample({ orderId: o, courierId: big }));
    await h.lh.posting.orderMoney(workedExample({ orderId: 'o4', courierId: small }));
    const rows = await h.ops.cashHolders(h.staff, {});
    expect(rows.map((r) => r.courierId)).toEqual([big, small]);
    const s = await h.lh.caps.status(big);
    expect(rows[0]).toMatchObject({ name: 'حيدر', phoneMasked: '+96477*****61', owedIqd: s.owedIqd, capIqd: s.capIqd, tier: s.tier, overCap: s.overCap });
    expect(rows[0]!.heldIqd).toBe(-s.cashIqd);
    expect(h.id.repo.accessLogs.some((l) => l.personId === big && l.purpose === 'ops_cash_round')).toBe(true);
  });
});

describe('ops.landmarks', () => {
  it('lists landmark places by zone, fewest photos first, counting proposed ones', async () => {
    const h = await setup();
    const mosque = h.places.save({ cityId: 'aziziyah', pin: { lat: 32.905, lng: 45.06 }, name: 'الجامع الكبير', photos: [], confidence: 1, sharedWith: [], landmark: true });
    h.places.save({ cityId: 'aziziyah', pin: { lat: 32.9055, lng: 45.0605 }, name: 'بيت أبو علي', photos: [], confidence: 0.5, sharedWith: [], landmark: false });
    const park = h.places.save({ cityId: 'aziziyah', pin: { lat: 32.9165, lng: 45.0585 }, name: 'حديقة الشاشة', photos: [], confidence: 1, sharedWith: [], landmark: true });
    await h.ops.addLandmarkPhoto(h.staff, { target: { kind: 'landmark', id: mosque.id }, uploadId: await upload(h.blobs, h.staff.personId), localNames: [] });
    const all = await h.ops.landmarks(h.staff, { cityId: 'aziziyah' });
    expect(all.map((l) => [l.name, l.zoneKey, l.photos])).toEqual([
      ['حديقة الشاشة', 'mahdood_2', 0],
      ['الجامع الكبير', 'centre', 1],
    ]);
    expect((await h.ops.landmarks(h.staff, { cityId: 'aziziyah', zoneKey: 'centre' })).map((l) => l.placeId)).toEqual([mosque.id]);
    expect(park.landmark).toBe(true);
  });
});

describe('ops.merchantOnboarding settlement mode', () => {
  it("sets the merchant's settlement mode when the visit chose one", async () => {
    const h = await setup();
    const v = await h.ops.merchantOnboarding(h.staff, {
      cityId: 'aziziyah',
      name: 'أسواق النور',
      type: 'grocer',
      contact: { name: 'أبو نور', phone: '07800000125' },
      location: { zoneKey: 'hashimi' },
      menuPhotoUploadIds: [],
      settlementMode: 'daily_zaincash',
    });
    expect((await h.lh.merchantCash.settings(v.merchantOrgId)).mode).toBe('daily_zaincash');
  });
});
