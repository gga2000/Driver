import { describe, expect, it } from 'vitest';
import { PlaceOrderInput, PriceRequest, type MenuItem, type QuoteComponent } from '@driver/contracts';
import { EMPTY_CART, ME, TABLE, addLine, type CartMerchant, type CartState, type NewCartLine } from './cart';
import { buildPlaceOrderInput, cartQuoteRequest, checkoutTotals, clock12, lineSavings, otherDeals, overNewCustomerCap, placeProblem, priorCashOrders, validTender, walletChoice } from './checkout';
import { canQuickAdd, chosenModifiers, defaultSelection, fromPrice, isSelectionValid, selectionProblems, sheetLinePrice, toggleModifier } from './modifiers';
import { similarOpenRestaurants } from './similar';

const kebabKilo: MenuItem = {
  id: 'org_1_kebab_kilo',
  name: 'كباب بالكيلو',
  description: null,
  priceIqd: 12000,
  photoUrl: null,
  available: true,
  unavailableReason: null,
  prepTimeMin: 25,
  pointsEligible: true,
  modifierGroups: [
    { id: 'g_amount', name: 'الكمية', required: true, min: 1, max: 1, variant: true, modifiers: [{ id: 'half', name: 'نص كيلو', priceIqd: 0, available: true }, { id: 'kilo', name: 'كيلو', priceIqd: 11000, available: true }] },
    {
      id: 'g_extras',
      name: 'إضافات',
      required: false,
      min: 0,
      max: 2,
      variant: false,
      modifiers: [
        { id: 'amba', name: 'عمبة', priceIqd: 0, available: true },
        { id: 'tomato', name: 'طماطة مشوية', priceIqd: 250, available: true },
        { id: 'cheese', name: 'جبن', priceIqd: 500, available: true },
        { id: 'gone', name: 'طرشي', priceIqd: 0, available: false },
      ],
    },
  ],
};

const wrap: MenuItem = {
  ...kebabKilo,
  id: 'org_1_kebab_wrap',
  name: 'لفة كباب',
  priceIqd: 2000,
  modifierGroups: [{ id: 'g_bread', name: 'الخبز', required: true, min: 1, max: 1, variant: false, modifiers: [{ id: 'samoon', name: 'صمون', priceIqd: 0, available: true }, { id: 'tannour', name: 'تنور', priceIqd: 0, available: true }] }],
};

describe('modifier validation (item sheet)', () => {
  it('variants open on their first option; plain required choices start empty and block the add', () => {
    expect(defaultSelection(kebabKilo)).toEqual({ g_amount: ['half'], g_extras: [] });
    expect(isSelectionValid(kebabKilo, defaultSelection(kebabKilo))).toBe(true);
    expect(selectionProblems(wrap, defaultSelection(wrap))).toEqual([{ groupId: 'g_bread', name: 'الخبز', problem: 'too_few' }]);
    expect(canQuickAdd(wrap)).toBe(false);
    expect(canQuickAdd({ ...kebabKilo, modifierGroups: [kebabKilo.modifierGroups[1]!] })).toBe(true);
    expect(canQuickAdd({ ...kebabKilo, modifierGroups: [], available: false })).toBe(false);
  });

  it('single-choice switches and cannot be emptied when required; multi-choice stops at max; unavailable refused', () => {
    let sel = defaultSelection(kebabKilo);
    sel = toggleModifier(kebabKilo, sel, 'g_amount', 'kilo').selection;
    expect(sel['g_amount']).toEqual(['kilo']);
    expect(toggleModifier(kebabKilo, sel, 'g_amount', 'kilo').selection['g_amount']).toEqual(['kilo']);
    sel = toggleModifier(kebabKilo, sel, 'g_extras', 'tomato').selection;
    sel = toggleModifier(kebabKilo, sel, 'g_extras', 'cheese').selection;
    const third = toggleModifier(kebabKilo, sel, 'g_extras', 'amba');
    expect(third.blocked).toBe('max');
    expect(third.selection).toBe(sel);
    expect(toggleModifier(kebabKilo, sel, 'g_extras', 'gone').blocked).toBe('unavailable');
    sel = toggleModifier(kebabKilo, sel, 'g_extras', 'cheese').selection;
    expect(sel['g_extras']).toEqual(['tomato']);
  });

  it('live line price = (item + chosen deltas) × qty; chosen modifiers in menu order', () => {
    let sel = toggleModifier(kebabKilo, defaultSelection(kebabKilo), 'g_amount', 'kilo').selection;
    sel = toggleModifier(kebabKilo, sel, 'g_extras', 'cheese').selection;
    sel = toggleModifier(kebabKilo, sel, 'g_extras', 'tomato').selection;
    expect(sheetLinePrice(kebabKilo, sel, 2)).toBe((12000 + 11000 + 250 + 500) * 2);
    expect(chosenModifiers(kebabKilo, sel).map((m) => m.name)).toEqual(['كيلو', 'طماطة مشوية', 'جبن']);
    expect(fromPrice(kebabKilo)).toEqual({ amount: 12000, varies: true });
    expect(fromPrice(wrap)).toEqual({ amount: 2000, varies: false });
  });

  it('a too-many selection (stale) is reported', () => {
    expect(selectionProblems(kebabKilo, { g_amount: ['half', 'kilo'], g_extras: [] })).toEqual([{ groupId: 'g_amount', name: 'الكمية', problem: 'too_many' }]);
  });
});

