import { describe, expect, it } from 'vitest';
import { AZIZIYAH_MONEY_RULES, DriverError, type OrderMoneyPayload } from '@driver/contracts';
import { postOrderClosed } from '../ledger/postings.js';
import { KITCHEN, ordersHarness } from './test-harness.js';

const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return 'ok';
  } catch (err) {
    return err instanceof DriverError ? err.code : String(err);
  }
};

const MIN = 60_000;

describe('OrdersService — placing', () => {
  it('computes totals and the vehicle cap, and offers the order to the merchant at once', async () => {
    const h = ordersHarness();
    const o = await h.orders.place('c1', h.foodInput());
    expect(o).toMatchObject({ state: 'placed', itemsTotalIqd: 15000, totalIqd: 16500, minVehicleClass: 'bike', cateringRequest: false });
    expect(o.merchantOfferedAt).toEqual(h.clock.now());
    expect(h.events.types(o.id)).toEqual(['order.placed', 'order.offered_to_merchant']);
  });

  it('keeps the saved-place link only for a place the orderer may use (maps program SP3d)', async () => {
    const h = ordersHarness();
    h.placeOwners.set('pl_mine', 'c1');
    h.placeOwners.set('pl_theirs', 'c2');
    const HOME = { lat: 32.8871, lng: 45.0766 };
    const mine = await h.orders.place('c1', h.foodInput({ dropoff: { zoneKey: 'zakur', pin: HOME, placeId: 'pl_mine' } }));
    expect((await h.repo.find(mine.id))!.order.dropoff).toEqual({ zoneKey: 'zakur', pin: HOME, placeId: 'pl_mine' });
    const theirs = await h.orders.place('c1', h.foodInput({ dropoff: { zoneKey: 'zakur', pin: HOME, placeId: 'pl_theirs' } }));
    expect((await h.repo.find(theirs.id))!.order.dropoff).toEqual({ zoneKey: 'zakur', pin: HOME });
  });

  it('goes to the door couriers learned for the place; a door sent by the app is never kept (maps a3)', async () => {
    const h = ordersHarness();
    const HOME = { lat: 32.8871, lng: 45.0766 };
    const DOOR = { lat: 32.8872, lng: 45.0766 };
    h.placeOwners.set('pl_mine', 'c1');
    h.placeDoors.set('pl_mine', DOOR);
    const o = await h.orders.place('c1', h.foodInput({ dropoff: { zoneKey: 'zakur', pin: HOME, placeId: 'pl_mine', door: { lat: 1, lng: 1 } } }));
    expect((await h.repo.find(o.id))!.order.dropoff).toEqual({ zoneKey: 'zakur', pin: HOME, placeId: 'pl_mine', door: DOOR });
    const forged = await h.orders.place('c1', h.foodInput({ dropoff: { zoneKey: 'zakur', pin: HOME, door: { lat: 1, lng: 1 } } }));
    expect((await h.repo.find(forged.id))!.order.dropoff).toEqual({ zoneKey: 'zakur', pin: HOME });
  });

  it('tags lines to participants; phone-only participants keep only a hash', async () => {
    const h = ordersHarness();
    h.people.set('07701111111', 'p_a');
    const o = await h.orders.place(
      'c1',
      h.foodInput({
        participants: [
          { ref: 'a', role: 'diner', phone: '07701111111', label: 'الكبير' },
          { ref: 'b', role: 'diner', phone: '07702222222' },
        ],
        lines: [
          { catalogItemId: 'kebab', qty: 2, unitPriceIqd: 5000, participantRef: 'a' },
          { catalogItemId: 'tikka', qty: 1, unitPriceIqd: 5000, participantRef: 'b' },
          { freeText: 'خبز زيادة', qty: 1, unitPriceIqd: 0 },
        ],
      }),
    );
    const [a, b] = o.participants;
    expect(a).toMatchObject({ personId: 'p_a', phoneOnly: false, label: 'الكبير' });
    expect(b).toMatchObject({ personId: null, phoneOnly: true });
    expect(o.lines.map((l) => l.participantId)).toEqual([a!.id, b!.id, null]);
    expect(h.events.ofType('line.tagged')).toHaveLength(2);
    expect(JSON.stringify(h.repo.participants)).not.toContain('07702222222');
  });

  it('rejects unknown participant tags, mixed merchants, missing merchant and empty carts', async () => {
    const h = ordersHarness();
    expect(await code(h.orders.place('c1', h.foodInput({ lines: [{ catalogItemId: 'x', qty: 1, unitPriceIqd: 1000, participantRef: 'ghost' }] })))).toBe('participant_unknown');
    expect(await code(h.orders.place('c1', h.foodInput({ lines: [{ catalogItemId: 'x', qty: 1, unitPriceIqd: 1000, merchantOrgId: 'rest_2' }] })))).toBe('one_merchant_per_order');
    expect(await code(h.orders.place('c1', h.foodInput({ merchantOrgId: undefined })))).toBe('merchant_required');
    expect(await code(h.orders.place('c1', h.foodInput({ lines: [] })))).toBe('order_empty');
    expect(await code(h.orders.place('c1', h.foodInput({ merchantOrgId: 'nope' })))).toBe('org_not_found');
  });

  it('caps by vehicle class: a 70,000 order needs a car; above 100,000 it is a catering request', async () => {
    const h = ordersHarness();
    const big = await h.orders.place('c1', h.foodInput({ lines: [{ catalogItemId: 'tray', qty: 7, unitPriceIqd: 10000 }] }));
    expect(big.minVehicleClass).toBe('car');
    const catering = await h.orders.place('c1', h.foodInput({ lines: [{ catalogItemId: 'tray_5k', qty: 40, unitPriceIqd: 5000 }] }));
    expect(catering).toMatchObject({ minVehicleClass: 'car', cateringRequest: true });
    expect(h.events.ofType('order.catering_request')).toHaveLength(1);
  });
});

