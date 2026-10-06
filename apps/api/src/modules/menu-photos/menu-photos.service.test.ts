import { describe, expect, it } from 'vitest';
import type { Actor } from '@driver/contracts';
import { CatalogService, InMemoryCatalogRepository } from '../catalog/index.js';
import { createInMemoryEvents } from '../events/index.js';
import { harness as identityHarness } from '../identity/test-harness.js';
import { OrgsService } from '../orgs/index.js';
import { DevBlobStore, type BlobStore } from '../places/index.js';
import { InMemoryMenuPhotosRepository } from './menu-photos.repository.js';
import { MenuPhotosService } from './menu-photos.service.js';

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
const HOUR = 3_600_000;

async function upload(blobs: BlobStore, ownerId: string): Promise<string> {
  const ticket = await blobs.createUpload({ ownerId, contentType: 'image/jpeg', sizeBytes: JPEG.length });
  const url = new URL(ticket.uploadUrl, 'http://local');
  await blobs.receive({ id: ticket.uploadId, exp: url.searchParams.get('exp') ?? undefined, sig: url.searchParams.get('sig') ?? undefined, contentType: 'image/jpeg', bytes: JPEG });
  return ticket.uploadId;
}

async function setup(start = '2026-10-07T07:00:00Z') {
  const id = identityHarness(start);
  const clock = id.clock;
  const ev = createInMemoryEvents({ clock });
  const blobs = new DevBlobStore(clock, { secret: 'blob' });
  const catalog = new CatalogService(new InMemoryCatalogRepository(), clock);
  const orgs = new OrgsService(undefined, clock);
  const org = await orgs.create({ type: 'restaurant', name: 'مطعم خالد', cityId: 'aziziyah', ownerId: 'x' });
  const other = await orgs.create({ type: 'restaurant', name: 'مطعم الريف', cityId: 'aziziyah', ownerId: 'y' });
  const dish = async (orgId: string, nameAr: string) => (await catalog.upsertItem(orgId, { patch: { nameAr, priceIqd: 5000 } }, 'seed')).item.id;
  const tikka = await dish(org.id, 'تكة');
  const kebab = await dish(org.id, 'كباب');
  const hummus = await dish(org.id, 'حمص');
  const foreign = await dish(other.id, 'قوزي');
  const repo = new InMemoryMenuPhotosRepository();
  const svc = new MenuPhotosService(repo, catalog, orgs, id.service, ev.events, blobs, ev.uow, clock);
  async function person(phone: string, grant?: { kind: 'merchant_owner' | 'merchant_staff' | 'field_ops' | 'admin'; orgId?: string }, name?: string): Promise<Actor> {
    const { actor } = await id.login(phone);
    if (grant) await id.service.grantRole({ personId: 'admin' }, { personId: actor.personId, kind: grant.kind, ...(grant.orgId ? { orgId: grant.orgId } : {}) });
    if (name) await id.service.nameIfMissing(actor.personId, name);
    return actor;
  }
  const owner = await person('07701234567', { kind: 'merchant_owner', orgId: org.id });
  const staff = await person('07709990000', { kind: 'merchant_staff', orgId: org.id });
  const otherOwner = await person('07705550001', { kind: 'merchant_owner', orgId: other.id });
  const ops = await person('07701110006', { kind: 'field_ops' }, 'ياسر عبد الله');
  const ops2 = await person('07701110016', { kind: 'field_ops' }, 'مصطفى كريم');
  const admin = await person('07700000001', { kind: 'admin' });
  return { id, clock, ev, blobs, catalog, orgs, repo, svc, orgId: org.id, otherOrgId: other.id, tikka, kebab, hummus, foreign, owner, staff, otherOwner, ops, ops2, admin };
}

type H = Awaited<ReturnType<typeof setup>>;

