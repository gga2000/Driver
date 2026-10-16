import { describe, expect, it } from 'vitest';
import { DriverError, type Order, type RoleKind } from '@driver/contracts';
import { FakeClock } from '../../shared/clock.js';
import { CatalogService, InMemoryCatalogRepository } from '../catalog/index.js';
import { OrgsService } from '../orgs/index.js';
import type { MerchantEventsPort, MerchantOrdersPort, MerchantPeoplePort, MerchantPhotosPort } from './merchant.service.js';
import { cardsState, firstOrderAfter, pendingCards, suggestedDoors } from './setup.js';
import { MerchantSetupService, setupCatalogOf } from './setup.service.js';

const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return 'ok';
  } catch (err) {
    return err instanceof DriverError ? err.code : String(err);
  }
};

/**
 * «جهّز محلك» over a real in-memory catalog and orgs: `new` is a shop field ops just signed up (owner
 * `o1`, staff `s1`), `old` a shop from before setup (owner `o2`).
 */
async function harness() {
  const clock = new FakeClock('2026-10-08T09:00:00Z');
  const orgs = new OrgsService(undefined, clock);
  const catalog = new CatalogService(new InMemoryCatalogRepository(), clock);
  const fresh = await orgs.create({ type: 'restaurant', name: 'مشويات الزهراء', cityId: 'aziziyah', ownerId: 'o1' });
  const old = await orgs.create({ type: 'restaurant', name: 'مطعم خالد', cityId: 'aziziyah', ownerId: 'o2' });
  // A shop from before setup has its storefront (customers can find it).
  await catalog.saveStorefront({ orgId: old.id, cityId: 'aziziyah', nameAr: 'مطعم خالد', cuisineAr: 'مشويات', tags: ['grill'], photoUrl: null, minOrderIqd: 0, hours: [] });
  const grants: Array<{ personId: string; kind: RoleKind; orgId: string }> = [
    { personId: 'o1', kind: 'merchant_owner', orgId: fresh.id },
    { personId: 's1', kind: 'merchant_staff', orgId: fresh.id },
    { personId: 'o2', kind: 'merchant_owner', orgId: old.id },
  ];
  const people: MerchantPeoplePort = {
    grants: async () => [],
    hasRole: async (personId, kind, orgId) => grants.some((g) => g.personId === personId && g.kind === kind && (orgId === undefined || g.orgId === orgId)),
    courierFirstName: async () => null,
    courierVehicle: async () => null,
  };
  const recorded: Array<{ type: string; payload: Record<string, unknown> }> = [];
  const events: MerchantEventsPort = { record: async (type, _a, _o, payload) => void recorded.push({ type, payload }) };
  const active: Order[] = [];
  const orders: MerchantOrdersPort = { listActive: async () => active, deliveredByDropoffZone: async () => [] };
  const uploads = new Map<string, string>([
    ['up_menu', 'o1'],
    ['up_dish', 'o1'],
    ['up_spot', 'o1'],
    ['up_stranger', 'x9'],
  ]);
  const photos: MerchantPhotosPort = { owns: async (id, personId) => uploads.get(id) === personId, readUrl: (id) => `https://blob.test/${id}`, remove: async () => undefined };
  const svc = new MerchantSetupService(orgs, people, setupCatalogOf(catalog), orders, events, clock, photos);
  // Field ops just signed it up: no storefront, so the first read starts its setup (ops is untouched).
  await svc.adopt(fresh);
  const owner = { personId: 'o1', sessionId: 'a' };
  const staff = { personId: 's1', sessionId: 'b' };
  const oldOwner = { personId: 'o2', sessionId: 'c' };
  const input = { merchantOrgId: fresh.id };
  return { clock, orgs, catalog, svc, fresh, old, owner, staff, oldOwner, input, recorded, active };
}

