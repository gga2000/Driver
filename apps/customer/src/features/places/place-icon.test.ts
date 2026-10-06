import { describe, expect, it } from 'vitest';
import { placeIcon } from './place-icon';

describe('place icons (A-06)', () => {
  it('work is a briefcase, never the food bag', () => {
    expect(placeIcon('work')).toBe('briefcase');
    expect(placeIcon('home')).toBe('home');
    expect(placeIcon('family')).toBe('user');
    expect(placeIcon('other')).toBe('map-pin');
    expect(placeIcon('custom')).toBe('map-pin');
  });
});
