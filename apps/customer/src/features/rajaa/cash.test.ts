import { describe, expect, it } from 'vitest';
import { cashPhase } from './cash';

describe('cashPhase (step 4b a6)', () => {
  it('off, or a wallet that covers the deposit, shows nothing', () => {
    expect(cashPhase(false, { cash: null }, 0, 6_000)).toBe('none');
    expect(cashPhase(false, { cash: 'accepted' }, 0, 6_000)).toBe('none');
    expect(cashPhase(true, { cash: null }, 6_000, 6_000)).toBe('none');
  });

  it('a short or unknown wallet offers the ask; the driver\'s answer then stands', () => {
    expect(cashPhase(true, { cash: null }, 5_999, 6_000)).toBe('ask');
    expect(cashPhase(true, { cash: null }, null, 6_000)).toBe('ask');
    expect(cashPhase(true, { cash: 'asked' }, 50_000, 6_000)).toBe('asked');
    expect(cashPhase(true, { cash: 'accepted' }, 50_000, 6_000)).toBe('accepted');
    expect(cashPhase(true, { cash: 'declined' }, 0, 6_000)).toBe('declined');
  });

  it('a rider who still owes is told so first', () => {
    expect(cashPhase(true, { cash: null }, -5_000, 6_000)).toBe('owed');
    expect(cashPhase(true, { cash: 'accepted' }, -1, 6_000)).toBe('owed');
  });
});