/** Everything but the step under test, done the way the owner would. */
async function finishAll(h: Awaited<ReturnType<typeof harness>>, skip: ReadonlySet<string> = new Set()) {
  const { svc, owner, input, orgs, fresh } = h;
  if (!skip.has('kind')) await svc.confirmKinds(owner, { ...input, kinds: ['meal'] });
  if (!skip.has('menu')) {
    const started = await svc.startMenu(owner, { ...input, uploadIds: ['up_menu'] });
    await svc.menuDraft(owner, { ...input, jobId: started.jobId!, items: [{ nameAr: 'تكة غنم', priceIqd: 6000, categoryAr: 'مشويات' }] });
    await svc.answer(owner, { ...input, jobId: started.jobId!, index: 0, answer: 'ok', uploadId: skip.has('photos') ? undefined : 'up_dish', librarySlug: 'tikka' });
  }
  if (!skip.has('hours')) await orgs.setMerchantSettings(fresh.id, { openingHours: [{ dow: 0, start: '11:00', end: '00:00' }] });
  if (!skip.has('money')) await svc.seePayout(owner, input);
  if (!skip.has('pickup')) await orgs.setMerchantSettings(fresh.id, { pickupSpot: { note: 'الشباك', photoRefs: [], updatedAt: h.clock.now() } });
  if (!skip.has('counter')) await svc.check(owner, { ...input, check: 'practice' });
}

describe('merchant setup — who sees it', () => {
  it('owner only: staff and strangers get forbidden on every read and write', async () => {
    const { svc, staff, input } = await harness();
    expect(await code(svc.get(staff, input))).toBe('forbidden');
    expect(await code(svc.confirmKinds(staff, { ...input, kinds: ['cafe'] }))).toBe('forbidden');
    expect(await code(svc.goLive(staff, input))).toBe('forbidden');
    expect(await code(svc.menuCards({ personId: 'nobody', sessionId: 'z' }, input))).toBe('forbidden');
  });

  it('a shop from before setup reads as live and inactive, and has nothing to write', async () => {
    const { svc, oldOwner, old, orgs } = await harness();
    const v = await svc.get(oldOwner, { merchantOrgId: old.id });
    expect(v).toMatchObject({ active: false, live: true, progress: { percent: 100, left: 0 } });
    expect(await code(svc.seePayout(oldOwner, { merchantOrgId: old.id }))).toBe('forbidden');
    expect(await svc.statusLine(old, await orgs.merchantSettings(old.id))).toBeNull();
    expect((await orgs.merchantSettings(old.id)).closed).toBeNull();
    // Reading it again never starts a setup on it.
    await svc.adopt(old);
    expect((await orgs.merchantSettings(old.id)).setup).toBeNull();
  });

  it('a new shop is adopted once: reading it twice changes nothing more', async () => {
    const { svc, fresh, orgs, recorded } = await harness();
    const first = (await orgs.merchantSettings(fresh.id)).setup;
    await svc.adopt(fresh);
    expect((await orgs.merchantSettings(fresh.id)).setup).toEqual(first);
    expect(recorded.filter((r) => r.type === 'merchant.setup_started')).toHaveLength(1);
  });
});

