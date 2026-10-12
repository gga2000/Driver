/**
 * The font stacks `tools/map-tiles/glyphs.py` writes, in their own tiny module so a map piece can name them without
 * pulling the whole Golden hour style into an app bundle (golden-style re-exports them).
 */
export const GOLDEN_FONTS = {
  regular: ['IBM Plex Sans Arabic Regular'],
  medium: ['IBM Plex Sans Arabic Medium'],
  bold: ['IBM Plex Sans Arabic Bold'],
} as const;