const KHALID: CartMerchant = { id: 'org_1', name: 'مطعم خالد', cityId: 'aziziyah', pickup: { zoneKey: 'street_30', pin: { lat: 32.9095, lng: 45.0635 } }, minOrderIqd: 5000 };
const SARA = { id: 'pp_sara', name: 'سارة', phone: '+9647701234567' };
const ZAKUR = { zoneKey: 'zakur', pin: { lat: 32.887, lng: 45.0765 } };

function twoPersonCart(): CartState {
  const line = (patch: Partial<NewCartLine>): NewCartLine => ({ itemId: wrap.id, name: wrap.name, basePriceIqd: 2000, modifiers: [{ groupId: 'g_bread', modifierId: 'tannour', name: 'تنور', priceIqd: 0 }], qty: 1, note: null, personId: ME, ...patch });
  let cart: CartState = EMPTY_CART;
  for (const [l, opts] of [
    [line({ qty: 2 }), {}],
    [line({ personId: SARA.id, note: 'بدون بصل', itemId: kebabKilo.id, name: kebabKilo.name, basePriceIqd: 12000, modifiers: [{ groupId: 'g_amount', modifierId: 'kilo', name: 'كيلو', priceIqd: 11000 }] }), { person: SARA }],
  ] as const) {
    const r = addLine(cart, KHALID, l, opts);
    if (r.ok) cart = r.cart;
  }
  return cart;
}

const comp = (key: QuoteComponent['key'], amount: number): QuoteComponent => ({ key, amount, label_ar: key, label_en: key, driverShareRule: 'driver_full', visibility: 'shown' });