describe('OrdersService — server-side line pricing (review C2)', () => {
  it('prices catalog lines from the menu: a client price is never what gets charged', async () => {
    const h = ordersHarness();
    // No price sent: the menu's 5,000 + 5,000 apply.
    const o = await h.orders.place('c1', h.foodInput({ lines: [{ catalogItemId: 'kebab', qty: 2 }, { catalogItemId: 'tikka', qty: 1 }] }));
    expect(o).toMatchObject({ itemsTotalIqd: 15000, totalIqd: 16500 });
    expect(o.lines.map((l) => l.unitPriceIqd)).toEqual([5000, 5000]);
    // A lower (or higher) client price is refused, never trusted.
    expect(await code(h.orders.place('c1', h.foodInput({ lines: [{ catalogItemId: 'kebab', qty: 2, unitPriceIqd: 1 }] })))).toBe('price_changed');
    expect(await code(h.orders.place('c1', h.foodInput({ lines: [{ catalogItemId: 'kebab', qty: 2, unitPriceIqd: 9000 }] })))).toBe('price_changed');
    expect(h.repo.orders.size).toBe(1);
  });

  it('adds modifier deltas from the menu and validates the picks', async () => {
    const h = ordersHarness();
    const g = 'falafel_mg_1';
    const o = await h.orders.place('c1', h.foodInput({ lines: [{ catalogItemId: 'falafel', qty: 2, modifiers: [{ groupId: g, modifierId: `${g}_m_1`, nameAr: 'x', priceIqd: 500 }] }] }));
    expect(o.itemsTotalIqd).toBe(2 * (1500 + 500));
    expect(o.lines[0]!.modifiers).toEqual([{ groupId: g, modifierId: `${g}_m_1`, nameAr: 'بيض', priceIqd: 500 }]);
    expect(await code(h.orders.place('c1', h.foodInput({ lines: [{ catalogItemId: 'falafel', qty: 1, modifiers: [{ groupId: g, modifierId: `${g}_m_1`, nameAr: 'x', priceIqd: 0 }] }] })))).toBe('price_changed');
    expect(await code(h.orders.place('c1', h.foodInput({ lines: [{ catalogItemId: 'falafel', qty: 1, modifiers: [{ groupId: g, modifierId: 'nope' }] }] })))).toBe('modifier_invalid');
    expect(await code(h.orders.place('c1', h.foodInput({ lines: [{ catalogItemId: 'falafel', qty: 1, modifiers: [{ groupId: g, modifierId: `${g}_m_1` }, { groupId: g, modifierId: `${g}_m_1` }] }] })))).toBe('modifier_invalid');
    expect(await code(h.orders.place('c1', h.foodInput({ lines: [{ catalogItemId: 'kebab', qty: 1, modifiers: [{ groupId: g, modifierId: `${g}_m_1` }] }] })))).toBe('modifier_invalid');
  });

  it('applies branch overrides and refuses unknown, foreign, unavailable, sold-out and out-of-hours items', async () => {
    const h = ordersHarness();
    h.merchants.add('rest_2', { location: { zoneKey: 'centre', pin: { lat: 32.91, lng: 45.06 } } });
    await h.catalog.addItem({ id: 'other_menu', orgId: 'rest_2', nameAr: 'صنف', priceIqd: 100 });
    expect((await h.orders.place('c1', h.foodInput({ lines: [{ catalogItemId: 'gus', qty: 1 }] }))).itemsTotalIqd).toBe(4000);
    expect((await h.orders.place('c1', h.foodInput({ branchKey: 'kut', lines: [{ catalogItemId: 'gus', qty: 1 }] }))).itemsTotalIqd).toBe(4500);
    expect(await code(h.orders.place('c1', h.foodInput({ branchKey: 'closed_branch', lines: [{ catalogItemId: 'gus', qty: 1 }] })))).toBe('catalog_item_unavailable');
    expect(await code(h.orders.place('c1', h.foodInput({ lines: [{ catalogItemId: 'ghost', qty: 1 }] })))).toBe('catalog_item_unavailable');
    expect(await code(h.orders.place('c1', h.foodInput({ lines: [{ catalogItemId: 'other_menu', qty: 1 }] })))).toBe('catalog_item_unavailable');
    expect(await code(h.orders.place('c1', h.foodInput({ lines: [{ catalogItemId: 'soldout', qty: 1 }] })))).toBe('catalog_item_unavailable');
    await h.catalog.setAvailable('tikka', false);
    expect(await code(h.orders.place('c1', h.foodInput()))).toBe('catalog_item_unavailable');
    // Breakfast is Saturday 06:00–11:00 Baghdad; the harness clock is Saturday 12:00.
    expect(await code(h.orders.place('c1', h.foodInput({ lines: [{ catalogItemId: 'breakfast', qty: 1 }] })))).toBe('catalog_item_unavailable');
    h.clock.set(Date.parse('2026-10-03T06:00:00Z')); // 09:00 local
    expect((await h.orders.place('c1', h.foodInput({ lines: [{ catalogItemId: 'breakfast', qty: 1 }] }))).itemsTotalIqd).toBe(3000);
  });

  it('free-text lines on a merchant order are priced 0; errands keep their estimate; catalog ids need a merchant', async () => {
    const h = ordersHarness();
    const o = await h.orders.place('c1', h.foodInput({ lines: [{ catalogItemId: 'kebab', qty: 1 }, { freeText: 'كباب مجاني', qty: 5, unitPriceIqd: 0 }, { freeText: 'خبز', qty: 1, unitPriceIqd: 99999 }] }));
    expect(o.itemsTotalIqd).toBe(5000);
    const errand = await h.orders.place('c1', { cityId: 'aziziyah', type: 'errand', pickup: { zoneKey: 'centre' }, dropoff: { zoneKey: 'zakur' }, lines: [{ freeText: 'دوه من الصيدلية', qty: 1, unitPriceIqd: 7000 }] });
    expect(errand.itemsTotalIqd).toBe(7000);
    expect(await code(h.orders.place('c1', { cityId: 'aziziyah', type: 'errand', pickup: { zoneKey: 'centre' }, dropoff: { zoneKey: 'zakur' }, lines: [{ catalogItemId: 'kebab', qty: 1 }] }))).toBe('catalog_item_unavailable');
  });
});

