import { describe, expect, it } from 'vitest';
import { fitLongSide } from './photo-size';

describe('fitLongSide', () => {
  it('brings a landscape camera photo down to 1280 wide', () => expect(fitLongSide(4032, 3024)).toEqual({ width: 1280 }));
  it('brings a portrait photo down to 1280 tall', () => expect(fitLongSide(3024, 4032)).toEqual({ height: 1280 }));
  it('leaves a small photo alone', () => expect(fitLongSide(1200, 900)).toBeNull());
  it('leaves a photo of unknown size alone', () => expect(fitLongSide(0, 0)).toBeNull());
});