describe('checkout payload builder', () => {
  it('quote request: kitchen → deliver-to, street hand-over option', () => {
    const req = cartQuoteRequest({ cityId: 'aziziyah', pickup: KHALID.pickup!, dropoff: ZAKUR, streetHandover: true, at: new Date('2026-10-03T15:00:00Z') });
    const parsed = PriceRequest.parse(req);
    expect(parsed.stops.map((s) => [s.zoneId, s.type])).toEqual([
      ['street_30', 'pickup'],
      ['zakur', 'dropoff'],
    ]);
    expect(parsed.options.streetHandover).toBe(true);
  });

  it('totals: items + delivery parts + service fee (promo never counted)', () => {
    const t = checkoutTotals(twoPersonCart(), { components: [comp('service_fee', 500), comp('base', 1000), comp('street_pickup', -250), comp('promo', -1000)] });
    expect(t).toMatchObject({ itemsIqd: 4000 + 23000, deliveryFeeIqd: 750, serviceFeeIqd: 500, totalIqd: 27000 + 1250 });
    expect(t.components.map((c) => c.key)).toEqual(['base', 'street_pickup', 'service_fee']);
  });

  it('deal shown at its exact saving; a cash total rounds up to 250 and the change goes to the wallet (Ali, 2026-10-04)', () => {
    const cart = twoPersonCart();
    const deal = { promotionId: 'd1', funder: 'merchant' as const, target: 'items' as const, type: 'percent' as const, label_ar: 'خصم 15%', label_en: '15% off', amountIqd: 4050, dealIqd: 4050, roundingIqd: 0 };
    const t = checkoutTotals(cart, { components: [comp('service_fee', 500), comp('base', 1000)] }, { discountIqd: 4050, discount: deal });
    // 27,000 + 1,500 − 4,050 = 24,450 → hands over 24,500, 50 back as "الباقي رصيد".
    expect(t).toMatchObject({ discountIqd: 4050, dealIqd: 4050, roundingIqd: 0, priceIqd: 24450, totalIqd: 24500, changeIqd: 50 });
    // The wallet pays the exact price.
    expect(checkoutTotals(cart, { components: [comp('service_fee', 500), comp('base', 1000)] }, { discountIqd: 4050, discount: deal }, 'wallet')).toMatchObject({ priceIqd: 24450, totalIqd: 24450, changeIqd: 0 });
    // An exact multiple has no change.
    expect(checkoutTotals(cart, { components: [comp('service_fee', 500), comp('base', 1000)] })).toMatchObject({ priceIqd: 28500, totalIqd: 28500, changeIqd: 0 });
    const saved = lineSavings(cart, { lineSavingsIqd: [600, 3450], dealLineSavingsIqd: [600, 3450] });
    expect([...saved.values()]).toEqual([600, 3450]);
    // Old API without the exact field: the per-line shares.
    expect([...lineSavings(cart, { lineSavingsIqd: [600, 3150] }).values()]).toEqual([600, 3150]);
  });

  it('wallet row (C-04): usable when it covers the exact price, otherwise how much is missing', () => {
    expect(walletChoice(null, 18000)).toEqual({ usable: false, missingIqd: 0 });
    expect(walletChoice(25000, 17800)).toEqual({ usable: true, missingIqd: 0 });
    expect(walletChoice(17800, 17800)).toEqual({ usable: true, missingIqd: 0 });
    expect(walletChoice(3000, 17750)).toEqual({ usable: false, missingIqd: 14750 });
  });

  it('deals never combine (C-06): the other live deals are named, the applied one is not', () => {
    const deals = [
      { dealId: 'd20', label_ar: 'خصم 20% على كل المنيو', label_en: '20% off' },
      { dealId: 'dfree', label_ar: 'توصيل مجاني فوق 15,000 دينار', label_en: 'Free delivery over 15,000' },
    ];
    expect(otherDeals(deals, { promotionId: 'd20', funder: 'merchant' }).map((d) => d.dealId)).toEqual(['dfree']);
    expect(otherDeals(deals, null)).toEqual([]);
    expect(otherDeals(deals, { promotionId: 'p1', funder: 'platform' })).toEqual([]);
    expect(placeProblem('wallet_insufficient')).toBe('wallet_insufficient');
  });

  it('builds orders.place: catalog ids + menu prices, a diner per tagged person, line tags and notes', () => {
    const input = buildPlaceOrderInput({
      cart: twoPersonCart(),
      dropoff: ZAKUR,
      streetHandover: false,
      recipient: { kind: 'me' },
      scheduledFor: null,
      paymentMethod: 'cash',
      fees: { deliveryFeeIqd: 1000, serviceFeeIqd: 500 },
    });
    const parsed = PlaceOrderInput.parse(input);
    expect(parsed).toMatchObject({ cityId: 'aziziyah', type: 'food', merchantOrgId: 'org_1', deliveryFeeIqd: 1000, serviceFeeIqd: 500, tipIqd: 0, paymentMethod: 'cash', dropoff: ZAKUR, options: { streetHandover: false } });
    expect(parsed.participants).toEqual([{ ref: 'pp_sara', role: 'diner', label: 'سارة', phone: '+9647701234567' }]);
    expect(parsed.lines.map((l) => [l.catalogItemId, l.qty, l.unitPriceIqd, l.participantRef, l.note, l.merchantOrgId])).toEqual([
      [wrap.id, 2, 2000, undefined, undefined, 'org_1'],
      [kebabKilo.id, 1, 12000, 'pp_sara', 'بدون بصل', 'org_1'],
    ]);
    expect(parsed.lines[1]!.modifiers).toEqual([{ groupId: 'g_amount', modifierId: 'kilo', priceIqd: 11000 }]);
    expect(parsed.scheduledFor).toBeUndefined();
    expect(parsed.usePoints).toBeUndefined();
  });

  it('«استخدم نقاطك» (W-02): asks the server to use points and sends the value the quote showed', () => {
    const base = { cart: twoPersonCart(), dropoff: ZAKUR, streetHandover: false, recipient: { kind: 'me' as const }, scheduledFor: null, paymentMethod: 'cash' as const, fees: { deliveryFeeIqd: 1000, serviceFeeIqd: 500 } };
    expect(PlaceOrderInput.parse(buildPlaceOrderInput({ ...base, usePoints: true, pointsIqd: 1500 }))).toMatchObject({ usePoints: true, pointsIqd: 1500 });
    // Switched off: neither is sent (the server spends nothing).
    const off = PlaceOrderInput.parse(buildPlaceOrderInput({ ...base, usePoints: false, pointsIqd: 0 }));
    expect(off.usePoints).toBeUndefined();
    expect(off.pointsIqd).toBeUndefined();
  });

  it('joy w4: the household wallet only on a wallet order; «للسفرة» lines mark the family table', () => {
    const base = { cart: twoPersonCart(), dropoff: ZAKUR, streetHandover: false, recipient: { kind: 'me' as const }, scheduledFor: null, fees: { deliveryFeeIqd: 1000, serviceFeeIqd: 500 } };
    expect(PlaceOrderInput.parse(buildPlaceOrderInput({ ...base, paymentMethod: 'wallet', householdOrgId: 'org_home' }))).toMatchObject({ paymentMethod: 'wallet', householdOrgId: 'org_home' });
    expect(PlaceOrderInput.parse(buildPlaceOrderInput({ ...base, paymentMethod: 'cash', householdOrgId: 'org_home' })).householdOrgId).toBeUndefined();
    expect(PlaceOrderInput.parse(buildPlaceOrderInput({ ...base, paymentMethod: 'cash' })).familyTable).toBeUndefined();
    const cart = twoPersonCart();
    const table = { ...cart, lines: cart.lines.map((l, i) => (i === 0 ? { ...l, personId: TABLE } : l)) };
    expect(PlaceOrderInput.parse(buildPlaceOrderInput({ ...base, cart: table, paymentMethod: 'cash' })).familyTable).toBe(true);
  });

  it('recipient: a person on the order becomes the recipient; someone else is added with name + phone; schedule and street', () => {
    const at = new Date('2026-10-03T17:30:00Z');
    const toSara = PlaceOrderInput.parse(
      buildPlaceOrderInput({ cart: twoPersonCart(), dropoff: ZAKUR, streetHandover: true, recipient: { kind: 'person', personId: 'pp_sara' }, scheduledFor: at, paymentMethod: 'cash', fees: { deliveryFeeIqd: 750, serviceFeeIqd: 500 } }),
    );
    expect(toSara.participants).toEqual([{ ref: 'pp_sara', role: 'recipient', label: 'سارة', phone: '+9647701234567' }]);
    expect(toSara.scheduledFor).toEqual(at);
    expect(toSara.options).toEqual({ streetHandover: true });

    const other = PlaceOrderInput.parse(
      buildPlaceOrderInput({ cart: twoPersonCart(), dropoff: ZAKUR, streetHandover: false, recipient: { kind: 'other', name: ' أم علي ', phone: '+9647801112233' }, scheduledFor: null, paymentMethod: 'cash', fees: { deliveryFeeIqd: 1000, serviceFeeIqd: 500 } }),
    );
    expect(other.participants.map((p) => [p.ref, p.role, p.label, p.phone])).toEqual([
      ['pp_sara', 'diner', 'سارة', '+9647701234567'],
      ['recipient', 'recipient', 'أم علي', '+9647801112233'],
    ]);
  });

  it('kitchen and courier notes go apart (M-09); the attempt key rides along (no duplicate orders)', () => {
    const base = { cart: twoPersonCart(), dropoff: ZAKUR, streetHandover: false, recipient: { kind: 'me' as const }, scheduledFor: null, paymentMethod: 'cash' as const, fees: { deliveryFeeIqd: 1000, serviceFeeIqd: 500 } };
    const parsed = PlaceOrderInput.parse(buildPlaceOrderInput({ ...base, note: ' حار شوية ', courierNote: ' دگ الجرس مرتين ', clientRequestId: 'chk_abc_123456' }));
    expect(parsed).toMatchObject({ note: 'حار شوية', courierNote: 'دگ الجرس مرتين', clientRequestId: 'chk_abc_123456' });
    const bare = PlaceOrderInput.parse(buildPlaceOrderInput({ ...base, note: '  ', courierNote: '' }));
    expect(bare.note).toBeUndefined();
    expect(bare.courierNote).toBeUndefined();
    expect(bare.clientRequestId).toBeUndefined();
  });

  it('an empty cart cannot be built', () => {
    expect(() => buildPlaceOrderInput({ cart: EMPTY_CART, dropoff: ZAKUR, streetHandover: false, recipient: { kind: 'me' }, scheduledFor: null, paymentMethod: 'cash', fees: { deliveryFeeIqd: 0, serviceFeeIqd: 0 } })).toThrow();
  });
});

