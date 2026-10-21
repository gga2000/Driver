import { describe, expect, it } from 'vitest';
import { DriverError, type Actor, type AppContext, type RoleKind } from '@driver/contracts';
import { appRouter, t } from '@driver/contracts/router';
import { CatalogService, InMemoryCatalogRepository } from '../catalog/index.js';
import { ConfigService } from '../config/index.js';
import { AuditLogService, InMemoryControlsRepository, StaffNames } from '../controls/index.js';
import { createInMemoryEvents } from '../events/index.js';
import { harness as identityHarness } from '../identity/test-harness.js';
import { ledgerHarness } from '../ledger/test-harness.js';
import type { MerchantService, MerchantSetupService } from '../merchant/index.js';
import type { OrdersService } from '../orders/index.js';
import { newSetupState, OrgsService } from '../orgs/index.js';
import { DevBlobStore } from '../places/index.js';
import { InMemoryPromotionsRepository, PromotionsService } from '../promotions/index.js';
import { InMemoryMerchantAdminRepository } from './merchant-admin.repository.js';
import { MerchantAdminService, modifierPricesChanged } from './merchant-admin.service.js';
import { STORE_AUDIT, StoresConsoleService } from './stores-console.service.js';

async function setup(start = '2026-10-21T09:00:00Z') {
  const id = identityHarness(start);
  const clock = id.clock;
  const lh = ledgerHarness({ start });
  const ev = createInMemoryEvents({ clock });
  const blobs = new DevBlobStore(clock, { secret: 'blob' });
  const catalog = new CatalogService(new InMemoryCatalogRepository(), clock);
  const promotions = new PromotionsService(new InMemoryPromotionsRepository(), ev.events, ev.uow, clock);
  const orgs = new OrgsService(undefined, clock);
  const menus = new MerchantAdminService(new InMemoryMerchantAdminRepository(), catalog, promotions, lh.ledger, lh.facade, {} as OrdersService, orgs, id.service, new ConfigService(), ev.events, blobs, ev.uow, clock);
  const audits = new AuditLogService(new InMemoryControlsRepository(), new StaffNames(id.service, clock), clock);
  // The shop's own switches are the merchant module's `ops*` methods (tested there); here only what they return.
  const shopCalls: string[] = [];
  const shops = {
    opsSetHours: async (actor: Actor, input: { days: unknown; holidays: unknown }) => {
      if (actor.personId !== ops.personId) throw new DriverError('forbidden');
      shopCalls.push('setHours');
      return { days: input.days, holidays: input.holidays };
    },
  } as unknown as MerchantService;
  const adopted: string[] = [];
  const setups = {
    adopt: async (org: { id: string }) => void adopted.push(org.id),
    opsGoLive: async () => {
      throw new DriverError('setup_not_ready');
    },
  } as unknown as MerchantSetupService;
  const svc = new StoresConsoleService(menus, shops, setups, orgs, catalog, audits, blobs, ev.uow, clock);
  async function person(phone: string): Promise<Actor> {
    return (await id.login(phone)).actor;
  }
  const ops = await person('07700000010');
  await id.service.grantRole({ personId: 'system' }, { personId: ops.personId, kind: 'field_ops' });
  // A shop field ops opened this morning: still in «جهّز محلك», hidden from customers.
  const fresh = await orgs.create({ type: 'restaurant', name: 'مشويات الحاج كريم', cityId: 'aziziyah', ownerId: 'owner_karim' });
  await orgs.setMerchantSettings(fresh.id, { setup: newSetupState(clock.now()) });
  // A shop from before setup: open to customers.
  const open = await orgs.create({ type: 'restaurant', name: 'مأكولات الشام', cityId: 'aziziyah', ownerId: 'owner_sham' });
  return { id, clock, ev, catalog, orgs, menus, audits, svc, ops, person, shopCalls, adopted, fresh: fresh.id, open: open.id };
}

