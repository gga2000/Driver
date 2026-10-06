import { describe, expect, it } from 'vitest';
import { earnCopy, payCopy, payerOf, paymentOf, receiverHint } from './checkout-lines';

describe('earnCopy (o7): the server’s points estimate in words', () => {
  it('solo and group orders', () => {
    expect(earnCopy(27, false)).toEqual({ key: 'checkout.earn', params: { n: 27 } });
    expect(earnCopy(27, true)).toEqual({ key: 'checkout.earn_shared', params: { n: 27 } });
  });
  it('nothing when it earns none or the quote has not come', () => {
    expect(earnCopy(0, false)).toBeNull();
    expect(earnCopy(undefined, false)).toBeNull();
  });
});

describe('payCopy (o9): one line under the button', () => {
  it('cash for me, cash for someone else, wallet', () => {
    expect(payCopy('7,250', 'cash', { kind: 'me' })).toEqual({ key: 'checkout.pay_line_cash', params: { amount: '7,250' } });
    expect(payCopy('7,250', 'cash', { kind: 'other', name: 'أبو علي' })).toEqual({ key: 'checkout.pay_line_cash_them', params: { amount: '7,250', name: 'أبو علي' } });
    expect(payCopy('7,250', 'wallet', { kind: 'other', name: 'أبو علي' })).toEqual({ key: 'checkout.pay_line_wallet', params: { amount: '7,250' } });
  });
});

describe('who pays (o12) maps onto the existing payment methods', () => {
  it('they pay cash, or I pay from my wallet', () => {
    expect(paymentOf('them_cash')).toBe('cash');
    expect(paymentOf('me_wallet')).toBe('wallet');
    expect(payerOf('cash')).toBe('them_cash');
    expect(payerOf('wallet')).toBe('me_wallet');
  });
  it('says what the courier asks the receiver', () => {
    expect(receiverHint('أبو علي', 'wallet')).toEqual({ key: 'checkout.receiver_paid_hint', params: { name: 'أبو علي' } });
    expect(receiverHint('أبو علي', 'cash')).toEqual({ key: 'checkout.receiver_cash_hint', params: { name: 'أبو علي' } });
  });
});