describe('"راح أدفع بـ …" ("الخردة علينا")', () => {
  it('keeps the chosen note only while it fits the cash total, never on a wallet order', () => {
    expect(validTender(25_000, 17_750, 'cash')).toBe(25_000);
    expect(validTender(17_750, 17_750, 'cash')).toBe(17_750);
    expect(validTender(20_000, 21_000, 'cash')).toBeNull();
    expect(validTender(25_000, 17_750, 'wallet')).toBeNull();
    expect(validTender(null, 17_750, 'cash')).toBeNull();
    expect(validTender(25_000, null, 'cash')).toBeNull();
    expect(placeProblem('tender_invalid')).toBe('tender_invalid');
  });

  it('sends it with a cash order (a valid place input), never with a wallet one', () => {
    const base = { cart: twoPersonCart(), dropoff: ZAKUR, streetHandover: false, recipient: { kind: 'me' as const }, scheduledFor: null, fees: { deliveryFeeIqd: 1000, serviceFeeIqd: 500 } };
    const cash = buildPlaceOrderInput({ ...base, paymentMethod: 'cash', statedTenderIqd: 25_000 });
    expect(cash.statedTenderIqd).toBe(25_000);
    expect(PlaceOrderInput.parse(cash).statedTenderIqd).toBe(25_000);
    expect(buildPlaceOrderInput({ ...base, paymentMethod: 'wallet', statedTenderIqd: 25_000 }).statedTenderIqd).toBeUndefined();
    expect(buildPlaceOrderInput({ ...base, paymentMethod: 'cash', statedTenderIqd: null }).statedTenderIqd).toBeUndefined();
  });
});