describe('merchant setup — the steps', () => {
  it('starts at zero, closed for customers, with field ops’ pick suggested', async () => {
    const { svc, owner, input, orgs, fresh } = await harness();
    const v = await svc.get(owner, input);
    expect(v).toMatchObject({ active: true, live: false, kinds: { confirmed: null, suggested: ['meal'] }, menu: { items: 0, cards: 'none' } });
    expect(v.progress).toMatchObject({ percent: 0, done: 0, left: 7, next: 'kind' });
    expect((await orgs.merchantSettings(fresh.id)).closed).not.toBeNull();
  });

  it('confirming a café sets the drinks prep default only where none is set', async () => {
    const { svc, owner, input, orgs, fresh } = await harness();
    const v = await svc.confirmKinds(owner, { ...input, kinds: ['cafe', 'cold'] });
    expect(v.kinds.confirmed).toEqual(['cafe', 'cold']);
    expect(v.progress.steps.find((s) => s.key === 'kind')?.done).toBe(true);
    expect((await orgs.merchantSettings(fresh.id)).defaultPrepMin).toBe(5);
    await orgs.setMerchantSettings(fresh.id, { defaultPrepMin: 12 });
    await svc.confirmKinds(owner, { ...input, kinds: ['cold'] });
    expect((await orgs.merchantSettings(fresh.id)).defaultPrepMin).toBe(12);
  });

  it('cards: nothing reaches the menu until صح; skip leaves it out; the last answer closes the draft', async () => {
    const { svc, owner, input, catalog, fresh } = await harness();
    expect(await code(svc.startMenu(owner, { ...input, uploadIds: ['up_stranger'] }))).toBe('upload_invalid');
    const started = await svc.startMenu(owner, { ...input, uploadIds: ['up_menu'] });
    expect(started).toMatchObject({ state: 'reading', photos: 1, cards: [] });
    const jobId = started.jobId!;
    const drafted = await svc.menuDraft(owner, {
      ...input,
      jobId,
      items: [
        { nameAr: 'شوربة عدس', priceIqd: 2000, categoryAr: null },
        { nameAr: 'باجة', priceIqd: 7000, categoryAr: 'وجبات' },
      ],
    });
    expect(drafted.state).toBe('ready');
    expect(await catalog.adminMenu(fresh.id)).toEqual([]);
    const one = await svc.answer(owner, { ...input, jobId, index: 0, answer: 'ok', priceIqd: 2500, uploadId: 'up_dish', librarySlug: 'lentil-soup' });
    expect(one.cards[0]).toMatchObject({ answer: 'ok' });
    const menu = await catalog.adminMenu(fresh.id);
    expect(menu).toHaveLength(1);
    expect(menu[0]).toMatchObject({ nameAr: 'شوربة عدس', priceIqd: 2500, photoUrl: 'upload:up_dish', photoLibrary: 'lentil-soup' });
    // Answering the same card again changes nothing.
    await svc.answer(owner, { ...input, jobId, index: 0, answer: 'ok' });
    expect(await catalog.adminMenu(fresh.id)).toHaveLength(1);
    const done = await svc.answer(owner, { ...input, jobId, index: 1, answer: 'skip' });
    expect(done.state).toBe('done');
    expect(await catalog.adminMenu(fresh.id)).toHaveLength(1);
    expect((await catalog.importJob(fresh.id, jobId)).state).toBe('applied');
    expect(await code(svc.answer(owner, { ...input, jobId, index: 5, answer: 'ok' }))).toBe('import_state_conflict');
  });

  it('a library photo counts for the photos step; his own photo later ends «صورة توضيحية»', async () => {
    const { svc, owner, input, catalog, fresh } = await harness();
    const started = await svc.startMenu(owner, { ...input, uploadIds: ['up_menu'] });
    await svc.menuDraft(owner, { ...input, jobId: started.jobId!, items: [{ nameAr: 'كباب', priceIqd: 5000 }] });
    await svc.answer(owner, { ...input, jobId: started.jobId!, index: 0, answer: 'ok' });
    let v = await svc.get(owner, input);
    expect(v.menu).toMatchObject({ items: 1, missingPhotos: 1 });
    expect(v.progress.steps.find((s) => s.key === 'photos')?.done).toBe(false);
    const [dish] = await catalog.adminMenu(fresh.id);
    v = await svc.dishPhoto(owner, { ...input, itemId: dish!.id, uploadId: 'up_dish', librarySlug: 'kebab' });
    expect(v.menu).toMatchObject({ missingPhotos: 0, libraryPhotos: 1 });
    expect(v.progress.steps.find((s) => s.key === 'photos')?.done).toBe(true);
    await catalog.replacePhoto(fresh.id, dish!.id, 'upload:own');
    expect((await catalog.adminMenu(fresh.id))[0]?.photoLibrary).toBeNull();
  });
});

