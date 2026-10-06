import { describe, expect, it } from 'vitest';
import { REVEAL_EDGE_PX, revealOffset } from './reveal';

describe('revealOffset', () => {
  const viewport = { top: 100, height: 600 };

  it('leaves a row that is already fully in view where it is', () => {
    expect(revealOffset({ top: 100, height: 64 }, viewport, 0)).toBeNull();
    expect(revealOffset({ top: 636, height: 64 }, viewport, 250)).toBeNull();
  });

  it('centres a row below the fold', () => {
    // Row at window y 900 with the page scrolled 200: 1000 px down the content; centred → 1000 - 268.
    expect(revealOffset({ top: 900, height: 64 }, viewport, 200)).toBe(732);
  });

  it('centres a row above the visible area', () => {
    expect(revealOffset({ top: 40, height: 64 }, viewport, 500)).toBe(500 + 40 - 100 - 268);
  });

  it('a row cut by the bottom edge counts as hidden', () => {
    expect(revealOffset({ top: 680, height: 64 }, viewport, 0)).toBe(680 - 100 - 268);
  });

  it('puts the top of a row taller than the area just under the top edge', () => {
    expect(revealOffset({ top: 900, height: 800 }, viewport, 0)).toBe(900 - 100 - REVEAL_EDGE_PX);
  });

  it('never scrolls above the top of the page', () => {
    expect(revealOffset({ top: -20, height: 64 }, viewport, 0)).toBe(0);
  });
});
