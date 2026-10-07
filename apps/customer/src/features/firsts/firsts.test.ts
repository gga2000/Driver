import { describe, expect, it } from 'vitest';
import { firstKindForOrder, firstMomentPlays, firstSeatId, firstSeenKey, rideStickerFor } from './firsts';

describe('«أول مرة» (g8)', () => {
  it('knows which first an order is from the server', () => {
    const firsts = { foodOrderId: 'o1', tuktukOrderId: 'o7', nightRideOrderId: null, rideMilestone: null };
    expect(firstKindForOrder('o1', firsts)).toBe('food');
    expect(firstKindForOrder('o7', firsts)).toBe('tuktuk');
    expect(firstKindForOrder('o2', firsts)).toBeNull();
    expect(firstKindForOrder('o1', undefined)).toBeNull();
  });

  it('g2: the first night ride and the milestone rides get a sticker; a milestone wins on the same ride', () => {
    const none = { foodOrderId: null, tuktukOrderId: null };
    expect(rideStickerFor('r1', { ...none, nightRideOrderId: 'r1', rideMilestone: null })).toEqual({ kind: 'night', stickerId: 'wasalt' });
    expect(rideStickerFor('r10', { ...none, nightRideOrderId: 'r1', rideMilestone: { orderId: 'r10', count: 10 } })).toEqual({ kind: 'milestone', count: 10, stickerId: 'jay' });
    expect(rideStickerFor('r10', { ...none, nightRideOrderId: 'r10', rideMilestone: { orderId: 'r10', count: 10 } })?.kind).toBe('milestone');
    expect(rideStickerFor('r2', { ...none, nightRideOrderId: 'r1', rideMilestone: null })).toBeNull();
    expect(rideStickerFor('r1', undefined)).toBeNull();
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
