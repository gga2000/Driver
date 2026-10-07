import { describe, expect, it } from 'vitest';
import { fontScale } from '@driver/design-tokens';
import { grownTileHeight, tileTextGrowth } from './tile-size';

describe('service tiles with the large-text setting', () => {
  it('keeps the drawn size at normal text (and on the web, which reports 1)', () => {
    expect(tileTextGrowth(1)).toBe(1);
    expect(tileTextGrowth(0.85)).toBe(1);
    expect(tileTextGrowth(Number.NaN)).toBe(1);
    expect(grownTileHeight(96, [30, 22], 1)).toBe(96);
  });

  it('grows by what the name and fact lines grow', () => {
    expect(grownTileHeight(96, [30, 22], 1.15)).toBe(Math.ceil(96 + 52 * 0.15));
    // Android's largest setting: a 96 px tile with a title and a footnote line needs 112.
    expect(grownTileHeight(96, [30, 22], 1.3)).toBe(112);
  });

  it('stops at the compact cap, where the tile text stops growing too', () => {
    expect(tileTextGrowth(2)).toBe(fontScale.compact);
    expect(grownTileHeight(84, [30, 22], 3.1)).toBe(grownTileHeight(84, [30, 22], fontScale.compact));
  });
});