describe('OrdersService — server-locked fees, promo-only discounts, capped tips (M2 review follow-up)', () => {
  it('fees come from the server quote: omitted fees are filled in, wrong ones are refused with price_changed', async () => {
    const h = ordersHarness();
    // centre → zakur (mid): 1,000 delivery + 500 service, whatever the client sends or omits.
    const omitted = await h.orders.place('c1', h.foodInput({ deliveryFeeIqd: undefined, serviceFeeIqd: undefined }));
    expect(omitted).toMatchObject({ itemsTotalIqd: 15000, deliveryFeeIqd: 1000, serviceFeeIqd: 500, totalIqd: 16500 });
    expect(await code(h.orders.place('c1', h.foodInput({ deliveryFeeIqd: 0 })))).toBe('price_changed');
    expect(await code(h.orders.place('c1', h.foodInput({ serviceFeeIqd: 0 })))).toBe('price_changed');
    expect(await code(h.orders.place('c1', h.foodInput({ deliveryFeeIqd: 5000 })))).toBe('price_changed');
    // The drop-off zone moves the fee: centre → centre is the near band.
    const near = await h.orders.place('c1', h.foodInput({ dropoff: { zoneKey: 'street_30' }, deliveryFeeIqd: undefined }));
    expect(near).toMatchObject({ deliveryFeeIqd: 500, totalIqd: 16000 });
    // A street hand-over is a −250 option the server applies.
    const street = await h.orders.place('c1', h.foodInput({ options: { streetHandover: true }, deliveryFeeIqd: undefined }));
    expect(street.deliveryFeeIqd).toBe(750);
    // No drop-off place, or a merchant without a place on file: nothing to price from.
    expect(await code(h.orders.place('c1', h.foodInput({ dropoff: undefined })))).toBe('quote_location_required');
    h.merchants.add('rest_nowhere');
    expect(await code(h.orders.place('c1', h.foodInput({ merchantOrgId: 'rest_nowhere' })))).toBe('quote_location_required');
  });

  it('night delivery: the server adds the +250 night component itself', async () => {
    const h = ordersHarness('2026-10-03T21:30:00Z'); // 00:30 Baghdad (food's night fee starts at midnight)
    const o = await h.orders.place('c1', h.foodInput({ deliveryFeeIqd: undefined }));
    expect(o).toMatchObject({ deliveryFeeIqd: 1250, totalIqd: 16750 });
  });

  it('rides: the fare is the server quote for the zones and vertical; a cheaper client fare is refused', async () => {
    const h = ordersHarness();
    const ride = { cityId: 'aziziyah', type: 'ride' as const, pickup: { zoneKey: 'centre' }, dropoff: { zoneKey: 'street_30' } };
    expect(await h.orders.place('c1', ride)).toMatchObject({ totalIqd: 3000, deliveryFeeIqd: 0, serviceFeeIqd: 0 });
    expect(await code(h.orders.place('c1', { ...ride, fareIqd: 1000 }))).toBe('price_changed');
    expect((await h.orders.place('c1', { ...ride, rideVertical: 'tuktuk', fareIqd: 2000 })).totalIqd).toBe(2000);
    expect(await code(h.orders.place('c1', { cityId: 'aziziyah', type: 'ride', fareIqd: 3000 }))).toBe('quote_location_required');
  });

  it('discounts only from a promotion the server resolves; NoPromotions means discount 0', async () => {
    const h = ordersHarness();
    // A discount the server does not grant (no deal, no code) is a stale cart: refresh, never honoured.
    expect(await code(h.orders.place('c1', h.foodInput({ discountIqd: 5000 })))).toBe('deal_changed');
    expect(await code(h.orders.place('c1', h.foodInput({ promoCode: 'FREE' })))).toBe('promotion_invalid');
    expect((await h.orders.place('c1', h.foodInput({ discountIqd: 0 }))).discountIqd).toBe(0);
    // A resolved promotion sets the discount; the ledger funds it from the promotion's budget line.
    h.promotions.codes.set('FREE', { promotionId: 'promo_launch', discountIqd: 1000 });
    expect(await code(h.orders.place('c1', h.foodInput({ promoCode: 'FREE', discountIqd: 3000 })))).toBe('price_changed');
    const o = await h.orders.place('c1', h.foodInput({ promoCode: 'FREE' }));
    expect(o).toMatchObject({ discountIqd: 1000, totalIqd: 15500 });
    await h.orders.merchantAccept('m1', { orderId: o.id, prepMinutes: 15 });
    const t = await h.tripFor(o.id);
    await h.pickup(t.id);
    await h.dropoff(t.id, { cashCollectedIqd: o.totalIqd });
    expect(h.events.last('order.cash_collected')!.payload).toMatchObject({ order: { platformPromo: { promotionId: 'promo_launch', amountIqd: 1000 } } });
  });

  it('tips are the customer choice, capped at 10,000, and posted 100 % to the courier', async () => {
    const h = ordersHarness();
    expect(await code(h.orders.place('c1', h.foodInput({ tipIqd: 10_500 })))).toBe('tip_above_cap');
    const o = await h.orders.place('c1', h.foodInput({ tipIqd: 2000 }));
    expect(o).toMatchObject({ tipIqd: 2000, totalIqd: 18500 });
    await h.orders.merchantAccept('m1', { orderId: o.id, prepMinutes: 15 });
    const t = await h.tripFor(o.id);
    await h.pickup(t.id);
    await h.dropoff(t.id, { cashCollectedIqd: o.totalIqd });
    const fact = h.events.last('order.cash_collected')!.payload['order'] as OrderMoneyPayload;
    const tips = postOrderClosed(fact, AZIZIYAH_MONEY_RULES).money.lines.filter((l) => l.type === 'tip');
    expect(tips).toEqual([expect.objectContaining({ amount: 2000, toAccount: 'driver:d1' })]);
  });

  it('the 25,000 new-customer cash cap applies to the server-computed total, not to client fees', async () => {
    const h = ordersHarness();
    // 25,000 of food; the client "forgets" the fees, the server adds 1,500 → 26,500 is over the cap.
    const order = h.foodInput({ lines: [{ catalogItemId: 'kebab', qty: 5 }], deliveryFeeIqd: undefined, serviceFeeIqd: undefined });
    expect(await code(h.orders.place('new1', order))).toBe('new_customer_cash_cap');
    expect(h.cashRisk.asked).toEqual([{ customerId: 'new1', totalIqd: 26500 }]);
  });
});

