import type { LandmarkCategory } from '@driver/contracts';

/**
 * A stroke glyph on the 24 × 24 grid, in the same shape language as `@driver/ui` icons (drawn for
 * round strokes of about 1.75 px, 2 px optical padding), so a landmark reads like the rest of the app.
 */
export type GlyphShape = { d: string } | { circle: readonly [cx: number, cy: number, r: number] } | { rect: readonly [x: number, y: number, w: number, h: number, r: number] };

/**
 * Landmark icons (maps program b3), one per category. They live here, not in `@driver/ui`, because the
 * Console (no React Native) draws them too. `garage` is the very `garage` icon of `@driver/ui` (both
 * packages' tests pin the same drawing); the rest are new: a domed mosque, a graduation cap, a shop
 * awning, a cross, a fuel pump, an arch bridge, and a ringed point for anything else.
 */
export const LANDMARK_GLYPHS: Readonly<Record<LandmarkCategory, readonly GlyphShape[]>> = {
  mosque: [{ d: 'M3.5 20.5h17' }, { d: 'M5.5 20.5V13h13v7.5' }, { d: 'M6.5 13a5.5 5.5 0 0 1 11 0' }, { d: 'M12 7.5V4.5' }, { d: 'M10.5 20.5v-3a1.5 1.5 0 0 1 3 0v3' }],
  school: [{ d: 'M2.5 9.5 12 5l9.5 4.5L12 14z' }, { d: 'M6.5 11.75v4c0 1.5 2.5 3 5.5 3s5.5-1.5 5.5-3v-4' }, { d: 'M21.5 9.5v5' }],
  market: [
    { d: 'M4 9.5 5.5 4.5h13L20 9.5' },
    { d: 'M4 9.5a2 2 0 0 0 4 0a2 2 0 0 0 4 0a2 2 0 0 0 4 0a2 2 0 0 0 4 0' },
    { d: 'M5 11.5v9h14v-9' },
    { d: 'M10 20.5v-5h4v5' },
  ],
  clinic: [{ rect: [4, 4, 16, 16, 3.5] }, { d: 'M12 8.25v7.5M8.25 12h7.5' }],
  fuel: [
    { d: 'M5 20.5V5.5A1.5 1.5 0 0 1 6.5 4h6A1.5 1.5 0 0 1 14 5.5v15' },
    { d: 'M3.5 20.5h12' },
    { rect: [7, 7, 5, 3.5, 0.75] },
    { d: 'M14 10h1.5a1.5 1.5 0 0 1 1.5 1.5v4.75a1.25 1.25 0 0 0 2.5 0V8.5L17.5 6' },
  ],
  bridge: [{ d: 'M2.5 9h19' }, { d: 'M4.5 9v11' }, { d: 'M19.5 9v11' }, { d: 'M4.5 20a7.5 7 0 0 1 15 0' }, { d: 'M9 9v4.6M12 9v4M15 9v4.6' }],
  garage: [{ d: 'M3 21V9l9-5 9 5v12' }, { d: 'M7 21v-8.5h10V21' }, { d: 'M7 16.5h10' }],
  other: [{ circle: [12, 12, 7] }, { circle: [12, 12, 2.25] }],
};

/** The glyph a landmark of this category is drawn with. */
export function landmarkGlyph(category: LandmarkCategory): readonly GlyphShape[] {
  return LANDMARK_GLYPHS[category];
}

/** A glyph as SVG markup for a 24-px viewBox (the Console's HTML markers); styling comes from the caller's CSS. */
export function glyphSvgMarkup(shapes: readonly GlyphShape[]): string {
  return shapes
    .map((s) => {
      if ('d' in s) return `<path d="${s.d}"/>`;
      if ('circle' in s) return `<circle cx="${s.circle[0]}" cy="${s.circle[1]}" r="${s.circle[2]}"/>`;
      const [x, y, w, h, r] = s.rect;
      return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}"/>`;
    })
    .join('');
}
