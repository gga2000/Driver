import { describe, expect, it } from 'vitest';
import { MerchantOnboardingInput } from '@driver/contracts';
import type { AuditLogService } from '../controls/index.js';
import type { DriverAccountService } from '../driver-account/index.js';
import { HandoverCodes } from '../driver-account/index.js';
import { createInMemoryEvents } from '../events/index.js';
import { harness as identityHarness } from '../identity/test-harness.js';
import { ledgerHarness, workedExample } from '../ledger/test-harness.js';
import { roundCollections } from '../control-room/index.js';
import { OrgsService } from '../orgs/index.js';
import { DevBlobStore, InMemorySavedPlacesRepository, LandmarkFeedService, PlacesService, SavedPlacesService, type BlobStore } from '../places/index.js';
import { InMemoryOpsRepository } from './ops.repository.js';
import { OpsService } from './ops.service.js';
import { InMemoryWindowCounter } from '../../shared/window-counter.js';

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
  const audits: Array<{ action: string; actorId: string; subjectId: string; detail?: Record<string, unknown> }> = [];
  const auditLog = { record: async (r: (typeof audits)[number]) => (audits.push(r), r) } as unknown as AuditLogService;
  const ops = new OpsService(repo, accounts, lh.merchantCash, lh.caps, lh.ledger, orgs, id.service, ev.events, blobs, ev.uow, clock, places, undefined, undefined, auditLog);
  const staff = (await id.login('07700000001')).actor;
  return { id, clock, lh, ev, blobs, codes, accounts, orgs, repo, ops, staff, places, audits };
}

describe('ops.recordCashReceipt on the Console round (S-K5)', () => {
  it("a receipt taken from the Console's \"استلمت\" is tonight's collection on the finance desk", async () => {
    const h = await setup();
    await h.lh.posting.orderMoney(workedExample({ orderId: 'o1', courierId: 'k1' }));
    const code = h.codes.code('k1', h.clock.now()).code;
    const r = await h.ops.recordCashReceipt(h.staff, { courierId: 'k1', amountIqd: 10000, code, idempotencyKey: 'console-round-k1' });
    const from = new Date(h.clock.now().getTime() - 3_600_000);
    const got = roundCollections(await h.lh.ledger.eventsOfTypes(['driver_settlement'], from, new Date(h.clock.now().getTime() + 1)));
    expect(got.get('k1')).toMatchObject({ amountIqd: 10000, reference: r.reference });
  });
});

