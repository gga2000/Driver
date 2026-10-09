import { validateStyleMin } from '@maplibre/maplibre-gl-style-spec';
import { describe, expect, it } from 'vitest';
import {
  buildGoldenStyle,
  FURROW_PATTERN,
  GOLDEN_FIRST_LABEL,
  GOLDEN_FONTS,
  GOLDEN_PALETTES,
  GOLDEN_SOURCE,
  goldenImages,
  lightFor,
  PALM_PATTERN,
  palmPattern,
  resolveLight,
  shadowOffset,
  sunAt,
  type GoldenLight,
  type GoldenMode,
} from './index.js';

const base = { pmtilesUrl: 'pmtiles://https://tiles.example.test/wasit.pmtiles', glyphs: 'https://tiles.example.test/fonts/{fontstack}/{range}.pbf' };
const LIGHTS: GoldenLight[] = ['day', 'morning', 'golden', 'sunset', 'night'];
const MODES: GoldenMode[] = ['customer', 'courier', 'console', 'lite'];
const ids = (s: ReturnType<typeof buildGoldenStyle>) => s.layers.map((l) => l.id);

describe('the sun over Aziziyah', () => {
  // Aziziyah is UTC+3; 9 Oct sunrise ≈ 05:55, solar noon ≈ 11:50, sunset ≈ 17:45 local.
  it('is high at noon, low in the late afternoon and below the horizon at night', () => {
    const noon = sunAt(new Date('2026-10-09T08:50:00Z'));
    expect(noon.alt).toBeGreaterThan(50);
    expect(noon.az).toBeGreaterThan(160);
    expect(noon.az).toBeLessThan(200);
    expect(lightFor(noon)).toBe('day');
    expect(lightFor(sunAt(new Date('2026-10-09T13:45:00Z')))).toBe('golden'); // 16:45, in the west
    expect(lightFor(sunAt(new Date('2026-10-09T03:45:00Z')))).toBe('morning'); // 06:45, in the east
    expect(lightFor(sunAt(new Date('2026-10-09T14:50:00Z')))).toBe('sunset'); // 17:50, maghrib
    expect(lightFor(sunAt(new Date('2026-10-09T19:00:00Z')))).toBe('night');
  });
  it('follows the clock by default and keeps a pinned light', () => {
    expect(resolveLight({ now: new Date('2026-10-09T19:00:00Z') }).light).toBe('night');
    expect(resolveLight({ light: 'golden', now: new Date('2026-10-09T19:00:00Z') }).light).toBe('golden');
  });
});

