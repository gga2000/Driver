import { contrastRatio, themes } from '@driver/design-tokens';
import { describe, expect, it } from 'vitest';
import {
  CONSOLE_PAIRS,
  CONSOLE_ROLES,
  mix,
  palettes,
  themeCss,
  type ConsoleTheme,
} from './palette';

/** Reads the variables back out of the generated CSS, so the test checks what the browser gets. */
function varsOf(css: string, selector: string): Record<string, string> {
  const start = css.indexOf(`${selector}{`);
  const body = css.slice(start + selector.length + 1, css.indexOf('}', start));
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/--c-([a-z0-9-]+):(\d+) (\d+) (\d+);/g)) {
    out[m[1]!] = `#${[m[2], m[3], m[4]]
      .map((v) => Number(v).toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase()}`;
  }
  return out;
}

const css = themeCss();
const generated: Record<ConsoleTheme, Record<string, string>> = {
  light: varsOf(css, ':root,[data-theme=light]'),
  dark: varsOf(css, '[data-theme=dark]'),
};

describe('console palette', () => {
  it('generates every role for both themes', () => {
    for (const theme of ['light', 'dark'] as const) {
      expect(Object.keys(generated[theme]).sort()).toEqual([...CONSOLE_ROLES].sort());
    }
  });

  it('keeps the brand spec values', () => {
    const l = generated.light;
    expect([l.canvas, l.surface, l.text, l.muted, l.accent, l['accent-text'], l.line]).toEqual([
      themes.light.bg,
      themes.light.surface,
      themes.light.text,
      themes.light.textMuted,
      '#E08A1E',
      '#9A5200',
      themes.light.border,
    ]);
  });

  it('mixes token steps', () => {
    expect(mix('#000000', '#FFFFFF', 0.5)).toBe('#808080');
    expect(mix('#E08A1E', '#E08A1E', 0.3)).toBe('#E08A1E');
  });

  describe.each(['light', 'dark'] as const)('%s theme meets WCAG AA', (theme) => {
    it.each(CONSOLE_PAIRS.map((p) => [`${p.fg} on ${p.bg}`, p] as const))('%s', (_label, pair) => {
      const vars = generated[theme];
      const ratio = contrastRatio(vars[pair.fg]!, vars[pair.bg]!);
      if (ratio < pair.min) {
        throw new Error(
          `${theme}: ${pair.fg} ${vars[pair.fg]} on ${pair.bg} ${vars[pair.bg]} = ${ratio.toFixed(2)}:1 (< ${pair.min}:1) — ${pair.use}`,
        );
      }
      expect(ratio).toBeGreaterThanOrEqual(pair.min);
    });
  });

  it('the generated CSS matches the palette objects', () => {
    for (const theme of ['light', 'dark'] as const) {
      for (const role of CONSOLE_ROLES)
        expect(generated[theme][role]).toBe(palettes[theme][role].toUpperCase());
    }
  });

  it('has no blue or teal anywhere (CON-11, the brand rule)', () => {
    const hue = (hex: string) => {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number];
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const d = max - min;
      const l = (max + min) / 2;
      const sat = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
      if (d === 0) return { h: 0, sat };
      const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
      return { h: (h * 60 + 360) % 360, sat };
    };
    for (const theme of ['light', 'dark'] as const) {
      for (const role of CONSOLE_ROLES) {
        const value = palettes[theme][role];
        if (!/^#[0-9A-Fa-f]{6}$/.test(value)) continue;
        const { h, sat } = hue(value);
        const blueish = sat > 0.15 && h >= 165 && h <= 265;
        expect(blueish, `${theme} ${role} ${value} is blue/teal`).toBe(false);
      }
    }
  });
});