describe('ops.recordCashReceipt: staff never take in their own cash', () => {
  it('a field ops person who also delivers cannot record a receipt for himself, even with his own code', async () => {
    const h = await setup();
    await h.lh.posting.orderMoney(workedExample({ orderId: 'o1', courierId: h.staff.personId }));
    const before = await h.lh.caps.status(h.staff.personId);
    const code = h.codes.code(h.staff.personId, h.clock.now()).code;
    await expect(h.ops.recordCashReceipt(h.staff, { courierId: h.staff.personId, amountIqd: 1000, code })).rejects.toMatchObject({ code: 'staff_own_account' });
    expect((await h.lh.caps.status(h.staff.personId)).cashIqd).toBe(before.cashIqd);
    expect(h.audits).toEqual([]);
  });

  it('every receipt writes a console audit row naming who took it', async () => {
    const h = await setup();
    await h.lh.posting.orderMoney(workedExample({ orderId: 'o1', courierId: 'k1' }));
    const r = await h.ops.recordCashReceipt(h.staff, { courierId: 'k1', amountIqd: 1000, code: h.codes.code('k1', h.clock.now()).code });
    expect(h.audits).toEqual([expect.objectContaining({ action: 'cash.receipt', actorId: h.staff.personId, subjectId: 'k1', detail: expect.objectContaining({ amountIqd: 1000, reference: r.reference }) })]);
  });
});

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

  it('takes only what he owes the company: the rest of the cash in his hand is his own pay', async () => {
    const h = await setup();
    await h.lh.posting.orderMoney(workedExample({ orderId: 'o1', courierId: 'k1' }));
    const s = await h.lh.caps.status('k1');
    const held = -s.cashIqd;
    expect(s.owedIqd).toBeGreaterThan(0);
    expect(s.owedIqd).toBeLessThan(held);
    const code = h.codes.code('k1', h.clock.now()).code;
    await expect(h.ops.recordCashReceipt(h.staff, { courierId: 'k1', amountIqd: held, code })).rejects.toMatchObject({ code: 'cash_receipt_exceeds_owed' });
    expect(h.audits).toEqual([]);
    const r = await h.ops.recordCashReceipt(h.staff, { courierId: 'k1', amountIqd: s.owedIqd, code, idempotencyKey: 'receipt-owed' });
    expect(r.courierOwedIqd).toBe(0);
    // His pay stays in his hand and on his book: nothing more is owed, nothing more can be taken.
    expect(-(await h.lh.caps.status('k1')).cashIqd).toBe(held - s.owedIqd);
    await expect(h.ops.recordCashReceipt(h.staff, { courierId: 'k1', amountIqd: 250, code })).rejects.toMatchObject({ code: 'cash_receipt_exceeds_owed' });
    // One audit row, for the one receipt that posted, at what he owed.
    expect(h.audits).toEqual([expect.objectContaining({ action: 'cash.receipt', subjectId: 'k1', detail: expect.objectContaining({ amountIqd: s.owedIqd, reference: r.reference }) })]);
  });

  it('a staff member who also delivers is refused his own hand-in whatever the amount, before the owed check', async () => {
    const h = await setup();
    await h.lh.posting.orderMoney(workedExample({ orderId: 'o1', courierId: h.staff.personId }));
    const s = await h.lh.caps.status(h.staff.personId);
    const code = h.codes.code(h.staff.personId, h.clock.now()).code;
    for (const amountIqd of [s.owedIqd, -s.cashIqd]) {
      await expect(h.ops.recordCashReceipt(h.staff, { courierId: h.staff.personId, amountIqd, code })).rejects.toMatchObject({ code: 'staff_own_account' });
    }
    expect(h.audits).toEqual([]);
  });
});

describe('ops.recordCashReceipt under concurrency (review 2026-10-04 #1)', () => {
  it('two field staff taking cash from one courier at once both post, under distinct references', async () => {
    const h = await setup();
    await h.lh.posting.orderMoney(workedExample({ orderId: 'o1', courierId: 'k1' }));
    const other = (await h.id.login('07700000002')).actor;
    const code = h.codes.code('k1', h.clock.now()).code;
    const [a, b] = await Promise.all([
      h.ops.recordCashReceipt(h.staff, { courierId: 'k1', amountIqd: 5000, code, idempotencyKey: 'rc-a' }),
      h.ops.recordCashReceipt(other, { courierId: 'k1', amountIqd: 5000, code, idempotencyKey: 'rc-b' }),
    ]);
    expect(a.reference).not.toBe(b.reference);
    const settled = (await h.lh.ledger.eventsFor('cash:k1')).filter((e) => e.type === 'driver_settlement');
    expect(settled.map((e) => e.amount)).toEqual([5000, 5000]);
    expect(h.repo.receipts).toHaveLength(2);
  });

  it('never takes more than the courier owes when two receipts race past the check', async () => {
    const h = await setup();
    await h.lh.posting.orderMoney(workedExample({ orderId: 'o1', courierId: 'k1' }));
    const due = (await h.lh.caps.status('k1')).owedIqd;
    const held = -(await h.lh.caps.status('k1')).cashIqd;
    expect(due).toBeGreaterThan(0);
    // The first receipt's held-cash read is slow (a busy ledger): the second lands meanwhile.
    let slowOnce = true;
    let secondDone: () => void = () => {};
    const secondFinished = new Promise<void>((r) => (secondDone = r));
    const caps = new Proxy(h.lh.caps, {
      get(target, prop, receiver) {
        if (prop !== 'status') return Reflect.get(target, prop, receiver);
        return async (id: string) => {
          const s = await target.status(id);
          if (slowOnce) {
            slowOnce = false;
            await Promise.race([secondFinished, new Promise((r) => setTimeout(r, 30))]);
          }
          return s;
        };
      },
    });
    const ops = new OpsService(h.repo, { verifyHandoverCode: () => true } as unknown as DriverAccountService, h.lh.merchantCash, caps, h.lh.ledger, h.orgs, h.id.service, h.ev.events, h.blobs, h.ev.uow, h.clock, h.places);
    const other = (await h.id.login('07700000002')).actor;
    const first = ops.recordCashReceipt(h.staff, { courierId: 'k1', amountIqd: due, code: '0000', idempotencyKey: 'rc-1' });
    await new Promise((r) => setTimeout(r, 0));
    const second = ops.recordCashReceipt(other, { courierId: 'k1', amountIqd: due, code: '0000', idempotencyKey: 'rc-2' }).finally(() => secondDone());
    const results = await Promise.allSettled([first, second]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason).toMatchObject({ code: expect.stringMatching(/^cash_receipt_exceeds_(owed|held)$/) });
    // Taken once: what is left in his hand is exactly his own pay.
    expect((await h.lh.caps.status('k1')).cashIqd).toBe(-(held - due));
  });
});

