import { describe, expect, it } from 'vitest';
import { kindOfLabels, withKind } from './dish-kind.js';

describe('ticket kind in the labels column (k4/j6 override)', () => {
  it('reads, sets and clears the kind without touching the customer labels', () => {
    expect(kindOfLabels(['spicy'])).toBeNull();
    expect(kindOfLabels(['spicy', 'kind:cold_drink'])).toBe('cold_drink');
    expect(kindOfLabels(['kind:nonsense'])).toBeNull();
    expect(withKind(['spicy', 'kind:food'], 'sweet')).toEqual(['spicy', 'kind:sweet']);
    expect(withKind(['new', 'kind:food'], null)).toEqual(['new']);
  });
});
