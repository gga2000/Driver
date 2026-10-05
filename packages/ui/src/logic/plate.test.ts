import { describe, expect, it } from 'vitest';
import { splitPlate } from './plate';

describe('splitPlate (Iraqi plates)', () => {
  it('splits the governorate from the number whichever side it is written', () => {
    expect(splitPlate('واسط 45678')).toEqual({ number: '45678', region: 'واسط' });
    expect(splitPlate('12345 بغداد')).toEqual({ number: '12345', region: 'بغداد' });
  });
  it('keeps a one-letter series with the number', () => {
    expect(splitPlate('أ 45678 واسط')).toEqual({ number: 'أ 45678', region: 'واسط' });
  });
  it('leaves Latin plates and plates without a governorate whole', () => {
    expect(splitPlate('ABC-123')).toEqual({ number: 'ABC-123', region: null });
    expect(splitPlate('  77 1234 ')).toEqual({ number: '77 1234', region: null });
    expect(splitPlate('بغداد')).toEqual({ number: 'بغداد', region: null });
  });
});