describe('OrdersService — new-customer cash cap (decisions §4)', () => {
  it('the first three cash orders of a new account are capped at 25,000 and flagged for the arriving call', async () => {
    const h = ordersHarness();
    const big = h.foodInput({ lines: [{ catalogItemId: 'tray_9k', qty: 3, unitPriceIqd: 9000 }] }); // 27,000 + 1,500 fees
    expect(await code(h.orders.place('new1', big))).toBe('new_customer_cash_cap');
    expect(h.cashRisk.asked).toEqual([{ customerId: 'new1', totalIqd: 28500 }]);
    // wallet orders are not cash exposure (the wallet covers it)
    h.wallets.set('customer:new1', 30000);
    expect((await h.orders.place('new1', { ...big, paymentMethod: 'wallet' })).state).toBe('placed');
    const small = await h.orders.place('new1', h.foodInput());
    expect(h.events.ofType('order.placed').find((e) => e.orderId === small.id)!.payload).toMatchObject({ arrivingCallRequired: true });
    // three completed cash orders later the cap is gone
    h.cashRisk.prior.set('new1', 3);
    const ok = await h.orders.place('new1', big);
    expect(ok.state).toBe('placed');
    expect(h.events.ofType('order.placed').find((e) => e.orderId === ok.id)!.payload).toMatchObject({ arrivingCallRequired: false });
  });
});

