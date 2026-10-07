import { describe, expect, it } from 'vitest';
import { contrastRatio } from './contrast.js';
import { contrastPairs, minFontSize, nonTextPairs, services, themes, type, type ThemeName } from './tokens.js';

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

describe.each(Object.keys(themes) as ThemeName[])('%s theme: 3:1 for every boundary, focus and selected-state cue (WCAG 1.4.11)', (name) => {
  const theme = themes[name];
  it.each(nonTextPairs.filter((p) => !p.only || p.only.includes(name)).map((p) => [p.fg, p.bg, p] as const))('%s against %s', (_fg, _bg, pair) => {
    const ratio = contrastRatio(theme[pair.fg], theme[pair.bg]);
    if (ratio < 3) {
      throw new Error(`${name}: ${pair.fg} ${theme[pair.fg]} against ${pair.bg} ${theme[pair.bg]} is ${ratio.toFixed(2)}:1 (< 3:1) — used for ${pair.use}`);
    }
    expect(ratio).toBeGreaterThanOrEqual(3);
  });
});

describe.each(Object.keys(services) as ThemeName[])('%s theme: the home service tiles read (Date & Saffron)', (name) => {
  const p = services[name];
  const fills = (k: keyof typeof p): string[] => {
    const s = p[k];
    return 'mesh' in s ? [s.fill, ...s.mesh] : [s.fill];
  };
  it.each(Object.keys(p) as (keyof typeof p)[])('%s: its title and live fact pass AA on every stop of the fill', (k) => {
    for (const fill of fills(k)) {
      const ratio = contrastRatio(p[k].on, fill);
      if (ratio < 4.5) throw new Error(`${name}: ${k} ${p[k].on} on ${fill} is ${ratio.toFixed(2)}:1 (< 4.5:1)`);
      expect(ratio).toBeGreaterThanOrEqual(4.5);
    }
  });
  it('the tuktuk is not the error red, and no two services share a fill', () => {
    expect(p.tuktuk.fill).not.toBe(themes[name].danger);
    const all = [p.food.fill, p.taxi.fill, p.tuktuk.fill, p.trips.fill, p.back.fill];
    expect(new Set(all).size).toBe(all.length);
  });
});

describe('warning is not the brand (joy S2-02)', () => {
  it('the warning tint and the accent tint are different colours, and the late banner is ink, not a tint', () => {
    expect(themes.light.warningTint).not.toBe(themes.light.accentTint);
    expect(themes.light.warning).not.toBe(themes.light.accent);
    expect(themes.light.inverse).toBe(themes.light.text);
    expect(contrastRatio(themes.light.onInverseCaution, themes.light.inverse)).toBeGreaterThan(7);
  });
});

describe('type floor', () => {
  it('no text style is under 12 px (audit S-10)', () => {
    for (const [k, v] of Object.entries(type)) expect(v.size, k).toBeGreaterThanOrEqual(minFontSize);
  });
});

describe('brand rules', () => {
  it('never puts white text on the brand orange (2.68:1 fails even large text)', () => {
    expect(contrastRatio('#FFFFFF', themes.light.accent)).toBeLessThan(3);
    expect(themes.light.onAccent).toBe('#1F1A14');
  });
  it('field borders at rest are neutral 500 (audit S-04): 3.63:1 on cream, 3.90:1 on white', () => {
    expect(themes.light.borderStrong).toBe('#8C7F6F');
    expect(contrastRatio(themes.light.borderStrong, themes.light.bg)).toBeGreaterThan(3.6);
  });
  it('keeps the brand spec hexes for the light theme', () => {
    const l = themes.light;
    expect([l.bg, l.surface, l.text, l.textMuted, l.accent, l.accentTint, l.border]).toEqual([
      '#FBF6EE', '#FFFFFF', '#1F1A14', '#6B6157', '#E08A1E', '#FCEBD3', '#EADFCF',
    ]);
    // Warning moved off the brand hue to mustard (joy S2-02, 2026-10-06).
    expect([l.success, l.warning, l.danger, l.info]).toEqual(['#2F8F5B', '#B07F00', '#C2412D', '#2F6FB0']);
  });
  it('both themes define the same keys', () => {
    expect(Object.keys(themes.dark).sort()).toEqual(Object.keys(themes.light).sort());
  });
});
