import { describe, expect, it } from 'vitest';
import { EMPTY_CART, ME, TABLE, addLine, groupByPerson, type CartMerchant, type CartState } from './cart';
import { buildPlaceOrderInput } from './checkout';
import { defaultPersonFor, isFamilyOrder, personChips } from './family';

const KHALID: CartMerchant = { id: 'org_1', name: 'مطعم خالد', cityId: 'aziziyah', pickup: { zoneKey: 'street_30' }, minOrderIqd: 5000 };
const household = [
  { personId: 'p_me', name: 'أم علي', isMe: true },
  { personId: 'p_manar', name: 'منار', isMe: false },
  { personId: 'p_husain', name: 'حسين', isMe: false },
];

describe('personChips: «لمنو؟» offers the household (o5)', () => {
  it('the table, me, the household by name, then people used before — no doubles', () => {
    const chips = personChips({ household, saved: [{ id: 'pp_1', name: 'منار', phone: null }, { id: 'pp_2', name: 'سارة', phone: '+9647701234567' }], family: true });
    expect(chips.map((c) => (c.kind === 'table' || c.kind === 'me' ? c.kind : `${c.kind}:${c.name}`))).toEqual(['table', 'me', 'person:منار', 'household:حسين', 'person:سارة']);
    expect(chips[3]).toMatchObject({ id: 'hh_p_husain' });
  });
  it('no «للسفرة» outside family mode', () => {
    expect(personChips({ household: [], saved: [], family: false }).map((c) => c.kind)).toEqual(['me']);
  });
});

describe('family mode and the dish’s starting person', () => {
  it('a household with others, people on the cart, or shared dishes', () => {
    expect(isFamilyOrder({ household: [household[0]!], cartPeople: 0, tableLines: 0 })).toBe(false);
    expect(isFamilyOrder({ household, cartPeople: 0, tableLines: 0 })).toBe(true);
    expect(isFamilyOrder({ household: [], cartPeople: 1, tableLines: 0 })).toBe(true);
  });
  it('a dish for two or more starts on «للسفرة» in a family order', () => {
    expect(defaultPersonFor({ min: 2, max: 3 }, true)).toBe(TABLE);
    expect(defaultPersonFor({ min: 1, max: 1 }, true)).toBe(ME);
    expect(defaultPersonFor({ min: 4, max: 5 }, false)).toBe(ME);
    expect(defaultPersonFor(null, true)).toBe(ME);
  });
});

describe('«للسفرة» in the cart and the order', () => {
  let cart: CartState = EMPTY_CART;
  const sara = { id: 'pp_2', name: 'سارة', phone: '+9647701234567' };
  for (const [itemId, personId] of [
    ['wrap', sara.id],
    ['soup', ME],
    ['kilo', TABLE],
  ] as const) {
    const r = addLine(cart, KHALID, { itemId, name: itemId, basePriceIqd: 1000, modifiers: [], qty: 1, note: null, personId }, personId === sara.id ? { person: sara } : {});
    if (r.ok) cart = r.cart;
  }
  it('the table group comes first', () => {
    expect(groupByPerson(cart).groups.map((g) => g.personId)).toEqual([TABLE, ME, sara.id]);
  });
  it('table lines go untagged (the organiser’s points); people keep their tag', () => {
    const input = buildPlaceOrderInput({ cart, dropoff: { zoneKey: 'centre' }, streetHandover: false, recipient: { kind: 'me' }, scheduledFor: null, paymentMethod: 'cash', fees: { deliveryFeeIqd: 1000, serviceFeeIqd: 500 } });
    expect(input.lines?.map((l) => l.participantRef ?? null)).toEqual([sara.id, null, null]);
    expect(input.participants?.map((p) => p.ref)).toEqual([sara.id]);
  });
});