describe('ops.recordCashReceipt code guessing (review 2026-10-04 #8)', () => {
  it("locks a courier's hand-over code for the local day after 5 wrong codes, even for the right one", async () => {
    const h = await setup();
    await h.lh.posting.orderMoney(workedExample({ orderId: 'o1', courierId: 'k1' }));
    const good = h.codes.code('k1', h.clock.now()).code;
    const wrong = (n: number) => String((Number(good) + n) % 10_000).padStart(4, '0');
    for (let n = 1; n <= 5; n++) await expect(h.ops.recordCashReceipt(h.staff, { courierId: 'k1', amountIqd: 1000, code: wrong(n) })).rejects.toMatchObject({ code: 'handover_code_invalid' });
    await expect(h.ops.recordCashReceipt(h.staff, { courierId: 'k1', amountIqd: 1000, code: good })).rejects.toMatchObject({ code: 'handover_code_locked' });
    expect((await h.ev.events.forActor(h.staff.personId)).some((e) => e.type === 'ops.handover_code_locked')).toBe(true);
    // Another courier is unaffected; the next local day the courier's new code works again.
    await h.lh.posting.orderMoney(workedExample({ orderId: 'o2', courierId: 'k2' }));
    await expect(h.ops.recordCashReceipt(h.staff, { courierId: 'k2', amountIqd: 1000, code: h.codes.code('k2', h.clock.now()).code })).resolves.toMatchObject({ amountIqd: 1000 });
    h.clock.advance(24 * 3600_000);
    await expect(h.ops.recordCashReceipt(h.staff, { courierId: 'k1', amountIqd: 1000, code: h.codes.code('k1', h.clock.now()).code })).resolves.toMatchObject({ amountIqd: 1000 });
  });

  it('the 5-wrong-codes lock counts attempts on every API instance (shared counter; review 2026-10-04 #22)', async () => {
    const h = await setup();
    await h.lh.posting.orderMoney(workedExample({ orderId: 'o1', courierId: 'k1' }));
    const shared = new InMemoryWindowCounter(h.clock);
    const instance = () => new OpsService(h.repo, h.accounts, h.lh.merchantCash, h.lh.caps, h.lh.ledger, h.orgs, h.id.service, h.ev.events, h.blobs, h.ev.uow, h.clock, h.places, shared);
    const [a, b] = [instance(), instance()];
    const good = h.codes.code('k1', h.clock.now()).code;
    const wrong = (n: number) => String((Number(good) + n) % 10_000).padStart(4, '0');
    for (let n = 1; n <= 5; n++) await expect((n % 2 ? a : b).recordCashReceipt(h.staff, { courierId: 'k1', amountIqd: 1000, code: wrong(n) })).rejects.toMatchObject({ code: 'handover_code_invalid' });
    await expect(a.recordCashReceipt(h.staff, { courierId: 'k1', amountIqd: 1000, code: good })).rejects.toMatchObject({ code: 'handover_code_locked' });
    await expect(b.recordCashReceipt(h.staff, { courierId: 'k1', amountIqd: 1000, code: good })).rejects.toMatchObject({ code: 'handover_code_locked' });
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
      location: { zoneKey: 'centre', pin: { lat: 32.905, lng: 45.06 } },
      menuPhotoUploadIds: menu,
      commissionTier: 'starter',
    });
    expect(v).toMatchObject({ state: 'draft', menuPhotos: 2 });
    const org = await h.orgs.get(v.merchantOrgId);
    expect(org).toMatchObject({ type: 'restaurant', name: 'مطعم الريف', cityId: 'aziziyah' });
    expect((await h.orgs.merchantSettings(v.merchantOrgId)).location).toEqual({ zoneKey: 'centre', pin: { lat: 32.905, lng: 45.06 } });
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

  it('the kitchen’s zone is read from its pin, never the tapped zone; no pin or a pin outside town is refused', async () => {
    const h = await setup();
    const input = { cityId: 'aziziyah', name: 'مطعم الريف', type: 'restaurant' as const, contact: { name: 'أبو حسن', phone: '07800000126' }, menuPhotoUploadIds: [], commissionTier: 'starter' as const };
    // Pinned in Zakur while the chip said centre: the store sits in Zakur.
    const v = await h.ops.merchantOnboarding(h.staff, { ...input, location: { zoneKey: 'centre', pin: { lat: 32.887, lng: 45.0765 } } });
    expect((await h.orgs.merchantSettings(v.merchantOrgId)).location).toEqual({ zoneKey: 'zakur', pin: { lat: 32.887, lng: 45.0765 } });
    expect(h.repo.onboardings.at(-1)!.location).toEqual({ zoneKey: 'zakur', pin: { lat: 32.887, lng: 45.0765 } });
    await expect(h.ops.merchantOnboarding(h.staff, { ...input, contact: { name: 'x', phone: '07800000127' }, location: { zoneKey: 'centre', pin: { lat: 33.3, lng: 44.4 } } })).rejects.toMatchObject({ code: 'outside_zone' });
    expect(MerchantOnboardingInput.safeParse({ ...input, location: { zoneKey: 'centre' } }).success).toBe(false);
  });

  it('refuses photos that are not the caller’s uploads', async () => {
    const h = await setup();
    await expect(
      h.ops.merchantOnboarding(h.staff, { cityId: 'aziziyah', name: 'x محل', type: 'grocer', contact: { name: 'a', phone: '07800000124' }, location: { zoneKey: 'centre', pin: { lat: 32.905, lng: 45.06 } }, menuPhotoUploadIds: ['up_nope'], commissionTier: 'starter' }),
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
    const mosque = await h.places.save({ cityId: 'aziziyah', pin: { lat: 32.905, lng: 45.06 }, name: 'الجامع الكبير', photos: [], confidence: 1, sharedWith: [], landmark: true });
    await h.places.save({ cityId: 'aziziyah', pin: { lat: 32.9055, lng: 45.0605 }, name: 'بيت أبو علي', photos: [], confidence: 0.5, sharedWith: [], landmark: false });
    const park = await h.places.save({ cityId: 'aziziyah', pin: { lat: 32.9165, lng: 45.0585 }, name: 'حديقة الشاشة', photos: [], confidence: 1, sharedWith: [], landmark: true });
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

describe('approved landmark photos on the map (maps program b3)', () => {
  it('the newest approved photo of a landmark is in the feed as soon as it is approved; a rejected one never', async () => {
    const h = await setup();
    const saved = new SavedPlacesService(new InMemorySavedPlacesRepository(), h.blobs, { peersOf: () => [] }, h.ev.events, h.clock, h.places);
    const feed = new LandmarkFeedService(saved, h.blobs, h.clock);
    const ops = new OpsService(h.repo, h.accounts, h.lh.merchantCash, h.lh.caps, h.lh.ledger, h.orgs, h.id.service, h.ev.events, h.blobs, h.ev.uow, h.clock, h.places, undefined, feed);
    ops.onModuleInit();
    const mosque = await h.places.save({ cityId: 'aziziyah', pin: { lat: 32.905, lng: 45.06 }, name: 'الجامع الكبير', photos: [], confidence: 1, sharedWith: [], landmark: true });
    const reviewer = (await h.id.login('07700000002')).actor;
    const photoOf = async () => {
      const f = await feed.feed({ cityId: 'aziziyah' });
      return f.changed ? (f.landmarks.find((l) => l.id === mosque.id)?.photoUrl ?? null) : 'unchanged';
    };
    expect(await photoOf()).toBeNull();

    const rejected = await ops.addLandmarkPhoto(h.staff, { target: { kind: 'landmark', id: mosque.id }, uploadId: await upload(h.blobs, h.staff.personId), localNames: [] });
    await ops.reviewLandmarkPhoto(reviewer, { photoId: rejected.photoId, approve: false, reason: 'ضبابية' });
    expect(await photoOf()).toBeNull();

    const good = await upload(h.blobs, h.staff.personId);
    const approved = await ops.addLandmarkPhoto(h.staff, { target: { kind: 'landmark', id: mosque.id }, uploadId: good, localNames: [] });
    await ops.reviewLandmarkPhoto(reviewer, { photoId: approved.photoId, approve: true });
    expect(await photoOf()).toContain(`/files/${good}?`);
    expect(await h.repo.latestApprovedUploads([mosque.id, 'lm_none'])).toEqual(new Map([[mosque.id, good]]));
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
      location: { zoneKey: 'hashimi', pin: { lat: 32.896, lng: 45.0675 } },
      menuPhotoUploadIds: [],
      settlementMode: 'daily_zaincash',
      commissionTier: 'starter',
    });
    expect((await h.lh.merchantCash.settings(v.merchantOrgId)).mode).toBe('daily_zaincash');
  });
});

describe('ops.merchantOnboarding commission tier (Ali 2026-10-11)', () => {
  const visit = { cityId: 'aziziyah', name: 'كباب الزهراء', type: 'restaurant' as const, contact: { name: 'أبو علي', phone: '07800000131' }, location: { zoneKey: 'centre', pin: { lat: 32.905, lng: 45.06 } } };

  it('a new restaurant starts on starter (5 %) when the visit names no tier, and the audit log says so', async () => {
    const h = await setup();
    const v = await h.ops.merchantOnboarding(h.staff, MerchantOnboardingInput.parse(visit));
    expect((await h.orgs.merchantSettings(v.merchantOrgId)).commissionTier).toBe('starter');
    expect(h.audits).toEqual([expect.objectContaining({ action: 'store.commission_tier_set', actorId: h.staff.personId, subjectId: v.merchantOrgId, detail: expect.objectContaining({ from: null, to: 'starter' }) })]);
  });

  it('the visit may name another tier; pickup is not a store tier', async () => {
    const h = await setup();
    const v = await h.ops.merchantOnboarding(h.staff, MerchantOnboardingInput.parse({ ...visit, commissionTier: 'featured' }));
    expect((await h.orgs.merchantSettings(v.merchantOrgId)).commissionTier).toBe('featured');
    expect(h.audits.at(-1)).toMatchObject({ action: 'store.commission_tier_set', detail: { to: 'featured' } });
    expect(MerchantOnboardingInput.safeParse({ ...visit, commissionTier: 'pickup' }).success).toBe(false);
  });
});

describe('ops.homeKitchenApply (أكل بيت «سجّل مطبخك»)', () => {
  const DOOR = { lat: 32.887, lng: 45.0765 }; // Zakur
  const apply = { cityId: 'aziziyah', kitchenName: 'مطبخ أم حسين', cookName: 'أم حسين', door: DOOR, landmark: 'قرب جامع الزكور' };
  const cook = async (h: Awaited<ReturnType<typeof setup>>, phone = '07700000501') => (await h.id.login(phone)).actor;

  it('creates her restaurant org (no role yet), a submitted home_kitchen onboarding, a follow-up task and the home rate with one audit row', async () => {
    const h = await setup();
    const me = await cook(h);
    const v = await h.ops.homeKitchenApply(me, apply);
    expect(v).toEqual({ state: 'submitted', kitchenName: 'مطبخ أم حسين', submittedAt: h.clock.now(), rejectReason: null });
    expect(h.repo.onboardings).toHaveLength(1);
    const row = h.repo.onboardings[0]!;
    expect(row).toMatchObject({ type: 'home_kitchen', state: 'submitted', name: 'مطبخ أم حسين', cityId: 'aziziyah', createdById: me.personId, contactPersonId: me.personId, notes: 'قرب جامع الزكور', menuPhotoRefs: [], shopPhotoRef: null, location: { zoneKey: 'zakur', pin: DOOR } });
    expect(await h.orgs.get(row.orgId)).toMatchObject({ type: 'restaurant', name: 'مطبخ أم حسين', cityId: 'aziziyah', members: [expect.objectContaining({ personId: me.personId })] });
    // Nothing opens for her until staff approve it.
    expect(await h.id.service.hasRole(me.personId, 'merchant_owner', row.orgId)).toBe(false);
    expect(await h.id.service.hasRole(me.personId, 'merchant_owner')).toBe(false);
    const settings = await h.orgs.merchantSettings(row.orgId);
    expect(settings).toMatchObject({ commissionTier: 'home', location: { zoneKey: 'zakur', pin: DOOR } });
    expect(h.audits).toEqual([expect.objectContaining({ action: 'store.commission_tier_set', actorId: me.personId, subjectId: row.orgId, detail: { from: null, to: 'home', onboardingId: row.id } })]);
    expect(h.repo.tasks.filter((t) => t.refId === row.id)).toEqual([expect.objectContaining({ kind: 'merchant_followup', state: 'open', assigneeId: null, payload: { merchantOrgId: row.orgId, homeKitchen: true } })]);
    expect((await h.ev.events.forActor(me.personId)).filter((e) => e.type === 'merchant.onboarding_drafted').map((e) => e.payload)).toEqual([expect.objectContaining({ onboardingId: row.id, merchantOrgId: row.orgId, type: 'home_kitchen' })]);
  });

  it('no landmark leaves the notes empty', async () => {
    const h = await setup();
    await h.ops.homeKitchenApply(await cook(h), { ...apply, landmark: undefined });
    expect(h.repo.onboardings[0]!.notes).toBeNull();
  });

  it('asking again while one waits returns it and creates nothing new (one pending per person)', async () => {
    const h = await setup();
    const me = await cook(h);
    const first = await h.ops.homeKitchenApply(me, apply);
    h.clock.advance(60_000);
    const again = await h.ops.homeKitchenApply(me, { ...apply, kitchenName: 'اسم ثاني' });
    expect(again).toEqual(first);
    expect(h.repo.onboardings).toHaveLength(1);
    expect(h.repo.tasks).toHaveLength(1);
    expect(h.audits).toHaveLength(1);
  });

  it('a double tap (two calls at once) makes one application', async () => {
    const h = await setup();
    const me = await cook(h);
    const [a, b] = await Promise.all([h.ops.homeKitchenApply(me, apply), h.ops.homeKitchenApply(me, apply)]);
    expect(a).toEqual(b);
    expect(h.repo.onboardings).toHaveLength(1);
    expect(h.repo.tasks).toHaveLength(1);
    expect(h.audits).toHaveLength(1);
  });

  it('a door outside the zones is refused and nothing is made', async () => {
    const h = await setup();
    const me = await cook(h);
    await expect(h.ops.homeKitchenApply(me, { ...apply, door: { lat: 33.3, lng: 44.4 } })).rejects.toMatchObject({ code: 'outside_zone' });
    expect(h.repo.onboardings).toEqual([]);
    expect(h.audits).toEqual([]);
    expect((await h.id.repo.readIdentity(me.personId))?.name ?? null).toBeNull();
  });

  it("her name goes to the vault only when it has none; it never overwrites one", async () => {
    const h = await setup();
    const fresh = await cook(h, '07700000502');
    await h.ops.homeKitchenApply(fresh, apply);
    expect((await h.id.repo.readIdentity(fresh.personId))?.name).toBe('أم حسين');

    const named = await cook(h, '07700000503');
    await h.id.service.setName({ personId: named.personId, sessionId: 's' }, 'زهراء');
    await h.ops.homeKitchenApply(named, { ...apply, cookName: 'اسم آخر' });
    expect((await h.id.repo.readIdentity(named.personId))?.name).toBe('زهراء');
    // The name lives only in the vault, never on the onboarding row.
    expect(JSON.stringify(h.repo.onboardings)).not.toContain('اسم آخر');
  });
  it("a pending ordinary restaurant onboarding with her as contact doesn't count as her kitchen application", async () => {
    const h = await setup();
    const me = await cook(h, '07700000504');
    await h.ops.merchantOnboarding(h.staff, MerchantOnboardingInput.parse({ cityId: 'aziziyah', name: 'كباب الزهراء', type: 'restaurant', contact: { name: 'أم حسين', phone: '07700000504' }, location: { zoneKey: 'centre', pin: { lat: 32.905, lng: 45.06 } } }));
    expect(h.repo.onboardings).toEqual([expect.objectContaining({ type: 'restaurant', state: 'draft', contactPersonId: me.personId })]);
    h.clock.advance(60_000);
    const v = await h.ops.homeKitchenApply(me, apply);
    expect(v).toEqual({ state: 'submitted', kitchenName: 'مطبخ أم حسين', submittedAt: h.clock.now(), rejectReason: null });
    expect(h.repo.onboardings.map((o) => [o.type, o.state])).toEqual([
      ['restaurant', 'draft'],
      ['home_kitchen', 'submitted'],
    ]);
    expect(await h.ops.myHomeKitchenApplication(me)).toMatchObject({ state: 'submitted', kitchenName: 'مطبخ أم حسين' });
  });
});

describe('ops.myHomeKitchenApplication', () => {
  const apply = { cityId: 'aziziyah', kitchenName: 'مطبخ أم حسين', cookName: 'أم حسين', door: { lat: 32.887, lng: 45.0765 } };

  it('none, then submitted, then active once staff approve it', async () => {
    const h = await setup();
    const me = (await h.id.login('07700000511')).actor;
    expect(await h.ops.myHomeKitchenApplication(me)).toEqual({ state: 'none', kitchenName: null, submittedAt: null, rejectReason: null });
    const at = h.clock.now();
    await h.ops.homeKitchenApply(me, apply);
    expect(await h.ops.myHomeKitchenApplication(me)).toEqual({ state: 'submitted', kitchenName: 'مطبخ أم حسين', submittedAt: at, rejectReason: null });
    await h.ops.reviewOnboarding(h.staff, { onboardingId: h.repo.onboardings[0]!.id, approve: true });
    expect(await h.ops.myHomeKitchenApplication(me)).toMatchObject({ state: 'active', kitchenName: 'مطبخ أم حسين', rejectReason: null });
  });

  it('rejected with the reason; a new application after that is the one she sees', async () => {
    const h = await setup();
    const me = (await h.id.login('07700000512')).actor;
    await h.ops.homeKitchenApply(me, apply);
    await h.ops.reviewOnboarding(h.staff, { onboardingId: h.repo.onboardings[0]!.id, approve: false, reason: 'ما ردّت على الاتصال' });
    expect(await h.ops.myHomeKitchenApplication(me)).toEqual({ state: 'rejected', kitchenName: 'مطبخ أم حسين', submittedAt: expect.any(Date), rejectReason: 'ما ردّت على الاتصال' });
    h.clock.advance(3_600_000);
    await h.ops.homeKitchenApply(me, { ...apply, kitchenName: 'مطبخ زهراء' });
    expect(h.repo.onboardings).toHaveLength(2);
    expect(await h.ops.myHomeKitchenApplication(me)).toMatchObject({ state: 'submitted', kitchenName: 'مطبخ زهراء', rejectReason: null });
  });
});

describe('approving a home kitchen (ops.reviewOnboarding)', () => {
  const apply = { cityId: 'aziziyah', kitchenName: 'مطبخ أم حسين', cookName: 'أم حسين', door: { lat: 32.887, lng: 45.0765 } };

  it('the cook can never approve her own application, even holding a staff role', async () => {
    const h = await setup();
    const me = (await h.id.login('07700000521')).actor;
    await h.id.service.grantRole({ personId: 'system:test' }, { personId: me.personId, kind: 'field_ops' });
    await h.ops.homeKitchenApply(me, apply);
    const row = h.repo.onboardings[0]!;
    await expect(h.ops.reviewOnboarding(me, { onboardingId: row.id, approve: true })).rejects.toMatchObject({ code: 'approval_own_item' });
    await expect(h.ops.reviewOnboarding(me, { onboardingId: row.id, approve: false })).rejects.toMatchObject({ code: 'approval_own_item' });
    expect(h.repo.onboardings[0]!.state).toBe('submitted');
    expect(await h.id.service.hasRole(me.personId, 'merchant_owner', row.orgId)).toBe(false);
  });

  it("another staff member's approval makes her the owner and says merchant.activated with type home_kitchen", async () => {
    const h = await setup();
    const me = (await h.id.login('07700000522')).actor;
    await h.ops.homeKitchenApply(me, apply);
    const row = h.repo.onboardings[0]!;
    const decided = await h.ops.reviewOnboarding(h.staff, { onboardingId: row.id, approve: true });
    expect(decided).toMatchObject({ state: 'active', reviewedById: h.staff.personId });
    expect(await h.id.service.hasRole(me.personId, 'merchant_owner', row.orgId)).toBe(true);
    const activated = (await h.ev.events.forActor(h.staff.personId)).filter((e) => e.type === 'merchant.activated');
    expect(activated.map((e) => e.payload)).toEqual([{ onboardingId: row.id, merchantOrgId: row.orgId, cityId: 'aziziyah', contactPersonId: me.personId, type: 'home_kitchen', reason: null }]);
    // Her follow-up task closes with the decision; a second decision is a conflict.
    expect(h.repo.tasks.find((t) => t.refId === row.id)).toMatchObject({ state: 'done', payload: expect.objectContaining({ decision: 'activated' }) });
    await expect(h.ops.reviewOnboarding(h.staff, { onboardingId: row.id, approve: true })).rejects.toMatchObject({ code: 'approval_state_conflict' });
  });
});

describe('ops.merchantOnboarding of a home kitchen (field ops visit)', () => {
  const visit = { cityId: 'aziziyah', name: 'مطبخ أم علي', contact: { name: 'أم علي', phone: '07800000141' }, location: { zoneKey: 'centre', pin: { lat: 32.905, lng: 45.06 } } };

  it('is a restaurant org on the home tier, never starter, whatever tier the visit named', async () => {
    const h = await setup();
    const v = await h.ops.merchantOnboarding(h.staff, MerchantOnboardingInput.parse({ ...visit, type: 'home_kitchen' }));
    expect(await h.orgs.get(v.merchantOrgId)).toMatchObject({ type: 'restaurant', name: 'مطبخ أم علي' });
    expect((await h.orgs.merchantSettings(v.merchantOrgId)).commissionTier).toBe('home');
    expect(h.repo.onboardings.at(-1)).toMatchObject({ type: 'home_kitchen', state: 'draft' });
    expect(h.audits).toEqual([expect.objectContaining({ action: 'store.commission_tier_set', subjectId: v.merchantOrgId, detail: expect.objectContaining({ from: null, to: 'home' }) })]);
    const named = await h.ops.merchantOnboarding(h.staff, MerchantOnboardingInput.parse({ ...visit, type: 'home_kitchen', contact: { name: 'أم علي', phone: '07800000142' }, commissionTier: 'featured' }));
    expect((await h.orgs.merchantSettings(named.merchantOrgId)).commissionTier).toBe('home');
  });

  it('the home rate is only for a home kitchen: a restaurant or grocer visit naming it is refused and nothing is made', async () => {
    const h = await setup();
    for (const [type, phone] of [['restaurant', '07800000144'], ['grocer', '07800000145']] as const) {
      await expect(h.ops.merchantOnboarding(h.staff, MerchantOnboardingInput.parse({ ...visit, name: 'كباب الزهراء', type, contact: { name: 'أبو علي', phone }, commissionTier: 'home' }))).rejects.toMatchObject({ code: 'commission_tier_home_only' });
    }
    // No store org is left behind for a refused visit, and the contact is not added to the vault.
    expect(await h.orgs.inCity('aziziyah')).toEqual([]);
    expect(await h.id.service.personIdByPhone('07800000144')).toBeNull();
    expect(h.repo.onboardings).toEqual([]);
    expect(h.repo.tasks).toEqual([]);
    expect(h.audits).toEqual([]);
    expect(await h.ev.events.forActor(h.staff.personId)).not.toEqual(expect.arrayContaining([expect.objectContaining({ type: 'merchant.onboarding_drafted' })]));
  });

  it('an ordinary restaurant visit is unchanged: starter by default', async () => {
    const h = await setup();
    const v = await h.ops.merchantOnboarding(h.staff, MerchantOnboardingInput.parse({ ...visit, name: 'كباب الزهراء', type: 'restaurant', contact: { name: 'أبو علي', phone: '07800000143' } }));
    expect(await h.orgs.get(v.merchantOrgId)).toMatchObject({ type: 'restaurant' });
    expect((await h.orgs.merchantSettings(v.merchantOrgId)).commissionTier).toBe('starter');
    expect(h.repo.onboardings.at(-1)).toMatchObject({ type: 'restaurant' });
  });
});
