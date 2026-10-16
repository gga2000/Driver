import { describe, expect, it } from 'vitest';
import type { Order } from '@driver/contracts';
import { missingWords, partialAsk, secondsKey, secondsLeft } from './partial';

const line = (id: string, over: Partial<Order['lines'][number]> = {}): Order['lines'][number] => ({ id, catalogItemId: `item_${id}`, freeText: null, qty: 1, unitPriceIqd: 1500, modifiers: [], participantId: null, note: null, pointsEligible: true, availability: 'available', ...over });
const at = new Date('2026-10-08T12:00:00Z');
const order = (partial: Order['partial'], state: Order['state'] = 'placed') => ({ state, partial, totalIqd: 13_000, lines: [line('a'), line('b', { availability: 'unavailable', qty: 2 }), line('c', { catalogItemId: null, freeText: 'خبز زيادة', availability: 'unavailable' })] });
const proposal = (ids: string[]): Order['partial'] => ({ unavailableLineIds: ids, proposedAt: at, deadline: new Date(at.getTime() + 60_000), reducedItemsTotalIqd: 10_000, reducedTotalIqd: 11_500 });
const cart = { lines: [{ key: 'k', itemId: 'item_b', name: 'بيبسي', basePriceIqd: 750, modifiers: [], qty: 2, note: null, personId: 'ME' }] };

describe('BENCH-03: the kitchen asks whether to send the rest', () => {
  it('names the missing dishes from his cart, or the order’s own words', () => {
    const ask = partialAsk(order(proposal(['b', 'c'])), cart)!;
    expect(ask.missing).toEqual([
      { id: 'b', name: 'بيبسي', qty: 2 },
      { id: 'c', name: 'خبز زيادة', qty: 1 },
    ]);
    expect(ask.reducedTotalIqd).toBe(11_500);
    expect(missingWords(ask)).toBe('بيبسي وخبز زيادة');
    expect(missingWords(partialAsk(order(proposal(['b'])), null)!)).toBeNull();
  });

  it('only while the order waits and the kitchen asked', () => {
    expect(partialAsk(order(null), cart)).toBeNull();
    expect(partialAsk(order(proposal(['b']), 'merchant_accepted'), cart)).toBeNull();
  });

  it('counts down whole seconds and stops at 0', () => {
    const deadline = new Date(at.getTime() + 60_000);
    expect(secondsLeft(deadline, at.getTime())).toBe(60);
    expect(secondsLeft(deadline, at.getTime() + 59_100)).toBe(1);
    expect(secondsLeft(deadline, at.getTime() + 61_000)).toBe(0);
    expect([1, 2, 5, 10, 11, 45].map(secondsKey)).toEqual(['kitchen.partial_left_one', 'kitchen.partial_left_two', 'kitchen.partial_left_few', 'kitchen.partial_left_few', 'kitchen.partial_left', 'kitchen.partial_left']);
  });
});
