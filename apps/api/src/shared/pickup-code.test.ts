import { describe, expect, it } from 'vitest';
import { pickupCode, pickupCodeFor } from './pickup-code.js';

describe('pickupCode (maps program r4)', () => {
  it('four digits, the same for the same order and courier, different for another courier', () => {
    const a = pickupCode('ord_1', 'courier_a', 's');
    expect(a).toMatch(/^\d{4}$/);
    expect(pickupCode('ord_1', 'courier_a', 's')).toBe(a);
    const others = new Set(Array.from({ length: 20 }, (_, i) => pickupCode('ord_1', `courier_${i}`, 's')));
    expect(others.size).toBeGreaterThan(15);
    expect(pickupCode('ord_1', 'courier_a', 'other')).not.toBe(a);
    expect(pickupCodeFor('ord_1', 'courier_a')).toBe(pickupCodeFor('ord_1', 'courier_a'));
  });
});
