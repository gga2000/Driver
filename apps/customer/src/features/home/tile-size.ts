import { fontScale as fontCaps } from '@driver/design-tokens';

/**
 * The service tiles hold a name and a fact at a fixed height. With the phone's large-text setting
 * (React Native's `fontScale`) they grow taller by what those two lines grow, up to the compact cap
 * (1.3×). Past the cap the tile text stops growing too (it is `compact`), and a long fact shrinks to
 * fit its width instead of being cut. The web reports a scale of 1, so the tiles keep their size there.
 */
export function tileTextGrowth(scale: number): number {
  if (!Number.isFinite(scale) || scale <= 1) return 1;
  return Math.min(scale, fontCaps.compact);
}

/** A tile's height for this text scale: `base` plus the growth of the text lines it stacks. */
export function grownTileHeight(base: number, lineHeights: readonly number[], scale: number): number {
  const lines = lineHeights.reduce((sum, h) => sum + h, 0);
  return Math.ceil(base + lines * (tileTextGrowth(scale) - 1));
}
