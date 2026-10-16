import { describe, expect, it } from 'vitest';
import { sharedFee } from './kitchens';

const fees = (...xs: (number | null)[]) => xs.map((deliveryFeeIqd) => ({ deliveryFeeIqd }));

describe('sharedFee', () => {
  it('says the fee once when every open kitchen charges the same', () => {
    expect(sharedFee(fees(500, 500, 500))).toBe(500);
    expect(sharedFee(fees(0, 0))).toBe(0);
  });

  it('leaves it to each row when they differ, before a place is picked, or with nothing open', () => {
    expect(sharedFee(fees(500, 1000, 500))).toBeNull();
    expect(sharedFee(fees(500, null))).toBeNull();
    expect(sharedFee(fees(null, null))).toBeNull();
    expect(sharedFee([])).toBeNull();
  });
});
