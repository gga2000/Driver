import { describe, expect, it } from 'vitest';
import type { Actor, Order } from '@driver/contracts';
import { CatalogService, InMemoryCatalogRepository } from '../catalog/index.js';
import { ConfigService } from '../config/index.js';
import { createInMemoryEvents } from '../events/index.js';
import { harness as identityHarness } from '../identity/test-harness.js';
import { ledgerHarness, workedExample } from '../ledger/test-harness.js';
import type { OrdersService } from '../orders/index.js';
import { OrgsService } from '../orgs/index.js';
import { DevBlobStore, type BlobStore } from '../places/index.js';
import { InMemoryPromotionsRepository, PromotionsService } from '../promotions/index.js';
import { InMemoryMerchantAdminRepository } from './merchant-admin.repository.js';
import { MerchantAdminService } from './merchant-admin.service.js';

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
const MIN = 60_000;

async function upload(blobs: BlobStore, ownerId: string): Promise<string> {
  const ticket = await blobs.createUpload({ ownerId, contentType: 'image/jpeg', sizeBytes: JPEG.length });
  const url = new URL(ticket.uploadUrl, 'http://local');
  await blobs.receive({ id: ticket.uploadId, exp: url.searchParams.get('exp') ?? undefined, sig: url.searchParams.get('sig') ?? undefined, contentType: 'image/jpeg', bytes: JPEG });
  return ticket.uploadId;
}

function order(over: Partial<Order> & { id: string }): Order {
  return {
    cityId: 'aziziyah',
    type: 'food',
    state: 'closed',
    ordererId: 'c1',
    merchantOrgId: 'org_1',
    householdOrgId: null,
    quoteId: null,
    paymentMethod: 'cash',
    itemsTotalIqd: 15000,
    deliveryFeeIqd: 1000,
    serviceFeeIqd: 500,
    discountIqd: 0,
    tipIqd: 0,
    totalIqd: 16500,
    minVehicleClass: null,
    cateringRequest: false,
    lines: [],
    participants: [],
    partial: null,
    scheduledFor: null,
    merchantOfferedAt: null,
    promisedReadyAt: null,
    placedAt: new Date('2026-10-03T09:00:00Z'),
    acceptedAt: null,
    preparingAt: null,
    readyAt: null,
    pickedUpAt: null,
    deliveredAt: null,
    closedAt: null,
    cancelledAt: null,
    cancellationReason: null,
    cancellationFeeIqd: 0,
    refundState: 'none',
    note: null,
    rating: null,
    ...over,
  } as Order;
}

async function setup(start = '2026-10-03T12:00:00Z') {
  const id = identityHarness(start);
  const clock = id.clock;
  const lh = ledgerHarness({ start });
  const ev = createInMemoryEvents({ clock });
  const blobs = new DevBlobStore(clock, { secret: 'blob' });
  const catalogRepo = new InMemoryCatalogRepository();
  const catalog = new CatalogService(catalogRepo, clock);
  const promotions = new PromotionsService(new InMemoryPromotionsRepository(), ev.events, ev.uow, clock);
  const orders: Order[] = [];
  const ordersFake = {
    merchantOrders: async (orgId: string, range: { from: Date; to: Date }) => orders.filter((o) => o.merchantOrgId === orgId && o.placedAt >= range.from && o.placedAt < range.to),
    get: async (orderId: string) => {
      const o = orders.find((x) => x.id === orderId);
      if (!o) throw new Error('nope');
      return o;
    },
  } as unknown as OrdersService;
  const orgs = new OrgsService(undefined, clock);
  const org = await orgs.create({ type: 'restaurant', name: 'مطعم الريف', cityId: 'aziziyah', ownerId: 'x' });
  const repo = new InMemoryMerchantAdminRepository();
  const svc = new MerchantAdminService(repo, catalog, promotions, lh.ledger, lh.facade, ordersFake, orgs, id.service, new ConfigService(), ev.events, blobs, ev.uow, clock);
  async function person(phone: string, kind?: 'merchant_owner' | 'merchant_staff' | 'admin'): Promise<Actor> {
    const { actor } = await id.login(phone);
    if (kind) await id.service.grantRole({ personId: 'admin' }, { personId: actor.personId, kind, ...(kind === 'admin' ? {} : { orgId: org.id }) });
    return actor;
  }
  const owner = await person('07700000001', 'merchant_owner');
  const staff = await person('07700000002', 'merchant_staff');
  return { id, clock, lh, ev, blobs, catalog, promotions, orders, orgs, orgId: org.id, repo, svc, person, owner, staff };
}

