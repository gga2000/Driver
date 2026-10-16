import { describe, expect, it } from 'vitest';
import { scaleText } from './text-scale';

describe('scaleText (courier n6 text size)', () => {
  const body = { fontSize: 16, lineHeight: 24 };

  it('changes nothing at the normal size', () => {
    expect(scaleText(body, 1, false, 1.3)).toEqual({ fontSize: 16, lineHeight: 24, maxFontSizeMultiplier: undefined });
    expect(scaleText(body, 1, true, 1.3)).toEqual({ fontSize: 16, lineHeight: 24, maxFontSizeMultiplier: 1.3 });
  });

  it('grows size and line height together, so lines never clip', () => {
    expect(scaleText(body, 1.15, false, 1.3)).toEqual({ fontSize: 18.5, lineHeight: 27.5, maxFontSizeMultiplier: undefined });
    expect(scaleText(body, 1.3, false, 1.3)).toEqual({ fontSize: 21, lineHeight: 31, maxFontSizeMultiplier: undefined });
  });

  it('keeps a compact label within its cap: the phone gets only what is left', () => {
    const large = scaleText(body, 1.15, true, 1.3);
    expect(large.fontSize).toBe(18.5);
    expect(large.maxFontSizeMultiplier).toBeCloseTo(1.3 / 1.15);
    const largest = scaleText(body, 1.3, true, 1.3);
    expect(largest.maxFontSizeMultiplier).toBe(1);
    expect(scaleText(body, 1.5, true, 1.3).fontSize).toBe(21);
  });
});
