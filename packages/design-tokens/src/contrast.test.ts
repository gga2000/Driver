import { describe, expect, it } from 'vitest';
import { contrastRatio } from './contrast.js';
import { contrastPairs, themes, type ThemeName } from './tokens.js';

describe('contrastRatio', () => {
  it('matches the WCAG reference values', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 5);
    expect(contrastRatio('#FFFFFF', '#FFFFFF')).toBeCloseTo(1, 5);
    // #767676 on white is the classic 4.54:1 boundary grey.
    expect(contrastRatio('#767676', '#FFFFFF')).toBeCloseTo(4.54, 2);
  });
});

describe.each(Object.keys(themes) as ThemeName[])('%s theme: WCAG AA for every text/background pair', (name) => {
  const theme = themes[name];
  it.each(contrastPairs.map((p) => [p.fg, p.bg, p] as const))('%s on %s', (_fg, _bg, pair) => {
    const ratio = contrastRatio(theme[pair.fg], theme[pair.bg]);
    const min = pair.large ? 3 : 4.5;
    if (ratio < min) {
      throw new Error(
        `${name}: ${pair.fg} ${theme[pair.fg]} on ${pair.bg} ${theme[pair.bg]} is ${ratio.toFixed(2)}:1 (< ${min}:1) — used for ${pair.use}`,
      );
    }
    expect(ratio).toBeGreaterThanOrEqual(min);
  });
});

describe('brand rules', () => {
  it('never puts white text on the brand orange (2.68:1 fails even large text)', () => {
    expect(contrastRatio('#FFFFFF', themes.light.accent)).toBeLessThan(3);
    expect(themes.light.onAccent).toBe('#1F1A14');
  });
  it('keeps the brand spec hexes for the light theme', () => {
    const l = themes.light;
    expect([l.bg, l.surface, l.text, l.textMuted, l.accent, l.accentTint, l.border]).toEqual([
      '#FBF6EE', '#FFFFFF', '#1F1A14', '#6B6157', '#E08A1E', '#FCEBD3', '#EADFCF',
    ]);
    expect([l.success, l.warning, l.danger, l.info]).toEqual(['#2F8F5B', '#C77700', '#C2412D', '#2F6FB0']);
  });
  it('both themes define the same keys', () => {
    expect(Object.keys(themes.dark).sort()).toEqual(Object.keys(themes.light).sort());
  });
});
