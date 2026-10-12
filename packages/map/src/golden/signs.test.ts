import { describe, expect, it } from 'vitest';
import { buildGoldenStyle, goldenImages } from './golden-style.js';
import { flattenPath, SIGN_COLOURS, SIGN_KINDS, signImage, signImageId } from './signs.js';

describe('signposts', () => {
  it('draws every kind as a pin: solid in the middle of the head, clear in the corners, in its own colour', () => {
    for (const k of SIGN_KINDS) {
      const img = signImage(k);
      expect(img.data.length).toBe(img.width * img.height * 4);
      const px = (x: number, y: number) => Array.from(img.data.subarray((y * img.width + x) * 4, (y * img.width + x) * 4 + 4));
      expect(px(0, 0)[3]).toBe(0);
      expect(px(img.width - 1, 0)[3]).toBe(0);
      // just inside the rim on the left of the head: the kind's colour, opaque
      const [r, g, b, a] = px(Math.round(img.width / 2 - 11 * 2), 17 * 2);
      expect(a).toBe(255);
      const want = [1, 3, 5].map((i) => parseInt(SIGN_COLOURS[k].slice(i, i + 2), 16));
      expect(Math.abs(r! - want[0]!) + Math.abs(g! - want[1]!) + Math.abs(b! - want[2]!)).toBeLessThan(12);
      // the glyph puts cream inside the head
      let cream = 0;
      for (let y = 8; y < 60; y++) for (let x = 12; x < 60; x++) { const p = px(x, y); if (p[0]! > 230 && p[1]! > 210) cream++; }
      expect(cream).toBeGreaterThan(40);
    }
  });

  it('reads the icon paths, arcs and curves included', () => {
    const [semi] = flattenPath('M6 20.5v-5a6 6 0 0 1 12 0v5');
    expect(semi![0]).toEqual([6, 20.5]);
    const top = Math.min(...semi!.map((p) => p[1]));
    expect(top).toBeCloseTo(9.5, 1);
    expect(semi!.at(-1)![0]).toBeCloseTo(18, 5);
    expect(semi!.at(-1)![1]).toBeCloseTo(20.5, 5);
  });

  it('registers the signs with the map images and draws them from the places layer', () => {
    for (const light of ['day', 'night'] as const) {
      const imgs = goldenImages(light);
      for (const k of SIGN_KINDS) expect(imgs[signImageId(k)]).toBeDefined();
      const style = buildGoldenStyle({ pmtilesUrl: 'pmtiles://x', glyphs: 'g/{fontstack}/{range}', light });
      const ids = style.layers.map((l) => l.id);
      expect(ids).toContain('golden-signposts');
      expect(ids.indexOf('golden-area-names')).toBeGreaterThan(ids.indexOf('golden-roofs'));
      expect(ids.indexOf('golden-area-names')).toBeLessThan(ids.indexOf('golden-houses-3d'));
    }
  });
});