/** A request for two dishes, taken by `ops` with a visit in two hours. */
async function scheduled(h: H) {
  const r = await h.svc.request(h.owner, { merchantOrgId: h.orgId, itemIds: [h.tikka, h.kebab], note: 'الأفضل الصبح قبل الزحمة' });
  await h.svc.schedule(h.ops, { requestId: r.requestId, scheduledFor: new Date(h.clock.now().getTime() + 2 * HOUR) });
  return r.requestId;
}

/** Both dishes shot and handed over. */
async function handedOver(h: H) {
  const requestId = await scheduled(h);
  await h.svc.addShot(h.ops, { requestId, itemId: h.tikka, uploadId: await upload(h.blobs, h.ops.personId) });
  await h.svc.addShot(h.ops, { requestId, itemId: h.kebab, uploadId: await upload(h.blobs, h.ops.personId) });
  const v = await h.svc.markShot(h.ops, { requestId });
  return { requestId, view: v };
}

describe('menu photo service: the merchant asks', () => {
  it('owner asks for named dishes with a note; staff see it read only; another store sees nothing', async () => {
    const h = await setup();
    const v = await h.svc.request(h.owner, { merchantOrgId: h.orgId, itemIds: [h.kebab, h.tikka, h.kebab], note: '  الأفضل الصبح قبل الزحمة ' });
    expect(v).toMatchObject({ state: 'requested', storeName: 'مطعم خالد', note: 'الأفضل الصبح قبل الزحمة', wholeMenu: false, canAct: true, photographerName: null });
    // Menu order, each dish once.
    expect(v.dishes.map((d) => d.nameAr)).toEqual(['تكة', 'كباب']);
    expect(v.counts).toEqual({ dishes: 2, proposed: 0, accepted: 0, rejected: 0 });
    const seen = await h.svc.merchantList(h.staff, { merchantOrgId: h.orgId });
    expect(seen.map((r) => [r.requestId, r.canAct])).toEqual([[v.requestId, false]]);
    await expect(h.svc.merchantList(h.otherOwner, { merchantOrgId: h.orgId })).rejects.toMatchObject({ code: 'forbidden' });
    expect((await h.ev.events.forActor(h.owner.personId)).map((e) => e.type)).toContain('menu_photos.requested');
  });

  it('no dishes named = the whole menu', async () => {
    const h = await setup();
    const v = await h.svc.request(h.owner, { merchantOrgId: h.orgId, itemIds: [] });
    expect(v.wholeMenu).toBe(true);
    expect(v.dishes.map((d) => d.nameAr)).toEqual(['تكة', 'كباب', 'حمص']);
  });

  it('staff cannot ask or cancel; dishes of another store are refused; one open request per store', async () => {
    const h = await setup();
    await expect(h.svc.request(h.staff, { merchantOrgId: h.orgId, itemIds: [] })).rejects.toMatchObject({ code: 'forbidden' });
    await expect(h.svc.request(h.owner, { merchantOrgId: h.orgId, itemIds: [h.foreign] })).rejects.toMatchObject({ code: 'menu_item_not_found' });
    const v = await h.svc.request(h.owner, { merchantOrgId: h.orgId, itemIds: [] });
    await expect(h.svc.request(h.owner, { merchantOrgId: h.orgId, itemIds: [h.tikka] })).rejects.toMatchObject({ code: 'menu_photo_request_open' });
    await expect(h.svc.cancel(h.staff, { merchantOrgId: h.orgId, requestId: v.requestId })).rejects.toMatchObject({ code: 'forbidden' });
    await expect(h.svc.cancel(h.otherOwner, { merchantOrgId: h.otherOrgId, requestId: v.requestId })).rejects.toMatchObject({ code: 'menu_photo_not_found' });
    const cancelled = await h.svc.cancel(h.owner, { merchantOrgId: h.orgId, requestId: v.requestId });
    expect(cancelled).toMatchObject({ state: 'cancelled' });
    expect(cancelled.closedAt).not.toBeNull();
    // Closed: a new one can be asked for.
    await expect(h.svc.request(h.owner, { merchantOrgId: h.orgId, itemIds: [h.tikka] })).resolves.toMatchObject({ state: 'requested' });
  });

  it('cancelling a visit already being shot deletes the photos taken so far', async () => {
    const h = await setup();
    const requestId = await scheduled(h);
    const up = await upload(h.blobs, h.ops.personId);
    await h.svc.addShot(h.ops, { requestId, itemId: h.tikka, uploadId: up });
    await h.svc.cancel(h.owner, { merchantOrgId: h.orgId, requestId });
    expect(await h.blobs.get(up)).toBeNull();
    await expect(h.svc.addShot(h.ops, { requestId, itemId: h.kebab, uploadId: await upload(h.blobs, h.ops.personId) })).rejects.toMatchObject({ code: 'menu_photo_state_conflict' });
  });
});