describe('ops.stores: the team sets a new shop up', () => {
  it('writes the menu with the owner\'s rules, marks the events as the Console\'s, and audits each change by name', async () => {
    const h = await setup();
    const S = { merchantOrgId: h.fresh };
    const tikka = await h.svc.upsertItem(h.ops, { ...S, nameAr: 'تكة لحم', priceIqd: 8000, categoryAr: 'مشويات' });
    await h.svc.addItems(h.ops, { ...S, categoryAr: 'سندويشات', items: [{ nameAr: 'زنگر', priceIqd: 5000 }, { nameAr: 'شاورما دجاج صمون', priceIqd: 2000 }] });
    await h.svc.setModifiers(h.ops, { ...S, itemId: tikka.id, groups: [{ nameAr: 'الحجم', minSelect: 1, maxSelect: 1, required: true, modifiers: [{ nameAr: 'نفر', priceIqd: 0, available: true }, { nameAr: 'نص كيلو', priceIqd: 10000, available: true }] }] });
    await h.svc.upsertItem(h.ops, { ...S, itemId: tikka.id, nameAr: 'تكة لحم غنم', priceIqd: 8500, categoryAr: 'مشويات' });
    const pic = await h.svc.libraryPhoto(h.ops, { ...S, itemId: tikka.id, photo: 'lib-tikka-1.webp' });
    expect(pic).toMatchObject({ photoUrl: '/media/food/lib-tikka-1.webp', photoLibrary: 'tikka', photoReviewPending: false });

    const menu = await h.svc.menu(h.ops, S);
    expect(menu.categories.map((c) => [c.nameAr, c.items.map((i) => [i.nameAr, i.priceIqd])])).toEqual([
      ['مشويات', [['تكة لحم غنم', 8500]]],
      ['سندويشات', [['زنگر', 5000], ['شاورما دجاج صمون', 2000]]],
    ]);

    // The owner's "who did what" can tell the team's edits from his own.
    const events = await h.ev.events.forActor(h.ops.personId);
    expect(events.filter((e) => e.type === 'item.published').every((e) => (e.payload as { by?: string }).by === 'console')).toBe(true);

    const history = await h.svc.history(h.ops, S);
    expect(history.map((r) => r.action)).toEqual([STORE_AUDIT.libraryPhoto, STORE_AUDIT.itemSaved, STORE_AUDIT.optionsSaved, STORE_AUDIT.itemsAdded, STORE_AUDIT.itemSaved]);
    expect(history.every((r) => r.actorId === h.ops.personId)).toBe(true);
    expect(history[3]!.summaryAr).toBe('زاد 2 أكلات لـمشويات الحاج كريم بقسم «سندويشات»');
  });

  it('lists the city\'s stores, shops in setup first, with their steps and gaps', async () => {
    const h = await setup();
    await h.svc.upsertItem(h.ops, { merchantOrgId: h.fresh, nameAr: 'كباب', priceIqd: 7000 });
    const rows = await h.svc.list(h.ops, { cityId: 'aziziyah' });
    expect(rows.map((r) => [r.name, r.state])).toEqual([
      ['مشويات الحاج كريم', 'setup'],
      ['مأكولات الشام', 'live'],
    ]);
    expect(rows[0]).toMatchObject({ dishes: 1, dishesNoPhoto: 1, steps: { total: 7 }, lastEdit: { at: h.clock.now() } });
    expect(rows[0]!.steps.done).toBeLessThan(7);
    expect(rows[1]).toMatchObject({ steps: { done: 7, total: 7, next: null }, lastEdit: null });
  });

  it('refuses a library file that is not in the library, and a store that is not a shop', async () => {
    const h = await setup();
    const item = await h.svc.upsertItem(h.ops, { merchantOrgId: h.fresh, nameAr: 'كباب', priceIqd: 7000 });
    await expect(h.svc.libraryPhoto(h.ops, { merchantOrgId: h.fresh, itemId: item.id, photo: 'lib-nothing-9.webp' })).rejects.toMatchObject({ code: 'upload_invalid' });
    const home = await h.orgs.create({ type: 'household', name: 'بيت', cityId: 'aziziyah', ownerId: 'x' });
    await expect(h.svc.menu(h.ops, { merchantOrgId: home.id })).rejects.toMatchObject({ code: 'org_not_found' });
  });
});

