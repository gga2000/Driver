import { describe, expect, it } from 'vitest';
import { pointsChip } from './points-chip';

describe('header points chip (h9)', () => {
  it('shows the server balance with grouped Western digits', () => {
    expect(pointsChip(true, { points: 1250 })).toEqual({ points: 1250, text: '1,250' });
  });
  it('is hidden at zero, for guests and before the balance loads', () => {
    expect(pointsChip(true, { points: 0 })).toBeNull();
    expect(pointsChip(false, { points: 900 })).toBeNull();
    expect(pointsChip(true, undefined)).toBeNull();
  });
});