describe('menu photo service: field ops shoot', () => {
  it('lists open requests in the city, his own first; setting the visit takes it', async () => {
    const h = await setup();
    const requestId = await scheduled(h);
    const forHim = await h.svc.openForOps(h.ops, { cityId: 'aziziyah' });
    expect(forHim).toHaveLength(1);
    expect(forHim[0]).toMatchObject({ requestId, state: 'scheduled', assignedToMe: true, canAct: true, photographerName: 'ياسر', note: 'الأفضل الصبح قبل الزحمة' });
    // A colleague sees it taken and cannot act on it.
    const forColleague = await h.svc.openForOps(h.ops2, { cityId: 'aziziyah' });
    expect(forColleague[0]).toMatchObject({ assignedToMe: false, canAct: false });
    await expect(h.svc.schedule(h.ops2, { requestId, scheduledFor: new Date(h.clock.now().getTime() + HOUR) })).rejects.toMatchObject({ code: 'menu_photo_taken' });
    await expect(h.svc.addShot(h.ops2, { requestId, itemId: h.tikka, uploadId: await upload(h.blobs, h.ops2.personId) })).rejects.toMatchObject({ code: 'menu_photo_taken' });
    // He moves his own visit; an admin can move it for him and it stays his.
    await expect(h.svc.schedule(h.ops, { requestId, scheduledFor: new Date(h.clock.now().getTime() + 26 * HOUR) })).resolves.toMatchObject({ state: 'scheduled' });
    await expect(h.svc.schedule(h.admin, { requestId, scheduledFor: new Date(h.clock.now().getTime() + 3 * HOUR) })).resolves.toMatchObject({ photographerName: 'ياسر' });
    // The merchant sees who comes and when.
    const [mine] = await h.svc.merchantList(h.owner, { merchantOrgId: h.orgId });
    expect(mine).toMatchObject({ photographerName: 'ياسر', scheduledFor: new Date(h.clock.now().getTime() + 3 * HOUR) });
  });

  it('a visit must be within two weeks (an hour back is fine)', async () => {
    const h = await setup();
    const r = await h.svc.request(h.owner, { merchantOrgId: h.orgId, itemIds: [] });
    const now = h.clock.now().getTime();
    await expect(h.svc.schedule(h.ops, { requestId: r.requestId, scheduledFor: new Date(now - 2 * HOUR) })).rejects.toMatchObject({ code: 'menu_photo_schedule_invalid' });
    await expect(h.svc.schedule(h.ops, { requestId: r.requestId, scheduledFor: new Date(now + 15 * 24 * HOUR) })).rejects.toMatchObject({ code: 'menu_photo_schedule_invalid' });
    await expect(h.svc.schedule(h.ops, { requestId: r.requestId, scheduledFor: new Date(now - HOUR / 2) })).resolves.toMatchObject({ state: 'scheduled' });
  });

  it('shooting in the shop without a visit set takes the request on the spot', async () => {
    const h = await setup();
    const r = await h.svc.request(h.owner, { merchantOrgId: h.orgId, itemIds: [] });
    const v = await h.svc.addShot(h.ops, { requestId: r.requestId, itemId: h.hummus, uploadId: await upload(h.blobs, h.ops.personId) });
    expect(v).toMatchObject({ state: 'scheduled', assignedToMe: true, scheduledFor: h.clock.now() });
    expect(v.dishes.find((d) => d.itemId === h.hummus)?.shot).toMatchObject({ state: 'proposed' });
  });

  it('uploads must be his own and finished; dishes must be on the request', async () => {
    const h = await setup();
    const requestId = await scheduled(h);
    await expect(h.svc.addShot(h.ops, { requestId, itemId: h.tikka, uploadId: await upload(h.blobs, h.owner.personId) })).rejects.toMatchObject({ code: 'upload_invalid' });
    await expect(h.svc.addShot(h.ops, { requestId, itemId: h.tikka, uploadId: 'up_nope' })).rejects.toMatchObject({ code: 'upload_invalid' });
    await expect(h.svc.addShot(h.ops, { requestId, itemId: h.hummus, uploadId: await upload(h.blobs, h.ops.personId) })).rejects.toMatchObject({ code: 'menu_photo_item_not_listed' });
  });

  it('a re-shoot replaces the photo and deletes the old upload', async () => {
    const h = await setup();
    const requestId = await scheduled(h);
    const first = await upload(h.blobs, h.ops.personId);
    await h.svc.addShot(h.ops, { requestId, itemId: h.tikka, uploadId: first });
    const second = await upload(h.blobs, h.ops.personId);
    const v = await h.svc.addShot(h.ops, { requestId, itemId: h.tikka, uploadId: second });
    expect(v.counts.proposed).toBe(1);
    expect(await h.blobs.get(first)).toBeNull();
    expect(await h.blobs.get(second)).not.toBeNull();
  });

  it('handing over needs at least one photo and moves it to shot; the merchant cannot do it', async () => {
    const h = await setup();
    const r = await h.svc.request(h.owner, { merchantOrgId: h.orgId, itemIds: [] });
    await expect(h.svc.markShot(h.ops, { requestId: r.requestId })).rejects.toMatchObject({ code: 'menu_photo_no_shots' });
    await h.svc.schedule(h.ops, { requestId: r.requestId, scheduledFor: h.clock.now() });
    await expect(h.svc.markShot(h.ops, { requestId: r.requestId })).rejects.toMatchObject({ code: 'menu_photo_no_shots' });
    const { requestId, view } = await handedOver(await setup());
    expect(view).toMatchObject({ requestId, state: 'shot', canAct: false });
    expect(view.shotAt).not.toBeNull();
  });

  it('after handing over, nothing more can be shot or cancelled', async () => {
    const h = await setup();
    const { requestId } = await handedOver(h);
    await expect(h.svc.addShot(h.ops, { requestId, itemId: h.tikka, uploadId: await upload(h.blobs, h.ops.personId) })).rejects.toMatchObject({ code: 'menu_photo_state_conflict' });
    await expect(h.svc.cancel(h.owner, { merchantOrgId: h.orgId, requestId })).rejects.toMatchObject({ code: 'menu_photo_state_conflict' });
    expect(await h.svc.openForOps(h.ops, { cityId: 'aziziyah' })).toEqual([]);
  });
});

