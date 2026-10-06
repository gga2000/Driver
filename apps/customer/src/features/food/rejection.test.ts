import { describe, expect, it } from 'vitest';
import { carryLines, optionCopy, rejectionReason } from './rejection';

describe('rejectionReason (o15)', () => {
  it('the Merchant app codes, the timeout, and a kitchen’s own words', () => {
    expect(rejectionReason('too_busy')).toEqual({ key: 'kitchen.reason_busy' });
    expect(rejectionReason('sold_out')).toEqual({ key: 'kitchen.reason_sold_out' });
    expect(rejectionReason('merchant_timeout')).toEqual({ key: 'kitchen.reason_timeout' });
    expect(rejectionReason('other: الفحم خلص')).toEqual({ key: 'kitchen.reason_words', params: { words: 'الفحم خلص' } });
    expect(rejectionReason('المطبخ مزدحم')).toEqual({ key: 'kitchen.reason_words', params: { words: 'المطبخ مزدحم' } });
  });
  it('nothing for no reason or an unknown code', () => {
    expect(rejectionReason(null)).toBeNull();
    expect(rejectionReason('other: ')).toBeNull();
    expect(rejectionReason('some_new_code')).toBeNull();
  });
});

describe('carryLines and optionCopy', () => {
  it('sends names, quantities and choices', () => {
    expect(carryLines({ lines: [{ key: 'k', itemId: 'i', name: 'لفة تكة', basePriceIqd: 2500, qty: 2, note: null, personId: 'me', modifiers: [{ groupId: 'g', modifierId: 'm', name: 'صمون', priceIqd: 0 }] }] })).toEqual([{ name: 'لفة تكة', qty: 2, choices: ['صمون'] }]);
  });
  it('all, some or none of the dishes, with the server’s total', () => {
    const amount = (n: number) => n.toLocaleString('en-US');
    expect(optionCopy({ moved: 3, of: 3, totalIqd: 14750 }, amount)).toEqual({ key: 'kitchen.option_all', params: { total: '14,750' } });
    expect(optionCopy({ moved: 2, of: 3, totalIqd: 9000 }, amount)).toEqual({ key: 'kitchen.option_some', params: { n: 2, of: 3, total: '9,000' } });
    expect(optionCopy({ moved: 2, of: 3, totalIqd: null }, amount)).toEqual({ key: 'kitchen.option_some_no_total', params: { n: 2, of: 3 } });
    expect(optionCopy({ moved: 0, of: 3, totalIqd: null }, amount)).toEqual({ key: 'kitchen.option_none' });
  });
});