describe('checkout rules and helpers', () => {
  it('new-customer cash cap: first 3 completed cash orders capped at 25,000', () => {
    const done = [{ paymentMethod: 'cash' as const, state: 'closed' as const }, { paymentMethod: 'cash' as const, state: 'delivered' as const }, { paymentMethod: 'cash' as const, state: 'merchant_rejected' as const }];
    expect(priorCashOrders(done)).toBe(2);
    expect(overNewCustomerCap(25_000, 2, 'cash')).toBe(false);
    expect(overNewCustomerCap(25_250, 2, 'cash')).toBe(true);
    expect(overNewCustomerCap(40_000, 3, 'cash')).toBe(false);
    expect(overNewCustomerCap(40_000, 0, 'wallet')).toBe(false);
  });

  it('maps place errors to the checkout messages', () => {
    expect(placeProblem('price_changed')).toBe('price_changed');
    expect(placeProblem('catalog_item_unavailable')).toBe('catalog_item_unavailable');
    expect(placeProblem('new_customer_cash_cap')).toBe('new_customer_cash_cap');
    expect(placeProblem('whatever')).toBe('other');
    expect(placeProblem(null)).toBe('other');
  });

  it('slot labels: 12-hour on the city clock (slots themselves: slots.test.ts)', () => {
    // Labels are on the city's clock (UTC+3) with ص/م, whatever the phone's zone.
    expect(clock12(new Date('2026-10-03T16:00:00Z'))).toBe('7:00 م');
    expect(clock12(new Date('2026-10-02T21:05:00Z'))).toBe('12:05 ص');
  });

  it('similar open kitchens: shared tags first, never the one that said no', () => {
    const card = (id: string, tags: string[], open = true, eta = 30) => ({
      id,
      cityId: 'aziziyah',
      name: id,
      cuisine: '',
      tags,
      photoUrl: null,
      rating: null,
      pickup: { zoneKey: 'centre' },
      prepMinMinutes: 20,
      prepMaxMinutes: 30,
      etaMinMinutes: eta,
      etaMaxMinutes: eta + 10,
      deliveryFeeIqd: 1000,
      serviceFeeIqd: 500,
      minOrderIqd: 5000,
      open,
      closedReason: null,
      opensAt: null,
      busy: false,
    });
    const cards = [card('khalid', ['grill', 'kebab']), card('kareem', ['grill', 'kebab', 'chicken'], true, 35), card('sham', ['shawarma', 'chicken'], true, 20), card('musafir', ['grill'], false)];
    expect(similarOpenRestaurants({ id: 'khalid', tags: ['grill', 'kebab'] }, cards).map((c) => c.id)).toEqual(['kareem', 'sham']);
  });
});