describe('OrdersService — merchant acceptance', () => {
  it('order.accepted carries what dispatch needs: ready time, vehicle, pickup and drop-off points, cash exposure', async () => {
    const h = ordersHarness();
    const o = await h.orders.place('c1', h.foodInput({ dropoff: { zoneKey: 'zakur', pin: { lat: 32.9185, lng: 45.0712 } } }));
    await h.orders.merchantAccept('m1', { orderId: o.id, prepMinutes: 15 });
    expect(h.events.last('order.accepted')!.payload).toEqual({
      from: 'placed',
      to: 'merchant_accepted',
      orderType: 'food',
      cityId: 'aziziyah',
      merchantOrgId: 'rest_1',
      prepMinutes: 15,
      promisedReadyAt: new Date(h.clock.now().getTime() + 15 * MIN).toISOString(),
      minVehicleClass: 'bike',
      auto: false,
      partial: false,
      pickup: { zoneKey: 'centre', pin: { lat: 32.9105, lng: 45.0665 } },
      dropoff: { zoneKey: 'zakur', pin: { lat: 32.9185, lng: 45.0712 } },
      paymentMethod: 'cash',
      totalIqd: 16500,
    });
  });


  it('auto-rejects after 90 s with a dispatch alert, scored', async () => {
    const h = ordersHarness();
    const o = await h.orders.place('c1', h.foodInput());
    await h.advance(89_000);
    expect((await h.orders.get(o.id)).state).toBe('placed');
    await h.advance(1_000);
    expect((await h.orders.get(o.id)).state).toBe('merchant_rejected');
    expect(h.events.last('order.rejected')!.payload).toMatchObject({ auto: true, scored: true, dispatchAlert: true, reason: 'merchant_timeout' });
  });

  it('acceptance inside 90 s stops the timer', async () => {
    const h = ordersHarness();
    const o = await h.orders.place('c1', h.foodInput());
    await h.advance(30_000);
    const acc = await h.orders.merchantAccept('m1', { orderId: o.id, prepMinutes: 15 });
    expect(acc.state).toBe('merchant_accepted');
    expect(acc.promisedReadyAt).toEqual(new Date(h.clock.now().getTime() + 15 * MIN));
    await h.advance(90_000);
    expect((await h.orders.get(o.id)).state).toBe('merchant_accepted');
    expect(h.events.ofType('order.rejected')).toHaveLength(0);
  });

  it('merchants with the auto-accept flag skip acceptance', async () => {
    const h = ordersHarness();
    h.merchants.add('rest_auto', { autoAccept: true, defaultPrepMin: 25, location: { zoneKey: 'centre' } });
    const o = await h.orders.place('c1', h.foodInput({ merchantOrgId: 'rest_auto' }));
    expect(o.state).toBe('merchant_accepted');
    expect(o.promisedReadyAt).toEqual(new Date(h.clock.now().getTime() + 25 * MIN));
    expect(h.events.last('order.auto_accepted')!.payload).toMatchObject({ auto: true, prepMinutes: 25 });
    await h.advance(91_000);
    expect((await h.orders.get(o.id)).state).toBe('merchant_accepted');
  });

  it('pause windows: no orders during Friday prayer; an auto-reject that lands inside one is not scored', async () => {
    const closed = ordersHarness('2026-10-02T08:50:00Z'); // Friday 11:50 Baghdad
    expect(await code(closed.orders.place('c1', closed.foodInput()))).toBe('merchant_paused');

    const h = ordersHarness('2026-10-02T08:44:00Z'); // Friday 11:44, a minute before the pause
    const o = await h.orders.place('c1', h.foodInput());
    await h.advance(90_000); // 11:45:30 — inside the window
    expect((await h.orders.get(o.id)).state).toBe('merchant_rejected');
    expect(h.events.last('order.rejected')!.payload).toMatchObject({ auto: true, scored: false, pauseWindow: 'صلاة الجمعة' });
  });

  it('M-17 (on, Ali 2026-10-08): a late rejection takes a scoring hit and carries 500 customer credit funded by the merchant; a rejection before accepting carries none', async () => {
    expect(AZIZIYAH_MONEY_RULES.merchantLateRejectCredit.enabled).toBe(true);
    const h = ordersHarness();
    const o = await h.orders.place('c1', h.foodInput());
    await h.orders.merchantAccept('m1', { orderId: o.id, prepMinutes: 15 });
    await h.orders.markPreparing('m1', { orderId: o.id });
    const r = await h.orders.merchantReject('m1', { orderId: o.id, reason: 'خلص الأكل' });
    expect(r.state).toBe('merchant_rejected');
    expect(h.events.last('order.rejected')!.payload).toMatchObject({ orderId: o.id, customerId: 'c1', merchantOrgId: expect.any(String), afterAccept: true, customerCreditIqd: 500, creditFundedBy: 'merchant', scored: true });
    const early = await h.orders.place('c1', h.foodInput());
    await h.orders.merchantReject('m1', { orderId: early.id, reason: 'زحمة' });
    expect(h.events.last('order.rejected')!.payload).toMatchObject({ orderId: early.id, afterAccept: false, customerCreditIqd: 0, creditFundedBy: null });
  });

  it('M-17 switch off (ops can stop it without a release): a late rejection claims no credit', async () => {
    const rule = AZIZIYAH_MONEY_RULES.merchantLateRejectCredit;
    rule.enabled = false;
    try {
      const h = ordersHarness();
      const o = await h.orders.place('c1', h.foodInput());
      await h.orders.merchantAccept('m1', { orderId: o.id, prepMinutes: 15 });
      await h.orders.merchantReject('m1', { orderId: o.id, reason: 'خلص الأكل' });
      expect(h.events.last('order.rejected')!.payload).toMatchObject({ orderId: o.id, afterAccept: true, customerCreditIqd: 0, creditFundedBy: null });
    } finally {
      rule.enabled = true;
    }
  });
});