describe('ops.stores: a shop open to customers (Ali, 2026-10-21: "change now, tell the owner")', () => {
  it('prices change at once, and the history says what they were', async () => {
    const h = await setup();
    const S = { merchantOrgId: h.open };
    const { item } = await h.catalog.upsertItem(h.open, { patch: { nameAr: 'شاورما', priceIqd: 3000, categoryAr: 'لفات' } }, 'owner_sham');

    expect((await h.svc.upsertItem(h.ops, { ...S, itemId: item.id, nameAr: 'شاورما', priceIqd: 3500, categoryAr: 'لفات' })).priceIqd).toBe(3500);
    await h.svc.setModifiers(h.ops, { ...S, itemId: item.id, groups: [{ nameAr: 'إضافات', minSelect: 0, maxSelect: 2, required: false, modifiers: [{ nameAr: 'جبن', priceIqd: 500, available: true }] }] });
    await h.svc.upsertItem(h.ops, { ...S, itemId: item.id, nameAr: 'شاورما لحم', priceIqd: 3500, categoryAr: 'لفات' });
    await h.svc.addItems(h.ops, { ...S, items: [{ nameAr: 'فلافل', priceIqd: 1000 }] });

    const rows = await h.audits.list({ subjectKind: 'store', subjectId: h.open, limit: 10 });
    expect(rows.map((r) => [r.action, r.detail.priceChanged ?? null])).toEqual([
      [STORE_AUDIT.itemsAdded, null],
      [STORE_AUDIT.itemSaved, false],
      [STORE_AUDIT.optionsSaved, true],
      [STORE_AUDIT.itemSaved, true],
    ]);
    expect(rows[3]).toMatchObject({ summary_ar: 'غيّر سعر «شاورما» من 3,000 لـ3,500 دينار بـمأكولات الشام', detail: { before: { priceIqd: 3000 }, after: { priceIqd: 3500 } } });
    expect(rows[1]!.summary_ar).toBe('عدّل «شاورما لحم» بـمأكولات الشام');
  });

  it('the ops path is field ops and admin only: support, the shop\'s owner and staff are refused, with no audit row', async () => {
    const h = await setup();
    const S = { merchantOrgId: h.fresh };
    const admin = await h.person('07700000011');
    await h.id.service.grantRole({ personId: 'system' }, { personId: admin.personId, kind: 'admin' });
    const support = await h.person('07700000012');
    await h.id.service.grantRole({ personId: 'system' }, { personId: support.personId, kind: 'support' });
    const owner = await h.person('07700000013');
    await h.id.service.grantRole({ personId: 'system' }, { personId: owner.personId, kind: 'merchant_owner', orgId: h.fresh });
    const staff = await h.person('07700000014');
    await h.id.service.grantRole({ personId: 'system' }, { personId: staff.personId, kind: 'merchant_staff', orgId: h.fresh });

    expect((await h.svc.upsertItem(admin, { ...S, nameAr: 'كباب', priceIqd: 7000 })).nameAr).toBe('كباب');
    for (const who of [support, owner, staff]) {
      await expect(h.svc.upsertItem(who, { ...S, nameAr: 'فلافل', priceIqd: 1000 })).rejects.toMatchObject({ code: 'forbidden' });
      await expect(h.svc.addItems(who, { ...S, items: [{ nameAr: 'فلافل', priceIqd: 1000 }] })).rejects.toMatchObject({ code: 'forbidden' });
      await expect(h.menus.opsMenuGet(who, S)).rejects.toMatchObject({ code: 'forbidden' });
    }
    // The owner keeps his own path.
    expect((await h.menus.menuUpsertItem(owner, { ...S, nameAr: 'تمن', priceIqd: 1500 })).nameAr).toBe('تمن');
    expect((await h.svc.history(h.ops, S)).map((r) => r.actorId)).toEqual([admin.personId]);
  });

  it('a new shop enters setup before the team\'s first change; a refused caller starts nothing', async () => {
    const h = await setup();
    const brandNew = await h.orgs.create({ type: 'restaurant', name: 'كص الزهراء', cityId: 'aziziyah', ownerId: 'owner_new' });
    const support = await h.person('07700000018');
    await h.id.service.grantRole({ personId: 'system' }, { personId: support.personId, kind: 'support' });
    await expect(h.svc.addItems(support, { merchantOrgId: brandNew.id, items: [{ nameAr: 'كص', priceIqd: 3000 }] })).rejects.toMatchObject({ code: 'forbidden' });
    expect(h.adopted).toEqual([]);
    await h.svc.addItems(h.ops, { merchantOrgId: brandNew.id, items: [{ nameAr: 'كص', priceIqd: 3000 }] });
    expect(h.adopted).toEqual([brandNew.id]);
  });

  it('«فريقنا عدّل بمحلك»: the owner reads what the team changed, with a first name only; staff and the team are refused', async () => {
    const h = await setup();
    const S = { merchantOrgId: h.open };
    await h.id.service.setName(h.ops, 'حيدر كاظم الساعدي');
    await h.svc.addItems(h.ops, { ...S, items: [{ nameAr: 'فلافل', priceIqd: 1000 }] });
    const owner = await h.person('07700000015');
    await h.id.service.grantRole({ personId: 'system' }, { personId: owner.personId, kind: 'merchant_owner', orgId: h.open });
    const staff = await h.person('07700000016');
    await h.id.service.grantRole({ personId: 'system' }, { personId: staff.personId, kind: 'merchant_staff', orgId: h.open });
    const otherOwner = await h.person('07700000017');
    await h.id.service.grantRole({ personId: 'system' }, { personId: otherOwner.personId, kind: 'merchant_owner', orgId: h.fresh });

    const seen = await h.svc.ownerChanges(owner, S);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ byFirstName: 'حيدر' });
    expect(seen[0]!.summaryAr).toBe('زاد «فلافل»');
    expect(Object.keys(seen[0]!).sort()).toEqual(['at', 'byFirstName', 'id', 'summaryAr']);
    for (const who of [staff, otherOwner, h.ops]) await expect(h.svc.ownerChanges(who, S)).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('the merchant\'s own access is unchanged: a stranger still cannot read or write the menu', async () => {
    const h = await setup();
    await expect(h.menus.menuGet(h.ops, { merchantOrgId: h.fresh })).rejects.toMatchObject({ code: 'forbidden' });
    await expect(h.menus.menuUpsertItem(h.ops, { merchantOrgId: h.fresh, nameAr: 'كباب', priceIqd: 7000 })).rejects.toMatchObject({ code: 'forbidden' });
  });
});