describe('merchantAdmin access', () => {
  it('needs a merchant role scoped to that org; money and staff are owner-only', async () => {
    const h = await setup();
    const outsider = await h.person('07700000003');
    await expect(h.svc.menuGet(outsider, { merchantOrgId: h.orgId })).rejects.toMatchObject({ code: 'forbidden' });
    await expect(h.svc.menuGet(h.staff, { merchantOrgId: 'org_other' })).rejects.toMatchObject({ code: 'forbidden' });
    await expect(h.svc.menuGet(h.staff, { merchantOrgId: h.orgId })).resolves.toMatchObject({ categories: [] });
    await expect(h.svc.moneyToday(h.staff, { merchantOrgId: h.orgId })).rejects.toMatchObject({ code: 'forbidden' });
    await expect(h.svc.staffList(h.staff, { merchantOrgId: h.orgId })).rejects.toMatchObject({ code: 'forbidden' });
    expect(await h.svc.myMerchants(h.owner)).toEqual([{ merchantOrgId: h.orgId, role: 'merchant_owner' }]);
  });
});

describe('merchantAdmin.menu', () => {
  it('creates items in sections, edits prices with history, and sold-out-today resets at local midnight', async () => {
    const h = await setup('2026-10-03T12:00:00Z'); // 15:00 Baghdad
    const wrap = await h.svc.menuUpsertItem(h.staff, { merchantOrgId: h.orgId, nameAr: 'لفة شاورما', priceIqd: 3000, categoryAr: 'لفات' });
    await h.svc.menuUpsertItem(h.staff, { merchantOrgId: h.orgId, nameAr: 'بيبسي', priceIqd: 750 });
    const menu = await h.svc.menuGet(h.staff, { merchantOrgId: h.orgId });
    expect(menu.categories.map((c) => [c.nameAr, c.items.map((i) => i.nameAr)])).toEqual([['لفات', ['لفة شاورما']], [null, ['بيبسي']]]);

    const priced = await h.svc.menuUpdatePrice(h.staff, { merchantOrgId: h.orgId, itemId: wrap.id, priceIqd: 3500 });
    expect(priced.item.priceIqd).toBe(3500);
    expect(priced.history.map((c) => [c.oldPriceIqd, c.newPriceIqd])).toEqual([[3000, 3500], [0, 3000]]);
    expect((await h.ev.events.forActor(h.staff.personId)).map((e) => e.type)).toEqual(expect.arrayContaining(['item.published', 'item.price_changed']));

    const sold = await h.svc.menuSoldOutToday(h.staff, { merchantOrgId: h.orgId, itemId: wrap.id });
    expect(sold.onSale).toBe(false);
    expect(sold.available).toBe(true);
    expect(sold.soldOutUntil?.toISOString()).toBe('2026-10-03T21:00:00.000Z');
    // Customers see it as unavailable until then (orders price lines from the same read).
    expect((await h.catalog.menu(h.orgId)).find((i) => i.id === wrap.id)?.available).toBe(false);
    expect((await h.catalog.itemsOf(h.orgId, [wrap.id]))[0]?.available).toBe(false);
    h.clock.set('2026-10-03T21:00:01Z');
    expect((await h.catalog.menu(h.orgId)).find((i) => i.id === wrap.id)?.available).toBe(true);
    const back = (await h.svc.menuGet(h.staff, { merchantOrgId: h.orgId })).categories[0]!.items[0]!;
    expect(back).toMatchObject({ onSale: true, soldOutUntil: null });

    const off = await h.svc.menuSetAvailability(h.staff, { merchantOrgId: h.orgId, itemId: wrap.id, available: false });
    expect(off.onSale).toBe(false);
  });

  it('replaces photos from uploads, sets modifiers, renames sections and refuses other merchants’ items', async () => {
    const h = await setup();
    const item = await h.svc.menuUpsertItem(h.owner, { merchantOrgId: h.orgId, nameAr: 'تكة', priceIqd: 6000, categoryAr: 'مشويات' });
    const photo = await h.svc.menuReplacePhoto(h.owner, { merchantOrgId: h.orgId, itemId: item.id, uploadId: await upload(h.blobs, h.owner.personId) });
    expect(photo.photoUrl).toMatch(/\/files\/up_[0-9a-f]+\?exp=\d+&sig=/);
    await expect(h.svc.menuReplacePhoto(h.owner, { merchantOrgId: h.orgId, itemId: item.id, uploadId: 'up_nope' })).rejects.toMatchObject({ code: 'upload_invalid' });

    const mods = await h.svc.menuSetModifiers(h.owner, {
      merchantOrgId: h.orgId,
      itemId: item.id,
      groups: [{ nameAr: 'الحجم', minSelect: 1, maxSelect: 1, required: true, modifiers: [{ nameAr: 'نص', priceIqd: 0, available: true }, { nameAr: 'كامل', priceIqd: 4000, available: true }] }],
    });
    expect(mods.modifierGroups[0]!.modifiers.map((m) => m.priceIqd)).toEqual([0, 4000]);

    const renamed = await h.svc.menuUpsertCategory(h.owner, { merchantOrgId: h.orgId, nameAr: 'شوي', renameFrom: 'مشويات' });
    expect(renamed.categories.map((c) => c.nameAr)).toEqual(['شوي']);

    const other = await h.catalog.addItem({ orgId: 'org_other', nameAr: 'غريب', priceIqd: 1000 });
    await expect(h.svc.menuUpdatePrice(h.owner, { merchantOrgId: h.orgId, itemId: other.id, priceIqd: 2000 })).rejects.toMatchObject({ code: 'menu_item_not_found' });
  });

  it('reorders sections for the customer menu, keeping item order inside each and the unnamed one last', async () => {
    const h = await setup();
    const add = (nameAr: string, categoryAr?: string) => h.svc.menuUpsertItem(h.staff, { merchantOrgId: h.orgId, nameAr, priceIqd: 1000, ...(categoryAr ? { categoryAr } : {}) });
    await add('لفة تكة', 'تكة');
    await add('صحن تكة', 'تكة');
    await add('بيبسي');
    await add('لفة كص', 'كص');
    await add('باجة', 'باجة');
    const menu = await h.svc.menuReorderCategories(h.staff, { merchantOrgId: h.orgId, order: ['باجة', 'تكة', 'ما موجود'] });
    expect(menu.categories.map((c) => [c.nameAr, c.items.map((i) => i.nameAr)])).toEqual([
      ['باجة', ['باجة']],
      ['تكة', ['لفة تكة', 'صحن تكة']],
      ['كص', ['لفة كص']],
      [null, ['بيبسي']],
    ]);
    // The customer menu reads the same order.
    expect((await h.catalog.menu(h.orgId)).map((i) => i.nameAr)).toEqual(['باجة', 'لفة تكة', 'صحن تكة', 'لفة كص', 'بيبسي']);
    expect((await h.ev.events.forActor(h.staff.personId)).map((e) => e.type)).toContain('menu.categories_reordered');
    await expect(h.svc.menuReorderCategories(await h.person('07700000004'), { merchantOrgId: h.orgId, order: ['تكة'] })).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('a menu import applied from two tablets at once creates its items once (review 2026-10-04 #12)', async () => {
    const h = await setup();
    const job = await h.svc.menuImportFromPhotos(h.staff, { merchantOrgId: h.orgId, uploadIds: [await upload(h.blobs, h.staff.personId)] });
    const items = [{ nameAr: 'كباب', priceIqd: 5000 }];
    const results = await Promise.allSettled([
      h.svc.menuApplyImport(h.staff, { merchantOrgId: h.orgId, jobId: job.jobId, items }),
      h.svc.menuApplyImport(h.owner, { merchantOrgId: h.orgId, jobId: job.jobId, items }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((r) => r.status === 'rejected')).toMatchObject({ reason: { code: 'import_state_conflict' } });
    expect((await h.catalog.adminMenu(h.orgId)).map((i) => i.nameAr)).toEqual(['كباب']);
  });

  it('imports a menu from photos: draft (OCR stub) → staff-corrected rows → items, once', async () => {
    const h = await setup();
    const job = await h.svc.menuImportFromPhotos(h.staff, { merchantOrgId: h.orgId, uploadIds: [await upload(h.blobs, h.staff.personId)] });
    expect(job).toMatchObject({ state: 'draft', ocr: 'stub', items: [] });
    expect(job.photoUrls).toEqual([expect.stringMatching(/\/files\/up_[0-9a-f]+\?exp=\d+&sig=/)]);
    const applied = await h.svc.menuApplyImport(h.staff, {
      merchantOrgId: h.orgId,
      jobId: job.jobId,
      items: [
        { nameAr: 'كباب', priceIqd: 5000, categoryAr: 'مشويات' },
        { nameAr: 'شوربة', priceIqd: 1500 },
      ],
    });
    expect(applied).toMatchObject({ state: 'applied', appliedCount: 2 });
    expect((await h.catalog.adminMenu(h.orgId)).map((i) => i.nameAr)).toEqual(['كباب', 'شوربة']);
    await expect(h.svc.menuApplyImport(h.staff, { merchantOrgId: h.orgId, jobId: job.jobId, items: [{ nameAr: 'x', priceIqd: 1 }] })).rejects.toMatchObject({ code: 'import_state_conflict' });
    await expect(h.svc.menuImportJob(h.staff, { merchantOrgId: 'org_other', jobId: job.jobId })).rejects.toMatchObject({ code: 'forbidden' });
  });
});

describe('merchantAdmin.deals', () => {
  it('owner proposes with a server-side projected cost; the city switch holds it for platform approval', async () => {
    const h = await setup('2026-10-03T12:00:00Z');
    const wrap = await h.svc.menuUpsertItem(h.owner, { merchantOrgId: h.orgId, nameAr: 'لفة', priceIqd: 3000 });
    // Four weeks of history: 8 orders with 2 wraps each.
    for (let i = 0; i < 8; i += 1) {
      h.orders.push(order({ id: `h${i}`, placedAt: new Date(h.clock.now().getTime() - (i + 1) * 3 * 86_400_000), itemsTotalIqd: 6000, lines: [{ id: `l${i}`, catalogItemId: wrap.id, freeText: null, qty: 2, unitPriceIqd: 3000, modifiers: [], participantId: null, note: null, pointsEligible: true, availability: 'available' }] as Order['lines'] }));
    }
    const schedule = { startsAt: h.clock.now(), endsAt: new Date(h.clock.now().getTime() + 14 * 86_400_000), days: [] };
    await expect(h.svc.dealsPropose(h.staff, { merchantOrgId: h.orgId, type: 'percent', value: 20, nameAr: 'خصم', itemIds: [], schedule, minOrderIqd: 0 })).rejects.toMatchObject({ code: 'forbidden' });
    await expect(h.svc.dealsPropose(h.owner, { merchantOrgId: h.orgId, type: 'percent', value: 80, nameAr: 'خصم', itemIds: [], schedule, minOrderIqd: 0 })).rejects.toMatchObject({ code: 'deal_invalid' });

    // The owner sees the projection of a draft before submitting; nothing is stored.
    const draft = { merchantOrgId: h.orgId, type: 'percent' as const, value: 20, nameAr: 'خصم اللفات', itemIds: [wrap.id], schedule, minOrderIqd: 0 };
    expect(await h.svc.dealsProject(h.owner, draft)).toEqual({
      projected: { ordersPerWeek: 2, costPerOrderIqd: 1200, weeklyCostIqd: 2400, totalCostIqd: 4800, basisOrders: 8 },
      basisDays: 28,
      requiresApproval: true,
    });
    expect(await h.svc.dealsList(h.owner, { merchantOrgId: h.orgId })).toEqual([]);
    await expect(h.svc.dealsProject(h.staff, draft)).rejects.toMatchObject({ code: 'forbidden' });
    await expect(h.svc.dealsProject(h.owner, { ...draft, itemIds: ['not_mine'] })).rejects.toMatchObject({ code: 'deal_invalid' });
    expect((await h.svc.dealsProject(h.owner, { ...draft, minOrderIqd: 7000 })).projected).toMatchObject({ ordersPerWeek: 0, totalCostIqd: 0, basisOrders: 8 });

    const deal = await h.svc.dealsPropose(h.owner, { merchantOrgId: h.orgId, type: 'percent', value: 20, nameAr: 'خصم اللفات', itemIds: [wrap.id], schedule, minOrderIqd: 0 });
    expect(deal.projected).toEqual({ ordersPerWeek: 2, costPerOrderIqd: 1200, weeklyCostIqd: 2400, totalCostIqd: 4800, basisOrders: 8 });
    expect(deal).toMatchObject({ state: 'pending_approval', state_ar: 'بانتظار موافقة المنصة', active: false, funder: 'merchant' });

    const admin = await h.person('07700000009', 'admin');
    const approved = await h.svc.dealsReview(admin, { dealId: deal.dealId, approve: true });
    expect(approved).toMatchObject({ state: 'approved', active: true });
    const paused = await h.svc.dealsSetActive(h.owner, { merchantOrgId: h.orgId, dealId: deal.dealId, active: false });
    expect(paused).toMatchObject({ state: 'paused', active: false });
    await expect(h.svc.dealsReview(admin, { dealId: deal.dealId, approve: true })).rejects.toMatchObject({ code: 'deal_state_conflict' });
    expect((await h.svc.dealsList(h.staff, { merchantOrgId: h.orgId })).map((d) => d.dealId)).toEqual([deal.dealId]);
  });
});

describe('merchantAdmin.money', () => {
  it('today: sales, commission by tier, net, cash with couriers and the live payable balance', async () => {
    const h = await setup('2026-10-03T13:00:00Z');
    await h.lh.posting.orderMoney(workedExample({ orderId: 'o1', merchantId: h.orgId, courierId: 'k1' }));
    h.orders.push(order({ id: 'o1', placedAt: new Date('2026-10-03T11:30:00Z') }));
    const m = await h.svc.moneyToday(h.owner, { merchantOrgId: h.orgId });
    expect(m).toMatchObject({ localDate: '2026-10-03', orders: 1, salesIqd: 15000, commissionIqd: 2250, netIqd: 12750, settlementMode: 'nightly_courier' });
    expect(m.commissionByTier).toEqual([{ tier: 'featured', pct: 15, baseIqd: 15000, commissionIqd: 2250, orders: 1 }]);
    expect(m.holders).toEqual([{ courierId: 'k1', amountIqd: 12750 }]);
    expect(m.cashHeldByCouriersIqd).toBe(12750);
    expect(m.payableBalanceIqd).toBe(12750);
  });

  it('weekly statement: one line per order plus courier hand-overs', async () => {
    const h = await setup('2026-10-03T13:00:00Z');
    await h.lh.posting.orderMoney(workedExample({ orderId: 'o1', merchantId: h.orgId, courierId: 'k1' }));
    h.orders.push(order({ id: 'o1', placedAt: new Date('2026-10-03T11:30:00Z') }));
    await h.lh.merchantCash.confirmHandover({ handoverId: 'hv1', courierId: 'k1', merchantId: h.orgId, amountIqd: 12750, merchantConfirmedIqd: 12750, tabletTap: true });
    const s = await h.svc.moneyStatement(h.owner, { merchantOrgId: h.orgId });
    expect(s.from.toISOString()).toBe('2026-09-26T21:00:00.000Z'); // Sunday 27 Sep, Baghdad
    expect(s.lines).toEqual([
      { orderId: 'o1', at: expect.any(Date), payment: 'cash', itemsIqd: 15000, commissionTier: 'featured', commissionPct: 15, commissionIqd: 2250, discountIqd: 0, discountFunder: null, feesIqd: 0, netIqd: 12750 },
    ]);
    expect(s.settlements).toEqual([{ at: expect.any(Date), kind: 'courier_handover', amountIqd: 12750, reference: null }]);
    expect(s.totals).toMatchObject({ orders: 1, netIqd: 12750, settledIqd: 12750 });
    expect(s.closingIqd).toBe(0);
  });

  it('disputes show evidence and the default outcome; the owner answers once (re-answer replaces)', async () => {
    const h = await setup('2026-10-03T13:00:00Z');
    const kebab = await h.svc.menuUpsertItem(h.owner, { merchantOrgId: h.orgId, nameAr: 'كباب', priceIqd: 5000 });
    h.orders.push(
      order({
        id: 'o9',
        state: 'disputed',
        placedAt: new Date('2026-10-03T10:00:00Z'),
        acceptedAt: new Date('2026-10-03T10:01:00Z'),
        readyAt: new Date('2026-10-03T10:20:00Z'),
        lines: [{ id: 'l1', catalogItemId: kebab.id, freeText: null, qty: 2, unitPriceIqd: 5000, modifiers: [], participantId: 'p1', note: null, pointsEligible: true, availability: 'available' }] as Order['lines'],
        participants: [{ id: 'p1', role: 'diner', personId: null, phoneOnly: true, label: 'أحمد', note: null }],
      }),
    );
    await h.ev.events.emit(undefined, { actorId: 'c1', type: 'order.disputed', occurredAt: new Date('2026-10-03T11:00:00Z'), orderId: 'o9', payload: { kind: 'missing_item', note: 'ناقص كباب' } }, { name: 'order', id: 'o9' });
    const [d] = await h.svc.moneyDisputes(h.owner, { merchantOrgId: h.orgId });
    expect(d).toMatchObject({ orderId: 'o9', kind: 'missing_item', note: 'ناقص كباب', defaultOutcome: { code: 'merchant_refunds_item' }, response: null });
    expect(d!.evidence.lines).toEqual([{ name: 'كباب', qty: 2, participant: 'أحمد' }]);

    expect(d!.respondBy?.toISOString()).toBe('2026-10-05T11:00:00.000Z');
    expect(d!.evidence.photos).toEqual([]);

    const r = await h.svc.moneyRespondDispute(h.owner, { merchantOrgId: h.orgId, orderId: 'o9', decision: 'contest', note: 'الصورة تبين الكباب', evidenceUploadIds: [await upload(h.blobs, h.owner.personId)] });
    expect(r.response).toMatchObject({ decision: 'contest', evidencePhotos: 1 });
    expect(r.response!.photoUrls).toHaveLength(1);
    expect(r.response!.photoUrls[0]).toContain('/files/');
    const again = await h.svc.moneyRespondDispute(h.owner, { merchantOrgId: h.orgId, orderId: 'o9', decision: 'accept_default', evidenceUploadIds: [] });
    expect(again.response?.decision).toBe('accept_default');
    await expect(h.svc.moneyRespondDispute(h.owner, { merchantOrgId: h.orgId, orderId: 'o_unknown', decision: 'contest', evidenceUploadIds: [] })).rejects.toMatchObject({ code: 'dispute_not_found' });
    // Review 2026-10-04 #19: after respondBy (opened + 48 h) the default outcome stands; no late contest.
    h.clock.advance(48 * 3600_000);
    await expect(h.svc.moneyRespondDispute(h.owner, { merchantOrgId: h.orgId, orderId: 'o9', decision: 'contest', evidenceUploadIds: [] })).rejects.toMatchObject({ code: 'dispute_response_closed' });
    expect((await h.svc.moneyDisputes(h.owner, { merchantOrgId: h.orgId }))[0]!.response?.decision).toBe('accept_default');
  });
});

describe('merchantAdmin.money.cash', () => {
  it('splits the balance between couriers and Driver, lists hand-overs and follows "اطلب فلوسك" to the PIN hand-over', async () => {
    const h = await setup('2026-10-03T13:00:00Z');
    const courier = await h.person('07711111111');
    await h.id.service.setName(courier, 'حيدر كاظم');
    await h.lh.posting.orderMoney(workedExample({ orderId: 'o1', merchantId: h.orgId, courierId: courier.personId }));
    await h.lh.posting.orderMoney(workedExample({ orderId: 'o2', merchantId: h.orgId, courierId: undefined, deliveryFeeIqd: 0, payment: 'wallet' }));
    await expect(h.svc.moneyCash(h.staff, { merchantOrgId: h.orgId })).rejects.toMatchObject({ code: 'forbidden' });

    const before = await h.svc.moneyCash(h.owner, { merchantOrgId: h.orgId });
    expect(before).toMatchObject({ balanceIqd: 25500, exposureCapIqd: 300000, overExposure: false, mode: 'nightly_courier', heldByPlatformIqd: 12750, request: null, handovers: [] });
    expect(before.holders).toEqual([{ courierId: courier.personId, name: 'حيدر', amountIqd: 12750 }]);

    // Requested → assigned to the courier holding the cash (events recorded on the merchant aggregate).
    const at = h.clock.now();
    const merchant = { name: 'merchant', id: h.orgId };
    await h.ev.events.emit(undefined, { actorId: h.owner.personId, type: 'merchant.settlement_requested', occurredAt: at, payload: { merchantId: h.orgId, reason: 'merchant_request', balanceIqd: 25500, reference: 'M-AAAA-BBBB' } }, merchant);
    expect((await h.svc.moneyCash(h.owner, { merchantOrgId: h.orgId })).request).toMatchObject({ reference: 'M-AAAA-BBBB', state: 'requested', amountIqd: 25500, channel: null });
    const targetBy = new Date(at.getTime() + 60 * MIN);
    await h.ev.events.emit(undefined, { actorId: 'system:ledger', type: 'merchant.settlement_assigned', occurredAt: at, payload: { reference: 'M-AAAA-BBBB', channel: 'courier', courierId: courier.personId, targetBy: targetBy.toISOString() } }, merchant);
    const onTheWay = (await h.svc.moneyCash(h.owner, { merchantOrgId: h.orgId })).request;
    expect(onTheWay).toMatchObject({ state: 'on_the_way', channel: 'courier', courierName: 'حيدر', targetBy, handover: null });

    // The courier hands it over with the PIN.
    h.clock.advance(20 * MIN);
    h.lh.clock.advance(20 * MIN);
    await h.lh.merchantCash.configure(h.orgId, { pin: '4821' });
    await h.lh.merchantCash.confirmHandover({ handoverId: 'hv1', courierId: courier.personId, merchantId: h.orgId, amountIqd: 12750, merchantConfirmedIqd: 12750, pin: '4821' });
    const pinEvent = h.lh.bus.emitted.find((e) => e.type === 'merchant.paid_by_courier');
    expect(pinEvent?.payload).toMatchObject({ confirmedBy: 'pin' });
    await h.ev.events.emit(undefined, { actorId: courier.personId, type: 'merchant.paid_by_courier', occurredAt: h.clock.now(), payload: pinEvent!.payload }, merchant);

    const after = await h.svc.moneyCash(h.owner, { merchantOrgId: h.orgId });
    expect(after.handovers).toEqual([{ handoverId: 'hv1', at: expect.any(Date), courierId: courier.personId, courierName: 'حيدر', amountIqd: 12750, balanceAfterIqd: 12750, confirmedBy: 'pin' }]);
    expect(after.request).toMatchObject({ state: 'handed_over', handover: { handoverId: 'hv1', confirmedBy: 'pin' } });
    expect(after).toMatchObject({ balanceIqd: 12750, holders: [], heldByPlatformIqd: 12750 });
  });
});

describe('merchantAdmin.insights', () => {
  it('prep honesty, rejection rate, item ratings with review text and peak hours', async () => {
    const h = await setup('2026-10-03T13:00:00Z');
    const kebab = await h.svc.menuUpsertItem(h.owner, { merchantOrgId: h.orgId, nameAr: 'كباب', priceIqd: 5000 });
    const line = [{ id: 'l', catalogItemId: kebab.id, freeText: null, qty: 1, unitPriceIqd: 5000, modifiers: [], participantId: null, note: null, pointsEligible: true, availability: 'available' }] as Order['lines'];
    const at = new Date('2026-10-03T10:00:00Z'); // 13:00 Baghdad
    h.orders.push(
      order({ id: 'a', placedAt: at, merchantOfferedAt: at, acceptedAt: at, promisedReadyAt: new Date(at.getTime() + 15 * MIN), readyAt: new Date(at.getTime() + 25 * MIN), lines: line, rating: { delivery: 5, food: 3, tags: [], note: 'بارد شوية', ratedAt: at } }),
      order({ id: 'b', placedAt: at, merchantOfferedAt: at, acceptedAt: at, promisedReadyAt: new Date(at.getTime() + 15 * MIN), readyAt: new Date(at.getTime() + 14 * MIN), lines: line, rating: { delivery: 5, food: 5, tags: [], note: null, ratedAt: at } }),
      order({ id: 'c', placedAt: new Date('2026-10-02T17:00:00Z'), merchantOfferedAt: at, state: 'merchant_rejected' }), // 20:00 Baghdad
    );
    const i = await h.svc.insights(h.staff, { merchantOrgId: h.orgId, days: 30 });
    expect(i.prepHonesty).toEqual({ samples: 2, quotedAvgMin: 15, actualAvgMin: 19.5, onTimeShare: 0.5 });
    expect(i.rejection).toMatchObject({ offered: 3, rejected: 1, rate: 0.333 });
    // Five 7-day buckets over 30 days; both kebab orders and the rejection fall in the last week.
    expect(i.rejection.trend).toHaveLength(5);
    expect(i.rejection.trend.at(-1)).toMatchObject({ offered: 3, rejected: 1, rate: 0.333 });
    expect(i.rejection.trend[0]).toMatchObject({ offered: 0, rate: null });
    expect(i.bestSellers).toEqual([{ itemId: kebab.id, nameAr: 'كباب', qty: 2, orders: 2, salesIqd: 10000 }]);
    expect(i.peakGrid[6]![13]).toBe(2); // Saturday 13:00 Baghdad
    expect(i.orders).toBe(3);
    expect(i.itemRatings).toEqual([{ itemId: kebab.id, nameAr: 'كباب', avg: 4, count: 2, reviews: [{ score: 3, note: 'بارد شوية', at }] }]);
    expect(i.peakHours[13]).toBe(2);
    expect(i.peakHours[20]).toBe(1);
  });
});

describe('merchantAdmin.insights rating attribution', () => {
  it('gives the food score to the main dish, not the drink that came with it', async () => {
    const h = await setup('2026-10-03T13:00:00Z');
    const liver = await h.svc.menuUpsertItem(h.owner, { merchantOrgId: h.orgId, nameAr: 'لفة كبد', priceIqd: 1500 });
    const pepsi = await h.svc.menuUpsertItem(h.owner, { merchantOrgId: h.orgId, nameAr: 'بيبسي', priceIqd: 750 });
    const at = new Date('2026-10-03T10:00:00Z');
    const line = (id: string, itemId: string, qty: number, unitPriceIqd: number) => ({ id, catalogItemId: itemId, freeText: null, qty, unitPriceIqd, modifiers: [], participantId: null, note: null, pointsEligible: true, availability: 'available' });
    h.orders.push(order({ id: 'r1', placedAt: at, lines: [line('l1', pepsi.id, 2, 750), line('l2', liver.id, 3, 1500)] as Order['lines'], rating: { delivery: 5, food: 2, tags: [], note: 'الكبد ناشف', ratedAt: at } }));
    const i = await h.svc.insights(h.owner, { merchantOrgId: h.orgId, days: 7 });
    expect(i.itemRatings.map((r) => [r.nameAr, r.avg, r.reviews.map((x) => x.note)])).toEqual([['لفة كبد', 2, ['الكبد ناشف']]]);
    expect(i.bestSellers.map((b) => [b.nameAr, b.qty])).toEqual([['لفة كبد', 3], ['بيبسي', 2]]);
  });
});

describe('merchantAdmin.staff invite is not a name lookup (review 2026-10-04 #6)', () => {
  it("inviting a phone does not reveal the person's name until he signs in after the invite", async () => {
    const h = await setup();
    // Someone already on Driver as a customer, with a full name in the vault.
    const someone = await h.id.login('07700000088');
    await h.id.service.updateProfile(someone.actor, { name: 'مريم عبد الله صالح' });
    h.clock.advance(60_000);
    const invited = await h.svc.staffInvite(h.owner, { merchantOrgId: h.orgId, phone: '07700000088', role: 'merchant_staff' });
    expect(invited).toMatchObject({ personId: someone.actor.personId, pending: true, name: null });
    expect(JSON.stringify(await h.svc.staffList(h.owner, { merchantOrgId: h.orgId }))).not.toContain('مريم');
    // He opens the Merchant app (a new sign-in after the invite): now he is staff with a name.
    h.clock.advance(60_000);
    await h.id.login('07700000088');
    expect((await h.svc.staffList(h.owner, { merchantOrgId: h.orgId })).find((s) => s.personId === someone.actor.personId)).toMatchObject({ pending: false, name: 'مريم عبد الله صالح' });
  });

  it('a pending invite shows the typed number as 0770 ••• 4567; the owner resends it at most every 10 minutes (follow-up 2026-10-04)', async () => {
    const h = await setup();
    const invited = await h.svc.staffInvite(h.owner, {
      merchantOrgId: h.orgId,
      phone: '07701234567',
      role: 'merchant_staff',
    });
    expect(invited).toMatchObject({
      pending: true,
      name: null,
      phoneHint: '0770 ••• 4567',
      invitedAt: h.clock.now(),
      inviteSentAt: h.clock.now(),
    });
    expect(invited.resendAfter).toEqual(new Date(h.clock.now().getTime() + 10 * 60_000));
    const sent = async () =>
      (await h.ev.events.forAggregate('merchant_staff', h.orgId)).filter(
        (e) => e.type === 'merchant.staff_invite_sent',
      );
    expect((await sent()).map((e) => e.payload)).toEqual([
      expect.objectContaining({
        personId: invited.personId,
        storeName: 'مطعم الريف',
        resend: false,
      }),
    ]);
    // Too soon: a no-op.
    h.clock.advance(5 * 60_000);
    await h.svc.staffResendInvite(h.owner, { merchantOrgId: h.orgId, personId: invited.personId });
    expect(await sent()).toHaveLength(1);
    h.clock.advance(6 * 60_000);
    const again = await h.svc.staffResendInvite(h.owner, {
      merchantOrgId: h.orgId,
      personId: invited.personId,
    });
    expect(await sent()).toHaveLength(2);
    expect(again.inviteSentAt).toEqual(h.clock.now());
    // Staff can't; once he signs in there is nothing to resend.
    await expect(
      h.svc.staffResendInvite(h.staff, { merchantOrgId: h.orgId, personId: invited.personId }),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await h.id.login('07701234567');
    await expect(
      h.svc.staffResendInvite(h.owner, { merchantOrgId: h.orgId, personId: invited.personId }),
    ).rejects.toMatchObject({ code: 'staff_invite_not_pending' });
    expect(
      (await h.svc.staffList(h.owner, { merchantOrgId: h.orgId })).find(
        (s) => s.personId === invited.personId,
      ),
    ).not.toHaveProperty('phoneHint');
  });
});

describe('merchantAdmin.staff', () => {
  it('owner invites by phone, changes roles and removes staff; a merchant keeps at least one owner', async () => {
    const h = await setup();
    const list = await h.svc.staffList(h.owner, { merchantOrgId: h.orgId });
    expect(list.map((s) => [s.role, s.you, s.pending])).toEqual([
      ['merchant_owner', true, false],
      ['merchant_staff', false, false],
    ]);
    expect(h.id.repo.accessLogs.some((l) => l.accessorId === h.owner.personId && l.purpose === 'merchant_staff_view')).toBe(true);

    const cashier = await h.svc.staffInvite(h.owner, { merchantOrgId: h.orgId, phone: '07700000077', role: 'merchant_staff' });
    // Never signed in: the invite is pending until the first OTP.
    expect(cashier).toMatchObject({ role: 'merchant_staff', phoneMasked: '+96477*****77', pending: true });
    await h.id.login('07700000077');
    expect((await h.svc.staffList(h.owner, { merchantOrgId: h.orgId })).find((s) => s.personId === cashier.personId)?.pending).toBe(false);
    expect(await h.id.service.hasRole(cashier.personId, 'merchant_staff', h.orgId)).toBe(true);

    const promoted = await h.svc.staffSetRole(h.owner, { merchantOrgId: h.orgId, personId: cashier.personId, role: 'merchant_owner' });
    expect(promoted.role).toBe('merchant_owner');
    expect(await h.id.service.hasRole(cashier.personId, 'merchant_staff', h.orgId)).toBe(false);

    expect(await h.svc.staffRemove(h.owner, { merchantOrgId: h.orgId, personId: cashier.personId })).toEqual({ removed: true });
    expect(await h.id.service.hasRole(cashier.personId, 'merchant_owner', h.orgId)).toBe(false);
    await expect(h.svc.staffSetRole(h.owner, { merchantOrgId: h.orgId, personId: h.owner.personId, role: 'merchant_staff' })).rejects.toMatchObject({ code: 'staff_last_owner' });
    await expect(h.svc.staffRemove(h.owner, { merchantOrgId: h.orgId, personId: h.owner.personId })).rejects.toMatchObject({ code: 'staff_last_owner' });
  });
});