describe('OrdersService — scheduled orders (review A.12)', () => {
  it('reaches the merchant at T − prep − 10 min and cancels free until then', async () => {
    const h = ordersHarness();
    const at = new Date(h.clock.now().getTime() + 3 * 60 * MIN);
    const o = await h.orders.place('c1', h.foodInput({ scheduledFor: at }));
    expect(o.merchantOfferedAt).toBeNull();
    expect(await code(h.orders.merchantAccept('m1', { orderId: o.id, prepMinutes: 20 }))).toBe('order_state_conflict');
    expect((await h.orders.cancellationPreview(o.id)).free).toBe(true);
    await h.advance(150 * MIN - 1000); // offer at 3 h − (20 + 10) min = +2 h 30
    expect((await h.orders.get(o.id)).merchantOfferedAt).toBeNull();
    await h.advance(1000);
    expect((await h.orders.get(o.id)).merchantOfferedAt).toEqual(h.clock.now());
    expect((await h.orders.merchantAccept('m1', { orderId: o.id, prepMinutes: 20 })).state).toBe('merchant_accepted');
  });

  it('a scheduled order cancelled before it reached the merchant is never offered', async () => {
    const h = ordersHarness();
    const o = await h.orders.place('c1', h.foodInput({ scheduledFor: new Date(h.clock.now().getTime() + 3 * 60 * MIN) }));
    const c = await h.orders.cancel('c1', { orderId: o.id });
    expect(c).toMatchObject({ state: 'customer_cancelled', cancellationFeeIqd: 0 });
    await h.advance(4 * 60 * MIN);
    expect((await h.orders.get(o.id)).merchantOfferedAt).toBeNull();
  });
});

describe('OrdersService — partial accept (review A.4)', () => {
  async function proposed() {
    const h = ordersHarness();
    const o = await h.orders.place('c1', h.foodInput());
    const tikka = o.lines[1]!;
    const p = await h.orders.merchantAccept('m1', { orderId: o.id, prepMinutes: 15, unavailableLineIds: [tikka.id] });
    return { h, o: p, tikka };
  }

  it('marks lines unavailable and gives the customer 60 s with the reduced total', async () => {
    const { h, o, tikka } = await proposed();
    expect(o.state).toBe('placed');
    expect(o.partial).toMatchObject({ unavailableLineIds: [tikka.id], reducedItemsTotalIqd: 10000, reducedTotalIqd: 11500 });
    expect(o.partial!.deadline).toEqual(new Date(h.clock.now().getTime() + 60_000));
    expect(o.lines[1]!.availability).toBe('unavailable');
    expect(h.events.last('order.partial_proposed')!.payload).toMatchObject({ reducedTotalIqd: 11500 });
  });

  it('approval accepts the reduced order; the 90-s timer no longer applies', async () => {
    const { h, o } = await proposed();
    await h.advance(30_000);
    const a = await h.orders.respondPartial('c1', { orderId: o.id, approve: true });
    expect(a).toMatchObject({ state: 'merchant_accepted', itemsTotalIqd: 10000, totalIqd: 11500, partial: null });
    expect(a.lines[1]!.availability).toBe('removed');
    expect(h.events.last('order.accepted')!.payload).toMatchObject({ partial: true, prepMinutes: 15 });
    await h.advance(120_000);
    expect((await h.orders.get(o.id)).state).toBe('merchant_accepted');
  });

  it('declining cancels free; silence for 60 s cancels free too', async () => {
    const { h, o } = await proposed();
    expect(await code(h.orders.respondPartial('someone', { orderId: o.id, approve: false }))).toBe('forbidden');
    const d = await h.orders.respondPartial('c1', { orderId: o.id, approve: false });
    expect(d).toMatchObject({ state: 'customer_cancelled', cancellationFeeIqd: 0, cancellationReason: 'partial_declined' });

    const second = await proposed();
    await second.h.advance(60_000);
    expect(await second.h.orders.get(second.o.id)).toMatchObject({ state: 'platform_cancelled', cancellationReason: 'partial_timeout', cancellationFeeIqd: 0 });
    expect(await code(second.h.orders.respondPartial('c1', { orderId: second.o.id, approve: true }))).toBe('partial_accept_not_pending');
  });

  it('cannot mark every line or an unknown line unavailable (that is a rejection)', async () => {
    const h = ordersHarness();
    const o = await h.orders.place('c1', h.foodInput());
    expect(await code(h.orders.merchantAccept('m1', { orderId: o.id, prepMinutes: 15, unavailableLineIds: o.lines.map((l) => l.id) }))).toBe('partial_accept_invalid');
    expect(await code(h.orders.merchantAccept('m1', { orderId: o.id, prepMinutes: 15, unavailableLineIds: ['line_x'] }))).toBe('partial_accept_invalid');
  });
});

