import { describe, expect, it } from 'vitest';
import { contrastRatio, relativeLuminance } from './contrast.js';
import { partnerDash, partnerServices, partnerThemes, type PartnerThemeName } from './partner.js';
import { contrastPairs, nonTextPairs } from './tokens.js';

const names = Object.keys(partnerThemes) as PartnerThemeName[];

describe.each(names)('partner %s: WCAG AA for every text/background pair', (name) => {
  const theme = partnerThemes[name];
  it.each(contrastPairs.map((p) => [p.fg, p.bg, p] as const))('%s on %s', (_fg, _bg, pair) => {
    const ratio = contrastRatio(theme[pair.fg], theme[pair.bg]);
    expect(ratio, `${pair.fg} on ${pair.bg} (${pair.use})`).toBeGreaterThanOrEqual(pair.large ? 3 : 4.5);
  });
});

describe.each(names)('partner %s: 3:1 for every boundary and cue', (name) => {
  const theme = partnerThemes[name];
  // `only` rows: sun follows the light theme's rules, ember the dark theme's.
  const like = name === 'sun' ? 'light' : 'dark';
  it.each(nonTextPairs.filter((p) => !p.only || p.only.includes(like)).map((p) => [p.fg, p.bg, p] as const))('%s against %s', (_fg, _bg, pair) => {
    expect(contrastRatio(theme[pair.fg], theme[pair.bg]), `${pair.fg} against ${pair.bg} (${pair.use})`).toBeGreaterThanOrEqual(3);
  });
});

describe.each(names)('partner %s: service slips and dashboard tops', (name) => {
  it.each(Object.entries(partnerServices[name]))('%s: text on its band, ink on its tint and on the card', (_svc, c) => {
    expect(contrastRatio(c.on, c.fill)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(c.ink, c.tint)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(c.ink, partnerThemes[name].surface)).toBeGreaterThanOrEqual(4.5);
  });
  it('working, no-internet and cash-near tops are readable', () => {
    const d = partnerDash[name];
    for (const stop of d.working) expect(contrastRatio(d.onWorking, stop)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(d.onOffline, d.offline)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(d.onCashNear, d.cashNear)).toBeGreaterThanOrEqual(4.5);
  });
});

/** Blue/teal hue band: Ali's rule for the driver app is "no teal or blue anywhere". */
function isBlueOrTeal(hex: string): boolean {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return false;
  const [r, g, b] = [m[1]!, m[2]!, m[3]!].map((h) => parseInt(h, 16) / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max - min < 0.12) return false; // greys and near-greys carry no hue
  let h = 0;
  if (max === r) h = ((g - b) / (max - min)) % 6;
  else if (max === g) h = (b - r) / (max - min) + 2;
  else h = (r - g) / (max - min) + 4;
  const deg = (h * 60 + 360) % 360;
  return deg >= 165 && deg <= 260;
}

describe('no teal or blue in the dashboard', () => {
  it.each(names)('%s theme', (name) => {
    const blue = Object.entries(partnerThemes[name]).filter(([, v]) => v.startsWith('#') && isBlueOrTeal(v));
    expect(blue).toEqual([]);
  });
  it('the hue check itself catches the old info blue and kashi teal', () => {
    expect(isBlueOrTeal('#2F6FB0')).toBe(true);
    expect(isBlueOrTeal('#0B6577')).toBe(true);
    expect(isBlueOrTeal('#F38A1B')).toBe(false);
    expect(relativeLuminance('#FFFFFF')).toBeCloseTo(1, 5);
  });
});
