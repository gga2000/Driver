import { describe, expect, it } from 'vitest';
import { giftNote } from './gift';

describe('«عزيمة» on the job card (joy g1)', () => {
  it('nothing for an ordinary order', () => {
    expect(giftNote({ type: 'dropoff' })).toBeNull();
    expect(giftNote({ type: 'dropoff', gift: null })).toBeNull();
  });

  it('at the door: «هدية · لا تذكر السعر» when hidden, plain «هدية» otherwise', () => {
    expect(giftNote({ type: 'dropoff', gift: { hidePrices: true } })).toEqual({ key: 'partner.gift_hidden', hint: 'partner.gift_hidden_hint', hidden: true });
    expect(giftNote({ type: 'dropoff', gift: { hidePrices: false } })).toEqual({ key: 'partner.gift', hint: null, hidden: false });
  });

  it('at the kitchen only when prices are hidden: keep the receipt out of the bag', () => {
    expect(giftNote({ type: 'pickup', gift: { hidePrices: true } })?.key).toBe('partner.gift_pickup_hidden');
    expect(giftNote({ type: 'pickup', gift: { hidePrices: false } })).toBeNull();
  });
});
