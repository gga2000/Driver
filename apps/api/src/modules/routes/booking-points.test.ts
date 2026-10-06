import { describe, expect, it } from 'vitest';
import { bookingPoints } from './wallet.js';

describe('bookingPoints (joy r2: «+n نقطة» on the safe-arrival card)', () => {
  const ev = (postingGroupId: string, amount: number, toAccount = 'points:r1', kind: 'points' | 'money' = 'points') => ({ kind, toAccount, postingGroupId, amount });

  it("sums the points posted to the rider under this booking's seats only", () => {
    const events = [ev('seat:bk_1.front:points', 6), ev('seat:bk_1.back_left:points', 5), ev('seat:bk_2.front:points', 9), ev('seat:bk_1.front:money', 500, 'points:r1', 'money'), ev('seat:bk_1.front:points', 3, 'points:r9')];
    expect(bookingPoints(events, 'r1', 'bk_1')).toBe(11);
  });

  it('is null until the ledger posted them', () => {
    expect(bookingPoints([ev('seat:bk_2.front:points', 9)], 'r1', 'bk_1')).toBeNull();
  });
});
