import { describe, expect, it } from 'vitest';
import { DOCUMENT_LONG_SIDE_PX, fitLongSide, PHOTO_LONG_SIDE_PX } from './photo-size';

describe('photo resize before upload (speed d3)', () => {
  it('shrinks the long side of a big photo and leaves small ones alone', () => {
    expect(fitLongSide(4032, 3024)).toEqual({ width: PHOTO_LONG_SIDE_PX });
    expect(fitLongSide(3024, 4032)).toEqual({ height: PHOTO_LONG_SIDE_PX });
    expect(fitLongSide(1000, 800)).toBeNull();
    expect(fitLongSide(0, 0)).toBeNull();
  });

  it('keeps documents larger', () => {
    expect(fitLongSide(4032, 3024, DOCUMENT_LONG_SIDE_PX)).toEqual({ width: 1600 });
    expect(fitLongSide(1500, 1000, DOCUMENT_LONG_SIDE_PX)).toBeNull();
  });
});
