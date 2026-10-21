import { describe, expect, it } from 'vitest';
import type { Actor } from '@driver/contracts';
import { CatalogService, InMemoryCatalogRepository } from '../catalog/index.js';
import { ConfigService } from '../config/index.js';
import { AuditLogService, InMemoryControlsRepository, StaffNames } from '../controls/index.js';
import { createInMemoryEvents } from '../events/index.js';
import { harness as identityHarness } from '../identity/test-harness.js';
import { ledgerHarness } from '../ledger/test-harness.js';
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
  const svc = new StoresConsoleService(menus, orgs, catalog, audits, blobs, ev.uow, clock);
  async function person(phone: string): Promise<Actor> {
    return (await id.login(phone)).actor;
  }
  const ops = await person('07700000010');
  // A shop field ops opened this morning: still in «جهّز محلك», hidden from customers.
  const fresh = await orgs.create({ type: 'restaurant', name: 'مشويات الحاج كريم', cityId: 'aziziyah', ownerId: 'owner_karim' });
  await orgs.setMerchantSettings(fresh.id, { setup: newSetupState(clock.now()) });
  // A shop from before setup: open to customers.
  const open = await orgs.create({ type: 'restaurant', name: 'مأكولات الشام', cityId: 'aziziyah', ownerId: 'owner_sham' });
  return { id, clock, ev, catalog, orgs, menus, audits, svc, ops, fresh: fresh.id, open: open.id };
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

describe('ops.stores: a shop open to customers keeps its prices the owner\'s', () => {
  it('names, photos, sections and the daily switches go through; any price change is refused', async () => {
    const h = await setup();
    const S = { merchantOrgId: h.open };
    // Seeded before the rule: the shop's own dish.
    const { item } = await h.catalog.upsertItem(h.open, { patch: { nameAr: 'شاورما', priceIqd: 3000, categoryAr: 'لفات' } }, 'owner_sham');
    const owned = { code: 'store_price_owner_only' };

    await expect(h.svc.upsertItem(h.ops, { ...S, itemId: item.id, nameAr: 'شاورما', priceIqd: 3500 })).rejects.toMatchObject(owned);
    await expect(h.svc.upsertItem(h.ops, { ...S, nameAr: 'فلافل', priceIqd: 1000 })).rejects.toMatchObject(owned);
    await expect(h.svc.addItems(h.ops, { ...S, items: [{ nameAr: 'فلافل', priceIqd: 1000 }] })).rejects.toMatchObject(owned);
    await expect(h.svc.setModifiers(h.ops, { ...S, itemId: item.id, groups: [{ nameAr: 'إضافات', minSelect: 0, maxSelect: 2, required: false, modifiers: [{ nameAr: 'جبن', priceIqd: 500, available: true }] }] })).rejects.toMatchObject(owned);

    // A fix that keeps the price is the team's to make.
    expect((await h.svc.upsertItem(h.ops, { ...S, itemId: item.id, nameAr: 'شاورما لحم', priceIqd: 3000, description: 'بالصمون الحجري' })).nameAr).toBe('شاورما لحم');
    expect((await h.svc.setModifiers(h.ops, { ...S, itemId: item.id, groups: [{ nameAr: 'الخبز', minSelect: 1, maxSelect: 1, required: true, modifiers: [{ nameAr: 'صمون', priceIqd: 0, available: true }] }] })).modifierGroups).toHaveLength(1);
    expect((await h.svc.soldOutToday(h.ops, { ...S, itemId: item.id })).onSale).toBe(false);
    expect((await h.svc.setAvailability(h.ops, { ...S, itemId: item.id, available: true })).available).toBe(true);
    await h.svc.upsertCategory(h.ops, { ...S, nameAr: 'لفات وسندويشات', renameFrom: 'لفات' });
    expect((await h.svc.menu(h.ops, S)).categories[0]!.items[0]!.priceIqd).toBe(3000);
    // Refused changes leave no audit row.
    expect((await h.svc.history(h.ops, S)).map((r) => r.action)).toEqual([STORE_AUDIT.sectionSaved, STORE_AUDIT.availability, STORE_AUDIT.soldOutToday, STORE_AUDIT.optionsSaved, STORE_AUDIT.itemSaved]);
  });

  it('the merchant\'s own access is unchanged: a stranger still cannot read or write the menu', async () => {
    const h = await setup();
    await expect(h.menus.menuGet(h.ops, { merchantOrgId: h.fresh })).rejects.toMatchObject({ code: 'forbidden' });
    await expect(h.menus.menuUpsertItem(h.ops, { merchantOrgId: h.fresh, nameAr: 'كباب', priceIqd: 7000 })).rejects.toMatchObject({ code: 'forbidden' });
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