describe('OrdersService — cancellation fees (spec §4)', () => {
  it('free before acceptance, 500 after, food cost + 500 to the courier once preparing', async () => {
    const h = ordersHarness();
    const free = await h.orders.place('c1', h.foodInput());
    expect((await h.orders.cancel('c1', { orderId: free.id })).cancellationFeeIqd).toBe(0);

    const accepted = await h.orders.place('c1', h.foodInput());
    await h.orders.merchantAccept('m1', { orderId: accepted.id, prepMinutes: 15 });
    expect((await h.orders.cancellationPreview(accepted.id)).amountIqd).toBe(500);
    expect((await h.orders.cancel('c1', { orderId: accepted.id })).cancellationFeeIqd).toBe(500);

    const preparing = await h.orders.place('c1', h.foodInput());
    await h.orders.merchantAccept('m1', { orderId: preparing.id, prepMinutes: 15 });
    const trip = await h.tripFor(preparing.id);
    await h.orders.markPreparing('m1', { orderId: preparing.id });
    const fee = await h.orders.cancellationPreview(preparing.id);
    expect(fee.amountIqd).toBe(15500);
    expect(fee.splits).toEqual([
      { to: 'merchant', amountIqd: 15000 },
      { to: 'courier', amountIqd: 500 },
    ]);
    const c = await h.orders.cancel('c1', { orderId: preparing.id, reason: 'غيرت رأيي' });
    expect(c.cancellationFeeIqd).toBe(15500);
    // Shared contract (domain-events): the splits resolved to the merchant and the courier en route.
    expect(h.events.last('order.cancelled')!.payload).toMatchObject({
      by: 'customer',
      feeIqd: 15500,
      reason: 'غيرت رأيي',
      orderId: preparing.id,
      customerId: 'c1',
      tripId: trip.id,
      beneficiaries: [
        { kind: 'merchant', id: 'rest_1', amountIqd: 15000 },
        { kind: 'driver', id: 'd1', amountIqd: 500 },
      ],
    });
    expect((await h.trips.get(trip.id)).state).toBe('platform_cancelled');
    // the free cancel carried no beneficiaries
    expect(h.events.ofType('order.cancelled')[0]!.payload).toMatchObject({ feeIqd: 0, free: true, beneficiaries: [] });
  });

  it('no cancel after pickup — it becomes a dispute', async () => {
    const h = ordersHarness();
    const o = await h.orders.place('c1', h.foodInput());
    await h.orders.merchantAccept('m1', { orderId: o.id, prepMinutes: 15 });
    const t = await h.tripFor(o.id);
    await h.pickup(t.id);
    expect((await h.orders.get(o.id)).state).toBe('picked_up');
    expect(await code(h.orders.cancel('c1', { orderId: o.id }))).toBe('order_cancel_after_pickup');
    expect(await code(h.orders.cancel('c2', { orderId: o.id }))).toBe('forbidden');
  });
});

describe('OrdersService — merchant heartbeat and courier release (review A.2)', () => {
  async function waiting() {
    const h = ordersHarness();
    const o = await h.orders.place('c1', h.foodInput());
    await h.orders.merchantAccept('m1', { orderId: o.id, prepMinutes: 10 });
    const t = await h.tripFor(o.id);
    return { h, o, t };
  }

  it('silent merchant: dispatcher card at promised + 10, courier released at + 15 with 500 charged to the merchant', async () => {
    const { h, o, t } = await waiting();
    await h.advance(20 * MIN - 1000);
    expect(h.events.ofType('order.merchant_unresponsive')).toHaveLength(0);
    await h.advance(1000);
    expect(h.events.last('order.merchant_unresponsive')!.payload).toMatchObject({ dispatcherCard: true, call: true, cityId: 'aziziyah' });
    await h.advance(5 * MIN);
    expect(h.events.last('order.courier_released')!.payload).toMatchObject({ courierId: 'd1', compensationIqd: 500, chargedTo: 'merchant', tripId: t.id });
    expect((await h.trips.get(t.id)).orders[0]!.reason).toBe('merchant_unresponsive');
    expect((await h.orders.get(o.id)).state).toBe('merchant_accepted');
  });

  it('a merchant whose app is alive is left alone', async () => {
    const { h } = await waiting();
    await h.advance(19 * MIN);
    await h.orders.merchantHeartbeat('rest_1');
    await h.advance(1 * MIN);
    await h.advance(4 * MIN);
    await h.orders.merchantHeartbeat('rest_1');
    await h.advance(1 * MIN);
    expect(h.events.ofType('order.merchant_unresponsive')).toHaveLength(0);
    expect(h.events.ofType('order.courier_released')).toHaveLength(0);
  });

  it('a ready order never triggers the checks', async () => {
    const { h, o } = await waiting();
    await h.orders.markReady('m1', { orderId: o.id });
    await h.advance(30 * MIN);
    expect(h.events.ofType('order.merchant_unresponsive')).toHaveLength(0);
  });
});

