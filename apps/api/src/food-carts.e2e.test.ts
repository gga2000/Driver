import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AZIZIYAH_MONEY_RULES, type Actor, type WalkupChoice } from '@driver/contracts';
import { AppModule } from './app.module.js';
import { CatalogRpc, CatalogService, FOOD_CART_TAG, type CatalogItemRecord } from './modules/catalog/index.js';
import { ConfigService } from './modules/config/index.js';
import { CommissionTierService } from './modules/control-room/index.js';
import { FOOD_CARTS_REPOSITORY, FoodCartsService, seedDemoCarts, type FoodCartsRepository } from './modules/food-carts/index.js';
import { EventsService } from './modules/events/index.js';
import { IdentityService } from './modules/identity/index.js';
import { ORDERS_RULES } from './modules/orders/index.js';
import { OrgsService } from './modules/orgs/index.js';

/**
 * Food carts «عربانات» on the app's own wiring (Ali, 2026-10-11/12): walk-over tickets priced on the
 * server with sizes and extras, the pickup commission on collection, new carts on the starter tier,
 * cart storefronts kept out of the restaurant lists, and follows.
 */
describe('food carts (AppModule)', () => {
  let app: INestApplication;
  let carts: FoodCartsService;
  let catalog: CatalogService;
  let orgs: OrgsService;
  let identity: IdentityService;
  let seeded: { key: string; orgId: string; cartId: string }[];
  let owner: Actor;
  let liver: { key: string; orgId: string; cartId: string };
  let plate: CatalogItemRecord;
  let laffa: CatalogItemRecord;

  const customer = (n: number): Actor => ({ personId: `food-carts-e2e-customer-${n}`, sessionId: 'e2e' });
  const item = (key: string) => `${liver.orgId}_${key}`;
  /** A size or an extra by its name, as the customer app sends it. */
  const pick = (dish: CatalogItemRecord, name: string): WalkupChoice => {
    const g = dish.modifierGroups.find((x) => x.modifiers.some((m) => m.nameAr === name))!;
    return { groupId: g.id, optionId: g.modifiers.find((m) => m.nameAr === name)!.id };
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication({ logger: ['error', 'warn'] });
    await app.init();
    carts = app.get(FoodCartsService);
    catalog = app.get(CatalogService);
    orgs = app.get(OrgsService);
    identity = app.get(IdentityService);
    // Carts are off at launch (`foodCarts.launched`); the demo and this test open them.
    app.get(ConfigService).setFoodCartsOpen('aziziyah', true);
    seeded = await seedDemoCarts(orgs, catalog, carts, { ownerId: 'food-carts-e2e-owner' });
    liver = seeded.find((c) => c.key === 'liver')!;
    const ownerId = await identity.ensurePersonByPhone('07701234599', 'system:e2e', 'e2e');
    await identity.grantRole({ personId: 'system:e2e', sessionId: 'e2e' }, { personId: ownerId, kind: 'merchant_owner', orgId: liver.orgId });
    owner = { personId: ownerId, sessionId: 'e2e' };
    plate = (await catalog.itemsOf(liver.orgId, [item('plate')]))[0]!;
    laffa = (await catalog.itemsOf(liver.orgId, [item('laffa')]))[0]!;
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('placeWalkup prices the choices on the server', () => {
    it('a full plate adds 2,000 and an egg on the laffa adds 500', async () => {
      const w = await carts.placeWalkup(customer(1), {
        cartId: liver.cartId,
        lines: [
          { itemId: item('plate'), qty: 1, choices: [pick(plate, 'صحن كامل')] },
          { itemId: item('laffa'), qty: 2, choices: [pick(laffa, 'بيض')] },
        ],
      });
      expect(w.state).toBe('placed');
      expect(w.code).toMatch(/^\d{3}$/);
      expect(w.lines).toEqual([
        { itemId: item('plate'), nameAr: 'صحن كبدة', qty: 1, priceIqd: 5_000, choices: ['صحن كامل'] },
        { itemId: item('laffa'), nameAr: 'لفة كبدة', qty: 2, priceIqd: 2_500, choices: ['بيض'] },
      ]);
      expect(w.totalIqd).toBe(5_000 + 2 * 2_500);
    });

    it('a half plate costs the dish price; a plain laffa has no choices', async () => {
      const w = await carts.placeWalkup(customer(2), {
        cartId: liver.cartId,
        lines: [
          { itemId: item('plate'), qty: 1, choices: [pick(plate, 'نص صحن')] },
          { itemId: item('laffa'), qty: 1, choices: [] },
        ],
      });
      expect(w.lines.map((l) => [l.priceIqd, l.choices])).toEqual([
        [3_000, ['نص صحن']],
        [2_000, []],
      ]);
      expect(w.totalIqd).toBe(5_000);
    });

    it('the same dish with the same picks is one line; different picks stay apart', async () => {
      const egg = pick(laffa, 'بيض');
      const hot = pick(laffa, 'حار');
      const w = await carts.placeWalkup(customer(3), {
        cartId: liver.cartId,
        lines: [
          { itemId: item('laffa'), qty: 1, choices: [egg, hot] },
          { itemId: item('laffa'), qty: 1, choices: [] },
          { itemId: item('laffa'), qty: 2, choices: [hot, egg] },
          { itemId: item('laffa'), qty: 1, choices: [egg] },
          { itemId: item('laffa'), qty: 3, choices: [] },
        ],
      });
      expect(w.lines.map((l) => [l.choices, l.qty, l.priceIqd])).toEqual([
        [['بيض', 'حار'], 3, 2_500],
        [[], 4, 2_000],
        [['بيض'], 1, 2_500],
      ]);
      expect(w.totalIqd).toBe(3 * 2_500 + 4 * 2_000 + 2_500);
    });

    it('refuses an option the dish does not have, or a plate with no size', async () => {
      const me = customer(4);
      await expect(
        carts.placeWalkup(me, { cartId: liver.cartId, lines: [{ itemId: item('laffa'), qty: 1, choices: [{ groupId: pick(laffa, 'بيض').groupId, optionId: 'nope' }] }] }),
      ).rejects.toMatchObject({ code: 'modifier_invalid' });
      // A size of another dish is not this dish's own.
      await expect(carts.placeWalkup(me, { cartId: liver.cartId, lines: [{ itemId: item('laffa'), qty: 1, choices: [pick(plate, 'صحن كامل')] }] })).rejects.toMatchObject({
        code: 'modifier_invalid',
      });
      await expect(carts.placeWalkup(me, { cartId: liver.cartId, lines: [{ itemId: item('plate'), qty: 1, choices: [] }] })).rejects.toMatchObject({ code: 'modifier_invalid' });
      // Two sizes at once, or the same extra twice.
      await expect(
        carts.placeWalkup(me, { cartId: liver.cartId, lines: [{ itemId: item('plate'), qty: 1, choices: [pick(plate, 'نص صحن'), pick(plate, 'صحن كامل')] }] }),
      ).rejects.toMatchObject({ code: 'modifier_invalid' });
      await expect(
        carts.placeWalkup(me, { cartId: liver.cartId, lines: [{ itemId: item('laffa'), qty: 1, choices: [pick(laffa, 'بيض'), pick(laffa, 'بيض')] }] }),
      ).rejects.toMatchObject({ code: 'modifier_invalid' });
      // Nothing was placed.
      expect(await carts.myWalkups(me)).toEqual([]);
    });
  });

  it('collect records the pickup commission (5 %) of the total', async () => {
    const w = await carts.placeWalkup(customer(5), {
      cartId: liver.cartId,
      lines: [
        { itemId: item('plate'), qty: 1, choices: [pick(plate, 'صحن كامل')] },
        { itemId: item('samoon'), qty: 1, choices: [] },
        { itemId: item('laffa'), qty: 1, choices: [pick(laffa, 'بيض')] },
      ],
    });
    expect(w.totalIqd).toBe(5_000 + 1_500 + 2_500);
    const scope = { merchantOrgId: liver.orgId };
    await expect(carts.collect(owner, { ...scope, walkupId: w.id, code: w.code === '999' ? '998' : '999' })).rejects.toMatchObject({ code: 'walkup_code_wrong' });
    const before = (await carts.owner(owner, scope)).tonight;
    const view = await carts.collect(owner, { ...scope, walkupId: w.id, code: w.code });
    expect(view.walkups.some((x) => x.id === w.id)).toBe(false);
    expect(view.tonight.collected).toBe(before.collected + 1);
    expect(view.tonight.cashIqd).toBe(before.cashIqd + w.totalIqd);

    const rec = await app.get<FoodCartsRepository>(FOOD_CARTS_REPOSITORY).walkup(w.id);
    expect(AZIZIYAH_MONEY_RULES.commission.pickup).toBe(0.05);
    expect(rec).toMatchObject({ state: 'collected', commissionIqd: Math.round(w.totalIqd * AZIZIYAH_MONEY_RULES.commission.pickup) });
    expect(rec!.commissionIqd).toBe(450);
    // A ticket is collected once.
    await expect(carts.collect(owner, { ...scope, walkupId: w.id, code: w.code })).rejects.toMatchObject({ code: 'walkup_state_conflict' });
  });

  it('collect is one transaction: a failing walkup_collected event leaves the ticket open', async () => {
    const w = await carts.placeWalkup(customer(6), { cartId: liver.cartId, lines: [{ itemId: item('samoon'), qty: 1, choices: [] }] });
    const scope = { merchantOrgId: liver.orgId };
    const events = app.get(EventsService);
    const real = events.emit.bind(events);
    const spy = vi.spyOn(events, 'emit').mockImplementation(async (...args: Parameters<EventsService['emit']>) => {
      if (args[1].type === 'food_cart.walkup_collected') throw new Error('outbox down');
      return real(...args);
    });
    try {
      await expect(carts.collect(owner, { ...scope, walkupId: w.id, code: w.code })).rejects.toThrow('outbox down');
    } finally {
      spy.mockRestore();
    }
    const rec = await app.get<FoodCartsRepository>(FOOD_CARTS_REPOSITORY).walkup(w.id);
    expect(rec).toMatchObject({ state: 'placed', collectedAt: null, commissionIqd: 0 });
    // The owner can collect it again once the event goes through.
    await carts.collect(owner, { ...scope, walkupId: w.id, code: w.code });
    expect(await app.get<FoodCartsRepository>(FOOD_CARTS_REPOSITORY).walkup(w.id)).toMatchObject({ state: 'collected' });
  });

  it('a newly registered cart sets no tier, so it resolves to the starter default', async () => {
    const org = await orgs.create({ type: 'restaurant', name: 'فلافل التجربة', cityId: 'aziziyah', ownerId: 'food-carts-e2e-new-owner' });
    const cart = await carts.register({ orgId: org.id, cityId: 'aziziyah', kind: 'falafel' });
    expect(cart.orgId).toBe(org.id);
    expect((await orgs.merchantSettings(org.id)).commissionTier).toBeNull();
    expect(ORDERS_RULES.defaultCommissionTier).toBe('starter');
    const view = await app.get(CommissionTierService).view(org.id);
    expect(view).toMatchObject({ tier: 'starter', onFile: false, pct: 5 });
    // Registering again returns the same cart and still sets nothing.
    expect((await carts.register({ orgId: org.id, cityId: 'aziziyah', kind: 'falafel' })).id).toBe(cart.id);
    expect((await orgs.merchantSettings(org.id)).commissionTier).toBeNull();
  });

  it('cart storefronts stay out of the restaurant lists but can still be read by id', async () => {
    const cartOrgIds = new Set(seeded.map((c) => c.orgId));
    // A plain restaurant next to the carts, so the lists are not empty by accident.
    const kitchen = await orgs.create({ type: 'restaurant', name: 'مطعم التجربة', cityId: 'aziziyah', ownerId: 'food-carts-e2e-kitchen' });
    await catalog.saveStorefront({ orgId: kitchen.id, cityId: 'aziziyah', nameAr: 'مطعم التجربة', cuisineAr: 'مشويات', tags: ['grill'], minOrderIqd: 0, hours: [] });
    await catalog.addItem({ id: `${kitchen.id}_tikka`, orgId: kitchen.id, nameAr: 'تكة', nameEn: 'Tikka', description: null, priceIqd: 6_000, prepTimeMin: 15, categoryAr: null, sortOrder: 0 });
    const listed = await catalog.listedStorefronts('aziziyah');
    expect(listed.map((s) => s.orgId)).toContain(kitchen.id);
    expect(listed.filter((s) => cartOrgIds.has(s.orgId))).toEqual([]);
    expect(listed.some((s) => s.tags.includes(FOOD_CART_TAG))).toBe(false);

    const restaurants = await app.get(CatalogRpc).restaurants({ actor: null }, { cityId: 'aziziyah', filters: {} });
    expect(restaurants.map((r) => r.id)).toContain(kitchen.id);
    expect(restaurants.filter((r) => cartOrgIds.has(r.id))).toEqual([]);

    const front = await catalog.storefront(liver.orgId);
    expect(front).toMatchObject({ orgId: liver.orgId, nameAr: 'كبدة أبو حيدر' });
    expect(front!.tags).toContain(FOOD_CART_TAG);
    const menu = await app.get(CatalogRpc).menu({ actor: null }, { merchantId: liver.orgId });
    expect(menu).toBeTruthy();
  });

  it('follow toggles and counts the followers', async () => {
    const corn = seeded.find((c) => c.key === 'corn')!;
    const a = customer(10);
    const b = customer(11);
    const base = (await carts.get({ actor: null }, { cartId: corn.cartId })).followers;
    expect(await carts.follow(a, { cartId: corn.cartId, on: true })).toEqual({ following: true, followers: base + 1 });
    expect(await carts.follow(a, { cartId: corn.cartId, on: true })).toEqual({ following: true, followers: base + 1 });
    expect(await carts.follow(b, { cartId: corn.cartId, on: true })).toEqual({ following: true, followers: base + 2 });
    expect(await carts.get({ actor: a }, { cartId: corn.cartId })).toMatchObject({ following: true, followers: base + 2 });
    expect(await carts.follow(a, { cartId: corn.cartId, on: false })).toEqual({ following: false, followers: base + 1 });
    expect(await carts.get({ actor: a }, { cartId: corn.cartId })).toMatchObject({ following: false, followers: base + 1 });
    expect((await carts.list({ actor: b }, { cityId: 'aziziyah' })).followedIds).toContain(corn.cartId);
  });
});
