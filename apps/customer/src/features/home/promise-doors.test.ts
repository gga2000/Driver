import { describe, expect, it } from 'vitest';
import { liveDoors } from './promise-doors';

describe('«وعدنا هم» doors', () => {
  it('shows طرود once it has opened, and the carts card only while a cart is open', () => {
    expect(liveDoors({ parcel: true, carts: null })).toEqual(['parcel']);
    expect(liveDoors({ parcel: true, carts: { launched: true, open: 3 } })).toEqual(['carts', 'parcel']);
    expect(liveDoors({ parcel: false, carts: { launched: true, open: 1 } })).toEqual(['carts']);
  });

  it('shows nothing while nothing is open: carts not launched, or every cart closed', () => {
    expect(liveDoors({ parcel: false, carts: null })).toEqual([]);
    expect(liveDoors({ parcel: false, carts: { launched: false, open: 0 } })).toEqual([]);
    expect(liveDoors({ parcel: false, carts: { launched: true, open: 0 } })).toEqual([]);
  });
});
