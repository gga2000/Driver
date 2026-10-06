import { describe, expect, it } from 'vitest';
import { firstKindForOrder, firstMomentPlays, firstSeatId, firstSeenKey } from './firsts';

describe('«أول مرة» (g8)', () => {
  it('knows which first an order is from the server', () => {
    const firsts = { foodOrderId: 'o1', tuktukOrderId: 'o7' };
    expect(firstKindForOrder('o1', firsts)).toBe('food');
    expect(firstKindForOrder('o7', firsts)).toBe('tuktuk');
    expect(firstKindForOrder('o2', firsts)).toBeNull();
    expect(firstKindForOrder('o1', undefined)).toBeNull();
  });

  it('the first seat is the earliest booking that became a real seat', () => {
    const at = (h: number) => new Date(`2026-10-06T${String(h).padStart(2, '0')}:00:00Z`);
    expect(
      firstSeatId([
        { id: 'b3', state: 'booked', createdAt: at(9) },
        { id: 'b1', state: 'expired', createdAt: at(6) },
        { id: 'b2', state: 'completed', createdAt: at(7) },
      ]),
    ).toBe('b2');
    expect(firstSeatId([{ id: 'h', state: 'held', createdAt: at(6) }])).toBeNull();
  });

  it('plays once, and never on a quiet day', () => {
    expect(firstMomentPlays({ kind: 'food', seen: false, celebrations: true })).toBe(true);
    expect(firstMomentPlays({ kind: 'food', seen: true, celebrations: true })).toBe(false);
    expect(firstMomentPlays({ kind: 'rajaa', seen: false, celebrations: false })).toBe(false);
    expect(firstMomentPlays({ kind: null, seen: false, celebrations: true })).toBe(false);
    expect(firstSeenKey('tuktuk')).toBe('driver.customer.first.tuktuk');
  });
});