describe('OrdersService — "+5 د" after accepting (M-12, Ali 2026-10-04)', () => {
  async function accepted(prepMinutes = 10) {
    const h = ordersHarness();
    const o = await h.orders.place('c1', h.foodInput());
    await h.orders.merchantAccept('m1', { orderId: o.id, prepMinutes });
    const t = await h.tripFor(o.id);
    return { h, o, t, promised: (await h.orders.get(o.id)).promisedReadyAt! };
  }

  it('moves the promised ready time by 5 minutes once and tells the customer', async () => {
    const { h, o, promised } = await accepted();
    await h.advance(3 * MIN);
    const after = await h.orders.merchantExtendPrep('m1', { orderId: o.id });
    expect(after.promisedReadyAt).toEqual(new Date(promised.getTime() + 5 * MIN));
    expect(after.prepExtendedAt).toEqual(h.clock.now());
    expect(h.events.last('order.prep_extended')!.payload).toEqual({
      merchantOrgId: 'rest_1',
      minutes: 5,
      from: promised.toISOString(),
      promisedReadyAt: new Date(promised.getTime() + 5 * MIN).toISOString(),
    });
  });

  it('works while preparing too, and only once: the second is prep_already_extended', async () => {
    const { h, o } = await accepted();
    await h.orders.markPreparing('m1', { orderId: o.id });
    expect(await code(h.orders.merchantExtendPrep('m1', { orderId: o.id }))).toBe('ok');
    expect(await code(h.orders.merchantExtendPrep('m1', { orderId: o.id }))).toBe('prep_already_extended');
    expect(h.events.ofType('order.prep_extended')).toHaveLength(1);
  });

  it('only on an accepted order still in the kitchen', async () => {
    const h = ordersHarness();
    const placed = await h.orders.place('c1', h.foodInput());
    expect(await code(h.orders.merchantExtendPrep('m1', { orderId: placed.id }))).toBe('order_state_conflict');
    const { h: h2, o } = await accepted();
    await h2.orders.markReady('m1', { orderId: o.id });
    expect(await code(h2.orders.merchantExtendPrep('m1', { orderId: o.id }))).toBe('order_state_conflict');
  });

  it('the overdue check and the courier release move with the new promise', async () => {
    const { h, o, t } = await accepted(10);
    await h.orders.merchantExtendPrep('m1', { orderId: o.id });
    // Old promise + 10 min (20 min in): nothing — that check is stale now.
    await h.advance(20 * MIN);
    expect(h.events.ofType('order.merchant_unresponsive')).toHaveLength(0);
    // New promise + 10 min (25 min in): the dispatcher card; + 15 (30 min in): the courier is released.
    await h.advance(5 * MIN);
    expect(h.events.ofType('order.merchant_unresponsive')).toHaveLength(1);
    await h.advance(5 * MIN);
    expect(h.events.last('order.courier_released')!.payload).toMatchObject({ tripId: t.id, chargedTo: 'merchant' });
  });
});

describe('OrdersService — "سلّمته" at the pass (UI/UX audit S-M4)', () => {
  async function readyWithCourier() {
    const h = ordersHarness();
    const o = await h.orders.place('c1', h.foodInput());
    await h.orders.merchantAccept('m1', { orderId: o.id, prepMinutes: 10 });
    const t = await h.tripFor(o.id);
    await h.orders.markReady('m1', { orderId: o.id });
    const pickupStop = t.stops.find((s) => s.type === 'pickup')!;
    const arrive = async () => {
      await h.trips.arrive(t.id, pickupStop.id, 'd1', { pin: KITCHEN });
      await h.deliver();
    };
    return { h, o, t, arrive };
  }

  it('records the hand-over once the courier is at the counter: the time and order.handed_over with how long he waited', async () => {
    const { h, o, t, arrive } = await readyWithCourier();
    await arrive();
    await h.advance(4 * MIN);
    const after = await h.orders.merchantHandOver('m1', { orderId: o.id });
    expect(after.handedOverAt).toEqual(h.clock.now());
    expect(after.state).toBe('ready');
    const e = h.events.last('order.handed_over')!;
    expect(e.actorId).toBe('m1');
    expect(e.payload).toMatchObject({ merchantOrgId: 'rest_1', courierId: 'd1', tripId: t.id, waitedSec: 240 });
  });

  it('is idempotent: a second tap returns the first record and emits nothing new', async () => {
    const { h, o, arrive } = await readyWithCourier();
    await arrive();
    const first = await h.orders.merchantHandOver('m1', { orderId: o.id });
    await h.advance(MIN);
    const second = await h.orders.merchantHandOver('m1', { orderId: o.id });
    expect(second.handedOverAt).toEqual(first.handedOverAt);
    expect(h.events.ofType('order.handed_over')).toHaveLength(1);
  });

  it('refuses while the courier is still on his way, and before the order is ready', async () => {
    const { h, o } = await readyWithCourier();
    expect(await code(h.orders.merchantHandOver('m1', { orderId: o.id }))).toBe('order_state_conflict');
    const placed = await h.orders.place('c1', h.foodInput());
    expect(await code(h.orders.merchantHandOver('m1', { orderId: placed.id }))).toBe('order_state_conflict');
    expect(h.events.ofType('order.handed_over')).toHaveLength(0);
  });

  it('still records it when the courier already confirmed the pickup himself', async () => {
    const { h, o, t } = await readyWithCourier();
    await h.pickup(t.id);
    expect((await h.orders.get(o.id)).state).toBe('picked_up');
    const after = await h.orders.merchantHandOver('m1', { orderId: o.id });
    expect(after.handedOverAt).not.toBeNull();
    expect(after.state).toBe('picked_up');
  });
});