describe('buildGoldenStyle', () => {
  it('is a valid MapLibre style for every light and every screen', () => {
    for (const light of LIGHTS) {
      for (const mode of MODES) {
        const style = buildGoldenStyle({ ...base, light, mode });
        expect(validateStyleMin(style), `${light}/${mode}`).toEqual([]);
        expect(style.glyphs).toBe(base.glyphs);
        expect(style.sources[GOLDEN_SOURCE]).toMatchObject({ type: 'vector', url: base.pmtilesUrl });
        expect(new Set(ids(style)).size).toBe(style.layers.length);
      }
    }
  });
  it('reads only the layers the tiles carry and only the fonts glyphs.py writes', () => {
    const style = buildGoldenStyle({ ...base, light: 'golden', mode: 'courier' });
    const sourceLayers = new Set(style.layers.flatMap((l) => ('source-layer' in l && l['source-layer'] ? [l['source-layer']] : [])));
    expect([...sourceLayers].sort()).toEqual(['buildings', 'landuse', 'localities', 'palms', 'places', 'roads', 'water']);
    const night = buildGoldenStyle({ ...base, light: 'night', mode: 'customer' });
    expect(night.layers.filter((l) => 'source-layer' in l && l['source-layer'] === 'lights').map((l) => l.id)).toEqual(['golden-window-glow']);
    const fonts = new Set<string>(Object.values(GOLDEN_FONTS).flat());
    for (const l of style.layers) {
      if (l.type === 'symbol') for (const f of (l.layout?.['text-font'] as string[]) ?? []) expect(fonts.has(f)).toBe(true);
    }
  });
  it('keeps labels on top, so routes added before GOLDEN_FIRST_LABEL never hide a street name', () => {
    const style = buildGoldenStyle({ ...base, light: 'day' });
    const first = ids(style).indexOf(GOLDEN_FIRST_LABEL);
    expect(first).toBeGreaterThan(0);
    expect(style.layers.slice(first).every((l) => l.type === 'symbol')).toBe(true);
    expect(style.layers.slice(0, first).some((l) => l.type === 'symbol')).toBe(false);
  });
  it('draws less where less is needed: no 3D, shadows or patterns on the Console and cheap phones', () => {
    for (const mode of ['console', 'lite'] as const) {
      const style = buildGoldenStyle({ ...base, light: 'golden', mode });
      expect(style.layers.some((l) => l.type === 'fill-extrusion')).toBe(false);
      expect(ids(style).some((id) => id.startsWith('golden-shadow') || id.startsWith('golden-glint') || id === 'golden-palm-crowns')).toBe(false);
      expect(style.sky).toBeUndefined();
    }
    const courier = buildGoldenStyle({ ...base, light: 'golden', mode: 'courier' });
    expect(courier.sky).toBeDefined();
    const rise = (s: typeof courier) => s.layers.find((l) => l.id === 'golden-houses-3d')!.minzoom!;
    expect(rise(courier)).toBeLessThan(rise(buildGoldenStyle({ ...base, light: 'golden', mode: 'customer' })));
  });

  it('stands bridges up with the houses, the stair huts just after, and the small tanks and dishes only up close', () => {
    const style = buildGoldenStyle({ ...base, light: 'golden', mode: 'customer' });
    const z = (id: string) => style.layers.find((l) => l.id === id)!.minzoom!;
    expect(z('golden-roof-huts')).toBeGreaterThan(z('golden-houses-3d'));
    expect(z('golden-roof-tanks')).toBeGreaterThan(z('golden-roof-huts'));
    expect(z('golden-bridge-3d')).toBe(z('golden-houses-3d'));
  });
  it('lights the main streets like sodium lamps at night only, and casts no shadows in the dark', () => {
    const night = ids(buildGoldenStyle({ ...base, light: 'night' }));
    expect(night).toContain('golden-lamp-glow');
    expect(night.some((id) => id.startsWith('golden-shadow'))).toBe(false);
    const day = ids(buildGoldenStyle({ ...base, light: 'day' }));
    expect(day).not.toContain('golden-lamp-glow');
    expect(day.filter((id) => id.startsWith('golden-shadow'))).toHaveLength(3);
  });
});

describe('shadows', () => {
  it('fall away from the sun and lengthen as it sinks', () => {
    const west = { az: 260, alt: 14 };
    const [x, y] = shadowOffset(west, 6.8, 18);
    expect(x).toBeGreaterThan(0); // sun in the west → shadow to the east (right)
    expect(Math.abs(y)).toBeLessThan(Math.abs(x));
    expect(Math.hypot(...shadowOffset({ az: 260, alt: 50 }, 6.8, 18))).toBeLessThan(Math.hypot(x, y));
    // doubling per zoom level, like the map itself
    expect(shadowOffset(west, 6.8, 19)[0]).toBeCloseTo(x * 2, 0);
  });
});

describe('palettes', () => {
  const hue = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number];
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    if (max - min < 0.04) return null; // grey: no hue to judge
    const h = max === r ? ((g - b) / (max - min)) % 6 : max === g ? (b - r) / (max - min) + 2 : (r - g) / (max - min) + 4;
    return (h * 60 + 360) % 360;
  };
  it('never use blue or teal (brand rule): water is olive, night is brown', () => {
    for (const [light, p] of Object.entries(GOLDEN_PALETTES)) {
      for (const [key, value] of Object.entries(p)) {
        if (typeof value !== 'string') continue;
        const h = hue(value);
        if (h !== null) expect(h < 160 || h > 260, `${light}.${key} ${value}`).toBe(true);
      }
    }
  });
});

describe('palm pattern', () => {
  it('is a 36 px opaque tile in the grove colours, with crowns drawn on it', () => {
    const img = palmPattern(GOLDEN_PALETTES.golden);
    expect(img.width).toBe(36);
    expect(img.data).toHaveLength(36 * 36 * 4);
    const alphas = new Set<number>();
    const colours = new Set<string>();
    for (let i = 0; i < img.data.length; i += 4) {
      alphas.add(img.data[i + 3]!);
      colours.add(`${img.data[i]},${img.data[i + 1]},${img.data[i + 2]}`);
    }
    expect([...alphas]).toEqual([255]);
    expect(colours.size).toBeGreaterThan(5);
    expect(Object.keys(goldenImages('night'))).toEqual([PALM_PATTERN, FURROW_PATTERN]);
  });
});