describe('menu photo service: the owner decides', () => {
  it('accepting makes the photo the dish photo (item.photo_replaced); the last decision closes the request', async () => {
    const h = await setup();
    const { requestId, view } = await handedOver(h);
    const tikkaShot = view.dishes.find((d) => d.itemId === h.tikka)?.shot;
    const kebabShot = view.dishes.find((d) => d.itemId === h.kebab)?.shot;
    if (!tikkaShot || !kebabShot) throw new Error('shots missing');
    const kebabUpload = (await h.repo.shot(kebabShot.shotId))?.uploadId;

    const afterAccept = await h.svc.decide(h.owner, { merchantOrgId: h.orgId, requestId, shotId: tikkaShot.shotId, accept: true });
    expect(afterAccept.state).toBe('shot');
    const tikkaUpload = (await h.repo.shot(tikkaShot.shotId))?.uploadId;
    expect((await h.catalog.adminItem(h.orgId, h.tikka)).photoUrl).toBe(`upload:${tikkaUpload}`);
    expect(afterAccept.dishes.find((d) => d.itemId === h.tikka)?.currentPhotoUrl).toContain(tikkaUpload);
    const types = (await h.ev.events.forActor(h.owner.personId)).map((e) => e.type);
    expect(types).toEqual(expect.arrayContaining(['item.photo_replaced', 'menu_photos.accepted']));

    const done = await h.svc.decide(h.owner, { merchantOrgId: h.orgId, requestId, shotId: kebabShot.shotId, accept: false });
    expect(done).toMatchObject({ state: 'done', counts: { dishes: 2, proposed: 0, accepted: 1, rejected: 1 } });
    // A rejected photo is deleted and the dish keeps its old photo.
    expect(kebabUpload ? await h.blobs.get(kebabUpload) : 'missing').toBeNull();
    expect((await h.catalog.adminItem(h.orgId, h.kebab)).photoUrl).toBeNull();
    // Decided once only.
    await expect(h.svc.decide(h.owner, { merchantOrgId: h.orgId, requestId, shotId: kebabShot.shotId, accept: true })).rejects.toMatchObject({ code: 'menu_photo_state_conflict' });
  });

  it('only the owner of that store decides, and only after hand-over', async () => {
    const h = await setup();
    const requestId = await scheduled(h);
    const v = await h.svc.addShot(h.ops, { requestId, itemId: h.tikka, uploadId: await upload(h.blobs, h.ops.personId) });
    const shotId = v.dishes.find((d) => d.itemId === h.tikka)?.shot?.shotId ?? '';
    // Before hand-over the owner cannot decide yet.
    await expect(h.svc.decide(h.owner, { merchantOrgId: h.orgId, requestId, shotId, accept: true })).rejects.toMatchObject({ code: 'menu_photo_state_conflict' });
    await h.svc.markShot(h.ops, { requestId });
    await expect(h.svc.decide(h.staff, { merchantOrgId: h.orgId, requestId, shotId, accept: true })).rejects.toMatchObject({ code: 'forbidden' });
    await expect(h.svc.decide(h.ops, { merchantOrgId: h.orgId, requestId, shotId, accept: true })).rejects.toMatchObject({ code: 'forbidden' });
    await expect(h.svc.decide(h.otherOwner, { merchantOrgId: h.otherOrgId, requestId, shotId, accept: true })).rejects.toMatchObject({ code: 'menu_photo_not_found' });
    await expect(h.svc.decide(h.owner, { merchantOrgId: h.orgId, requestId, shotId: 'mps_nope', accept: true })).rejects.toMatchObject({ code: 'menu_photo_not_found' });
  });
});

describe('menu photo service: Console queue', () => {
  it('open requests first (oldest first), then closed ones; filter by state', async () => {
    const h = await setup();
    const a = await h.svc.request(h.owner, { merchantOrgId: h.orgId, itemIds: [] });
    await h.svc.cancel(h.owner, { merchantOrgId: h.orgId, requestId: a.requestId });
    h.clock.advance(HOUR);
    const b = await h.svc.request(h.otherOwner, { merchantOrgId: h.otherOrgId, itemIds: [] });
    const q = await h.svc.queue(h.admin, { cityId: 'aziziyah' });
    expect(q.map((r) => [r.storeName, r.state, r.canAct])).toEqual([
      ['مطعم الريف', 'requested', false],
      ['مطعم خالد', 'cancelled', false],
    ]);
    expect((await h.svc.queue(h.admin, { cityId: 'aziziyah', state: 'requested' })).map((r) => r.requestId)).toEqual([b.requestId]);
    expect(await h.svc.queue(h.admin, { cityId: 'baghdad' })).toEqual([]);
  });
});