describe('merchant setup — the shutter and the first order', () => {
  it('refuses to go live with a step open; the open switch is the same gate', async () => {
    const h = await harness();
    await finishAll(h, new Set(['hours']));
    expect(await code(h.svc.goLive(h.owner, h.input))).toBe('setup_not_ready');
    const line = await h.svc.statusLine(h.fresh, await h.orgs.merchantSettings(h.fresh.id));
    expect(line).toMatchObject({ live: false, left: 1, percent: 90 });
  });

  it('goes live once everything is done: storefront made from his answers, the setup close lifted', async () => {
    const h = await harness();
    await finishAll(h);
    const v = await h.svc.goLive(h.owner, h.input);
    expect(v).toMatchObject({ live: true, progress: { percent: 100, left: 0 } });
    const front = await h.catalog.storefront(h.fresh.id);
    expect(front).toMatchObject({ nameAr: 'مشويات الزهراء', cuisineAr: 'أكل ومشويات', tags: ['grill'], hours: [{ dow: 0, start: '11:00', end: '00:00' }] });
    expect((await h.orgs.merchantSettings(h.fresh.id)).closed).toBeNull();
    expect(h.recorded.map((r) => r.type)).toContain('merchant.went_live');
    // Idempotent.
    expect((await h.svc.goLive(h.owner, h.input)).live).toBe(true);
  });

  it('the first real order after the shutter is recorded once (the ops ping hook) until he has seen it', async () => {
    const h = await harness();
    await finishAll(h);
    await h.svc.goLive(h.owner, h.input);
    h.clock.advance(60_000);
    h.active.push({ id: 'ord_1', placedAt: new Date(h.clock.now().getTime() + 1000) } as unknown as Order);
    const line = await h.svc.statusLine(h.fresh, await h.orgs.merchantSettings(h.fresh.id));
    expect(line).toEqual({ live: true, percent: 100, left: 0, firstOrderId: 'ord_1' });
    await h.svc.statusLine(h.fresh, await h.orgs.merchantSettings(h.fresh.id));
    expect(h.recorded.filter((r) => r.type === 'merchant.first_order')).toHaveLength(1);
    await h.svc.firstOrderSeen(h.owner, h.input);
    expect((await h.svc.statusLine(h.fresh, await h.orgs.merchantSettings(h.fresh.id)))?.firstOrderId).toBeNull();
  });
});

describe('merchant setup — pure parts', () => {
  it('pending cards, card state and the first order', () => {
    const base = { startedAt: new Date(0), kinds: null, kindsAt: null, payoutAt: null, soundAt: null, screenAt: null, practiceAt: null, printerLaterAt: null, shopPhotoRef: null, menuJobId: 'j', cards: { '0': { answer: 'ok' as const, itemId: 'i' } }, liveAt: null, closedBySetup: true, firstOrder: null };
    expect(pendingCards(base, 3)).toBe(2);
    expect(cardsState(null, 0)).toBe('none');
    expect(cardsState({ state: 'draft', rows: 0 }, 0)).toBe('reading');
    expect(cardsState({ state: 'draft', rows: 3 }, 2)).toBe('ready');
    expect(cardsState({ state: 'applied', rows: 3 }, 0)).toBe('done');
    const live = new Date('2026-10-08T10:00:00Z');
    const o = (id: string, at: string) => ({ id, placedAt: new Date(at) });
    expect(firstOrderAfter([o('a', '2026-10-08T09:59:00Z'), o('c', '2026-10-08T10:05:00Z'), o('b', '2026-10-08T10:02:00Z')], live)?.id).toBe('b');
    expect(firstOrderAfter([o('a', '2026-10-08T09:59:00Z')], live)).toBeNull();
    expect(suggestedDoors(['cafe', 'sweets'])).toEqual(['cafe', 'sweet']);
    expect(suggestedDoors([])).toEqual(['meal']);
  });
});