describe('ops.stores through the router', () => {
  it('a Console call reaches this service, so the audit row is written', async () => {
    const h = await setup();
    const ctx = {
      auth: { sub: h.ops.personId, sid: h.ops.sessionId, iss: 'driver-api', iat: 0, exp: 0 },
      authError: null,
      identity: { hasRole: async (personId: string, kind: RoleKind) => h.id.service.hasRole(personId, kind) },
      stores: h.svc,
    } as unknown as AppContext;
    const call = t.createCallerFactory(appRouter)(ctx);
    await call.ops.stores.upsertItem({ merchantOrgId: h.fresh, nameAr: 'كباب', priceIqd: 7000 });
    expect((await h.svc.history(h.ops, { merchantOrgId: h.fresh })).map((r) => r.action)).toEqual([STORE_AUDIT.itemSaved]);
  });
});

describe('ops.stores: the shop itself', () => {
  it('hours: one audit row with what it was before, what it is now and the team\'s «ليش؟»', async () => {
    const h = await setup();
    await h.orgs.setMerchantSettings(h.fresh, { openingHours: [{ dow: 0, start: '11:00', end: '23:00' }] });
    const days = Array.from({ length: 7 }, (_, dow) => ({ dow, shifts: [{ start: '12:00', end: '00:00' }] }));
    await h.svc.setHours(h.ops, { merchantOrgId: h.fresh, days, holidays: [], why: 'صاحب المحل طلب بالتلفون' });
    const [row] = await h.audits.list({ subjectKind: 'store', subjectId: h.fresh, limit: 1 });
    expect(row).toMatchObject({ action: STORE_AUDIT.hoursSet, actorId: h.ops.personId, summary_ar: 'رتّب أوقات دوام مشويات الحاج كريم' });
    expect(row!.detail).toMatchObject({ before: { openingHours: [{ dow: 0, start: '11:00', end: '23:00' }] }, after: { days }, why: 'صاحب المحل طلب بالتلفون' });
  });

  it('a refused change leaves no audit row', async () => {
    const h = await setup();
    const stranger = await h.person('07700000019');
    await expect(h.svc.setHours(stranger, { merchantOrgId: h.fresh, days: [], holidays: [] })).rejects.toMatchObject({ code: 'forbidden' });
    await expect(h.svc.goLive(h.ops, { merchantOrgId: h.fresh })).rejects.toMatchObject({ code: 'setup_not_ready' });
    expect(await h.svc.history(h.ops, { merchantOrgId: h.fresh })).toEqual([]);
  });
});

describe('modifierPricesChanged', () => {
  const g = (mods: Array<[string, number]>) => [{ nameAr: 'الحجم', modifiers: mods.map(([nameAr, priceIqd]) => ({ nameAr, priceIqd })) }];
  it('sees a new, removed or changed priced option, and nothing else', () => {
    expect(modifierPricesChanged(g([['نفر', 0], ['نص كيلو', 10000]]), g([['نفر', 0], ['نص كيلو', 10000]]))).toBe(false);
    expect(modifierPricesChanged(g([['نص كيلو', 10000]]), g([['نص كيلو', 11000]]))).toBe(true);
    expect(modifierPricesChanged(g([['نص كيلو', 10000]]), g([]))).toBe(true);
    expect(modifierPricesChanged(g([]), g([['لبن', 500]]))).toBe(true);
    expect(modifierPricesChanged(g([['صمون', 0]]), g([['صمون', 0], ['خبز', 0]]))).toBe(false);
  });
});
