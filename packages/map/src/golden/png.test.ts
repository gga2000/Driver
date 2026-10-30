import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { goldenImages } from './golden-style.js';
import { patternPng, patternPngDataUri } from './png.js';

describe('pattern PNG for the phones', () => {
  it('writes a PNG whose pixels are the pattern', () => {
    for (const img of Object.values(goldenImages('golden'))) {
      const png = patternPng(img);
      expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
      const view = new DataView(png.buffer);
      expect(view.getUint32(16)).toBe(img.width);
      expect(view.getUint32(20)).toBe(img.height);
      // IDAT starts after the 8-byte signature and the 25-byte IHDR chunk.
      const len = view.getUint32(33);
      const raw = inflateSync(png.subarray(41, 41 + len));
      const row = img.width * 4 + 1;
      for (let y = 0; y < img.height; y++) expect(Buffer.from(raw.subarray(y * row + 1, (y + 1) * row)).equals(Buffer.from(img.data.subarray(y * img.width * 4, (y + 1) * img.width * 4)))).toBe(true);
    }
  });

  it('gives a data URI MapLibre Native can load', () => {
    const uri = patternPngDataUri({ width: 1, height: 1, data: new Uint8Array([224, 138, 30, 255]) });
    expect(uri.startsWith('data:image/png;base64,iVBORw0KGgo')).toBe(true);
    expect(Buffer.from(uri.split(',')[1]!, 'base64').length).toBeGreaterThan(40);
  });
});
