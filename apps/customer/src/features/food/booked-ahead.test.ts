import { describe, expect, it } from 'vitest';
import { isBookedAhead } from './booked-ahead';

const now = new Date('2026-10-08T09:00:00Z');
const later = new Date('2026-10-08T13:30:00Z');

describe('isBookedAhead (FOOD-02)', () => {
  it('is a placed order for later that the kitchen has not been shown', () => {
    expect(isBookedAhead({ state: 'placed', scheduledFor: later, merchantOfferedAt: null }, now)).toBe(true);
  });

  it('ends once the kitchen is shown it, or its time has come, or it moved on', () => {
    expect(isBookedAhead({ state: 'placed', scheduledFor: later, merchantOfferedAt: new Date('2026-10-08T13:00:00Z') }, now)).toBe(false);
    expect(isBookedAhead({ state: 'placed', scheduledFor: new Date('2026-10-08T08:59:00Z'), merchantOfferedAt: null }, now)).toBe(false);
    expect(isBookedAhead({ state: 'merchant_accepted', scheduledFor: later, merchantOfferedAt: null }, now)).toBe(false);
  });

  it('is never an order for now', () => {
    expect(isBookedAhead({ state: 'placed', scheduledFor: null, merchantOfferedAt: null }, now)).toBe(false);
  });
});
